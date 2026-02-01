import { describe, expect, it, vi } from "vitest";
import {
  type ActionBarConfig,
  type ActionHandlers,
  buildDetailView,
  buildSummaryView,
  ChatPresentationChannel,
  CliPresentationChannel,
  createDefaultHandlers,
  createPresenter,
  CRITERION_LABELS,
  CRITERION_WEIGHTS,
  DEFAULT_DIFF_OPTIONS,
  type DiffView,
  type FileDiff,
  formatCheckPrefix,
  formatStatus,
  isHighestScore,
  parseAction,
  type PresentationAction,
  renderActionBar,
  renderDetailCli,
  renderDiffCli,
  renderSplitDiffCli,
  renderSummaryCli,
  renderUnifiedDiffCli,
  SolutionPresenter,
  type SolutionSummaryRow,
  WebPresentationChannel,
} from "./presenter.js";
import type { SolutionEvaluation, SolutionRanking, RankedSolution } from "./comparator.js";

// ============================================================================
// Test utilities
// ============================================================================

function createMockEvaluation(overrides: Partial<SolutionEvaluation> = {}): SolutionEvaluation {
  return {
    solutionId: "solution-1",
    iterationId: "iteration-1",
    correctness: {
      testsPass: 1.0,
      typeCheck: true,
      lintClean: true,
      buildSuccess: true,
      noRegressions: true,
      requirementCoverage: 0.8,
      edgeCaseHandling: 0.7,
      apiCompatible: true,
      overall: 0.85,
    },
    quality: {
      complexity: { average: 3, max: 5, score: 0.9 },
      size: { linesAdded: 10, linesRemoved: 5, netChange: 5, score: 0.95 },
      duplication: { percentage: 0.02, score: 0.98 },
      naming: 0.85,
      comments: 0.8,
      patternAdherence: 0.82,
      errorHandling: 0.78,
      overall: 0.85,
    },
    efficiency: {
      algorithmic: 0.8,
      resourceCleanup: true,
      asyncEfficiency: 0.75,
      overall: 0.78,
    },
    completeness: {
      requirementsMet: 0.9,
      documentationAdded: true,
      testsAdded: 1,
      changelogUpdated: false,
      overall: 0.85,
    },
    safety: {
      noDangerousOps: true,
      securityReview: 0.9,
      noSecretsExposed: true,
      rollbackSafe: 0.85,
      overall: 0.9,
    },
    overallScore: 0.85,
    confidence: 0.8,
    evaluatedAt: new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  };
}

function createMockRanking(overrides: Partial<SolutionRanking> = {}): SolutionRanking {
  const eval1 = createMockEvaluation({ solutionId: "sol-1", overallScore: 0.9 });
  const eval2 = createMockEvaluation({ solutionId: "sol-2", overallScore: 0.8 });

  const solutions: RankedSolution[] = [
    {
      solutionId: "sol-1",
      rank: 1,
      score: 0.9,
      evaluation: eval1,
      strengths: ["All tests pass", "Clean type check"],
      weaknesses: [],
    },
    {
      solutionId: "sol-2",
      rank: 2,
      score: 0.8,
      evaluation: eval2,
      strengths: ["Good documentation"],
      weaknesses: ["Some lint errors"],
    },
  ];

  return {
    solutions,
    winner: solutions[0],
    confidence: 0.85,
    comparisonDetails: [],
    ...overrides,
  };
}

function createMockFileDiff(): FileDiff {
  return {
    path: "src/example.ts",
    status: "modified",
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 5,
        lines: [
          { type: "context", content: "// Header comment" },
          { type: "deletion", content: "const old = 1;" },
          { type: "addition", content: "const new1 = 1;" },
          { type: "addition", content: "const new2 = 2;" },
          { type: "context", content: "export default old;" },
        ],
      },
    ],
    language: "typescript",
  };
}

function createMockSummaryRow(overrides: Partial<SolutionSummaryRow> = {}): SolutionSummaryRow {
  return {
    iterationId: "sol-1",
    label: "sol-1",
    rank: 1,
    scores: {
      correctness: 0.85,
      quality: 0.8,
      efficiency: 0.75,
      completeness: 0.9,
      safety: 0.95,
      overall: 0.85,
    },
    isWinner: true,
    hasErrors: false,
    durationMs: 1000,
    ...overrides,
  };
}

function createMockActionHandlers(): ActionHandlers {
  return {
    onAccept: vi.fn().mockResolvedValue(undefined),
    onReject: vi.fn().mockResolvedValue(undefined),
    onRejectAll: vi.fn().mockResolvedValue(undefined),
    onRequestChanges: vi.fn().mockResolvedValue(undefined),
    onManualReview: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================================
// Constants tests
// ============================================================================

describe("CRITERION_WEIGHTS", () => {
  it("contains all expected criteria", () => {
    expect(CRITERION_WEIGHTS).toHaveProperty("correctness");
    expect(CRITERION_WEIGHTS).toHaveProperty("quality");
    expect(CRITERION_WEIGHTS).toHaveProperty("efficiency");
    expect(CRITERION_WEIGHTS).toHaveProperty("completeness");
    expect(CRITERION_WEIGHTS).toHaveProperty("safety");
  });

  it("weights sum to 1.0", () => {
    const sum = Object.values(CRITERION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });
});

describe("CRITERION_LABELS", () => {
  it("contains all expected criteria", () => {
    expect(CRITERION_LABELS.correctness).toBe("Correctness");
    expect(CRITERION_LABELS.quality).toBe("Code Quality");
    expect(CRITERION_LABELS.efficiency).toBe("Efficiency");
    expect(CRITERION_LABELS.completeness).toBe("Completeness");
    expect(CRITERION_LABELS.safety).toBe("Safety");
    expect(CRITERION_LABELS.overall).toBe("OVERALL");
  });
});

// ============================================================================
// Utility function tests
// ============================================================================

describe("isHighestScore", () => {
  it("returns true for highest score", () => {
    const iterations: SolutionSummaryRow[] = [
      createMockSummaryRow({
        iterationId: "sol-1",
        scores: { ...createMockSummaryRow().scores, correctness: 0.9 },
      }),
      createMockSummaryRow({
        iterationId: "sol-2",
        scores: { ...createMockSummaryRow().scores, correctness: 0.8 },
      }),
    ];

    expect(isHighestScore(iterations, "correctness", "sol-1")).toBe(true);
    expect(isHighestScore(iterations, "correctness", "sol-2")).toBe(false);
  });

  it("returns true for tied highest scores", () => {
    const iterations: SolutionSummaryRow[] = [
      createMockSummaryRow({
        iterationId: "sol-1",
        scores: { ...createMockSummaryRow().scores, correctness: 0.9 },
      }),
      createMockSummaryRow({
        iterationId: "sol-2",
        scores: { ...createMockSummaryRow().scores, correctness: 0.9 },
      }),
    ];

    expect(isHighestScore(iterations, "correctness", "sol-1")).toBe(true);
    expect(isHighestScore(iterations, "correctness", "sol-2")).toBe(true);
  });
});

describe("formatStatus", () => {
  it("formats completed status", () => {
    const result = formatStatus("completed", false);
    expect(result).toBe("Completed");
  });

  it("formats failed status", () => {
    const result = formatStatus("failed", false);
    expect(result).toBe("Failed");
  });

  it("formats timeout status", () => {
    const result = formatStatus("timeout", false);
    expect(result).toBe("Timeout");
  });

  it("returns unknown status unchanged", () => {
    const result = formatStatus("unknown", false);
    expect(result).toBe("unknown");
  });
});

describe("formatCheckPrefix", () => {
  it("formats pass check", () => {
    const result = formatCheckPrefix({ name: "test", type: "pass", source: "automated" }, false);
    expect(result).toBe("[pass]");
  });

  it("formats fail check", () => {
    const result = formatCheckPrefix({ name: "test", type: "fail", source: "automated" }, false);
    expect(result).toBe("[fail]");
  });

  it("formats score check with value", () => {
    const result = formatCheckPrefix(
      { name: "test", type: "score", value: 0.85, source: "llm" },
      false,
    );
    expect(result).toBe("[0.85]");
  });

  it("formats score check without value", () => {
    const result = formatCheckPrefix({ name: "test", type: "score", source: "llm" }, false);
    expect(result).toBe("[?]");
  });

  it("formats info check", () => {
    const result = formatCheckPrefix({ name: "test", type: "info", source: "automated" }, false);
    expect(result).toBe("[info]");
  });
});

// ============================================================================
// Summary view rendering tests
// ============================================================================

describe("renderSummaryCli", () => {
  it("renders summary with winner", () => {
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task", "task-1");
    const output = renderSummaryCli(view);

    expect(output).toContain("Solution Comparison: Test Task");
    expect(output).toContain("Winner: sol-1");
    expect(output).toContain("Score: 0.90");
  });

  it("renders summary without winner", () => {
    const ranking = createMockRanking({ winner: null, confidence: 0.3 });
    const view = buildSummaryView(ranking, "Test Task", "task-1");
    const output = renderSummaryCli(view);

    expect(output).toContain("No clear winner - manual review required");
  });

  it("renders comparison table with criteria", () => {
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task", "task-1");
    const output = renderSummaryCli(view);

    expect(output).toContain("Correctness");
    expect(output).toContain("Code Quality");
    expect(output).toContain("Efficiency");
    expect(output).toContain("Completeness");
    expect(output).toContain("Safety");
  });

  it("includes strengths and trade-offs for winner", () => {
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task", "task-1");
    const output = renderSummaryCli(view);

    expect(output).toContain("Strengths:");
    expect(output).toContain("All tests pass");
  });
});

// ============================================================================
// Detail view rendering tests
// ============================================================================

describe("renderDetailCli", () => {
  it("renders detail view header", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");
    const output = renderDetailCli(view);

    expect(output).toContain("Solution Details: solution-1");
    expect(output).toContain("Task: Test Task");
    expect(output).toContain("Status: Completed");
  });

  it("renders score breakdown", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");
    const output = renderDetailCli(view);

    expect(output).toContain("SCORE BREAKDOWN");
    expect(output).toContain("Correctness:");
    expect(output).toContain("Code Quality:");
    expect(output).toContain("Efficiency:");
    expect(output).toContain("Completeness:");
    expect(output).toContain("Safety:");
  });

  it("renders check results", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");
    const output = renderDetailCli(view);

    expect(output).toContain("[pass]");
    expect(output).toContain("Type check successful");
  });
});

// ============================================================================
// Diff view rendering tests
// ============================================================================

describe("renderUnifiedDiffCli", () => {
  it("renders diff header", () => {
    const diff = createMockFileDiff();
    const output = renderUnifiedDiffCli(diff);

    expect(output).toContain("Diff: src/example.ts");
  });

  it("renders hunk header", () => {
    const diff = createMockFileDiff();
    const output = renderUnifiedDiffCli(diff);

    expect(output).toContain("@@ -1,3 +1,5 @@");
  });

  it("renders additions with + prefix", () => {
    const diff = createMockFileDiff();
    const output = renderUnifiedDiffCli(diff);

    expect(output).toContain("+ const new1 = 1;");
    expect(output).toContain("+ const new2 = 2;");
  });

  it("renders deletions with - prefix", () => {
    const diff = createMockFileDiff();
    const output = renderUnifiedDiffCli(diff);

    expect(output).toContain("- const old = 1;");
  });

  it("renders context lines with space prefix", () => {
    const diff = createMockFileDiff();
    const output = renderUnifiedDiffCli(diff);

    expect(output).toContain("  // Header comment");
  });
});

describe("renderSplitDiffCli", () => {
  it("renders comparison header", () => {
    const leftDiff = createMockFileDiff();
    const rightDiff = createMockFileDiff();
    const output = renderSplitDiffCli(leftDiff, rightDiff, "sol-1", "sol-2");

    expect(output).toContain("Compare: sol-1 vs sol-2");
  });

  it("renders side-by-side labels", () => {
    const leftDiff = createMockFileDiff();
    const rightDiff = createMockFileDiff();
    const output = renderSplitDiffCli(leftDiff, rightDiff, "sol-1", "sol-2");

    expect(output).toContain("sol-1");
    expect(output).toContain("sol-2");
  });
});

describe("renderDiffCli", () => {
  it("renders unified diff by default", () => {
    const diffView: DiffView = {
      mode: "unified",
      files: [createMockFileDiff()],
      currentFileIndex: 0,
    };
    const output = renderDiffCli(diffView);

    expect(output).toContain("Diff: src/example.ts");
    expect(output).toContain("@@ -1,3 +1,5 @@");
  });

  it("renders split diff when mode is split", () => {
    const diffView: DiffView = {
      mode: "split",
      files: [createMockFileDiff(), createMockFileDiff()],
      currentFileIndex: 0,
      comparison: {
        leftIteration: "sol-1",
        rightIteration: "sol-2",
        keyDifferences: [],
      },
    };
    const output = renderDiffCli(diffView);

    expect(output).toContain("Compare: sol-1 vs sol-2");
  });

  it("handles empty files array", () => {
    const diffView: DiffView = {
      mode: "unified",
      files: [],
      currentFileIndex: 0,
    };
    const output = renderDiffCli(diffView);

    expect(output).toBe("No diff available.");
  });
});

// ============================================================================
// Action bar tests
// ============================================================================

describe("renderActionBar", () => {
  it("renders summary context actions", () => {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: "sol-1",
    };
    const output = renderActionBar(config);

    expect(output).toContain("[a] Accept winner");
    expect(output).toContain("[v] View details");
    expect(output).toContain("[d] View diff");
    expect(output).toContain("[c] Compare pair");
    expect(output).toContain("[r] Request changes");
    expect(output).toContain("[x] Reject all");
  });

  it("renders summary context without accept when no winner", () => {
    const config: ActionBarConfig = {
      context: "summary",
    };
    const output = renderActionBar(config);

    expect(output).not.toContain("[a] Accept winner");
  });

  it("renders detail context actions", () => {
    const config: ActionBarConfig = {
      context: "detail",
      currentIterationId: "sol-1",
    };
    const output = renderActionBar(config);

    expect(output).toContain("[a] Accept this solution");
    expect(output).toContain("[d] View full diff");
    expect(output).toContain("[b] Back to summary");
  });

  it("renders diff context with file navigation", () => {
    const config: ActionBarConfig = {
      context: "diff",
      hasMultipleFiles: true,
      fileIndex: 2,
      totalFiles: 5,
    };
    const output = renderActionBar(config);

    expect(output).toContain("[n] Next file (2/5)");
    expect(output).toContain("[p] Prev file");
  });

  it("renders compare context actions", () => {
    const config: ActionBarConfig = {
      context: "compare",
    };
    const output = renderActionBar(config);

    expect(output).toContain("[1] Select left");
    expect(output).toContain("[2] Select right");
    expect(output).toContain("[b] Back to summary");
  });
});

// ============================================================================
// Action parsing tests
// ============================================================================

describe("parseAction", () => {
  it("parses accept action with current iteration", () => {
    const config: ActionBarConfig = {
      context: "detail",
      currentIterationId: "sol-1",
    };
    const action = parseAction("a", config);

    expect(action).toEqual({ type: "accept", iterationId: "sol-1" });
  });

  it("parses accept action with winner", () => {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: "sol-winner",
    };
    const action = parseAction("a", config);

    expect(action).toEqual({ type: "accept", iterationId: "sol-winner" });
  });

  it("parses reject action with current iteration", () => {
    const config: ActionBarConfig = {
      context: "detail",
      currentIterationId: "sol-1",
    };
    const action = parseAction("x", config);

    expect(action).toEqual({ type: "reject", iterationId: "sol-1" });
  });

  it("parses reject all action from summary", () => {
    const config: ActionBarConfig = {
      context: "summary",
    };
    const action = parseAction("x", config);

    expect(action).toEqual({ type: "rejectAll" });
  });

  it("parses view details action", () => {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: "sol-1",
    };
    const action = parseAction("v", config);

    expect(action).toEqual({ type: "viewDetails", iterationId: "sol-1" });
  });

  it("parses view diff action", () => {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: "sol-1",
    };
    const action = parseAction("d", config);

    expect(action).toEqual({ type: "viewDiff", iterationId: "sol-1" });
  });

  it("parses back action", () => {
    const config: ActionBarConfig = {
      context: "detail",
    };
    const action = parseAction("b", config);

    expect(action).toEqual({ type: "backToSummary" });
  });

  it("parses navigation actions", () => {
    const config: ActionBarConfig = {
      context: "diff",
    };

    expect(parseAction("n", config)).toEqual({ type: "nextFile" });
    expect(parseAction("p", config)).toEqual({ type: "prevFile" });
  });

  it("parses compare action", () => {
    const config: ActionBarConfig = {
      context: "summary",
    };
    const action = parseAction("c", config);

    expect(action).toEqual({ type: "compare", iterationA: "", iterationB: "" });
  });

  it("parses manual review action", () => {
    const config: ActionBarConfig = {
      context: "summary",
    };
    const action = parseAction("m", config);

    expect(action).toEqual({ type: "manualReview" });
  });

  it("returns null for unknown action", () => {
    const config: ActionBarConfig = {
      context: "summary",
    };
    const action = parseAction("z", config);

    expect(action).toBeNull();
  });

  it("handles case insensitivity", () => {
    const config: ActionBarConfig = {
      context: "summary",
      winnerId: "sol-1",
    };

    expect(parseAction("A", config)).toEqual({ type: "accept", iterationId: "sol-1" });
    expect(parseAction("V", config)).toEqual({ type: "viewDetails", iterationId: "sol-1" });
  });
});

// ============================================================================
// Channel implementation tests
// ============================================================================

describe("CliPresentationChannel", () => {
  it("has correct properties", () => {
    const channel = new CliPresentationChannel();

    expect(channel.name).toBe("cli");
    expect(channel.supportsRichFormatting).toBe(true);
    expect(channel.supportsInteraction).toBe(true);
  });

  it("renders summary view", () => {
    const channel = new CliPresentationChannel();
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task");
    const output = channel.renderSummary(view);

    expect(typeof output).toBe("string");
    expect(output).toContain("Solution Comparison: Test Task");
  });

  it("renders detail view", () => {
    const channel = new CliPresentationChannel();
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task");
    const output = channel.renderDetail(view);

    expect(typeof output).toBe("string");
    expect(output).toContain("Solution Details:");
  });

  it("renders diff view", () => {
    const channel = new CliPresentationChannel();
    const diffView: DiffView = {
      mode: "unified",
      files: [createMockFileDiff()],
      currentFileIndex: 0,
    };
    const output = channel.renderDiff(diffView);

    expect(typeof output).toBe("string");
    expect(output).toContain("Diff:");
  });

  it("renders action bar", () => {
    const channel = new CliPresentationChannel();
    const config: ActionBarConfig = { context: "summary", winnerId: "sol-1" };
    const output = channel.renderActionBar(config);

    expect(typeof output).toBe("string");
    expect(output).toContain("Actions:");
  });
});

describe("ChatPresentationChannel", () => {
  it("has correct properties", () => {
    const channel = new ChatPresentationChannel();

    expect(channel.name).toBe("chat");
    expect(channel.supportsRichFormatting).toBe(true);
    expect(channel.supportsInteraction).toBe(false);
  });

  it("renders markdown summary", () => {
    const channel = new ChatPresentationChannel();
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task");
    const output = channel.renderSummary(view);

    expect(typeof output).toBe("string");
    expect(output).toContain("**Solution Comparison: Test Task**");
    expect(output).toContain("**Winner:**");
    expect(output).toContain("|");
  });

  it("renders markdown detail", () => {
    const channel = new ChatPresentationChannel();
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task");
    const output = channel.renderDetail(view);

    expect(typeof output).toBe("string");
    expect(output).toContain("**Solution Details: solution-1**");
    expect(output).toContain("**Score Breakdown:**");
  });

  it("renders diff with code block", () => {
    const channel = new ChatPresentationChannel();
    const diffView: DiffView = {
      mode: "unified",
      files: [createMockFileDiff()],
      currentFileIndex: 0,
    };
    const output = channel.renderDiff(diffView);

    expect(typeof output).toBe("string");
    expect(output).toContain("```diff");
    expect(output).toContain("```");
  });

  it("truncates long output", () => {
    const channel = new ChatPresentationChannel(100);
    const ranking = createMockRanking();
    const view = buildSummaryView(
      ranking,
      "Test Task with a very long title that will cause truncation",
    );
    const output = channel.renderSummary(view);

    expect(output.length).toBeLessThanOrEqual(100);
    expect(output).toContain("(truncated)");
  });
});

describe("WebPresentationChannel", () => {
  it("has correct properties", () => {
    const channel = new WebPresentationChannel();

    expect(channel.name).toBe("web");
    expect(channel.supportsRichFormatting).toBe(true);
    expect(channel.supportsInteraction).toBe(true);
  });

  it("renders JSON summary", () => {
    const channel = new WebPresentationChannel();
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task");
    const output = channel.renderSummary(view);

    expect(typeof output).toBe("object");
    expect(output).toHaveProperty("type", "solution_summary");
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("actions");
  });

  it("renders JSON detail", () => {
    const channel = new WebPresentationChannel();
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task");
    const output = channel.renderDetail(view);

    expect(typeof output).toBe("object");
    expect(output).toHaveProperty("type", "solution_detail");
    expect(output).toHaveProperty("data");
    expect(output).toHaveProperty("actions");
  });

  it("renders JSON diff with navigation", () => {
    const channel = new WebPresentationChannel();
    const diffView: DiffView = {
      mode: "unified",
      files: [createMockFileDiff(), createMockFileDiff()],
      currentFileIndex: 0,
    };
    const output = channel.renderDiff(diffView);

    expect(typeof output).toBe("object");
    expect(output).toHaveProperty("type", "solution_diff");
    expect(output).toHaveProperty("navigation");
    expect((output as any).navigation).toHaveProperty("hasNext", true);
    expect((output as any).navigation).toHaveProperty("hasPrev", false);
  });

  it("includes action buttons with variants", () => {
    const channel = new WebPresentationChannel();
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task");
    const output = channel.renderSummary(view) as any;

    const actions = output.actions;
    expect(actions.find((a: any) => a.id === "accept")).toHaveProperty("variant", "primary");
    expect(actions.find((a: any) => a.id === "reject")).toHaveProperty("variant", "danger");
  });
});

// ============================================================================
// View builder tests
// ============================================================================

describe("buildSummaryView", () => {
  it("builds summary from ranking with winner", () => {
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task", "task-1");

    expect(view.taskId).toBe("task-1");
    expect(view.taskTitle).toBe("Test Task");
    expect(view.winner).not.toBeNull();
    expect(view.winner?.iterationId).toBe("sol-1");
    expect(view.winner?.score).toBe(0.9);
    expect(view.iterations.length).toBe(2);
    expect(view.winnerStrengths.length).toBeGreaterThan(0);
  });

  it("builds summary from ranking without winner", () => {
    const ranking = createMockRanking({ winner: null });
    const view = buildSummaryView(ranking, "Test Task", "task-1");

    expect(view.winner).toBeNull();
    expect(view.winnerStrengths).toEqual([]);
    expect(view.winnerTradeoffs).toEqual([]);
  });

  it("maps iteration scores correctly", () => {
    const ranking = createMockRanking();
    const view = buildSummaryView(ranking, "Test Task", "task-1");

    const iter = view.iterations[0];
    expect(iter.scores.correctness).toBe(ranking.solutions[0].evaluation.correctness.overall);
    expect(iter.scores.quality).toBe(ranking.solutions[0].evaluation.quality.overall);
    expect(iter.scores.overall).toBe(ranking.solutions[0].evaluation.overallScore);
  });
});

describe("buildDetailView", () => {
  it("builds detail from evaluation", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");

    expect(view.iterationId).toBe("solution-1");
    expect(view.taskId).toBe("task-1");
    expect(view.taskTitle).toBe("Test Task");
    expect(view.status).toBe("completed");
  });

  it("includes score breakdown for all categories", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");

    expect(view.scoreBreakdown.correctness).toBeDefined();
    expect(view.scoreBreakdown.quality).toBeDefined();
    expect(view.scoreBreakdown.efficiency).toBeDefined();
    expect(view.scoreBreakdown.completeness).toBeDefined();
    expect(view.scoreBreakdown.safety).toBeDefined();
  });

  it("includes checks for each category", () => {
    const evaluation = createMockEvaluation();
    const view = buildDetailView(evaluation, "Test Task", "task-1");

    expect(view.scoreBreakdown.correctness.checks.length).toBeGreaterThan(0);
    expect(view.scoreBreakdown.quality.checks.length).toBeGreaterThan(0);
    expect(view.scoreBreakdown.safety.checks.length).toBeGreaterThan(0);
  });

  it("sets correct check types based on values", () => {
    const evaluation = createMockEvaluation({
      correctness: {
        ...createMockEvaluation().correctness,
        typeCheck: true,
        lintClean: false,
      },
    });
    const view = buildDetailView(evaluation, "Test Task", "task-1");

    const typeCheck = view.scoreBreakdown.correctness.checks.find((c) => c.name === "Type check");
    const lintCheck = view.scoreBreakdown.correctness.checks.find((c) => c.name === "Lint");

    expect(typeCheck?.type).toBe("pass");
    expect(lintCheck?.type).toBe("fail");
  });
});

// ============================================================================
// Presenter class tests
// ============================================================================

describe("SolutionPresenter", () => {
  it("presents comparison using channel", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const output = await presenter.presentComparison(ranking, "Test Task");

    expect(typeof output).toBe("string");
    expect(output).toContain("Solution Comparison: Test Task");
  });

  it("presents detail using channel", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const evaluation = createMockEvaluation();
    const output = await presenter.presentDetail(evaluation, "Test Task");

    expect(typeof output).toBe("string");
    expect(output).toContain("Solution Details:");
  });

  it("presents diff using channel", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const output = await presenter.presentDiff([createMockFileDiff()]);

    expect(typeof output).toBe("string");
    expect(output).toContain("Diff:");
  });

  it("handles accept action", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const action: PresentationAction = { type: "accept", iterationId: "sol-1" };
    const result = await presenter.handleAction(action, ranking);

    expect(result).toBe(true);
    expect(handlers.onAccept).toHaveBeenCalledWith("sol-1");
  });

  it("handles reject action", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const action: PresentationAction = {
      type: "reject",
      iterationId: "sol-1",
      reason: "Not good enough",
    };
    const result = await presenter.handleAction(action, ranking);

    expect(result).toBe(true);
    expect(handlers.onReject).toHaveBeenCalledWith("sol-1", "Not good enough");
  });

  it("handles rejectAll action", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const action: PresentationAction = { type: "rejectAll", reason: "Start over" };
    const result = await presenter.handleAction(action, ranking);

    expect(result).toBe(true);
    expect(handlers.onRejectAll).toHaveBeenCalledWith("Start over");
  });

  it("handles requestChanges action", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const action: PresentationAction = {
      type: "requestChanges",
      iterationId: "sol-1",
      feedback: "Add tests",
    };
    const result = await presenter.handleAction(action, ranking);

    expect(result).toBe(true);
    expect(handlers.onRequestChanges).toHaveBeenCalledWith("sol-1", "Add tests");
  });

  it("handles manualReview action", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const action: PresentationAction = { type: "manualReview" };
    const result = await presenter.handleAction(action, ranking);

    expect(result).toBe(true);
    expect(handlers.onManualReview).toHaveBeenCalled();
  });

  it("handles navigation actions without calling handlers", async () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const ranking = createMockRanking();
    const backAction: PresentationAction = { type: "backToSummary" };
    const nextAction: PresentationAction = { type: "nextFile" };
    const prevAction: PresentationAction = { type: "prevFile" };

    expect(await presenter.handleAction(backAction, ranking)).toBe(false);
    expect(await presenter.handleAction(nextAction, ranking)).toBe(false);
    expect(await presenter.handleAction(prevAction, ranking)).toBe(false);

    expect(handlers.onAccept).not.toHaveBeenCalled();
  });

  it("returns action bar for context", () => {
    const channel = new CliPresentationChannel();
    const handlers = createMockActionHandlers();
    const presenter = new SolutionPresenter(channel, handlers);

    const config: ActionBarConfig = { context: "summary", winnerId: "sol-1" };
    const output = presenter.getActionBar(config);

    expect(typeof output).toBe("string");
    expect(output).toContain("Actions:");
  });
});

// ============================================================================
// Factory function tests
// ============================================================================

describe("createPresenter", () => {
  it("creates CLI presenter", () => {
    const handlers = createMockActionHandlers();
    const presenter = createPresenter("cli", handlers);

    expect(presenter).toBeInstanceOf(SolutionPresenter);
  });

  it("creates chat presenter with default max length", () => {
    const handlers = createMockActionHandlers();
    const presenter = createPresenter("chat", handlers);

    expect(presenter).toBeInstanceOf(SolutionPresenter);
  });

  it("creates chat presenter with custom max length", () => {
    const handlers = createMockActionHandlers();
    const presenter = createPresenter("chat", handlers, { maxLength: 1000 });

    expect(presenter).toBeInstanceOf(SolutionPresenter);
  });

  it("creates web presenter", () => {
    const handlers = createMockActionHandlers();
    const presenter = createPresenter("web", handlers);

    expect(presenter).toBeInstanceOf(SolutionPresenter);
  });

  it("throws for unknown channel type", () => {
    const handlers = createMockActionHandlers();

    expect(() => createPresenter("unknown" as any, handlers)).toThrow("Unknown channel type");
  });
});

describe("createDefaultHandlers", () => {
  it("creates handlers that resolve without error", async () => {
    const handlers = createDefaultHandlers();

    await expect(handlers.onAccept("sol-1")).resolves.toBeUndefined();
    await expect(handlers.onReject("sol-1", "reason")).resolves.toBeUndefined();
    await expect(handlers.onRejectAll("reason")).resolves.toBeUndefined();
    await expect(handlers.onRequestChanges("sol-1", "feedback")).resolves.toBeUndefined();
    await expect(handlers.onManualReview()).resolves.toBeUndefined();
  });
});

// ============================================================================
// DEFAULT_DIFF_OPTIONS tests
// ============================================================================

describe("DEFAULT_DIFF_OPTIONS", () => {
  it("has expected default values", () => {
    expect(DEFAULT_DIFF_OPTIONS.contextLines).toBe(3);
    expect(DEFAULT_DIFF_OPTIONS.syntaxHighlight).toBe(true);
    expect(DEFAULT_DIFF_OPTIONS.wordDiff).toBe(false);
    expect(DEFAULT_DIFF_OPTIONS.collapseUnchanged).toBe(true);
  });
});
