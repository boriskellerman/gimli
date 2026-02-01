# Kanban Solution Presentation Format Design

> **PRD Phase 6 Task**: Design presentation format for showing user the options

## Overview

This document defines the presentation layer for Gimli's Autonomous Kanban Agent. After evaluating multiple solutions from parallel iterations, the system needs to present options to users in a clear, actionable format across multiple output channels (CLI, chat, web).

## Design Principles

1. **Progressive Disclosure**: Show summary first, details on demand
2. **Channel-Appropriate**: Adapt presentation to each output medium
3. **Actionable**: Clear interactive elements for decision-making
4. **Transparent**: Show scoring reasoning, not just scores
5. **Scannable**: Users should grasp key differences at a glance
6. **Accessible**: Work with or without rich formatting/colors

## Presentation Layers

### Layer 1: Summary View (Quick Overview)

The default view when presenting solution comparisons. Shows enough information to make a decision without scrolling.

### Layer 2: Detail View (Deep Dive)

Expanded view for a specific solution, showing full context, code changes, and rationale.

### Layer 3: Diff View (Code Comparison)

Side-by-side or unified diff visualization for code-heavy solutions.

### Layer 4: Interactive Actions

User controls for accepting, rejecting, or requesting changes.

## Summary View Design

### CLI Format

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Solution Comparison: Add user authentication endpoint                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Winner: Iteration #2 (claude-opus)        Score: 0.87    Confidence: 92%  │
│  ────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  ┌─────────────────┬──────────┬──────────┬──────────┬───────────┐          │
│  │ Criterion       │ #1 sonnet │ #2 opus  │ #3 gpt-4o│ Weight    │          │
│  ├─────────────────┼──────────┼──────────┼──────────┼───────────┤          │
│  │ Correctness     │    0.85  │   *0.95* │    0.80  │   40%     │          │
│  │ Code Quality    │    0.75  │   *0.82* │    0.78  │   25%     │          │
│  │ Efficiency      │    0.70  │    0.75  │   *0.80* │   15%     │          │
│  │ Completeness    │    0.90  │   *0.95* │    0.85  │   10%     │          │
│  │ Safety          │    1.00  │    1.00  │    1.00  │   10%     │          │
│  ├─────────────────┼──────────┼──────────┼──────────┼───────────┤          │
│  │ OVERALL         │    0.82  │   *0.87* │    0.81  │  100%     │          │
│  └─────────────────┴──────────┴──────────┴──────────┴───────────┘          │
│                                                                             │
│  #2 Strengths: All tests pass, 3 new tests, follows existing patterns       │
│  #2 Trade-offs: +15% LOC vs #1, marginally slower runtime than #3           │
│                                                                             │
│  Actions:                                                                   │
│    [a] Accept winner (#2)    [c] Compare pair    [r] Request changes        │
│    [v] View details          [d] View diff       [x] Reject all             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TypeScript Types

```typescript
/**
 * Summary view data structure
 */
export interface SolutionSummaryView {
  taskId: string;
  taskTitle: string;

  // Winner information
  winner: {
    iterationId: string;
    label: string;
    score: number;
    confidence: number;
  } | null;

  // Comparison table data
  iterations: SolutionSummaryRow[];

  // Quick insights
  winnerStrengths: string[];
  winnerTradeoffs: string[];

  // Auto-acceptance status
  autoAcceptance: {
    eligible: boolean;
    reason: string;
  };

  // Timing
  evaluationDurationMs: number;
  evaluatedAt: number;
}

export interface SolutionSummaryRow {
  iterationId: string;
  label: string;
  rank: number;

  // Category scores
  scores: {
    correctness: number;
    quality: number;
    efficiency: number;
    completeness: number;
    safety: number;
    overall: number;
  };

  // Quick metadata
  isWinner: boolean;
  hasErrors: boolean;
  durationMs: number;
}

/**
 * Criterion weights for display
 */
export const CRITERION_WEIGHTS: Record<string, number> = {
  correctness: 0.40,
  quality: 0.25,
  efficiency: 0.15,
  completeness: 0.10,
  safety: 0.10,
};

/**
 * Criterion display names
 */
export const CRITERION_LABELS: Record<string, string> = {
  correctness: "Correctness",
  quality: "Code Quality",
  efficiency: "Efficiency",
  completeness: "Completeness",
  safety: "Safety",
  overall: "OVERALL",
};
```

### Summary Rendering Functions

```typescript
import { renderTable, TableColumn } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";

/**
 * Render summary view for CLI
 */
export function renderSummaryCli(view: SolutionSummaryView): string {
  const lines: string[] = [];

  // Header
  lines.push(theme.heading(`Solution Comparison: ${view.taskTitle}`));
  lines.push("");

  // Winner banner
  if (view.winner) {
    const winnerLine = `Winner: ${view.winner.label}`;
    const scoreLine = `Score: ${view.winner.score.toFixed(2)}`;
    const confLine = `Confidence: ${Math.round(view.winner.confidence * 100)}%`;
    lines.push(theme.success(`${winnerLine}    ${scoreLine}    ${confLine}`));
    lines.push("");
  } else {
    lines.push(theme.warn("No clear winner - manual review required"));
    lines.push("");
  }

  // Comparison table
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

  const tableRows = Object.entries(CRITERION_LABELS).map(([key, label]) => {
    const row: Record<string, string> = {
      criterion: label,
      weight: key === "overall" ? "100%" : `${Math.round(CRITERION_WEIGHTS[key] * 100)}%`,
    };

    for (const iter of view.iterations) {
      const score = iter.scores[key as keyof typeof iter.scores];
      const formatted = score.toFixed(2);
      const isHighest = isHighestScore(view.iterations, key, iter.iterationId);
      row[iter.iterationId] = isHighest ? theme.accentBright(`*${formatted}*`) : formatted;
    }

    return row;
  });

  lines.push(renderTable({
    columns: tableColumns,
    rows: tableRows,
    width: process.stdout.columns || 80,
    border: "unicode",
  }));

  // Strengths and trade-offs
  if (view.winner) {
    lines.push("");
    lines.push(theme.muted(`${view.winner.label} Strengths: ${view.winnerStrengths.join(", ")}`));
    lines.push(theme.muted(`${view.winner.label} Trade-offs: ${view.winnerTradeoffs.join(", ")}`));
  }

  return lines.join("\n");
}

function isHighestScore(
  iterations: SolutionSummaryRow[],
  criterion: string,
  iterationId: string
): boolean {
  const scores = iterations.map((i) => ({
    id: i.iterationId,
    score: i.scores[criterion as keyof typeof i.scores],
  }));
  const max = Math.max(...scores.map((s) => s.score));
  const iter = scores.find((s) => s.id === iterationId);
  return iter?.score === max;
}
```

## Detail View Design

### CLI Format

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Solution Details: Iteration #2 (claude-opus)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Task: Add user authentication endpoint                                      │
│  Status: Completed | Duration: 45.2s | Cost: $0.12                          │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  SCORE BREAKDOWN                                                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Correctness: 0.95 (40%)                                                    │
│    [pass] All existing tests pass (142/142)                                 │
│    [pass] Type check successful                                             │
│    [pass] Lint clean (0 errors, 0 warnings)                                 │
│    [pass] Build successful                                                  │
│    [0.90] Requirement coverage (LLM: covers auth, sessions, tokens)         │
│    [0.85] Edge case handling (LLM: handles expired tokens, invalid input)   │
│                                                                             │
│  Code Quality: 0.82 (25%)                                                   │
│    [0.85] Cyclomatic complexity (avg: 4.2, max: 8)                          │
│    [0.80] Lines of code (+127 / -23 = +104 net)                             │
│    [0.90] No duplication detected                                           │
│    [0.75] Naming quality (LLM: clear, follows conventions)                  │
│    [0.80] Pattern adherence (LLM: matches existing auth patterns)           │
│                                                                             │
│  Efficiency: 0.75 (15%)                                                     │
│    [0.80] Algorithm complexity (LLM: O(1) token validation)                 │
│    [pass] Resource cleanup (connections properly closed)                    │
│    [0.70] Async efficiency (LLM: some sequential awaits could parallelize)  │
│                                                                             │
│  Completeness: 0.95 (10%)                                                   │
│    [pass] All requirements addressed (5/5)                                  │
│    [pass] Tests added (3 new tests, 95% coverage of new code)               │
│    [pass] Documentation updated                                             │
│    [pass] Changelog entry added                                             │
│                                                                             │
│  Safety: 1.00 (10%)                                                         │
│    [pass] No dangerous operations detected                                  │
│    [pass] Security review clean (LLM: no vulnerabilities found)             │
│    [pass] No secrets exposed                                                │
│    [pass] Rollback safe (single migration, reversible)                      │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  FILES CHANGED (5 files, +127 -23)                                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│    M src/auth/handler.ts           (+85 -10)  New auth endpoint             │
│    M src/auth/types.ts             (+12 -3)   Token types                   │
│    A src/auth/middleware.ts        (+25 -0)   Auth middleware               │
│    M src/routes/index.ts           (+3 -8)    Route registration            │
│    A src/auth/handler.test.ts      (+2 -2)    Unit tests                    │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  LLM REASONING                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  "This solution implements JWT-based authentication following the existing  │
│   middleware pattern in the codebase. I chose to use the existing token     │
│   validation library rather than implementing custom logic. The middleware  │
│   is designed to be composable and can be applied at route or router level. │
│   Trade-off: slightly more verbose than inline validation but more reusable."│
│                                                                             │
│  Actions:                                                                   │
│    [a] Accept this solution    [d] View full diff    [b] Back to summary    │
│    [r] Request changes         [c] Compare with...   [x] Reject             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TypeScript Types

```typescript
/**
 * Detail view data structure
 */
export interface SolutionDetailView {
  iterationId: string;
  label: string;
  taskId: string;
  taskTitle: string;

  // Status
  status: "completed" | "failed" | "timeout";
  durationMs: number;
  estimatedCostUsd: number;

  // Score breakdowns
  scoreBreakdown: ScoreBreakdown;

  // Files changed
  filesChanged: FileChange[];
  totalAdditions: number;
  totalDeletions: number;

  // LLM reasoning
  reasoning: string;

  // Full output (if needed)
  output?: string;

  // Errors (if any)
  error?: string;
}

export interface ScoreBreakdown {
  correctness: CategoryBreakdown;
  quality: CategoryBreakdown;
  efficiency: CategoryBreakdown;
  completeness: CategoryBreakdown;
  safety: CategoryBreakdown;
}

export interface CategoryBreakdown {
  score: number;
  weight: number;
  checks: CheckResult[];
}

export interface CheckResult {
  name: string;
  type: "pass" | "fail" | "score" | "info";
  value?: number;
  message?: string;
  source: "automated" | "llm";
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  summary?: string;
}
```

### Detail Rendering Functions

```typescript
/**
 * Render detail view for CLI
 */
export function renderDetailCli(view: SolutionDetailView): string {
  const lines: string[] = [];

  // Header
  lines.push(theme.heading(`Solution Details: ${view.label}`));
  lines.push("");
  lines.push(`Task: ${view.taskTitle}`);
  lines.push(
    `Status: ${formatStatus(view.status)} | ` +
    `Duration: ${(view.durationMs / 1000).toFixed(1)}s | ` +
    `Cost: $${view.estimatedCostUsd.toFixed(2)}`
  );
  lines.push("");

  // Score breakdown
  lines.push(theme.heading("SCORE BREAKDOWN"));
  lines.push("");

  for (const [category, breakdown] of Object.entries(view.scoreBreakdown)) {
    const label = CRITERION_LABELS[category] || category;
    const weightPct = Math.round(breakdown.weight * 100);
    lines.push(theme.accent(`${label}: ${breakdown.score.toFixed(2)} (${weightPct}%)`));

    for (const check of breakdown.checks) {
      const prefix = formatCheckPrefix(check);
      const message = check.message || check.name;
      lines.push(`  ${prefix} ${message}`);
    }
    lines.push("");
  }

  // Files changed
  lines.push(theme.heading(`FILES CHANGED (${view.filesChanged.length} files, +${view.totalAdditions} -${view.totalDeletions})`));
  lines.push("");

  for (const file of view.filesChanged) {
    const statusChar = { added: "A", modified: "M", deleted: "D", renamed: "R" }[file.status];
    const stats = `(+${file.additions} -${file.deletions})`;
    const summary = file.summary ? `  ${file.summary}` : "";
    lines.push(`  ${statusChar} ${file.path.padEnd(35)} ${stats.padEnd(12)}${summary}`);
  }
  lines.push("");

  // LLM reasoning
  if (view.reasoning) {
    lines.push(theme.heading("LLM REASONING"));
    lines.push("");
    lines.push(theme.muted(`"${view.reasoning}"`));
    lines.push("");
  }

  return lines.join("\n");
}

function formatStatus(status: string): string {
  switch (status) {
    case "completed": return theme.success("Completed");
    case "failed": return theme.error("Failed");
    case "timeout": return theme.warn("Timeout");
    default: return status;
  }
}

function formatCheckPrefix(check: CheckResult): string {
  switch (check.type) {
    case "pass": return theme.success("[pass]");
    case "fail": return theme.error("[fail]");
    case "score": return theme.info(`[${check.value?.toFixed(2)}]`);
    case "info": return theme.muted("[info]");
    default: return "      ";
  }
}
```

## Diff Visualization

### Unified Diff Format (Default)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Diff: src/auth/handler.ts                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  @@ -15,6 +15,25 @@ import { validateToken } from './token.js';            │
│                                                                             │
│   export async function handleAuth(req: Request): Promise<Response> {       │
│  -  const token = req.headers.get('Authorization');                         │
│  -  if (!token) {                                                           │
│  -    return new Response('Unauthorized', { status: 401 });                 │
│  -  }                                                                       │
│  +  // Extract and validate bearer token                                    │
│  +  const authHeader = req.headers.get('Authorization');                    │
│  +  if (!authHeader?.startsWith('Bearer ')) {                               │
│  +    return jsonError('Missing or invalid Authorization header', 401);     │
│  +  }                                                                       │
│  +                                                                          │
│  +  const token = authHeader.slice(7); // Remove 'Bearer ' prefix           │
│  +  const validation = await validateToken(token);                          │
│  +                                                                          │
│  +  if (!validation.valid) {                                                │
│  +    return jsonError(validation.error || 'Invalid token', 401);           │
│  +  }                                                                       │
│  +                                                                          │
│  +  // Attach user context to request                                       │
│  +  const ctx = { user: validation.user, token };                           │
│  +  return handleAuthenticatedRequest(req, ctx);                            │
│   }                                                                         │
│                                                                             │
│  Press [n] next file, [p] prev file, [q] quit, [a] accept, [r] reject       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Side-by-Side Comparison (For Comparing Iterations)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Compare: Iteration #1 vs Iteration #2                                       │
├─────────────────────────────────────────┬───────────────────────────────────┤
│  #1 (claude-sonnet)                     │  #2 (claude-opus)                 │
├─────────────────────────────────────────┼───────────────────────────────────┤
│  export async function handleAuth(req)  │  export async function handleAuth │
│    const token = req.headers.get(       │    // Extract and validate bearer │
│      'Authorization'                    │    const authHeader = req.headers │
│    );                                   │      .get('Authorization');       │
│    if (!token) {                        │    if (!authHeader?.startsWith(   │
│      return new Response(               │      'Bearer '                    │
│        'Unauthorized',                  │    )) {                           │
│        { status: 401 }                  │      return jsonError(            │
│      );                                 │        'Missing or invalid...',   │
│    }                                    │        401                        │
│                                         │      );                           │
│    // Direct validation                 │    }                              │
│    const valid = validateToken(token);  │                                   │
│    if (!valid) {                        │    const token = authHeader       │
│      return new Response(               │      .slice(7);                   │
│        'Invalid token',                 │    const validation = await       │
│        { status: 401 }                  │      validateToken(token);        │
│      );                                 │                                   │
│    }                                    │    if (!validation.valid) {       │
│                                         │      return jsonError(            │
│                                         │        validation.error ||        │
│                                         │        'Invalid token',           │
│                                         │        401                        │
│                                         │      );                           │
│                                         │    }                              │
├─────────────────────────────────────────┴───────────────────────────────────┤
│  Key Differences:                                                            │
│  - #2 has explicit Bearer prefix check (more robust)                         │
│  - #2 uses async validation with detailed error messages                     │
│  - #2 adds user context attachment for downstream handlers                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### TypeScript Types

```typescript
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

export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  language?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

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
  contextLines: number;       // Lines of context around changes (default: 3)
  syntaxHighlight: boolean;   // Enable syntax highlighting (default: true)
  wordDiff: boolean;          // Show word-level changes (default: false)
  maxWidth?: number;          // Max width per column for split view
  collapseUnchanged: boolean; // Collapse large unchanged sections (default: true)
}

export const DEFAULT_DIFF_OPTIONS: DiffRenderOptions = {
  contextLines: 3,
  syntaxHighlight: true,
  wordDiff: false,
  collapseUnchanged: true,
};
```

### Diff Rendering Functions

```typescript
/**
 * Render unified diff for CLI
 */
export function renderUnifiedDiffCli(
  diff: FileDiff,
  options: DiffRenderOptions = DEFAULT_DIFF_OPTIONS
): string {
  const lines: string[] = [];

  lines.push(theme.heading(`Diff: ${diff.path}`));
  lines.push("");

  for (const hunk of diff.hunks) {
    // Hunk header
    const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
    lines.push(theme.muted(header));
    lines.push("");

    for (const line of hunk.lines) {
      const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
      const color = line.type === "addition" ? theme.success
        : line.type === "deletion" ? theme.error
        : (s: string) => s;

      lines.push(color(`${prefix} ${line.content}`));
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render split comparison for CLI
 */
export function renderSplitDiffCli(
  leftDiff: FileDiff,
  rightDiff: FileDiff,
  leftLabel: string,
  rightLabel: string,
  width: number = 80
): string {
  const lines: string[] = [];
  const halfWidth = Math.floor((width - 3) / 2); // -3 for separator

  lines.push(theme.heading(`Compare: ${leftLabel} vs ${rightLabel}`));
  lines.push("");

  // Headers
  lines.push(`${leftLabel.padEnd(halfWidth)} | ${rightLabel}`);
  lines.push(`${"─".repeat(halfWidth)} | ${"─".repeat(halfWidth)}`);

  // Align and render lines side by side
  const leftLines = extractAllLines(leftDiff);
  const rightLines = extractAllLines(rightDiff);
  const maxLines = Math.max(leftLines.length, rightLines.length);

  for (let i = 0; i < maxLines; i++) {
    const left = (leftLines[i] || "").slice(0, halfWidth).padEnd(halfWidth);
    const right = (rightLines[i] || "").slice(0, halfWidth);
    lines.push(`${left} | ${right}`);
  }

  return lines.join("\n");
}

function extractAllLines(diff: FileDiff): string[] {
  const lines: string[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.type !== "deletion") {
        lines.push(line.content);
      }
    }
  }
  return lines;
}
```

## Interactive Actions

### Action Types

```typescript
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
 * Action handlers
 */
export interface ActionHandlers {
  onAccept: (iterationId: string) => Promise<void>;
  onReject: (iterationId: string, reason?: string) => Promise<void>;
  onRejectAll: (reason?: string) => Promise<void>;
  onRequestChanges: (iterationId: string, feedback: string) => Promise<void>;
  onManualReview: () => Promise<void>;
}
```

### CLI Action Bar

```typescript
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
 * Render action bar for current context
 */
export function renderActionBar(config: ActionBarConfig): string {
  const actions: string[] = [];

  switch (config.context) {
    case "summary":
      if (config.winnerId) {
        actions.push(`[a] Accept winner`);
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
        actions.push(`[n] Next file (${config.fileIndex}/${config.totalFiles})`);
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
export function parseAction(
  input: string,
  config: ActionBarConfig
): PresentationAction | null {
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
      return config.winnerId
        ? { type: "viewDetails", iterationId: config.winnerId }
        : null;

    case "d":
      return config.currentIterationId
        ? { type: "viewDiff", iterationId: config.currentIterationId }
        : config.winnerId
        ? { type: "viewDiff", iterationId: config.winnerId }
        : null;

    case "c":
      return { type: "compare", iterationA: "", iterationB: "" }; // Prompt for selection

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

    default:
      return null;
  }
}
```

## Multi-Channel Adapters

### Channel Interface

```typescript
/**
 * Presentation channel adapter interface
 */
export interface PresentationChannel {
  readonly name: string;
  readonly supportsRichFormatting: boolean;
  readonly supportsInteraction: boolean;

  renderSummary(view: SolutionSummaryView): string | object;
  renderDetail(view: SolutionDetailView): string | object;
  renderDiff(diff: DiffView): string | object;
  renderActionBar(config: ActionBarConfig): string | object;

  // For interactive channels
  promptAction?(config: ActionBarConfig): Promise<PresentationAction | null>;
}
```

### CLI Channel

```typescript
export class CliPresentationChannel implements PresentationChannel {
  readonly name = "cli";
  readonly supportsRichFormatting = true;
  readonly supportsInteraction = true;

  private isRich: boolean;

  constructor() {
    this.isRich = process.stdout.isTTY && !process.env.NO_COLOR;
  }

  renderSummary(view: SolutionSummaryView): string {
    return renderSummaryCli(view);
  }

  renderDetail(view: SolutionDetailView): string {
    return renderDetailCli(view);
  }

  renderDiff(diff: DiffView): string {
    if (diff.mode === "split" && diff.comparison) {
      return renderSplitDiffCli(
        diff.files[0],
        diff.files[1],
        diff.comparison.leftIteration,
        diff.comparison.rightIteration
      );
    }
    return renderUnifiedDiffCli(diff.files[diff.currentFileIndex]);
  }

  renderActionBar(config: ActionBarConfig): string {
    return renderActionBar(config);
  }

  async promptAction(config: ActionBarConfig): Promise<PresentationAction | null> {
    // Use readline for interactive prompts
    const readline = await import("node:readline/promises");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await rl.question("Choose action: ");
    rl.close();

    return parseAction(answer, config);
  }
}
```

### Chat Channel (Discord/Telegram/Slack)

```typescript
export class ChatPresentationChannel implements PresentationChannel {
  readonly name = "chat";
  readonly supportsRichFormatting = true;
  readonly supportsInteraction = false; // Async replies instead

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
        `Confidence: ${Math.round(view.winner.confidence * 100)}%)`
      );
      lines.push("");
    }

    // Compact table using markdown
    const headers = ["Criterion", ...view.iterations.map((i) => i.label), "Weight"];
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

    for (const [key, label] of Object.entries(CRITERION_LABELS)) {
      const row = [
        label,
        ...view.iterations.map((i) => {
          const score = i.scores[key as keyof typeof i.scores];
          return i.isWinner ? `**${score.toFixed(2)}**` : score.toFixed(2);
        }),
        key === "overall" ? "100%" : `${Math.round(CRITERION_WEIGHTS[key] * 100)}%`,
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
    for (const [category, breakdown] of Object.entries(view.scoreBreakdown)) {
      const label = CRITERION_LABELS[category] || category;
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
    const lines: string[] = [];

    lines.push(`**Diff: ${file.path}**`);
    lines.push("```diff");

    // Truncate diff to fit message limits
    let charCount = lines.join("\n").length;
    const maxDiffChars = this.maxLength - 100; // Reserve space for closing

    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const prefix = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " ";
        const diffLine = `${prefix} ${line.content}`;

        if (charCount + diffLine.length + 1 > maxDiffChars) {
          lines.push("... (truncated)");
          break;
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
```

### Web Channel (JSON for UI rendering)

```typescript
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
    // Web UI handles action bar rendering internally
    return { context: config.context };
  }
}
```

## Presenter Orchestrator

```typescript
/**
 * Main presenter class that coordinates presentation across channels
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
  async presentComparison(ranking: SolutionRanking): Promise<void> {
    const summaryView = this.buildSummaryView(ranking);

    // Render summary
    const output = this.channel.renderSummary(summaryView);
    this.output(output);

    // Handle interaction if supported
    if (this.channel.supportsInteraction && this.channel.promptAction) {
      await this.handleInteraction(summaryView, ranking);
    }
  }

  /**
   * Present single solution details
   */
  async presentDetail(evaluation: SolutionEvaluation): Promise<void> {
    const detailView = this.buildDetailView(evaluation);

    const output = this.channel.renderDetail(detailView);
    this.output(output);

    if (this.channel.supportsInteraction && this.channel.promptAction) {
      await this.handleDetailInteraction(detailView);
    }
  }

  /**
   * Present diff view
   */
  async presentDiff(iterationId: string, files: FileDiff[]): Promise<void> {
    const diffView: DiffView = {
      mode: "unified",
      files,
      currentFileIndex: 0,
    };

    const output = this.channel.renderDiff(diffView);
    this.output(output);

    if (this.channel.supportsInteraction && this.channel.promptAction) {
      await this.handleDiffInteraction(diffView, iterationId);
    }
  }

  private buildSummaryView(ranking: SolutionRanking): SolutionSummaryView {
    return {
      taskId: ranking.solutions[0]?.evaluation.solutionId || "",
      taskTitle: "", // Would come from task store

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
        hasErrors: false,
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

  private buildDetailView(evaluation: SolutionEvaluation): SolutionDetailView {
    // Implementation would extract detailed breakdown from evaluation
    // This is a simplified version
    return {
      iterationId: evaluation.solutionId,
      label: evaluation.solutionId,
      taskId: "",
      taskTitle: "",
      status: "completed",
      durationMs: 0,
      estimatedCostUsd: 0,
      scoreBreakdown: {
        correctness: { score: evaluation.correctness.overall, weight: 0.4, checks: [] },
        quality: { score: evaluation.quality.overall, weight: 0.25, checks: [] },
        efficiency: { score: evaluation.efficiency.overall, weight: 0.15, checks: [] },
        completeness: { score: evaluation.completeness.overall, weight: 0.1, checks: [] },
        safety: { score: evaluation.safety.overall, weight: 0.1, checks: [] },
      },
      filesChanged: [],
      totalAdditions: 0,
      totalDeletions: 0,
      reasoning: "",
    };
  }

  private async handleInteraction(
    view: SolutionSummaryView,
    ranking: SolutionRanking
  ): Promise<void> {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: view.winner?.iterationId,
    };

    // Interactive loop
    while (true) {
      const actionBarOutput = this.channel.renderActionBar(config);
      this.output(actionBarOutput);

      const action = await this.channel.promptAction!(config);
      if (!action) continue;

      if (await this.handleAction(action, view, ranking)) {
        break; // Exit loop on terminal actions
      }
    }
  }

  private async handleDetailInteraction(view: SolutionDetailView): Promise<void> {
    const config: ActionBarConfig = {
      context: "detail",
      currentIterationId: view.iterationId,
    };

    // Similar interaction loop
    // ...
  }

  private async handleDiffInteraction(view: DiffView, iterationId: string): Promise<void> {
    const config: ActionBarConfig = {
      context: "diff",
      currentIterationId: iterationId,
      hasMultipleFiles: view.files.length > 1,
      fileIndex: view.currentFileIndex + 1,
      totalFiles: view.files.length,
    };

    // Similar interaction loop with file navigation
    // ...
  }

  private async handleAction(
    action: PresentationAction,
    view: SolutionSummaryView,
    ranking: SolutionRanking
  ): Promise<boolean> {
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

      case "viewDetails":
        const eval = ranking.solutions.find((s) => s.solutionId === action.iterationId);
        if (eval) {
          await this.presentDetail(eval.evaluation);
        }
        return false;

      case "manualReview":
        await this.handlers.onManualReview();
        return true;

      default:
        return false;
    }
  }

  private output(content: string | object): void {
    if (typeof content === "string") {
      console.log(content);
    } else {
      // For web channel, would emit JSON event
      console.log(JSON.stringify(content, null, 2));
    }
  }
}
```

## File Structure

```
src/
├── kanban/
│   └── presentation/
│       ├── types.ts                  # All presentation types
│       ├── summary-view.ts           # Summary view rendering
│       ├── detail-view.ts            # Detail view rendering
│       ├── diff-view.ts              # Diff visualization
│       ├── actions.ts                # Action types and parsing
│       ├── channels/
│       │   ├── interface.ts          # PresentationChannel interface
│       │   ├── cli.ts                # CLI channel implementation
│       │   ├── chat.ts               # Chat channel (Discord/Telegram/Slack)
│       │   └── web.ts                # Web channel (JSON output)
│       ├── presenter.ts              # Main presenter orchestrator
│       └── index.ts                  # Public exports
└── terminal/
    ├── table.ts                      # Existing - used for score tables
    ├── theme.ts                      # Existing - colors and styling
    └── palette.ts                    # Existing - Lobster palette
```

## Integration Points

### With Evaluation Criteria

The presentation format directly consumes the `SolutionEvaluation` and `SolutionRanking` types from the evaluation criteria design:

```typescript
// From kanban-evaluation-criteria.md
import {
  SolutionEvaluation,
  SolutionRanking,
  RankedSolution,
} from "../evaluation/types.js";

// Transform to presentation views
function evaluationToSummaryView(ranking: SolutionRanking): SolutionSummaryView;
function evaluationToDetailView(eval: SolutionEvaluation): SolutionDetailView;
```

### With Multi-Iteration Workflow

The presentation receives results from the iteration runner:

```typescript
// From kanban-multi-iteration.md
import { IterationResult, AggregationResult } from "../iterations/types.js";

// Present aggregated results
async function presentIterationResults(
  aggregation: AggregationResult,
  channel: PresentationChannel
): Promise<void>;
```

### With Existing CLI Infrastructure

Uses existing terminal utilities:

```typescript
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { note } from "../terminal/note.js";
import { createCliProgress } from "../cli/progress.js";
```

## Testing Strategy

1. **Unit Tests**: Each rendering function tested with snapshot tests
2. **Channel Tests**: Verify output format for each channel type
3. **Integration Tests**: Full presentation flow with mock evaluations
4. **Visual Tests**: Manual verification of CLI formatting
5. **Action Tests**: Verify action parsing and handling

## Security Considerations

1. **Output Sanitization**: Escape special characters in user-provided content
2. **Truncation**: Enforce message limits to prevent DoS
3. **No Secrets**: Never display credentials or tokens in output
4. **Audit Trail**: Log all user actions on solutions

## References

- Evaluation Criteria: `docs/design/kanban-evaluation-criteria.md`
- Multi-Iteration Workflow: `docs/design/kanban-multi-iteration.md`
- Task Intake: `docs/design/kanban-task-intake.md`
- Terminal Table: `src/terminal/table.ts`
- Terminal Theme: `src/terminal/theme.ts`
- CLI Progress: `src/cli/progress.ts`
- Kanban Store: `src/dashboard/kanban-store.ts`
