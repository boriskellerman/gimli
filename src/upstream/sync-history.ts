/**
 * Sync history storage for upstream changes
 *
 * Stores history of all upstream sync operations including:
 * - Commits analyzed
 * - Changes applied/rejected
 * - Risk assessments
 * - Integration results
 */

import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG_DIR } from "../utils.js";
import type { CommitInfo } from "./commit-monitor.js";
import type { DiffAnalysis, ChangeCategory, ChangePriority } from "./diff-analyzer.js";

export const DEFAULT_HISTORY_DIR = path.join(CONFIG_DIR, "upstream");
export const HISTORY_FILENAME = "sync-history.json";
export const MAX_HISTORY_ENTRIES = 1000;

/**
 * Status of a sync operation
 */
export type SyncStatus =
  | "pending" // Detected, not yet evaluated
  | "evaluated" // Risk assessment complete
  | "staged" // Changes staged for testing
  | "testing" // Running tests
  | "approved" // Manual approval received
  | "applied" // Successfully merged
  | "rejected" // Rejected by user or automated checks
  | "failed" // Integration failed
  | "rolled-back"; // Applied but rolled back

/**
 * Risk assessment for a sync operation
 */
export interface RiskAssessment {
  /** Overall risk score (0-100) */
  score: number;
  /** Risk level */
  level: "critical" | "high" | "medium" | "low";
  /** Security impact assessment */
  securityImpact: "none" | "low" | "medium" | "high" | "critical";
  /** Compatibility concerns */
  compatibilityIssues: string[];
  /** Potential conflicts with Gimli modifications */
  conflictAreas: string[];
  /** Recommendation */
  recommendation: "auto-apply" | "review-required" | "manual-only" | "reject";
  /** Reasoning for the recommendation */
  reasoning: string;
}

/**
 * A single sync history entry
 */
export interface SyncHistoryEntry {
  /** Unique entry ID */
  id: string;
  /** Commit SHA */
  commitSha: string;
  /** Commit message (first line) */
  commitMessage: string;
  /** Commit author */
  author: string;
  /** Commit date */
  commitDate: string;
  /** When this entry was created */
  createdAt: string;
  /** When this entry was last updated */
  updatedAt: string;
  /** Current status */
  status: SyncStatus;
  /** Diff analysis results */
  analysis?: DiffAnalysis;
  /** Risk assessment */
  riskAssessment?: RiskAssessment;
  /** Files affected */
  filesAffected: string[];
  /** Primary change category */
  category: ChangeCategory;
  /** Change priority */
  priority: ChangePriority;
  /** Whether this is a security-related change */
  isSecurity: boolean;
  /** Whether this is a breaking change */
  isBreaking: boolean;
  /** Integration branch name (if staged) */
  stagingBranch?: string;
  /** Test results summary */
  testResults?: {
    passed: number;
    failed: number;
    skipped: number;
    summary: string;
  };
  /** User notes/comments */
  notes?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Sync history file format
 */
export interface SyncHistoryFile {
  /** Schema version */
  version: 1;
  /** History entries (newest first) */
  entries: SyncHistoryEntry[];
  /** Last updated timestamp */
  lastUpdated: string;
  /** Statistics */
  stats: {
    totalAnalyzed: number;
    totalApplied: number;
    totalRejected: number;
    totalFailed: number;
  };
}

/**
 * Generate a unique entry ID
 */
function generateEntryId(): string {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Resolve the history file path
 */
export function resolveHistoryPath(historyDir: string = DEFAULT_HISTORY_DIR): string {
  return path.join(historyDir, HISTORY_FILENAME);
}

/**
 * Load sync history from disk
 */
export async function loadHistory(
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<SyncHistoryFile> {
  const filePath = resolveHistoryPath(historyDir);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as SyncHistoryFile;
    if (data.version !== 1) {
      throw new Error("Unsupported history version");
    }
    return data;
  } catch {
    // Return empty history
    return {
      version: 1,
      entries: [],
      lastUpdated: new Date().toISOString(),
      stats: {
        totalAnalyzed: 0,
        totalApplied: 0,
        totalRejected: 0,
        totalFailed: 0,
      },
    };
  }
}

/**
 * Save sync history to disk
 */
export async function saveHistory(
  history: SyncHistoryFile,
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<void> {
  const filePath = resolveHistoryPath(historyDir);
  await fs.mkdir(historyDir, { recursive: true });

  history.lastUpdated = new Date().toISOString();

  const tmp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(history, null, 2), "utf-8");
  await fs.rename(tmp, filePath);
}

/**
 * Add a new entry to sync history
 */
export async function addHistoryEntry(
  commit: CommitInfo,
  analysis: DiffAnalysis,
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<SyncHistoryEntry> {
  const history = await loadHistory(historyDir);

  const entry: SyncHistoryEntry = {
    id: generateEntryId(),
    commitSha: commit.sha,
    commitMessage: commit.message,
    author: commit.author,
    commitDate: commit.date,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "pending",
    analysis,
    filesAffected: analysis.files.map((f) => f.path),
    category: analysis.primaryCategory,
    priority: analysis.priority,
    isSecurity: analysis.isSecurity,
    isBreaking: analysis.isBreaking,
  };

  history.entries.unshift(entry);
  history.stats.totalAnalyzed++;

  // Prune old entries
  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries = history.entries.slice(0, MAX_HISTORY_ENTRIES);
  }

  await saveHistory(history, historyDir);
  return entry;
}

/**
 * Update an existing history entry
 */
export async function updateHistoryEntry(
  id: string,
  updates: Partial<Omit<SyncHistoryEntry, "id" | "commitSha" | "createdAt">>,
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<SyncHistoryEntry | null> {
  const history = await loadHistory(historyDir);
  const index = history.entries.findIndex((e) => e.id === id);

  if (index === -1) {
    return null;
  }

  const oldStatus = history.entries[index].status;
  const newStatus = updates.status;

  history.entries[index] = {
    ...history.entries[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // Update stats based on status change
  if (newStatus && oldStatus !== newStatus) {
    if (newStatus === "applied") history.stats.totalApplied++;
    if (newStatus === "rejected") history.stats.totalRejected++;
    if (newStatus === "failed") history.stats.totalFailed++;
  }

  await saveHistory(history, historyDir);
  return history.entries[index];
}

/**
 * Get a history entry by ID or commit SHA
 */
export async function getHistoryEntry(
  idOrSha: string,
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<SyncHistoryEntry | null> {
  const history = await loadHistory(historyDir);
  return (
    history.entries.find(
      (e) => e.id === idOrSha || e.commitSha === idOrSha || e.commitSha.startsWith(idOrSha),
    ) ?? null
  );
}

/**
 * Query history entries with filters
 */
export async function queryHistory(
  filters: {
    status?: SyncStatus | SyncStatus[];
    category?: ChangeCategory | ChangeCategory[];
    isSecurity?: boolean;
    isBreaking?: boolean;
    priority?: ChangePriority | ChangePriority[];
    since?: Date;
    until?: Date;
    limit?: number;
  } = {},
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<SyncHistoryEntry[]> {
  const history = await loadHistory(historyDir);
  let entries = history.entries;

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    entries = entries.filter((e) => statuses.includes(e.status));
  }

  if (filters.category) {
    const categories = Array.isArray(filters.category) ? filters.category : [filters.category];
    entries = entries.filter((e) => categories.includes(e.category));
  }

  if (filters.isSecurity !== undefined) {
    entries = entries.filter((e) => e.isSecurity === filters.isSecurity);
  }

  if (filters.isBreaking !== undefined) {
    entries = entries.filter((e) => e.isBreaking === filters.isBreaking);
  }

  if (filters.priority) {
    const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    entries = entries.filter((e) => priorities.includes(e.priority));
  }

  if (filters.since) {
    const sinceMs = filters.since.getTime();
    entries = entries.filter((e) => new Date(e.createdAt).getTime() >= sinceMs);
  }

  if (filters.until) {
    const untilMs = filters.until.getTime();
    entries = entries.filter((e) => new Date(e.createdAt).getTime() <= untilMs);
  }

  if (filters.limit) {
    entries = entries.slice(0, filters.limit);
  }

  return entries;
}

/**
 * Calculate risk assessment for a diff analysis
 */
export function calculateRiskAssessment(analysis: DiffAnalysis): RiskAssessment {
  let score = 0;
  const compatibilityIssues: string[] = [];
  const conflictAreas: string[] = [];

  // Security impact
  let securityImpact: RiskAssessment["securityImpact"] = "none";
  if (analysis.isSecurity) {
    const criticalSecurity = analysis.securitySignals.some((s) => s.severity === "critical");
    const highSecurity = analysis.securitySignals.some((s) => s.severity === "high");
    if (criticalSecurity) {
      securityImpact = "critical";
      score += 40;
    } else if (highSecurity) {
      securityImpact = "high";
      score += 25;
    } else {
      securityImpact = "medium";
      score += 15;
    }
  }

  // Breaking changes
  if (analysis.isBreaking) {
    score += 30;
    for (const signal of analysis.breakingSignals) {
      compatibilityIssues.push(`${signal.type}: ${signal.description}`);
    }
  }

  // Check for Gimli-sensitive paths
  const gimliSensitivePaths = [
    /^src\/security\//,
    /^src\/auth\//,
    /^src\/config\//,
    /^src\/gateway\/auth/,
    /credential/i,
    /permission/i,
    /sandbox/i,
  ];

  for (const file of analysis.files) {
    for (const pattern of gimliSensitivePaths) {
      if (pattern.test(file.path)) {
        conflictAreas.push(file.path);
        score += 10;
        break;
      }
    }
  }

  // Priority-based scoring
  switch (analysis.priority) {
    case "critical":
      score += 20;
      break;
    case "high":
      score += 10;
      break;
    case "medium":
      score += 5;
      break;
  }

  // Cap score at 100
  score = Math.min(100, score);

  // Determine risk level
  let level: RiskAssessment["level"];
  if (score >= 70) level = "critical";
  else if (score >= 50) level = "high";
  else if (score >= 25) level = "medium";
  else level = "low";

  // Determine recommendation
  let recommendation: RiskAssessment["recommendation"];
  let reasoning: string;

  if (score >= 70) {
    recommendation = "manual-only";
    reasoning =
      "High risk due to security implications or breaking changes. Manual review required.";
  } else if (score >= 40) {
    recommendation = "review-required";
    reasoning = "Moderate risk. Automated tests recommended before applying.";
  } else if (conflictAreas.length > 0) {
    recommendation = "review-required";
    reasoning = `Changes affect Gimli-sensitive areas: ${conflictAreas.join(", ")}`;
  } else {
    recommendation = "auto-apply";
    reasoning = "Low risk change suitable for automatic integration.";
  }

  return {
    score,
    level,
    securityImpact,
    compatibilityIssues,
    conflictAreas,
    recommendation,
    reasoning,
  };
}

/**
 * Generate a weekly summary of upstream activity
 */
export async function generateWeeklySummary(
  historyDir: string = DEFAULT_HISTORY_DIR,
): Promise<string> {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const entries = await queryHistory({ since: oneWeekAgo }, historyDir);

  if (entries.length === 0) {
    return "No upstream changes detected in the past week.";
  }

  const byCategory = new Map<ChangeCategory, number>();
  let securityCount = 0;
  let breakingCount = 0;
  let appliedCount = 0;
  let rejectedCount = 0;

  for (const entry of entries) {
    byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
    if (entry.isSecurity) securityCount++;
    if (entry.isBreaking) breakingCount++;
    if (entry.status === "applied") appliedCount++;
    if (entry.status === "rejected") rejectedCount++;
  }

  const lines = [
    "# OpenClaw Upstream Weekly Summary",
    "",
    `**Period**: ${oneWeekAgo.toISOString().split("T")[0]} to ${new Date().toISOString().split("T")[0]}`,
    `**Total Changes**: ${entries.length}`,
    "",
    "## By Category",
  ];

  for (const [category, count] of byCategory.entries()) {
    lines.push(`- ${category}: ${count}`);
  }

  lines.push("");
  lines.push("## Notable Changes");

  if (securityCount > 0) {
    lines.push(`- **Security-related**: ${securityCount} change(s)`);
  }
  if (breakingCount > 0) {
    lines.push(`- **Breaking changes**: ${breakingCount}`);
  }

  lines.push("");
  lines.push("## Integration Status");
  lines.push(`- Applied: ${appliedCount}`);
  lines.push(`- Rejected: ${rejectedCount}`);
  lines.push(`- Pending: ${entries.length - appliedCount - rejectedCount}`);

  // Highlight high-priority items
  const highPriority = entries.filter((e) => e.priority === "critical" || e.priority === "high");
  if (highPriority.length > 0) {
    lines.push("");
    lines.push("## High Priority Items");
    for (const entry of highPriority.slice(0, 5)) {
      const sha = entry.commitSha.slice(0, 7);
      lines.push(`- [${sha}] ${entry.commitMessage} (${entry.priority})`);
    }
  }

  return lines.join("\n");
}
