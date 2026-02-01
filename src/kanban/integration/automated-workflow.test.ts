/**
 * Integration tests for automated Kanban validation workflow
 *
 * Tests the complete task-to-solution pipeline without human intervention:
 * adapter -> picker -> runner -> comparator -> presenter
 */

import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Adapter imports
import {
  type AdapterConfig,
  AdapterRegistry,
  type ExternalTask,
  type TaskAdapter,
  type TaskComment,
  type TaskListFilter,
} from "../adapter.js";

// Picker imports
import {
  filterTasks,
  pickNextTask,
  pickTopTasks,
  type PickableTask,
  rankTasks,
  type TaskPickerFilter,
} from "../picker.js";

// Runner imports
import {
  aggregateResults,
  createHybridVariations,
  createIterationPlan,
  createModelVariations,
  createThinkingVariations,
  DEFAULT_ITERATION_LIMITS,
  DEFAULT_SCORING_CONFIG,
  IterationLimitEnforcer,
  IterationResultCollector,
  type IterationResult,
  type IterationVariation,
  parseConfidenceFromOutput,
  scoreResult,
} from "../iteration-runner.js";

// Comparator imports
import {
  booleanToScore,
  calculateCommentRatio,
  calculateSizeMetrics,
  checkDangerousOps,
  checkSecretsExposed,
  clamp01,
  type ComparatorDeps,
  createDefaultDeps,
  DEFAULT_AUTO_ACCEPTANCE_CONFIG,
  DEFAULT_EVALUATION_CONFIG,
  estimateComplexity,
  estimateDuplication,
  evaluateSolution,
  formatRankingAsMarkdown,
  identifyStrengths,
  identifyWeaknesses,
  inverseScore,
  rankSolutions,
  ratioToScore,
  shouldAutoAccept,
  type SolutionEvaluation,
  type SolutionInput,
} from "../comparator.js";

// Presenter imports
import {
  buildDetailView,
  buildSummaryView,
  ChatPresentationChannel,
  CliPresentationChannel,
  createDefaultHandlers,
  createPresenter,
  parseAction,
  renderActionBar,
  renderDetailCli,
  renderSummaryCli,
  type SolutionRanking,
  WebPresentationChannel,
} from "../presenter.js";

// Dashboard store types
import type { KanbanTask } from "../../dashboard/kanban-store.js";

// ============================================================================
// Mock implementations for testing
// ============================================================================

function genId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/**
 * Create a mock task adapter for testing
 */
function createMockAdapter(tasks: ExternalTask[]): TaskAdapter {
  return {
    type: "mock",
    name: "Mock Adapter",
    supportsWrite: true,
    listTasks: async (_filter?: TaskListFilter) => tasks,
    getTask: async (id: string) => tasks.find((t) => t.id === id) ?? null,
    updateStatus: async () => {},
    addComment: async () => {},
    getComments: async () => [],
    isConfigured: async () => true,
    getConfigInstructions: () => "Mock adapter - no configuration needed",
  };
}

/**
 * Create a mock pickable task
 */
function createMockPickableTask(overrides: Partial<PickableTask> = {}): PickableTask {
  const now = new Date();
  return {
    id: "task-" + genId(),
    title: "Mock Task",
    status: "open",
    priority: "medium",
    labels: [],
    assignees: [],
    createdAt: now,
    updatedAt: now,
    commentCount: 0,
    ...overrides,
  };
}

/**
 * Create a mock external task
 */
function createMockExternalTask(overrides: Partial<ExternalTask> = {}): ExternalTask {
  const now = new Date();
  return {
    id: "ext-" + genId(),
    source: { adapter: "mock", source: "test" },
    title: "Mock External Task",
    status: "open",
    priority: "medium",
    labels: [],
    assignees: [],
    createdAt: now,
    updatedAt: now,
    commentCount: 0,
    metadata: {},
    ...overrides,
  };
}

/**
 * Create a mock kanban task
 */
function createMockKanbanTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  const now = new Date().toISOString();
  return {
    id: "kanban-" + genId(),
    title: "Mock Kanban Task",
    column: "backlog",
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock iteration result
 */
function createMockIterationResult(overrides: Partial<IterationResult> = {}): IterationResult {
  const startedAt = Date.now() - 5000;
  const endedAt = Date.now();
  return {
    variationId: "var-" + genId(),
    runId: "run-" + genId(),
    sessionKey: "session-" + genId(),
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    output: "Solution output\n\nConfidence: 85%",
    outputType: "text",
    metrics: {
      confidence: 0.85,
      completeness: 0.9,
      codeQuality: 0.8,
      responsiveness: 0.95,
      overallScore: 0.87,
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      estimatedCostUsd: 0.02,
    },
    success: true,
    ...overrides,
  };
}

/**
 * Create a mock solution input
 */
function createMockSolutionInput(overrides: Partial<SolutionInput> = {}): SolutionInput {
  return {
    solutionId: "sol-" + genId(),
    iterationId: "iter-" + genId(),
    taskDescription: "Implement a feature that does X",
    originalCode: 'function original() { return "hello"; }',
    solutionCode:
      'function solution() {\n  // Improved implementation\n  const result = "hello world";\n  return result;\n}',
    changedFiles: ["src/feature.ts"],
    ...overrides,
  };
}

/**
 * Create mock comparator deps with no-op functions
 */
function createMockComparatorDeps(): ComparatorDeps {
  return {
    spawnCommand: async () => ({
      success: true,
      stdout: "Tests: 10 passed",
      stderr: "",
      exitCode: 0,
    }),
    llmAssess: async () => ({
      score: 0.8,
      confidence: 0.9,
      reasoning: "Good implementation",
      suggestions: [],
    }),
    now: () => new Date(),
  };
}

// ============================================================================
// Automated workflow integration tests
// ============================================================================

describe("Automated Kanban Validation Workflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Complete Pipeline: Adapter -> Picker -> Runner -> Comparator -> Presenter", () => {
    it("runs end-to-end without human prompts", async () => {
      // STEP 1: Adapter - Ingest tasks from source
      const externalTasks: ExternalTask[] = [
        createMockExternalTask({
          id: "task-1",
          title: "Implement caching layer",
          priority: "high",
          labels: ["feature", "performance"],
        }),
        createMockExternalTask({
          id: "task-2",
          title: "Fix memory leak",
          priority: "critical",
          labels: ["bug"],
        }),
        createMockExternalTask({
          id: "task-3",
          title: "Update documentation",
          priority: "low",
          labels: ["docs"],
        }),
      ];

      const registry = new AdapterRegistry();
      registry.registerFactory("mock", () => createMockAdapter(externalTasks));
      const adapter = registry.createAdapter({
        type: "mock",
        source: "test",
        enabled: true,
        config: {},
      });

      const ingestedTasks = await adapter.listTasks();
      expect(ingestedTasks).toHaveLength(3);

      // STEP 2: Picker - Automatically select best task
      const pickableTasks: PickableTask[] = ingestedTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        labels: t.labels,
        assignees: t.assignees,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        commentCount: t.commentCount,
      }));

      const pickResult = pickNextTask(pickableTasks);
      expect(pickResult.task).not.toBeNull();
      expect(pickResult.task?.id).toBe("task-2"); // Critical priority should be picked first
      expect(pickResult.reason).toContain("Critical priority");

      // STEP 3: Runner - Create variations and simulate execution
      const selectedTask = createMockKanbanTask({
        id: pickResult.task!.id,
        title: pickResult.task!.title,
        description: "Fix the memory leak in the cache module",
      });

      const variations = createModelVariations(selectedTask, [
        "claude-3-5-sonnet",
        "claude-3-haiku",
      ]);
      expect(variations).toHaveLength(2);

      const plan = createIterationPlan(selectedTask, {
        strategy: "parallel",
        variations,
        completionCriteria: { waitForAll: true },
      });

      expect(plan.status).toBe("pending");
      expect(plan.variations).toHaveLength(2);

      // Simulate results collection
      const collector = new IterationResultCollector(plan);

      const result1 = createMockIterationResult({
        variationId: variations[0].id,
        metrics: { overallScore: 0.92 },
      });
      const result2 = createMockIterationResult({
        variationId: variations[1].id,
        metrics: { overallScore: 0.78 },
      });

      collector.addResult(result1);
      collector.addResult(result2);

      const bestResult = collector.getBestResult();
      expect(bestResult).toBeDefined();
      expect(bestResult?.variationId).toBe(variations[0].id);

      // STEP 4: Comparator - Evaluate solutions automatically
      const solution1 = createMockSolutionInput({
        solutionId: "solution-1",
        iterationId: variations[0].id,
      });
      const solution2 = createMockSolutionInput({
        solutionId: "solution-2",
        iterationId: variations[1].id,
      });

      const mockDeps = createMockComparatorDeps();
      const [eval1, eval2] = await Promise.all([
        evaluateSolution(solution1, DEFAULT_EVALUATION_CONFIG, mockDeps),
        evaluateSolution(solution2, DEFAULT_EVALUATION_CONFIG, mockDeps),
      ]);

      const ranking = rankSolutions([eval1, eval2]);
      expect(ranking.solutions).toHaveLength(2);
      expect(ranking.winner).toBeDefined();

      // STEP 5: Presenter - Format results automatically
      const summaryView = buildSummaryView(ranking, selectedTask.title, selectedTask.id);
      expect(summaryView.winner).toBeDefined();
      expect(summaryView.iterations).toHaveLength(2);

      // Render for different channels without interaction
      const cliOutput = renderSummaryCli(summaryView);
      expect(cliOutput).toContain("Solution Comparison");

      const chatChannel = new ChatPresentationChannel(2000);
      const chatOutput = chatChannel.renderSummary(summaryView);
      expect(typeof chatOutput).toBe("string");

      const webChannel = new WebPresentationChannel();
      const webOutput = webChannel.renderSummary(summaryView);
      expect(typeof webOutput).toBe("object");

      // Verify no human prompts required - the entire pipeline completed
      expect(summaryView.autoAcceptance).toBeDefined();
    });

    it("handles automatic task selection without user input", async () => {
      const tasks: PickableTask[] = [
        createMockPickableTask({
          id: "urgent",
          title: "Critical security fix",
          priority: "critical",
          dueDate: new Date(Date.now() - 86400000), // Overdue
        }),
        createMockPickableTask({
          id: "normal",
          title: "Regular feature",
          priority: "medium",
        }),
        createMockPickableTask({
          id: "backlog",
          title: "Nice to have",
          priority: "low",
        }),
      ];

      // Automatic selection based on scoring
      const result = pickNextTask(tasks);
      expect(result.task).not.toBeNull();
      expect(result.task?.id).toBe("urgent");
      expect(result.consideredCount).toBe(3);

      // No user confirmation needed - returns immediately
      expect(result.score).toBeGreaterThan(0);
    });

    it("automatically evaluates solutions without human review", async () => {
      const solution = createMockSolutionInput({
        solutionCode:
          "/**\n * Fixed memory leak by properly disposing resources\n */\nexport async function processData(input: string): Promise<string> {\n  const buffer = Buffer.alloc(1024);\n  try {\n    // Process the input\n    const result = input.toUpperCase();\n    return result;\n  } finally {\n    // Proper cleanup\n    buffer.fill(0);\n  }\n}",
      });

      const mockDeps = createMockComparatorDeps();
      const evaluation = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, mockDeps);

      // Evaluation completes automatically
      expect(evaluation.solutionId).toBe(solution.solutionId);
      expect(evaluation.overallScore).toBeGreaterThan(0);
      expect(evaluation.confidence).toBeGreaterThan(0);

      // Automatic strength/weakness identification
      const strengths = identifyStrengths(evaluation);
      const weaknesses = identifyWeaknesses(evaluation);
      expect(Array.isArray(strengths)).toBe(true);
      expect(Array.isArray(weaknesses)).toBe(true);
    });

    it("automatically presents results without interaction prompts", async () => {
      // Create mock ranking
      const eval1: SolutionEvaluation = {
        solutionId: "sol-1",
        iterationId: "iter-1",
        correctness: {
          testsPass: 1.0,
          typeCheck: true,
          lintClean: true,
          buildSuccess: true,
          noRegressions: true,
          requirementCoverage: 0.95,
          edgeCaseHandling: 0.85,
          apiCompatible: true,
          overall: 0.92,
        },
        quality: {
          complexity: { average: 3, max: 5, score: 0.9 },
          size: { linesAdded: 50, linesRemoved: 10, netChange: 40, score: 0.85 },
          duplication: { percentage: 0.02, score: 0.98 },
          naming: 0.9,
          comments: 0.8,
          patternAdherence: 0.88,
          errorHandling: 0.85,
          overall: 0.88,
        },
        efficiency: {
          algorithmic: 0.85,
          resourceCleanup: true,
          asyncEfficiency: 0.9,
          overall: 0.87,
        },
        completeness: {
          requirementsMet: 0.95,
          documentationAdded: true,
          testsAdded: 0.8,
          changelogUpdated: false,
          overall: 0.85,
        },
        safety: {
          noDangerousOps: true,
          securityReview: 0.9,
          noSecretsExposed: true,
          rollbackSafe: 0.95,
          overall: 0.93,
        },
        overallScore: 0.89,
        confidence: 0.88,
        evaluatedAt: new Date(),
      };

      const ranking = rankSolutions([eval1]);

      // Create presenter with no-op handlers (no user interaction)
      const presenter = createPresenter("cli", createDefaultHandlers());

      // Present without blocking for user input
      const output = await presenter.presentComparison(ranking, "Test Task", "task-1");
      expect(output).toBeDefined();
      expect(typeof output).toBe("string");
      expect(output).toContain("Solution Comparison");
    });
  });

  describe("Automatic Task Selection", () => {
    it("selects highest priority task automatically", () => {
      const tasks: PickableTask[] = [
        createMockPickableTask({ id: "low", priority: "low" }),
        createMockPickableTask({ id: "high", priority: "high" }),
        createMockPickableTask({ id: "critical", priority: "critical" }),
        createMockPickableTask({ id: "medium", priority: "medium" }),
      ];

      const result = pickNextTask(tasks);
      expect(result.task?.id).toBe("critical");
    });

    it("considers due dates in automatic selection", () => {
      const tasks: PickableTask[] = [
        createMockPickableTask({
          id: "overdue",
          priority: "medium",
          dueDate: new Date(Date.now() - 86400000),
        }),
        createMockPickableTask({
          id: "future",
          priority: "high",
          dueDate: new Date(Date.now() + 604800000),
        }),
      ];

      const result = pickNextTask(tasks);
      expect(result.task?.id).toBe("overdue");
      expect(result.reason).toContain("Overdue");
    });

    it("picks multiple tasks automatically for batch processing", () => {
      const tasks: PickableTask[] = Array.from({ length: 10 }, (_, i) =>
        createMockPickableTask({
          id: "task-" + i,
          priority: i < 3 ? "high" : "medium",
        }),
      );

      const topTasks = pickTopTasks(tasks, 5);
      expect(topTasks).toHaveLength(5);
      // High priority tasks should be at the top
      expect(topTasks.slice(0, 3).every((t) => t.task.priority === "high")).toBe(true);
    });

    it("respects filters in automatic selection", () => {
      const tasks: PickableTask[] = [
        createMockPickableTask({ id: "bug", labels: ["bug"], priority: "high" }),
        createMockPickableTask({ id: "feature", labels: ["feature"], priority: "critical" }),
        createMockPickableTask({ id: "docs", labels: ["docs"], priority: "medium" }),
      ];

      const filter: TaskPickerFilter = { labels: ["bug"] };
      const result = pickNextTask(tasks, { filter });
      expect(result.task?.id).toBe("bug");
    });
  });

  describe("Automatic Solution Evaluation", () => {
    it("evaluates correctness without manual checks", async () => {
      const solution = createMockSolutionInput();
      const mockDeps = createMockComparatorDeps();
      const evaluation = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, mockDeps);

      expect(evaluation.correctness).toBeDefined();
      expect(evaluation.correctness.typeCheck).toBe(true);
      expect(evaluation.correctness.lintClean).toBe(true);
      expect(evaluation.correctness.buildSuccess).toBe(true);
    });

    it("checks code quality automatically", () => {
      const code =
        "function example(a: number, b: number): number {\n  if (a > b) {\n    return a;\n  } else if (a < b) {\n    return b;\n  } else {\n    return 0;\n  }\n}";
      const complexity = estimateComplexity(code);
      expect(complexity.average).toBeGreaterThan(0);
      expect(complexity.max).toBeGreaterThan(0);

      const duplication = estimateDuplication(code);
      expect(duplication).toBeLessThan(1);

      const comments = calculateCommentRatio(code);
      expect(comments).toBeGreaterThanOrEqual(0);
    });

    it("detects dangerous operations automatically", () => {
      // Test code that uses dynamic code execution (dangerous pattern)
      const dangerousCode = 'const result = new Function("return 2 + 2")()';
      const result = checkDangerousOps(dangerousCode);
      expect(result.safe).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);

      const safeCode = 'console.log("hello")';
      const safeResult = checkDangerousOps(safeCode);
      expect(safeResult.safe).toBe(true);
    });

    it("checks for exposed secrets automatically", () => {
      const codeWithSecrets = 'const apiKey = "sk-1234567890abcdefghij";';
      const result = checkSecretsExposed(codeWithSecrets);
      expect(result.safe).toBe(false);

      const safeCode = "const apiKey = process.env.API_KEY;";
      const safeResult = checkSecretsExposed(safeCode);
      expect(safeResult.safe).toBe(true);
    });
  });

  describe("Automatic Result Presentation", () => {
    it("renders CLI output without user prompts", () => {
      const ranking: SolutionRanking = {
        solutions: [
          {
            solutionId: "sol-1",
            rank: 1,
            score: 0.9,
            evaluation: {
              solutionId: "sol-1",
              iterationId: "iter-1",
              correctness: {
                testsPass: 1,
                typeCheck: true,
                lintClean: true,
                buildSuccess: true,
                noRegressions: true,
                requirementCoverage: 0.9,
                edgeCaseHandling: 0.8,
                apiCompatible: true,
                overall: 0.9,
              },
              quality: {
                complexity: { average: 3, max: 5, score: 0.9 },
                size: { linesAdded: 50, linesRemoved: 10, netChange: 40, score: 0.8 },
                duplication: { percentage: 0.01, score: 0.99 },
                naming: 0.9,
                comments: 0.8,
                patternAdherence: 0.85,
                errorHandling: 0.85,
                overall: 0.87,
              },
              efficiency: {
                algorithmic: 0.85,
                resourceCleanup: true,
                asyncEfficiency: 0.9,
                overall: 0.87,
              },
              completeness: {
                requirementsMet: 0.9,
                documentationAdded: true,
                testsAdded: 0.8,
                changelogUpdated: false,
                overall: 0.85,
              },
              safety: {
                noDangerousOps: true,
                securityReview: 0.9,
                noSecretsExposed: true,
                rollbackSafe: 0.9,
                overall: 0.92,
              },
              overallScore: 0.9,
              confidence: 0.88,
              evaluatedAt: new Date(),
            },
            strengths: ["All tests pass", "Clean type check and lint"],
            weaknesses: [],
          },
        ],
        winner: null,
        confidence: 0.88,
        comparisonDetails: [],
      };
      ranking.winner = ranking.solutions[0];

      const summaryView = buildSummaryView(ranking, "Test Task", "task-1");
      const output = renderSummaryCli(summaryView);

      expect(output).toContain("Solution Comparison");
      expect(output).toContain("Test Task");
      expect(output).not.toContain("Press any key");
      expect(output).not.toContain("Enter your choice");
    });

    it("generates action bar without blocking prompts", () => {
      const config = {
        context: "summary" as const,
        winnerId: "sol-1",
      };

      const actionBar = renderActionBar(config);
      expect(actionBar).toContain("[a]");
      expect(actionBar).toContain("[v]");
      expect(actionBar).toContain("[d]");
    });

    it("parses actions programmatically", () => {
      const config = {
        context: "summary" as const,
        winnerId: "sol-1",
        currentIterationId: "sol-1",
      };

      const acceptAction = parseAction("a", config);
      expect(acceptAction?.type).toBe("accept");

      const viewAction = parseAction("v", config);
      expect(viewAction?.type).toBe("viewDetails");

      const rejectAction = parseAction("x", config);
      expect(rejectAction?.type).toBe("reject");
    });
  });

  describe("Auto-Acceptance Logic", () => {
    it("determines auto-acceptance eligibility without human input", () => {
      const ranking: SolutionRanking = {
        solutions: [
          {
            solutionId: "sol-1",
            rank: 1,
            score: 0.92,
            evaluation: {
              solutionId: "sol-1",
              iterationId: "iter-1",
              correctness: {
                testsPass: 1,
                typeCheck: true,
                lintClean: true,
                buildSuccess: true,
                noRegressions: true,
                requirementCoverage: 0.95,
                edgeCaseHandling: 0.9,
                apiCompatible: true,
                overall: 0.95,
              },
              quality: {
                complexity: { average: 3, max: 5, score: 0.9 },
                size: { linesAdded: 50, linesRemoved: 10, netChange: 40, score: 0.85 },
                duplication: { percentage: 0.01, score: 0.99 },
                naming: 0.9,
                comments: 0.85,
                patternAdherence: 0.88,
                errorHandling: 0.9,
                overall: 0.9,
              },
              efficiency: {
                algorithmic: 0.88,
                resourceCleanup: true,
                asyncEfficiency: 0.9,
                overall: 0.88,
              },
              completeness: {
                requirementsMet: 0.95,
                documentationAdded: true,
                testsAdded: 0.9,
                changelogUpdated: true,
                overall: 0.92,
              },
              safety: {
                noDangerousOps: true,
                securityReview: 0.95,
                noSecretsExposed: true,
                rollbackSafe: 0.95,
                overall: 0.96,
              },
              overallScore: 0.92,
              confidence: 0.9,
              evaluatedAt: new Date(),
            },
            strengths: ["All tests pass", "Clean type check and lint", "High safety score"],
            weaknesses: [],
          },
        ],
        winner: null,
        confidence: 0.9,
        comparisonDetails: [],
      };
      ranking.winner = ranking.solutions[0];

      const config = {
        ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
        enabled: true,
        minScore: 0.85,
        minConfidence: 0.8,
      };

      const result = shouldAutoAccept(ranking, config);
      expect(result.accept).toBe(true);
      expect(result.reason).toBe("All criteria met");
    });

    it("rejects when score is below threshold", () => {
      const ranking: SolutionRanking = {
        solutions: [
          {
            solutionId: "sol-1",
            rank: 1,
            score: 0.7,
            evaluation: {
              solutionId: "sol-1",
              iterationId: "iter-1",
              correctness: {
                testsPass: 0.8,
                typeCheck: true,
                lintClean: false,
                buildSuccess: true,
                noRegressions: true,
                requirementCoverage: 0.7,
                edgeCaseHandling: 0.6,
                apiCompatible: true,
                overall: 0.75,
              },
              quality: {
                complexity: { average: 8, max: 15, score: 0.5 },
                size: { linesAdded: 200, linesRemoved: 10, netChange: 190, score: 0.4 },
                duplication: { percentage: 0.15, score: 0.85 },
                naming: 0.6,
                comments: 0.4,
                patternAdherence: 0.5,
                errorHandling: 0.5,
                overall: 0.55,
              },
              efficiency: {
                algorithmic: 0.6,
                resourceCleanup: false,
                asyncEfficiency: 0.5,
                overall: 0.55,
              },
              completeness: {
                requirementsMet: 0.7,
                documentationAdded: false,
                testsAdded: 0.3,
                changelogUpdated: false,
                overall: 0.5,
              },
              safety: {
                noDangerousOps: true,
                securityReview: 0.7,
                noSecretsExposed: true,
                rollbackSafe: 0.6,
                overall: 0.75,
              },
              overallScore: 0.7,
              confidence: 0.6,
              evaluatedAt: new Date(),
            },
            strengths: [],
            weaknesses: ["Lint errors present", "Missing documentation"],
          },
        ],
        winner: null,
        confidence: 0.6,
        comparisonDetails: [],
      };
      ranking.winner = ranking.solutions[0];

      const config = {
        ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
        enabled: true,
        minScore: 0.85,
      };

      const result = shouldAutoAccept(ranking, config);
      expect(result.accept).toBe(false);
      expect(result.reason).toContain("below threshold");
    });
  });

  describe("Variation Strategy Automation", () => {
    it("creates model variations automatically", () => {
      const task = createMockKanbanTask({ title: "Test Task" });
      const variations = createModelVariations(task, [
        "claude-3-5-sonnet",
        "claude-3-haiku",
        "claude-3-opus",
      ]);

      expect(variations).toHaveLength(3);
      expect(variations[0].model).toBe("claude-3-5-sonnet");
      expect(variations[1].model).toBe("claude-3-haiku");
      expect(variations[2].model).toBe("claude-3-opus");
    });

    it("creates thinking variations automatically", () => {
      const task = createMockKanbanTask({ title: "Complex Problem" });
      const variations = createThinkingVariations(task, ["none", "low", "medium", "high"]);

      expect(variations).toHaveLength(4);
      expect(variations[0].thinking).toBe("none");
      expect(variations[3].thinking).toBe("high");
    });

    it("creates hybrid variations automatically", () => {
      const task = createMockKanbanTask({ title: "Hybrid Test" });
      const variations = createHybridVariations(task, {
        models: ["claude-3-5-sonnet", "claude-3-haiku"],
        thinkingLevels: ["low", "high"],
        maxCombinations: 4,
      });

      expect(variations).toHaveLength(4);
      // Each variation should have a unique combination
      const uniqueCombos = new Set(variations.map((v) => v.model + "-" + v.thinking));
      expect(uniqueCombos.size).toBe(4);
    });
  });

  describe("Result Aggregation Automation", () => {
    it("aggregates results using best strategy", () => {
      const results: IterationResult[] = [
        createMockIterationResult({
          variationId: "var-1",
          metrics: { overallScore: 0.8 },
        }),
        createMockIterationResult({
          variationId: "var-2",
          metrics: { overallScore: 0.95 },
        }),
        createMockIterationResult({
          variationId: "var-3",
          metrics: { overallScore: 0.7 },
        }),
      ];

      const aggregated = aggregateResults(results, "best");
      expect(aggregated.strategy).toBe("best");
      expect(aggregated.selectedResults).toHaveLength(1);
      expect(aggregated.selectedResults[0].variationId).toBe("var-2");
    });

    it("aggregates results using voting strategy", () => {
      const results: IterationResult[] = [
        createMockIterationResult({
          variationId: "var-1",
          output: "Answer A",
          metrics: { overallScore: 0.8 },
        }),
        createMockIterationResult({
          variationId: "var-2",
          output: "Answer A",
          metrics: { overallScore: 0.75 },
        }),
        createMockIterationResult({
          variationId: "var-3",
          output: "Answer B",
          metrics: { overallScore: 0.9 },
        }),
      ];

      const aggregated = aggregateResults(results, "voting");
      expect(aggregated.strategy).toBe("voting");
      expect(aggregated.mergedOutput).toBe("Answer A");
      expect(aggregated.confidence).toBeCloseTo(0.667, 2);
    });

    it("parses confidence from output automatically", () => {
      expect(parseConfidenceFromOutput("Confidence: 85%")).toBe(0.85);
      expect(parseConfidenceFromOutput("confidence: 0.92")).toBe(0.92);
      expect(parseConfidenceFromOutput("confidence score: 78")).toBe(0.78);
      expect(parseConfidenceFromOutput("No confidence here")).toBeUndefined();
    });
  });

  describe("Limit Enforcement Automation", () => {
    it("enforces iteration limits automatically", () => {
      const enforcer = new IterationLimitEnforcer({
        ...DEFAULT_ITERATION_LIMITS,
        maxConcurrentIterations: 2,
        maxTotalIterations: 5,
      });

      // Should allow spawning initially
      expect(enforcer.canSpawn().allowed).toBe(true);

      // Spawn two iterations
      enforcer.recordSpawn();
      enforcer.recordSpawn();

      // Should block at concurrent limit
      expect(enforcer.canSpawn().allowed).toBe(false);
      expect(enforcer.canSpawn().reason).toContain("concurrent");

      // Complete one
      enforcer.recordCompletion(createMockIterationResult());
      expect(enforcer.canSpawn().allowed).toBe(true);
    });

    it("tracks resource usage automatically", () => {
      const enforcer = new IterationLimitEnforcer(DEFAULT_ITERATION_LIMITS);

      const result = createMockIterationResult({
        usage: { totalTokens: 5000, estimatedCostUsd: 0.1 },
      });

      enforcer.recordSpawn();
      enforcer.recordCompletion(result);

      const usage = enforcer.getUsage();
      expect(usage.completedCount).toBe(1);
      expect(usage.totalTokens).toBe(5000);
      expect(usage.totalCost).toBe(0.1);
    });
  });

  describe("Scoring Utilities", () => {
    it("converts boolean to score", () => {
      expect(booleanToScore(true)).toBe(1.0);
      expect(booleanToScore(false)).toBe(0.0);
    });

    it("calculates ratio score", () => {
      expect(ratioToScore(8, 10)).toBe(0.8);
      expect(ratioToScore(15, 10)).toBe(1.0); // Capped at 1.0
      expect(ratioToScore(0, 0)).toBe(0);
    });

    it("calculates inverse score", () => {
      expect(inverseScore(0, 5, 10)).toBe(1.0); // At or below baseline
      expect(inverseScore(10, 5, 10)).toBe(0.0); // At worst
      expect(inverseScore(7.5, 5, 10)).toBe(0.5); // Halfway
    });

    it("clamps values to 0-1", () => {
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(-0.5)).toBe(0);
      expect(clamp01(1.5)).toBe(1);
    });

    it("scores results automatically", () => {
      const result = createMockIterationResult({
        metrics: {
          confidence: 0.9,
          completeness: 0.85,
          codeQuality: 0.8,
          responsiveness: 0.95,
          overallScore: 0,
        },
        durationMs: 60000,
        usage: { estimatedCostUsd: 0.05 },
        success: true,
      });

      const score = scoreResult(result, DEFAULT_SCORING_CONFIG);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe("Markdown Formatting", () => {
    it("formats ranking as markdown automatically", () => {
      const ranking: SolutionRanking = {
        solutions: [
          {
            solutionId: "sol-1",
            rank: 1,
            score: 0.9,
            evaluation: {
              solutionId: "sol-1",
              iterationId: "iter-1",
              correctness: {
                testsPass: 1,
                typeCheck: true,
                lintClean: true,
                buildSuccess: true,
                noRegressions: true,
                requirementCoverage: 0.9,
                edgeCaseHandling: 0.8,
                apiCompatible: true,
                overall: 0.9,
              },
              quality: {
                complexity: { average: 3, max: 5, score: 0.9 },
                size: { linesAdded: 50, linesRemoved: 10, netChange: 40, score: 0.8 },
                duplication: { percentage: 0.01, score: 0.99 },
                naming: 0.85,
                comments: 0.8,
                patternAdherence: 0.85,
                errorHandling: 0.85,
                overall: 0.87,
              },
              efficiency: {
                algorithmic: 0.85,
                resourceCleanup: true,
                asyncEfficiency: 0.9,
                overall: 0.87,
              },
              completeness: {
                requirementsMet: 0.9,
                documentationAdded: true,
                testsAdded: 0.8,
                changelogUpdated: false,
                overall: 0.85,
              },
              safety: {
                noDangerousOps: true,
                securityReview: 0.9,
                noSecretsExposed: true,
                rollbackSafe: 0.9,
                overall: 0.92,
              },
              overallScore: 0.9,
              confidence: 0.88,
              evaluatedAt: new Date(),
            },
            strengths: ["All tests pass"],
            weaknesses: [],
          },
        ],
        winner: null,
        confidence: 0.88,
        comparisonDetails: [],
      };
      ranking.winner = ranking.solutions[0];

      const markdown = formatRankingAsMarkdown(ranking);
      expect(markdown).toContain("## Solution Comparison Results");
      expect(markdown).toContain("### Winner: sol-1");
      expect(markdown).toContain("Correctness");
      expect(markdown).toContain("Quality");
      expect(markdown).toContain("Efficiency");
    });
  });
});

describe("Channel Independence", () => {
  it("CLI channel works without terminal interaction", () => {
    const channel = new CliPresentationChannel();
    expect(channel.supportsRichFormatting).toBe(true);
    expect(channel.supportsInteraction).toBe(true);

    // Can render without interaction
    const ranking: SolutionRanking = {
      solutions: [],
      winner: null,
      confidence: 0,
      comparisonDetails: [],
    };
    const summaryView = buildSummaryView(ranking, "Test", "id");
    const output = channel.renderSummary(summaryView);
    expect(typeof output).toBe("string");
  });

  it("Chat channel works without any interaction", () => {
    const channel = new ChatPresentationChannel(2000);
    expect(channel.supportsInteraction).toBe(false);

    const ranking: SolutionRanking = {
      solutions: [],
      winner: null,
      confidence: 0,
      comparisonDetails: [],
    };
    const summaryView = buildSummaryView(ranking, "Test", "id");
    const output = channel.renderSummary(summaryView);
    expect(typeof output).toBe("string");
  });

  it("Web channel returns JSON without blocking", () => {
    const channel = new WebPresentationChannel();
    expect(channel.supportsRichFormatting).toBe(true);

    const ranking: SolutionRanking = {
      solutions: [],
      winner: null,
      confidence: 0,
      comparisonDetails: [],
    };
    const summaryView = buildSummaryView(ranking, "Test", "id");
    const output = channel.renderSummary(summaryView);
    expect(typeof output).toBe("object");
    expect((output as { type: string }).type).toBe("solution_summary");
  });
});
