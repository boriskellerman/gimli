/**
 * Test-Fix AI Developer Workflow (ADW)
 *
 * A three-stage workflow that:
 * 1. Analyzes: Understands the test failure or bug report
 * 2. Fixes: Proposes and implements fix candidates
 * 3. Verifies: Runs tests and measures improvement
 *
 * This workflow is designed for automated bug fixing with validation.
 */

import {
  type ADWDefinition,
  type ADWContext,
  type ADWResult,
  type StageConfig,
  type TriggerType,
  type ADWLogger,
  DEFAULT_RETRY_CONFIG,
  executeADW,
  createConsoleLogger,
  createFileLogger,
} from "./adw-base.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for the test-fix workflow
 */
export interface TestFixInput {
  /** Test failure output or bug description */
  issue: string;
  /** Type of issue */
  issueType: "test_failure" | "bug_report" | "regression";
  /** Failing test file(s) if known */
  testFiles?: string[];
  /** Source file(s) suspected to contain the bug */
  sourceFiles?: string[];
  /** Stack trace if available */
  stackTrace?: string;
  /** Expected behavior */
  expectedBehavior?: string;
  /** Actual behavior */
  actualBehavior?: string;
  /** Additional context */
  context?: string;
  /** Maximum fix attempts */
  maxAttempts?: number;
}

/**
 * Root cause analysis from the analysis stage
 */
export interface RootCauseAnalysis {
  /** Summary of the issue */
  summary: string;
  /** Identified root cause */
  rootCause: string;
  /** Confidence level */
  confidence: "high" | "medium" | "low";
  /** Affected files */
  affectedFiles: string[];
  /** Proposed fix approaches */
  proposedFixes: Array<{
    id: string;
    description: string;
    approach: string;
    risk: "low" | "medium" | "high";
    files: string[];
  }>;
  /** Related issues or similar past bugs */
  relatedIssues?: string[];
}

/**
 * Fix result from the implementation stage
 */
export interface FixResult {
  /** Fix ID that was applied */
  fixId: string;
  /** Description of changes made */
  changes: string;
  /** Files modified */
  filesModified: string[];
  /** Whether a commit was created */
  committed?: boolean;
  /** Commit SHA if created */
  commitSha?: string;
}

/**
 * Verification result from the testing stage
 */
export interface VerificationResult {
  /** Whether verification passed */
  passed: boolean;
  /** Test results */
  testResults: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  /** Whether the specific failing test now passes */
  targetTestPassed: boolean;
  /** Any new failures introduced */
  newFailures?: string[];
  /** Performance impact if measured */
  performanceImpact?: string;
}

// ============================================================================
// Stage Definitions
// ============================================================================

const ANALYSIS_STAGE: StageConfig = {
  id: "analyze",
  name: "Root Cause Analysis",
  description: "Analyze the test failure or bug to identify root cause",
  agent: {
    thinking: "high",
    systemPromptAdditions: `You are a debugging expert performing root cause analysis.

Your job is to:
1. Understand the test failure or bug report thoroughly
2. Analyze the stack trace and error messages
3. Identify the root cause of the issue
4. Propose fix approaches with risk assessment

Important:
- Read the relevant source files carefully
- Look for edge cases and boundary conditions
- Consider recent changes that might have caused the issue
- Check for similar patterns elsewhere in the codebase

Output a structured analysis with:
- Clear summary of the issue
- Identified root cause with confidence level
- List of affected files
- 1-3 proposed fix approaches with risk assessment`,
  },
  timeoutSeconds: 300,
  required: true,
};

const FIX_STAGE: StageConfig = {
  id: "fix",
  name: "Implement Fix",
  description: "Implement the most appropriate fix",
  agent: {
    thinking: "medium",
    systemPromptAdditions: `You are implementing a bug fix based on root cause analysis.

Your job is to:
1. Review the proposed fixes from the analysis
2. Choose the most appropriate fix (lowest risk, highest confidence)
3. Implement the fix carefully
4. Ensure the fix doesn't introduce new issues

Guidelines:
- Make minimal changes to fix the issue
- Preserve existing behavior for unaffected cases
- Add comments explaining the fix if the logic is non-obvious
- Don't refactor unrelated code

After implementing:
- List all files modified
- Describe exactly what was changed
- Note any potential side effects`,
  },
  timeoutSeconds: 300,
  required: true,
  dependsOn: ["analyze"],
};

const VERIFY_STAGE: StageConfig = {
  id: "verify",
  name: "Verify Fix",
  description: "Run tests to verify the fix works",
  agent: {
    thinking: "low",
    systemPromptAdditions: `You are verifying that a bug fix works correctly.

Your job is to:
1. Run the originally failing test(s)
2. Run the full test suite to check for regressions
3. Verify the fix addresses the root cause
4. Check that no new issues were introduced

Report:
- Whether the target test now passes
- Full test suite results
- Any new failures introduced
- Overall assessment of the fix quality`,
  },
  timeoutSeconds: 600,
  required: true,
  dependsOn: ["fix"],
};

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Create the test-fix workflow definition
 */
export function createTestFixDefinition(options?: Partial<ADWDefinition>): ADWDefinition {
  return {
    id: "test-fix",
    name: "Test and Fix",
    description: "Analyze test failures, implement fixes, and verify they work",
    version: "1.0.0",
    stages: [ANALYSIS_STAGE, FIX_STAGE, VERIFY_STAGE],
    retryConfig: {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 2,
    },
    totalTimeoutSeconds: 1800, // 30 minutes
    tags: ["bugfix", "testing"],
    ...options,
  };
}

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build the prompt for the analysis stage
 */
function buildAnalysisPrompt(input: TestFixInput): string {
  const lines: string[] = [
    "# Bug Analysis Request",
    "",
    `## Issue Type: ${input.issueType.replace("_", " ")}`,
    "",
    "## Issue Description",
    input.issue,
    "",
  ];

  if (input.stackTrace) {
    lines.push("## Stack Trace", "```", input.stackTrace, "```", "");
  }

  if (input.expectedBehavior) {
    lines.push("## Expected Behavior", input.expectedBehavior, "");
  }

  if (input.actualBehavior) {
    lines.push("## Actual Behavior", input.actualBehavior, "");
  }

  if (input.testFiles && input.testFiles.length > 0) {
    lines.push("## Failing Test Files");
    for (const file of input.testFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (input.sourceFiles && input.sourceFiles.length > 0) {
    lines.push("## Suspected Source Files");
    for (const file of input.sourceFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (input.context) {
    lines.push("## Additional Context", input.context, "");
  }

  lines.push(
    "## Instructions",
    "1. Read and analyze the failing test(s) and relevant source code",
    "2. Identify the root cause of the failure",
    "3. Propose 1-3 fix approaches with risk assessment",
    "4. Recommend which fix to implement",
  );

  return lines.join("\n");
}

/**
 * Build the prompt for the fix stage
 */
function buildFixPrompt(input: TestFixInput, context: ADWContext): string {
  const analysisResult = context.stageResults.get("analyze");
  const analysisOutput = analysisResult?.output || "No analysis available";

  const lines: string[] = [
    "# Bug Fix Implementation",
    "",
    "## Original Issue",
    input.issue,
    "",
    "## Root Cause Analysis",
    analysisOutput,
    "",
    "## Instructions",
    "1. Review the analysis and proposed fixes",
    "2. Select the most appropriate fix (prefer low-risk options)",
    "3. Implement the fix carefully",
    "4. List all changes made",
    "",
    "Important:",
    "- Make minimal, focused changes",
    "- Don't introduce new features or refactoring",
    "- Preserve existing behavior for unaffected cases",
  ];

  return lines.join("\n");
}

/**
 * Build the prompt for the verification stage
 */
function buildVerifyPrompt(input: TestFixInput, context: ADWContext): string {
  const analysisResult = context.stageResults.get("analyze");
  const fixResult = context.stageResults.get("fix");

  const lines: string[] = [
    "# Fix Verification",
    "",
    "## Original Issue",
    input.issue,
    "",
    "## Analysis Summary",
    analysisResult?.output ? analysisResult.output.slice(0, 500) + "..." : "Not available",
    "",
    "## Fix Applied",
    fixResult?.output || "Not available",
    "",
    "## Verification Instructions",
    "",
  ];

  if (input.testFiles && input.testFiles.length > 0) {
    lines.push("### Run the specific failing test(s):");
    for (const file of input.testFiles) {
      lines.push(`pnpm test ${file}`);
    }
    lines.push("");
  }

  lines.push(
    "### Then run the full test suite:",
    "pnpm test",
    "",
    "### Report:",
    "1. Does the originally failing test now pass?",
    "2. Full test results (passed/failed/skipped)",
    "3. Any new failures introduced?",
    "4. Overall fix quality assessment",
  );

  return lines.join("\n");
}

/**
 * Build prompt for a stage based on context
 */
function buildPrompt(stage: StageConfig, context: ADWContext): string {
  const input = context.input as TestFixInput;

  switch (stage.id) {
    case "analyze":
      return buildAnalysisPrompt(input);
    case "fix":
      return buildFixPrompt(input, context);
    case "verify":
      return buildVerifyPrompt(input, context);
    default:
      throw new Error(`Unknown stage: ${stage.id}`);
  }
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute the test-fix workflow
 */
export async function executeTestFix(
  input: TestFixInput,
  trigger: { type: TriggerType; source?: string; metadata?: Record<string, unknown> },
  options?: {
    workingDir?: string;
    logger?: ADWLogger;
    resultsDir?: string;
    logFile?: string;
  },
): Promise<ADWResult> {
  const definition = createTestFixDefinition();

  // Create logger
  let logger = options?.logger;
  if (!logger) {
    logger = options?.logFile
      ? createFileLogger(options.logFile, "test-fix")
      : createConsoleLogger("test-fix");
  }

  return executeADW(definition, input as unknown as Record<string, unknown>, trigger, buildPrompt, {
    workingDir: options?.workingDir,
    logger,
    resultsDir: options?.resultsDir,
  });
}

// ============================================================================
// Result Parsing
// ============================================================================

/**
 * Parse root cause analysis from the analysis stage output
 */
export function parseAnalysis(output: string): RootCauseAnalysis | null {
  try {
    // Extract summary
    const summaryMatch = output.match(/(?:summary|issue)[:\s]*([^\n]+(?:\n(?![#*-])[^\n]+)*)/i);
    const summary = summaryMatch ? summaryMatch[1].trim() : output.split("\n")[0] || "";

    // Extract root cause
    const rootCauseMatch = output.match(
      /(?:root\s*cause|cause)[:\s]*([^\n]+(?:\n(?![#*-])[^\n]+)*)/i,
    );
    const rootCause = rootCauseMatch ? rootCauseMatch[1].trim() : "Unknown";

    // Determine confidence
    let confidence: "high" | "medium" | "low" = "medium";
    if (/high\s*confidence/i.test(output)) confidence = "high";
    if (/low\s*confidence/i.test(output)) confidence = "low";

    // Extract affected files - look for file paths in various formats
    const affectedFiles: string[] = [];
    // Match "file: path" or "affected: path" patterns
    const fileMatches1 = output.matchAll(/(?:file|affected)[:\s]*[`"]?([^\s`"]+\.\w+)[`"]?/gi);
    for (const match of fileMatches1) {
      if (!affectedFiles.includes(match[1])) {
        affectedFiles.push(match[1]);
      }
    }
    // Also match "- path" list format (common in markdown)
    const fileMatches2 = output.matchAll(/^-\s+([^\s]+\.\w+)/gm);
    for (const match of fileMatches2) {
      if (!affectedFiles.includes(match[1])) {
        affectedFiles.push(match[1]);
      }
    }

    // Extract proposed fixes
    const proposedFixes: RootCauseAnalysis["proposedFixes"] = [];
    const fixMatches = output.matchAll(/(?:fix|approach|option)\s*(\d+)[:\s]*([^\n]+)/gi);
    let fixId = 1;
    for (const match of fixMatches) {
      proposedFixes.push({
        id: `fix-${fixId++}`,
        description: match[2].trim(),
        approach: match[2].trim(),
        risk: "medium",
        files: [],
      });
    }

    return {
      summary,
      rootCause,
      confidence,
      affectedFiles,
      proposedFixes:
        proposedFixes.length > 0
          ? proposedFixes
          : [
              {
                id: "fix-1",
                description: "Apply fix based on analysis",
                approach: "Direct fix",
                risk: "medium",
                files: affectedFiles,
              },
            ],
    };
  } catch {
    return null;
  }
}

/**
 * Parse fix result from the fix stage output
 */
export function parseFixResult(output: string): FixResult | null {
  try {
    const filesModified: string[] = [];
    const fileMatches = output.matchAll(
      /(?:modified|changed|updated|created)[:\s]*[`"]?([^\s`"]+\.\w+)[`"]?/gi,
    );
    for (const match of fileMatches) {
      if (!filesModified.includes(match[1])) {
        filesModified.push(match[1]);
      }
    }

    // Check for commit
    const commitMatch = output.match(/commit[:\s]*[`"]?([a-f0-9]{7,40})[`"]?/i);
    const committed = commitMatch !== null;
    const commitSha = commitMatch ? commitMatch[1] : undefined;

    // Extract changes description
    const changesMatch = output.match(/(?:changes?|fix)[:\s]*([^\n]+(?:\n(?![#*-])[^\n]+)*)/i);
    const changes = changesMatch ? changesMatch[1].trim() : "Fix applied";

    return {
      fixId: "fix-1",
      changes,
      filesModified,
      committed,
      commitSha,
    };
  } catch {
    return null;
  }
}

/**
 * Parse verification result from the verify stage output
 */
export function parseVerificationResult(output: string): VerificationResult | null {
  try {
    // Parse test counts
    const passedMatch = output.match(/(\d+)\s*(?:tests?\s*)?passed/i);
    const failedMatch = output.match(/(\d+)\s*(?:tests?\s*)?failed/i);
    const skippedMatch = output.match(/(\d+)\s*(?:tests?\s*)?skipped/i);

    const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
    const total = passed + failed + skipped;

    // Check if target test passed
    const targetTestPassed =
      /(?:target|original|failing)\s*test[s]?\s*(?:now\s*)?pass(?:es|ed)?/i.test(output) ||
      (failed === 0 && passed > 0);

    // Check for new failures
    const newFailures: string[] = [];
    const newFailureMatches = output.matchAll(/new\s*failure[:\s]*([^\n]+)/gi);
    for (const match of newFailureMatches) {
      newFailures.push(match[1].trim());
    }

    // Determine if passed overall
    const verificationPassed = failed === 0 && targetTestPassed && newFailures.length === 0;

    return {
      passed: verificationPassed,
      testResults: { total, passed, failed, skipped },
      targetTestPassed,
      newFailures: newFailures.length > 0 ? newFailures : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Get structured results from a test-fix execution
 */
export function getTestFixResults(result: ADWResult): {
  analysis: RootCauseAnalysis | null;
  fix: FixResult | null;
  verification: VerificationResult | null;
} {
  const analyzeStage = result.stageResults.find((s) => s.stageId === "analyze");
  const fixStage = result.stageResults.find((s) => s.stageId === "fix");
  const verifyStage = result.stageResults.find((s) => s.stageId === "verify");

  return {
    analysis: analyzeStage?.output ? parseAnalysis(analyzeStage.output) : null,
    fix: fixStage?.output ? parseFixResult(fixStage.output) : null,
    verification: verifyStage?.output ? parseVerificationResult(verifyStage.output) : null,
  };
}

/**
 * Determine if the fix was successful
 */
export function wasFixSuccessful(result: ADWResult): boolean {
  if (result.status !== "completed") return false;

  const { verification } = getTestFixResults(result);
  if (!verification) return false;

  return verification.passed && verification.targetTestPassed;
}
