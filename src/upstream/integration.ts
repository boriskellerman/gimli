/**
 * Integration workflow for upstream changes
 *
 * Provides functionality to:
 * - Create staging branches for testing upstream changes
 * - Run automated tests on merged changes
 * - Implement rollback mechanisms
 * - Resolve merge conflicts preserving Gimli security defaults
 */

import fs from "node:fs/promises";
import path from "node:path";

import { runExec, runCommandWithTimeout, type SpawnResult } from "../process/exec.js";
import type { CommitInfo } from "./commit-monitor.js";
import type { DiffAnalysis, ChangePriority } from "./diff-analyzer.js";
import {
  loadHistory,
  saveHistory,
  updateHistoryEntry,
  calculateRiskAssessment,
  type RiskAssessment,
  type SyncHistoryEntry,
  type SyncStatus,
} from "./sync-history.js";

/**
 * Allowlist configuration for auto-apply
 */
export interface AllowlistConfig {
  /** File patterns that are safe to auto-apply */
  safePatterns: RegExp[];
  /** Authors whose changes can be auto-applied */
  trustedAuthors: string[];
  /** Change categories safe for auto-apply */
  safeCategories: string[];
  /** Maximum risk score for auto-apply (0-100) */
  maxAutoApplyRiskScore: number;
}

/**
 * Default allowlist configuration
 * Conservative defaults - most changes require review
 */
export const defaultAllowlistConfig: AllowlistConfig = {
  safePatterns: [
    /^docs\//,
    /^\.github\/(?!workflows)/,
    /README\.md$/,
    /CHANGELOG\.md$/,
    /LICENSE$/,
    /\.md$/,
  ],
  trustedAuthors: [],
  safeCategories: ["documentation", "chore"],
  maxAutoApplyRiskScore: 15,
};

/**
 * Integration result
 */
export interface IntegrationResult {
  success: boolean;
  message: string;
  stagingBranch?: string;
  testResults?: TestResults;
  conflictFiles?: string[];
  error?: string;
}

/**
 * Test results from running tests on staged changes
 */
export interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  summary: string;
  failedTests?: string[];
}

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = "ours" | "theirs" | "manual";

/**
 * Files and patterns that should always keep Gimli's version during conflicts
 */
const GIMLI_SECURITY_DEFAULTS = [
  /^src\/security\//,
  /^src\/auth\//,
  /^src\/gateway\/auth/,
  /credential/i,
  /permission/i,
  /sandbox/i,
  /\.env/,
  /secrets?\./i,
];

/**
 * Check if a file should preserve Gimli's version during conflicts
 */
export function shouldPreserveGimliVersion(filePath: string): boolean {
  return GIMLI_SECURITY_DEFAULTS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if a change is safe to auto-apply based on allowlist
 */
export function isAutoApplyable(
  analysis: DiffAnalysis,
  riskAssessment: RiskAssessment,
  commit: CommitInfo,
  config: AllowlistConfig = defaultAllowlistConfig,
): boolean {
  // Never auto-apply security changes
  if (analysis.isSecurity) return false;

  // Never auto-apply breaking changes
  if (analysis.isBreaking) return false;

  // Check risk score
  if (riskAssessment.score > config.maxAutoApplyRiskScore) return false;

  // Check if all files match safe patterns
  const allFilesSafe = analysis.files.every((file) =>
    config.safePatterns.some((pattern) => pattern.test(file.path)),
  );

  // Check trusted author
  const isTrustedAuthor = config.trustedAuthors.includes(commit.author);

  // Check safe category
  const isSafeCategory = config.safeCategories.includes(analysis.primaryCategory);

  // Auto-apply if files are safe AND (author trusted OR category safe)
  return allFilesSafe && (isTrustedAuthor || isSafeCategory);
}

/**
 * Generate a staging branch name for a commit
 */
export function generateStagingBranchName(commitSha: string): string {
  const shortSha = commitSha.slice(0, 7);
  const timestamp = Date.now().toString(36);
  return `upstream-staging/${shortSha}-${timestamp}`;
}

/**
 * Execute a git command safely
 */
async function git(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  const options = cwd ? { timeoutMs: 60_000 } : 60_000;
  if (cwd) {
    return runCommandWithTimeout(["git", ...args], { timeoutMs: 60_000, cwd }).then((r) => ({
      stdout: r.stdout,
      stderr: r.stderr,
    }));
  }
  return runExec("git", args, options);
}

/**
 * Get the current git branch
 */
export async function getCurrentBranch(cwd?: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return stdout.trim();
}

/**
 * Check if the working directory is clean
 */
export async function isWorkingDirClean(cwd?: string): Promise<boolean> {
  const { stdout } = await git(["status", "--porcelain"], cwd);
  return stdout.trim() === "";
}

/**
 * Create a staging branch for testing upstream changes
 */
export async function createStagingBranch(
  commitSha: string,
  baseBranch: string = "main",
  cwd?: string,
): Promise<string> {
  const branchName = generateStagingBranchName(commitSha);

  // Create branch from base
  await git(["checkout", "-b", branchName, baseBranch], cwd);

  return branchName;
}

/**
 * Cherry-pick a commit onto the current branch
 */
export async function cherryPickCommit(
  commitSha: string,
  cwd?: string,
): Promise<{ success: boolean; conflicts: string[] }> {
  try {
    await git(["cherry-pick", "--no-commit", commitSha], cwd);
    return { success: true, conflicts: [] };
  } catch (error) {
    // Check for conflicts
    const { stdout } = await git(["diff", "--name-only", "--diff-filter=U"], cwd);
    const conflicts = stdout.trim().split("\n").filter(Boolean);

    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    throw error;
  }
}

/**
 * Resolve conflicts for files that should preserve Gimli's version
 */
export async function resolveSecurityConflicts(
  conflictFiles: string[],
  cwd?: string,
): Promise<string[]> {
  const resolved: string[] = [];

  for (const file of conflictFiles) {
    if (shouldPreserveGimliVersion(file)) {
      // Keep our (Gimli's) version
      await git(["checkout", "--ours", file], cwd);
      await git(["add", file], cwd);
      resolved.push(file);
    }
  }

  return resolved;
}

/**
 * Abort a cherry-pick in progress
 */
export async function abortCherryPick(cwd?: string): Promise<void> {
  try {
    await git(["cherry-pick", "--abort"], cwd);
  } catch {
    // May fail if no cherry-pick in progress
  }
}

/**
 * Delete a branch
 */
export async function deleteBranch(branchName: string, cwd?: string): Promise<void> {
  await git(["branch", "-D", branchName], cwd);
}

/**
 * Switch to a branch
 */
export async function switchBranch(branchName: string, cwd?: string): Promise<void> {
  await git(["checkout", branchName], cwd);
}

/**
 * Run tests on the current state
 */
export async function runTests(cwd?: string): Promise<TestResults> {
  const startTime = Date.now();

  try {
    const result = await runCommandWithTimeout(
      ["pnpm", "test", "--run"],
      { timeoutMs: 300_000, cwd }, // 5 minute timeout for tests
    );

    const duration = Date.now() - startTime;
    const { passed, failed, skipped } = parseTestOutput(result.stdout + result.stderr);

    return {
      passed,
      failed,
      skipped,
      duration,
      summary: failed > 0 ? `${failed} test(s) failed` : `All ${passed} tests passed`,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errResult = error as SpawnResult;
    const output = (errResult?.stdout ?? "") + (errResult?.stderr ?? "");
    const { passed, failed, skipped, failedTests } = parseTestOutput(output);

    return {
      passed,
      failed: failed || 1,
      skipped,
      duration,
      summary: `Tests failed: ${failed} failures`,
      failedTests,
    };
  }
}

/**
 * Parse test output to extract pass/fail counts
 */
function parseTestOutput(output: string): {
  passed: number;
  failed: number;
  skipped: number;
  failedTests: string[];
} {
  // Vitest output patterns
  const passMatch = output.match(/(\d+)\s+passed/i);
  const failMatch = output.match(/(\d+)\s+failed/i);
  const skipMatch = output.match(/(\d+)\s+skipped/i);

  const failedTests: string[] = [];
  const failedTestMatches = output.matchAll(/FAIL\s+([^\n]+)/g);
  for (const match of failedTestMatches) {
    failedTests.push(match[1].trim());
  }

  return {
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
    failedTests,
  };
}

/**
 * Rollback staged changes
 */
export async function rollback(
  stagingBranch: string,
  originalBranch: string,
  cwd?: string,
): Promise<void> {
  // Abort any in-progress operations
  await abortCherryPick(cwd);

  // Switch back to original branch
  await switchBranch(originalBranch, cwd);

  // Delete staging branch
  await deleteBranch(stagingBranch, cwd);
}

/**
 * Apply staged changes to the main branch
 */
export async function applyChanges(
  stagingBranch: string,
  targetBranch: string = "main",
  commitMessage: string,
  cwd?: string,
): Promise<void> {
  // Commit staged changes
  await git(["commit", "-m", commitMessage], cwd);

  // Switch to target branch
  await switchBranch(targetBranch, cwd);

  // Merge staging branch
  await git(["merge", "--no-ff", stagingBranch, "-m", `Merge upstream: ${commitMessage}`], cwd);

  // Delete staging branch
  await deleteBranch(stagingBranch, cwd);
}

/**
 * Generate a risk report for human review
 */
export function generateRiskReport(
  commit: CommitInfo,
  analysis: DiffAnalysis,
  riskAssessment: RiskAssessment,
): string {
  const lines: string[] = [
    "# Upstream Change Risk Report",
    "",
    "## Commit Information",
    `- **SHA**: ${commit.sha}`,
    `- **Author**: ${commit.author}`,
    `- **Date**: ${commit.date}`,
    `- **Message**: ${commit.message}`,
    "",
    "## Risk Assessment",
    `- **Score**: ${riskAssessment.score}/100`,
    `- **Level**: ${riskAssessment.level.toUpperCase()}`,
    `- **Security Impact**: ${riskAssessment.securityImpact}`,
    `- **Recommendation**: ${riskAssessment.recommendation}`,
    "",
    `> ${riskAssessment.reasoning}`,
    "",
  ];

  if (analysis.isSecurity) {
    lines.push("## ⚠️ Security Signals");
    for (const signal of analysis.securitySignals) {
      lines.push(`- **${signal.type}** (${signal.severity}): ${signal.description}`);
    }
    lines.push("");
  }

  if (analysis.isBreaking) {
    lines.push("## ⚠️ Breaking Changes");
    for (const signal of analysis.breakingSignals) {
      lines.push(`- **${signal.type}**: ${signal.description}`);
    }
    lines.push("");
  }

  if (riskAssessment.compatibilityIssues.length > 0) {
    lines.push("## Compatibility Issues");
    for (const issue of riskAssessment.compatibilityIssues) {
      lines.push(`- ${issue}`);
    }
    lines.push("");
  }

  if (riskAssessment.conflictAreas.length > 0) {
    lines.push("## Potential Conflict Areas");
    lines.push("These files may conflict with Gimli-specific modifications:");
    for (const area of riskAssessment.conflictAreas) {
      lines.push(`- \`${area}\``);
    }
    lines.push("");
  }

  lines.push("## Files Changed");
  for (const file of analysis.files) {
    const securityNote = shouldPreserveGimliVersion(file.path) ? " 🔒" : "";
    lines.push(`- \`${file.path}\` (+${file.additions}/-${file.deletions})${securityNote}`);
  }
  lines.push("");

  lines.push("## Recommended Actions");
  switch (riskAssessment.recommendation) {
    case "auto-apply":
      lines.push("✅ This change can be automatically applied.");
      break;
    case "review-required":
      lines.push("👀 Review the changes before applying.");
      lines.push("Run `gimli upstream preview <sha>` to see the diff.");
      break;
    case "manual-only":
      lines.push("⚠️ Manual integration required.");
      lines.push("This change requires careful review and testing.");
      break;
    case "reject":
      lines.push("❌ This change is not recommended for integration.");
      lines.push("Review the security and compatibility concerns above.");
      break;
  }

  return lines.join("\n");
}

/**
 * Full integration workflow
 */
export async function stageUpstreamChanges(
  commit: CommitInfo,
  analysis: DiffAnalysis,
  historyDir?: string,
  cwd?: string,
): Promise<IntegrationResult> {
  const riskAssessment = calculateRiskAssessment(analysis);

  // Check if working directory is clean
  if (!(await isWorkingDirClean(cwd))) {
    return {
      success: false,
      message: "Working directory is not clean. Please commit or stash changes first.",
      error: "DIRTY_WORKING_DIR",
    };
  }

  const originalBranch = await getCurrentBranch(cwd);
  let stagingBranch: string | undefined;

  try {
    // Create staging branch
    stagingBranch = await createStagingBranch(commit.sha, originalBranch, cwd);

    // Cherry-pick the commit
    const { success, conflicts } = await cherryPickCommit(commit.sha, cwd);

    if (!success) {
      // Try to resolve security conflicts automatically
      const resolved = await resolveSecurityConflicts(conflicts, cwd);
      const unresolvedConflicts = conflicts.filter((f) => !resolved.includes(f));

      if (unresolvedConflicts.length > 0) {
        // Rollback and report conflicts
        await rollback(stagingBranch, originalBranch, cwd);

        return {
          success: false,
          message: `Merge conflicts in ${unresolvedConflicts.length} file(s) require manual resolution`,
          conflictFiles: unresolvedConflicts,
          error: "MERGE_CONFLICT",
        };
      }
    }

    // Update history entry
    if (historyDir) {
      const history = await loadHistory(historyDir);
      const entry = history.entries.find((e) => e.commitSha === commit.sha);
      if (entry) {
        await updateHistoryEntry(
          entry.id,
          {
            status: "staged",
            stagingBranch,
            riskAssessment,
          },
          historyDir,
        );
      }
    }

    return {
      success: true,
      message: `Changes staged on branch ${stagingBranch}`,
      stagingBranch,
    };
  } catch (error) {
    // Cleanup on error
    if (stagingBranch) {
      try {
        await rollback(stagingBranch, originalBranch, cwd);
      } catch {
        // Ignore cleanup errors
      }
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `Failed to stage changes: ${errorMessage}`,
      error: "STAGING_FAILED",
    };
  }
}

/**
 * Test staged changes
 */
export async function testStagedChanges(
  entryId: string,
  historyDir?: string,
  cwd?: string,
): Promise<IntegrationResult> {
  // Update status to testing
  if (historyDir) {
    await updateHistoryEntry(entryId, { status: "testing" }, historyDir);
  }

  const testResults = await runTests(cwd);

  // Update history with results
  if (historyDir) {
    await updateHistoryEntry(
      entryId,
      {
        status: testResults.failed > 0 ? "evaluated" : "approved",
        testResults: {
          passed: testResults.passed,
          failed: testResults.failed,
          skipped: testResults.skipped,
          summary: testResults.summary,
        },
      },
      historyDir,
    );
  }

  return {
    success: testResults.failed === 0,
    message: testResults.summary,
    testResults,
  };
}
