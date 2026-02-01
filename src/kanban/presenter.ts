/**
 * Results presenter for Kanban solution comparison
 *
 * Presents evaluated solutions with pros/cons across multiple output channels
 * (CLI, chat, web). Implements progressive disclosure: summary view first,
 * then detail/diff views on demand.
 *
 * Design reference: docs/design/kanban-presentation-format.md
 */

import { renderTable, type TableColumn } from "../terminal/table.js";
import { theme, isRich, colorize } from "../terminal/theme.js";
import type { SolutionEvaluation, SolutionRanking } from "./comparator.js";

// ============================================================================
// Constants
// ============================================================================

/**
 * Criterion weights for display
 */
export const CRITERION_WEIGHTS: Record<string, number> = {
  correctness: 0.4,
  quality: 0.25,
  efficiency: 0.15,
  completeness: 0.1,
  safety: 0.1,
};

/**
 * Criterion display labels
 */
export const CRITERION_LABELS: Record<string, string> = {
  correctness: "Correctness",
  quality: "Code Quality",
  efficiency: "Efficiency",
  completeness: "Completeness",
  safety: "Safety",
  overall: "OVERALL",
};

// ============================================================================
// Type definitions
// ============================================================================

/**
 * Summary view data structure
 */
export interface SolutionSummaryView {
  taskId: string;
  taskTitle: string;

  winner: {
    iterationId: string;
    label: string;
    score: number;
    confidence: number;
  } | null;

  iterations: SolutionSummaryRow[];

  winnerStrengths: string[];
  winnerTradeoffs: string[];

  autoAcceptance: {
    eligible: boolean;
    reason: string;
  };

  evaluationDurationMs: number;
  evaluatedAt: number;
}

/**
 * Summary row for a single iteration
 */
export interface SolutionSummaryRow {
  iterationId: string;
  label: string;
  rank: number;

  scores: {
    correctness: number;
    quality: number;
    efficiency: number;
    completeness: number;
    safety: number;
    overall: number;
  };

  isWinner: boolean;
  hasErrors: boolean;
  durationMs: number;
}

/**
 * Detail view data structure
 */
export interface SolutionDetailView {
  iterationId: string;
  label: string;
  taskId: string;
  taskTitle: string;

  status: "completed" | "failed" | "timeout";
  durationMs: number;
  estimatedCostUsd: number;

  scoreBreakdown: ScoreBreakdown;

  filesChanged: FileChange[];
  totalAdditions: number;
  totalDeletions: number;

  reasoning: string;
  output?: string;
  error?: string;
}

/**
 * Score breakdown by category
 */
export interface ScoreBreakdown {
  correctness: CategoryBreakdown;
  quality: CategoryBreakdown;
  efficiency: CategoryBreakdown;
  completeness: CategoryBreakdown;
  safety: CategoryBreakdown;
}

/**
 * Breakdown for a single scoring category
 */
export interface CategoryBreakdown {
  score: number;
  weight: number;
  checks: CheckResult[];
}

/**
 * Individual check result
 */
export interface CheckResult {
  name: string;
  type: "pass" | "fail" | "score" | "info";
  value?: number;
  message?: string;
  source: "automated" | "llm";
}

/**
 * File change information
 */
export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  summary?: string;
}

/**
 * Diff view data structure
 */
export interface DiffView {
  mode: "unified" | "split";
  files: FileDiff[];
  currentFileIndex: number;
  comparison?: {
    leftIteration: string;
    rightIteration: string;
    keyDifferences: string[];
  };
}

/**
 * File diff data
 */
export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  language?: string;
}

/**
 * Diff hunk
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

/**
 * Single diff line
 */
export interface DiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Diff rendering options
 */
export interface DiffRenderOptions {
  contextLines: number;
  syntaxHighlight: boolean;
  wordDiff: boolean;
  maxWidth?: number;
  collapseUnchanged: boolean;
}

/**
 * Default diff options
 */
export const DEFAULT_DIFF_OPTIONS: DiffRenderOptions = {
  contextLines: 3,
  syntaxHighlight: true,
  wordDiff: false,
  collapseUnchanged: true,
};

/**
 * User actions for solution presentation
 */
export type PresentationAction =
  | { type: "accept"; iterationId: string }
  | { type: "reject"; iterationId: string; reason?: string }
  | { type: "rejectAll"; reason?: string }
  | { type: "requestChanges"; iterationId: string; feedback: string }
  | { type: "viewDetails"; iterationId: string }
  | { type: "viewDiff"; iterationId: string; filePath?: string }
  | { type: "compare"; iterationA: string; iterationB: string }
  | { type: "backToSummary" }
  | { type: "nextFile" }
  | { type: "prevFile" }
  | { type: "manualReview" };

/**
 * Action bar configuration
 */
export interface ActionBarConfig {
  context: "summary" | "detail" | "diff" | "compare";
  winnerId?: string;
  currentIterationId?: string;
  hasMultipleFiles?: boolean;
  fileIndex?: number;
  totalFiles?: number;
}

/**
 * Presentation channel interface
 */
export interface PresentationChannel {
  readonly name: string;
  readonly supportsRichFormatting: boolean;
  readonly supportsInteraction: boolean;

  renderSummary(view: SolutionSummaryView): string | object;
  renderDetail(view: SolutionDetailView): string | object;
  renderDiff(diff: DiffView): string | object;
  renderActionBar(config: ActionBarConfig): string | object;

  promptAction?(config: ActionBarConfig): Promise<PresentationAction | null>;
}

/**
 * Action handlers for presenter
 */
export interface ActionHandlers {
  onAccept: (iterationId: string) => Promise<void>;
  onReject: (iterationId: string, reason?: string) => Promise<void>;
  onRejectAll: (reason?: string) => Promise<void>;
  onRequestChanges: (iterationId: string, feedback: string) => Promise<void>;
  onManualReview: () => Promise<void>;
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Check if a score is the highest among iterations for a criterion
 */
export function isHighestScore(
  iterations: SolutionSummaryRow[],
  criterion: string,
  iterationId: string,
): boolean {
  const scores = iterations.map((i) => ({
    id: i.iterationId,
    score: i.scores[criterion as keyof typeof i.scores],
  }));
  const maxScore = Math.max(...scores.map((s) => s.score));
  const iter = scores.find((s) => s.id === iterationId);
  return iter?.score === maxScore;
}

/**
 * Format status with appropriate styling
 */
export function formatStatus(status: string, rich: boolean): string {
  switch (status) {
    case "completed":
      return colorize(rich, theme.success, "Completed");
    case "failed":
      return colorize(rich, theme.error, "Failed");
    case "timeout":
      return colorize(rich, theme.warn, "Timeout");
    default:
      return status;
  }
}

/**
 * Format check prefix with appropriate styling
 */
export function formatCheckPrefix(check: CheckResult, rich: boolean): string {
  switch (check.type) {
    case "pass":
      return colorize(rich, theme.success, "[pass]");
    case "fail":
      return colorize(rich, theme.error, "[fail]");
    case "score":
      return colorize(rich, theme.info, `[${check.value?.toFixed(2) ?? "?"}]`);
    case "info":
      return colorize(rich, theme.muted, "[info]");
    default:
      return "      ";
  }
}

// ============================================================================
// Summary view rendering
// ============================================================================

/**
 * Render summary view for CLI
 */
export function renderSummaryCli(view: SolutionSummaryView): string {
  const rich = isRich();
  const lines: string[] = [];

  // Header
  const title = `Solution Comparison: ${view.taskTitle}`;
  lines.push(colorize(rich, theme.heading, title));
  lines.push("");

  // Winner banner
  if (view.winner) {
    const winnerLine = `Winner: ${view.winner.label}`;
    const scoreLine = `Score: ${view.winner.score.toFixed(2)}`;
    const confLine = `Confidence: ${Math.round(view.winner.confidence * 100)}%`;
    lines.push(colorize(rich, theme.success, `${winnerLine}    ${scoreLine}    ${confLine}`));
    lines.push("");
  } else {
    lines.push(colorize(rich, theme.warn, "No clear winner - manual review required"));
    lines.push("");
  }

  // Comparison table
  if (view.iterations.length > 0) {
    const tableColumns: TableColumn[] = [
      { key: "criterion", header: "Criterion", align: "left", minWidth: 15 },
      ...view.iterations.map((iter) => ({
        key: iter.iterationId,
        header: iter.isWinner ? `*${iter.label}*` : iter.label,
        align: "center" as const,
        minWidth: 10,
      })),
      { key: "weight", header: "Weight", align: "right", minWidth: 8 },
    ];

    const criterionKeys = [
      "correctness",
      "quality",
      "efficiency",
      "completeness",
      "safety",
      "overall",
    ];
    const tableRows = criterionKeys.map((key) => {
      const label = CRITERION_LABELS[key] ?? key;
      const row: Record<string, string> = {
        criterion: key === "overall" ? colorize(rich, theme.accentBright, label) : label,
        weight: key === "overall" ? "100%" : `${Math.round((CRITERION_WEIGHTS[key] ?? 0) * 100)}%`,
      };

      for (const iter of view.iterations) {
        const score = iter.scores[key as keyof typeof iter.scores];
        const formatted = score.toFixed(2);
        const highest = isHighestScore(view.iterations, key, iter.iterationId);
        row[iter.iterationId] = highest
          ? colorize(rich, theme.accentBright, `*${formatted}*`)
          : formatted;
      }

      return row;
    });

    lines.push(
      renderTable({
        columns: tableColumns,
        rows: tableRows,
        width: process.stdout.columns || 80,
        border: "unicode",
      }),
    );
  }

  // Strengths and trade-offs
  if (view.winner && (view.winnerStrengths.length > 0 || view.winnerTradeoffs.length > 0)) {
    lines.push("");
    if (view.winnerStrengths.length > 0) {
      lines.push(
        colorize(
          rich,
          theme.muted,
          `${view.winner.label} Strengths: ${view.winnerStrengths.join(", ")}`,
        ),
      );
    }
    if (view.winnerTradeoffs.length > 0) {
      lines.push(
        colorize(
          rich,
          theme.muted,
          `${view.winner.label} Trade-offs: ${view.winnerTradeoffs.join(", ")}`,
        ),
      );
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Detail view rendering
// ============================================================================

/**
 * Render detail view for CLI
 */
export function renderDetailCli(view: SolutionDetailView): string {
  const rich = isRich();
  const lines: string[] = [];

  // Header
  lines.push(colorize(rich, theme.heading, `Solution Details: ${view.label}`));
  lines.push("");
  lines.push(`Task: ${view.taskTitle}`);
  lines.push(
    `Status: ${formatStatus(view.status, rich)} | ` +
      `Duration: ${(view.durationMs / 1000).toFixed(1)}s | ` +
      `Cost: $${view.estimatedCostUsd.toFixed(2)}`,
  );
  lines.push("");

  // Score breakdown
  lines.push(colorize(rich, theme.heading, "SCORE BREAKDOWN"));
  lines.push("");

  const categories = ["correctness", "quality", "efficiency", "completeness", "safety"] as const;
  for (const category of categories) {
    const breakdown = view.scoreBreakdown[category];
    const label = CRITERION_LABELS[category] ?? category;
    const weightPct = Math.round(breakdown.weight * 100);
    lines.push(
      colorize(rich, theme.accent, `${label}: ${breakdown.score.toFixed(2)} (${weightPct}%)`),
    );

    for (const check of breakdown.checks) {
      const prefix = formatCheckPrefix(check, rich);
      const message = check.message || check.name;
      lines.push(`  ${prefix} ${message}`);
    }
    lines.push("");
  }

  // Files changed
  if (view.filesChanged.length > 0) {
    lines.push(
      colorize(
        rich,
        theme.heading,
        `FILES CHANGED (${view.filesChanged.length} files, +${view.totalAdditions} -${view.totalDeletions})`,
      ),
    );
    lines.push("");

    for (const file of view.filesChanged) {
      const statusChar = { added: "A", modified: "M", deleted: "D", renamed: "R" }[file.status];
      const stats = `(+${file.additions} -${file.deletions})`;
      const summary = file.summary ? `  ${file.summary}` : "";
      lines.push(`  ${statusChar} ${file.path.padEnd(35)} ${stats.padEnd(12)}${summary}`);
    }
    lines.push("");
  }

  // LLM reasoning
  if (view.reasoning) {
    lines.push(colorize(rich, theme.heading, "LLM REASONING"));
    lines.push("");
    lines.push(colorize(rich, theme.muted, `"${view.reasoning}"`));
    lines.push("");
  }

  // Error if present
  if (view.error) {
    lines.push(colorize(rich, theme.error, "ERROR"));
    lines.push("");
    lines.push(colorize(rich, theme.error, view.error));
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Diff view rendering
// ============================================================================

/**
 * Render unified diff for CLI
 */
export function renderUnifiedDiffCli(
  diff: FileDiff,
  _options: DiffRenderOptions = DEFAULT_DIFF_OPTIONS,
): string {
  const rich = isRich();
  const lines: string[] = [];

  lines.push(colorize(rich, theme.heading, `Diff: ${diff.path}`));
  lines.push("");

  for (const hunk of diff.hunks) {
    // Hunk header
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    lines.push(colorize(rich, theme.muted, header));

    for (const line of hunk.lines) {
      const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
      const color =
        line.type === "addition"
          ? theme.success
          : line.type === "deletion"
            ? theme.error
            : (s: string) => s;

      lines.push(colorize(rich, color, `${prefix} ${line.content}`));
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render split comparison diff for CLI
 */
export function renderSplitDiffCli(
  leftDiff: FileDiff,
  rightDiff: FileDiff,
  leftLabel: string,
  rightLabel: string,
  width: number = 80,
): string {
  const rich = isRich();
  const lines: string[] = [];
  const halfWidth = Math.floor((width - 3) / 2);

  lines.push(colorize(rich, theme.heading, `Compare: ${leftLabel} vs ${rightLabel}`));
  lines.push("");

  // Headers
  lines.push(`${leftLabel.padEnd(halfWidth)} | ${rightLabel}`);
  lines.push(`${"─".repeat(halfWidth)} | ${"─".repeat(halfWidth)}`);

  // Extract lines from diffs
  const extractLines = (diff: FileDiff): string[] => {
    const result: string[] = [];
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== "deletion") {
          result.push(line.content);
        }
      }
    }
    return result;
  };

  const leftLines = extractLines(leftDiff);
  const rightLines = extractLines(rightDiff);
  const maxLines = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLines; i++) {
    const left = (leftLines[i] || "").slice(0, halfWidth).padEnd(halfWidth);
    const right = (rightLines[i] || "").slice(0, halfWidth);
    lines.push(`${left} | ${right}`);
  }

  return lines.join("\n");
}

/**
 * Render diff view for CLI (unified or split based on mode)
 */
export function renderDiffCli(
  diff: DiffView,
  options: DiffRenderOptions = DEFAULT_DIFF_OPTIONS,
): string {
  if (diff.mode === "split" && diff.comparison && diff.files.length >= 2) {
    return renderSplitDiffCli(
      diff.files[0],
      diff.files[1],
      diff.comparison.leftIteration,
      diff.comparison.rightIteration,
      options.maxWidth,
    );
  }

  const file = diff.files[diff.currentFileIndex];
  if (!file) {
    return "No diff available.";
  }

  return renderUnifiedDiffCli(file, options);
}

// ============================================================================
// Action bar rendering
// ============================================================================

/**
 * Render action bar for current context
 */
export function renderActionBar(config: ActionBarConfig): string {
  const actions: string[] = [];

  switch (config.context) {
    case "summary":
      if (config.winnerId) {
        actions.push("[a] Accept winner");
      }
      actions.push("[v] View details");
      actions.push("[d] View diff");
      actions.push("[c] Compare pair");
      actions.push("[r] Request changes");
      actions.push("[x] Reject all");
      break;

    case "detail":
      actions.push("[a] Accept this solution");
      actions.push("[d] View full diff");
      actions.push("[c] Compare with...");
      actions.push("[r] Request changes");
      actions.push("[b] Back to summary");
      actions.push("[x] Reject");
      break;

    case "diff":
      if (config.hasMultipleFiles) {
        actions.push(`[n] Next file (${config.fileIndex ?? 1}/${config.totalFiles ?? 1})`);
        actions.push("[p] Prev file");
      }
      actions.push("[a] Accept");
      actions.push("[r] Reject");
      actions.push("[b] Back");
      actions.push("[q] Quit");
      break;

    case "compare":
      actions.push("[1] Select left");
      actions.push("[2] Select right");
      actions.push("[b] Back to summary");
      break;
  }

  return `Actions: ${actions.join("    ")}`;
}

/**
 * Parse user input into action
 */
export function parseAction(input: string, config: ActionBarConfig): PresentationAction | null {
  const key = input.toLowerCase().trim();

  switch (key) {
    case "a":
      return config.currentIterationId
        ? { type: "accept", iterationId: config.currentIterationId }
        : config.winnerId
          ? { type: "accept", iterationId: config.winnerId }
          : null;

    case "x":
      return config.currentIterationId
        ? { type: "reject", iterationId: config.currentIterationId }
        : { type: "rejectAll" };

    case "v":
      return config.winnerId ? { type: "viewDetails", iterationId: config.winnerId } : null;

    case "d":
      return config.currentIterationId
        ? { type: "viewDiff", iterationId: config.currentIterationId }
        : config.winnerId
          ? { type: "viewDiff", iterationId: config.winnerId }
          : null;

    case "c":
      return { type: "compare", iterationA: "", iterationB: "" };

    case "r":
      return { type: "requestChanges", iterationId: config.currentIterationId || "", feedback: "" };

    case "b":
      return { type: "backToSummary" };

    case "n":
      return { type: "nextFile" };

    case "p":
      return { type: "prevFile" };

    case "m":
      return { type: "manualReview" };

    case "q":
      return { type: "backToSummary" };

    default:
      return null;
  }
}

// ============================================================================
// Channel implementations
// ============================================================================

/**
 * CLI presentation channel
 */
export class CliPresentationChannel implements PresentationChannel {
  readonly name = "cli";
  readonly supportsRichFormatting = true;
  readonly supportsInteraction = true;

  renderSummary(view: SolutionSummaryView): string {
    return renderSummaryCli(view);
  }

  renderDetail(view: SolutionDetailView): string {
    return renderDetailCli(view);
  }

  renderDiff(diff: DiffView): string {
    return renderDiffCli(diff);
  }

  renderActionBar(config: ActionBarConfig): string {
    return renderActionBar(config);
  }

  async promptAction(config: ActionBarConfig): Promise<PresentationAction | null> {
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = await rl.question("Choose action: ");
      return parseAction(answer, config);
    } finally {
      rl.close();
    }
  }
}

/**
 * Chat presentation channel (for Discord/Telegram/Slack)
 */
export class ChatPresentationChannel implements PresentationChannel {
  readonly name = "chat";
  readonly supportsRichFormatting = true;
  readonly supportsInteraction = false;

  private maxLength: number;

  constructor(maxLength: number = 2000) {
    this.maxLength = maxLength;
  }

  renderSummary(view: SolutionSummaryView): string {
    const lines: string[] = [];

    lines.push(`**Solution Comparison: ${view.taskTitle}**`);
    lines.push("");

    if (view.winner) {
      lines.push(
        `**Winner:** ${view.winner.label} ` +
          `(Score: ${view.winner.score.toFixed(2)}, ` +
          `Confidence: ${Math.round(view.winner.confidence * 100)}%)`,
      );
      lines.push("");
    }

    // Compact markdown table
    const headers = ["Criterion", ...view.iterations.map((i) => i.label), "Weight"];
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

    const criterionKeys = [
      "correctness",
      "quality",
      "efficiency",
      "completeness",
      "safety",
      "overall",
    ];
    for (const key of criterionKeys) {
      const label = CRITERION_LABELS[key] ?? key;
      const row = [
        label,
        ...view.iterations.map((i) => {
          const score = i.scores[key as keyof typeof i.scores];
          return i.isWinner ? `**${score.toFixed(2)}**` : score.toFixed(2);
        }),
        key === "overall" ? "100%" : `${Math.round((CRITERION_WEIGHTS[key] ?? 0) * 100)}%`,
      ];
      lines.push(`| ${row.join(" | ")} |`);
    }

    lines.push("");
    lines.push("Reply with: `accept`, `reject`, `details`, or `diff`");

    return this.truncate(lines.join("\n"));
  }

  renderDetail(view: SolutionDetailView): string {
    const lines: string[] = [];

    lines.push(`**Solution Details: ${view.label}**`);
    lines.push(`Task: ${view.taskTitle}`);
    lines.push(`Status: ${view.status} | Duration: ${(view.durationMs / 1000).toFixed(1)}s`);
    lines.push("");

    lines.push("**Score Breakdown:**");
    const categories = ["correctness", "quality", "efficiency", "completeness", "safety"] as const;
    for (const category of categories) {
      const breakdown = view.scoreBreakdown[category];
      const label = CRITERION_LABELS[category] ?? category;
      lines.push(`- ${label}: ${breakdown.score.toFixed(2)}`);
    }

    lines.push("");
    lines.push("**Files Changed:**");
    for (const file of view.filesChanged.slice(0, 5)) {
      lines.push(`- ${file.status[0].toUpperCase()} \`${file.path}\``);
    }
    if (view.filesChanged.length > 5) {
      lines.push(`- ... and ${view.filesChanged.length - 5} more`);
    }

    return this.truncate(lines.join("\n"));
  }

  renderDiff(diff: DiffView): string {
    const file = diff.files[diff.currentFileIndex];
    if (!file) {
      return "No diff available.";
    }

    const lines: string[] = [];

    lines.push(`**Diff: ${file.path}**`);
    lines.push("```diff");

    let charCount = lines.join("\n").length;
    const maxDiffChars = this.maxLength - 100;

    outer: for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
        const diffLine = `${prefix} ${line.content}`;

        if (charCount + diffLine.length + 1 > maxDiffChars) {
          lines.push("... (truncated)");
          break outer;
        }

        lines.push(diffLine);
        charCount += diffLine.length + 1;
      }
    }

    lines.push("```");
    return lines.join("\n");
  }

  renderActionBar(_config: ActionBarConfig): string {
    return "Reply: `accept`, `reject`, `details`, `diff`, or `changes <feedback>`";
  }

  private truncate(text: string): string {
    if (text.length <= this.maxLength) return text;
    return text.slice(0, this.maxLength - 20) + "\n\n... (truncated)";
  }
}

/**
 * Web presentation channel (JSON for UI rendering)
 */
export class WebPresentationChannel implements PresentationChannel {
  readonly name = "web";
  readonly supportsRichFormatting = true;
  readonly supportsInteraction = true;

  renderSummary(view: SolutionSummaryView): object {
    return {
      type: "solution_summary",
      data: view,
      actions: [
        { id: "accept", label: "Accept Winner", variant: "primary", disabled: !view.winner },
        { id: "details", label: "View Details", variant: "secondary" },
        { id: "diff", label: "View Diff", variant: "secondary" },
        { id: "compare", label: "Compare", variant: "secondary" },
        { id: "reject", label: "Reject All", variant: "danger" },
      ],
    };
  }

  renderDetail(view: SolutionDetailView): object {
    return {
      type: "solution_detail",
      data: view,
      actions: [
        { id: "accept", label: "Accept Solution", variant: "primary" },
        { id: "diff", label: "View Diff", variant: "secondary" },
        { id: "compare", label: "Compare", variant: "secondary" },
        { id: "changes", label: "Request Changes", variant: "secondary" },
        { id: "back", label: "Back", variant: "ghost" },
        { id: "reject", label: "Reject", variant: "danger" },
      ],
    };
  }

  renderDiff(diff: DiffView): object {
    return {
      type: "solution_diff",
      data: diff,
      navigation: {
        currentFile: diff.currentFileIndex,
        totalFiles: diff.files.length,
        hasNext: diff.currentFileIndex < diff.files.length - 1,
        hasPrev: diff.currentFileIndex > 0,
      },
      actions: [
        { id: "accept", label: "Accept", variant: "primary" },
        { id: "reject", label: "Reject", variant: "danger" },
        { id: "back", label: "Back", variant: "ghost" },
      ],
    };
  }

  renderActionBar(config: ActionBarConfig): object {
    return { context: config.context };
  }
}

// ============================================================================
// View building utilities
// ============================================================================

/**
 * Build summary view from ranking
 */
export function buildSummaryView(
  ranking: SolutionRanking,
  taskTitle: string = "",
  taskId: string = "",
): SolutionSummaryView {
  return {
    taskId,
    taskTitle,

    winner: ranking.winner
      ? {
          iterationId: ranking.winner.solutionId,
          label: ranking.winner.solutionId,
          score: ranking.winner.score,
          confidence: ranking.confidence,
        }
      : null,

    iterations: ranking.solutions.map((sol) => ({
      iterationId: sol.solutionId,
      label: sol.solutionId,
      rank: sol.rank,
      scores: {
        correctness: sol.evaluation.correctness.overall,
        quality: sol.evaluation.quality.overall,
        efficiency: sol.evaluation.efficiency.overall,
        completeness: sol.evaluation.completeness.overall,
        safety: sol.evaluation.safety.overall,
        overall: sol.evaluation.overallScore,
      },
      isWinner: sol.rank === 1,
      hasErrors: !sol.evaluation.correctness.typeCheck || !sol.evaluation.correctness.lintClean,
      durationMs: 0,
    })),

    winnerStrengths: ranking.winner?.strengths || [],
    winnerTradeoffs: ranking.winner?.weaknesses || [],

    autoAcceptance: {
      eligible: false,
      reason: "",
    },

    evaluationDurationMs: 0,
    evaluatedAt: Date.now(),
  };
}

/**
 * Build detail view from evaluation
 */
export function buildDetailView(
  evaluation: SolutionEvaluation,
  taskTitle: string = "",
  taskId: string = "",
): SolutionDetailView {
  return {
    iterationId: evaluation.solutionId,
    label: evaluation.solutionId,
    taskId,
    taskTitle,
    status: "completed",
    durationMs: 0,
    estimatedCostUsd: 0,
    scoreBreakdown: {
      correctness: {
        score: evaluation.correctness.overall,
        weight: CRITERION_WEIGHTS.correctness,
        checks: buildCorrectnessChecks(evaluation),
      },
      quality: {
        score: evaluation.quality.overall,
        weight: CRITERION_WEIGHTS.quality,
        checks: buildQualityChecks(evaluation),
      },
      efficiency: {
        score: evaluation.efficiency.overall,
        weight: CRITERION_WEIGHTS.efficiency,
        checks: buildEfficiencyChecks(evaluation),
      },
      completeness: {
        score: evaluation.completeness.overall,
        weight: CRITERION_WEIGHTS.completeness,
        checks: buildCompletenessChecks(evaluation),
      },
      safety: {
        score: evaluation.safety.overall,
        weight: CRITERION_WEIGHTS.safety,
        checks: buildSafetyChecks(evaluation),
      },
    },
    filesChanged: [],
    totalAdditions: 0,
    totalDeletions: 0,
    reasoning: "",
  };
}

function buildCorrectnessChecks(evaluation: SolutionEvaluation): CheckResult[] {
  const checks: CheckResult[] = [];
  const c = evaluation.correctness;

  checks.push({
    name: "Tests pass",
    type: c.testsPass >= 0.95 ? "pass" : "score",
    value: c.testsPass,
    message: `Tests: ${Math.round(c.testsPass * 100)}% passing`,
    source: "automated",
  });

  checks.push({
    name: "Type check",
    type: c.typeCheck ? "pass" : "fail",
    message: c.typeCheck ? "Type check successful" : "Type check failed",
    source: "automated",
  });

  checks.push({
    name: "Lint",
    type: c.lintClean ? "pass" : "fail",
    message: c.lintClean ? "Lint clean" : "Lint errors present",
    source: "automated",
  });

  checks.push({
    name: "Build",
    type: c.buildSuccess ? "pass" : "fail",
    message: c.buildSuccess ? "Build successful" : "Build failed",
    source: "automated",
  });

  checks.push({
    name: "Requirement coverage",
    type: "score",
    value: c.requirementCoverage,
    message: `Requirement coverage: ${(c.requirementCoverage * 100).toFixed(0)}%`,
    source: "llm",
  });

  return checks;
}

function buildQualityChecks(evaluation: SolutionEvaluation): CheckResult[] {
  const checks: CheckResult[] = [];
  const q = evaluation.quality;

  checks.push({
    name: "Complexity",
    type: "score",
    value: q.complexity.score,
    message: `Complexity: avg ${q.complexity.average.toFixed(1)}, max ${q.complexity.max}`,
    source: "automated",
  });

  checks.push({
    name: "Size",
    type: "score",
    value: q.size.score,
    message: `Size: +${q.size.linesAdded} -${q.size.linesRemoved}`,
    source: "automated",
  });

  checks.push({
    name: "Duplication",
    type: q.duplication.score >= 0.95 ? "pass" : "score",
    value: q.duplication.score,
    message:
      q.duplication.percentage > 0
        ? `Duplication: ${(q.duplication.percentage * 100).toFixed(1)}%`
        : "No duplication detected",
    source: "automated",
  });

  checks.push({
    name: "Pattern adherence",
    type: "score",
    value: q.patternAdherence,
    message: `Pattern adherence: ${(q.patternAdherence * 100).toFixed(0)}%`,
    source: "llm",
  });

  return checks;
}

function buildEfficiencyChecks(evaluation: SolutionEvaluation): CheckResult[] {
  const checks: CheckResult[] = [];
  const e = evaluation.efficiency;

  checks.push({
    name: "Algorithmic",
    type: "score",
    value: e.algorithmic,
    message: `Algorithmic efficiency: ${(e.algorithmic * 100).toFixed(0)}%`,
    source: "llm",
  });

  checks.push({
    name: "Resource cleanup",
    type: e.resourceCleanup ? "pass" : "info",
    message: e.resourceCleanup ? "Resource cleanup present" : "No explicit resource cleanup",
    source: "automated",
  });

  checks.push({
    name: "Async efficiency",
    type: "score",
    value: e.asyncEfficiency,
    message: `Async efficiency: ${(e.asyncEfficiency * 100).toFixed(0)}%`,
    source: "llm",
  });

  return checks;
}

function buildCompletenessChecks(evaluation: SolutionEvaluation): CheckResult[] {
  const checks: CheckResult[] = [];
  const c = evaluation.completeness;

  checks.push({
    name: "Requirements met",
    type: c.requirementsMet >= 0.9 ? "pass" : "score",
    value: c.requirementsMet,
    message: `Requirements: ${(c.requirementsMet * 100).toFixed(0)}% addressed`,
    source: "llm",
  });

  checks.push({
    name: "Documentation",
    type: c.documentationAdded ? "pass" : "info",
    message: c.documentationAdded ? "Documentation added" : "No documentation added",
    source: "automated",
  });

  checks.push({
    name: "Tests",
    type: c.testsAdded > 0 ? "pass" : "info",
    message: c.testsAdded > 0 ? "Tests added" : "No tests added",
    source: "automated",
  });

  return checks;
}

function buildSafetyChecks(evaluation: SolutionEvaluation): CheckResult[] {
  const checks: CheckResult[] = [];
  const s = evaluation.safety;

  checks.push({
    name: "Dangerous operations",
    type: s.noDangerousOps ? "pass" : "fail",
    message: s.noDangerousOps ? "No dangerous operations" : "Dangerous operations detected",
    source: "automated",
  });

  checks.push({
    name: "Security review",
    type: "score",
    value: s.securityReview,
    message: `Security review: ${(s.securityReview * 100).toFixed(0)}%`,
    source: "llm",
  });

  checks.push({
    name: "Secrets",
    type: s.noSecretsExposed ? "pass" : "fail",
    message: s.noSecretsExposed ? "No secrets exposed" : "Possible secrets in code",
    source: "automated",
  });

  checks.push({
    name: "Rollback safety",
    type: "score",
    value: s.rollbackSafe,
    message: `Rollback safety: ${(s.rollbackSafe * 100).toFixed(0)}%`,
    source: "llm",
  });

  return checks;
}

// ============================================================================
// Main presenter class
// ============================================================================

/**
 * Solution presenter that coordinates presentation across channels
 */
export class SolutionPresenter {
  private channel: PresentationChannel;
  private handlers: ActionHandlers;

  constructor(channel: PresentationChannel, handlers: ActionHandlers) {
    this.channel = channel;
    this.handlers = handlers;
  }

  /**
   * Present solution comparison to user
   */
  async presentComparison(
    ranking: SolutionRanking,
    taskTitle: string = "",
    taskId: string = "",
  ): Promise<string | object> {
    const summaryView = buildSummaryView(ranking, taskTitle, taskId);
    return this.channel.renderSummary(summaryView);
  }

  /**
   * Present single solution details
   */
  async presentDetail(
    evaluation: SolutionEvaluation,
    taskTitle: string = "",
    taskId: string = "",
  ): Promise<string | object> {
    const detailView = buildDetailView(evaluation, taskTitle, taskId);
    return this.channel.renderDetail(detailView);
  }

  /**
   * Present diff view
   */
  async presentDiff(
    files: FileDiff[],
    mode: "unified" | "split" = "unified",
  ): Promise<string | object> {
    const diffView: DiffView = {
      mode,
      files,
      currentFileIndex: 0,
    };
    return this.channel.renderDiff(diffView);
  }

  /**
   * Get the action bar for current context
   */
  getActionBar(config: ActionBarConfig): string | object {
    return this.channel.renderActionBar(config);
  }

  /**
   * Handle user action
   */
  async handleAction(action: PresentationAction, ranking: SolutionRanking): Promise<boolean> {
    switch (action.type) {
      case "accept":
        await this.handlers.onAccept(action.iterationId);
        return true;

      case "reject":
        await this.handlers.onReject(action.iterationId, action.reason);
        return true;

      case "rejectAll":
        await this.handlers.onRejectAll(action.reason);
        return true;

      case "requestChanges":
        await this.handlers.onRequestChanges(action.iterationId, action.feedback);
        return true;

      case "manualReview":
        await this.handlers.onManualReview();
        return true;

      case "viewDetails": {
        const sol = ranking.solutions.find((s) => s.solutionId === action.iterationId);
        if (sol) {
          const output = await this.presentDetail(sol.evaluation);
          this.output(output);
        }
        return false;
      }

      case "backToSummary":
      case "nextFile":
      case "prevFile":
      case "viewDiff":
      case "compare":
        // These are navigation actions, not terminal actions
        return false;

      default:
        return false;
    }
  }

  private output(content: string | object): void {
    if (typeof content === "string") {
      console.log(content);
    } else {
      console.log(JSON.stringify(content, null, 2));
    }
  }
}

// ============================================================================
// Factory functions
// ============================================================================

/**
 * Create a presenter for the given channel type
 */
export function createPresenter(
  channelType: "cli" | "chat" | "web",
  handlers: ActionHandlers,
  options?: { maxLength?: number },
): SolutionPresenter {
  let channel: PresentationChannel;

  switch (channelType) {
    case "cli":
      channel = new CliPresentationChannel();
      break;
    case "chat":
      channel = new ChatPresentationChannel(options?.maxLength);
      break;
    case "web":
      channel = new WebPresentationChannel();
      break;
    default:
      throw new Error(`Unknown channel type: ${String(channelType)}`);
  }

  return new SolutionPresenter(channel, handlers);
}

/**
 * Create default no-op handlers (for testing or simple use cases)
 */
export function createDefaultHandlers(): ActionHandlers {
  return {
    onAccept: async () => {},
    onReject: async () => {},
    onRejectAll: async () => {},
    onRequestChanges: async () => {},
    onManualReview: async () => {},
  };
}
