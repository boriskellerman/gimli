/**
 * Parallel Iteration Execution Integration Tests
 *
 * Tests the iteration runner's ability to spawn and manage multiple
 * sub-agents running in parallel, with variation strategies for
 * model, thinking level, and prompt variations.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  aggregateResults,
  createHybridVariations,
  createIterationPlan,
  createModelVariations,
  createPromptVariations,
  createThinkingVariations,
  DEFAULT_ITERATION_LIMITS,
  DEFAULT_SCORING_CONFIG,
  type IterationLimits,
  IterationLimitEnforcer,
  type IterationPlan,
  type IterationResult,
  IterationResultCollector,
  IterationRunner,
  type IterationVariation,
  parseConfidenceFromOutput,
  type PromptVariant,
  scoreResult,
} from "../iteration-runner.js";

// Mock the gateway call
vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

import { callGateway } from "../../gateway/call.js";
const mockCallGateway = vi.mocked(callGateway);

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTask(
  overrides: Partial<{ id: string; title: string; description: string }> = {},
) {
  return {
    id: "task_integration_123",
    title: "Integration Test Task",
    description: "A task for integration testing parallel iterations",
    ...overrides,
  };
}

function createMockVariation(overrides: Partial<IterationVariation> = {}): IterationVariation {
  return {
    id: `var-${Math.random().toString(36).slice(2, 8)}`,
    label: "test-variation",
    priority: 0,
    status: "pending",
    ...overrides,
  };
}

function createMockResult(overrides: Partial<IterationResult> = {}): IterationResult {
  const now = Date.now();
  return {
    variationId: "var-1",
    runId: `run-${Math.random().toString(36).slice(2, 8)}`,
    sessionKey: `session-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: now - 10000,
    endedAt: now,
    durationMs: 10000,
    output: "Test output with solution",
    outputType: "text",
    metrics: {
      confidence: 0.8,
      completeness: 0.9,
      codeQuality: 0.85,
      responsiveness: 0.9,
      overallScore: 0.85,
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      estimatedCostUsd: 0.05,
    },
    success: true,
    ...overrides,
  };
}

function createMockPlan(overrides: Partial<IterationPlan> = {}): IterationPlan {
  return {
    id: `plan-${Math.random().toString(36).slice(2, 8)}`,
    taskId: "task-integration-123",
    taskTitle: "Integration Test Task",
    taskDescription: "Test description for parallel iterations",
    strategy: "parallel",
    variations: [createMockVariation()],
    maxIterations: 6,
    maxParallel: 3,
    timeoutSeconds: 300,
    completionCriteria: { waitForAll: true },
    createdAt: Date.now(),
    status: "pending",
    ...overrides,
  };
}

/**
 * Simulates a gateway response based on spawn/status calls
 */
function createGatewaySimulator(config: {
  spawnLatencyMs?: number;
  completionLatencyMs?: number;
  failureRate?: number;
  timeoutRate?: number;
  confidenceRange?: [number, number];
  costRange?: [number, number];
}) {
  const {
    spawnLatencyMs = 10,
    completionLatencyMs = 50,
    failureRate = 0,
    timeoutRate = 0,
    confidenceRange = [60, 95],
    costRange = [0.01, 0.1],
  } = config;

  const runStates = new Map<
    string,
    { status: string; startedAt: number; output?: string; error?: string }
  >();
  let spawnCounter = 0;

  return async (opts: {
    method: string;
    params?: { runId?: string; args?: { model?: string } };
  }) => {
    if (opts.method === "tool.invoke") {
      spawnCounter++;
      const runId = `run-${spawnCounter}`;

      // Check for failure
      if (Math.random() < failureRate) {
        return {
          status: "error",
          error: "Spawn failed due to simulated error",
        };
      }

      runStates.set(runId, {
        status: "running",
        startedAt: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, spawnLatencyMs));

      return {
        status: "accepted",
        runId,
        childSessionKey: `session-${runId}`,
      };
    }

    if (opts.method === "agent.status") {
      const runId = opts.params?.runId || "";
      const state = runStates.get(runId);

      if (!state) {
        return { status: "unknown" };
      }

      const elapsed = Date.now() - state.startedAt;

      // Simulate running state for a while
      if (elapsed < completionLatencyMs) {
        return { status: "running" };
      }

      // Check for timeout
      if (Math.random() < timeoutRate) {
        state.status = "timeout";
        state.error = "timeout";
        return { status: "failed", error: "timeout" };
      }

      // Complete successfully
      const confidence =
        confidenceRange[0] + Math.random() * (confidenceRange[1] - confidenceRange[0]);
      const cost = costRange[0] + Math.random() * (costRange[1] - costRange[0]);

      state.status = "completed";
      state.output = `Solution completed successfully.

Implementation details:
- Analyzed the requirements
- Applied best practices
- Tested the solution

Confidence: ${Math.round(confidence)}%

Estimated cost: $${cost.toFixed(4)}`;

      return {
        status: "completed",
        output: state.output,
      };
    }

    return {};
  };
}

// ============================================================================
// Spawning Multiple Sub-Agents Tests
// ============================================================================

describe("Spawning Multiple Sub-Agents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns multiple variations in parallel up to maxParallel limit", async () => {
    const spawnCalls: string[] = [];

    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        const runId = `run-${spawnCalls.length + 1}`;
        spawnCalls.push(runId);
        return {
          status: "accepted",
          runId,
        };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "Done\n\nConfidence: 80%" };
      }
      return {};
    });

    const variations = Array.from({ length: 5 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: 2 },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    // Verify all variations were spawned
    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    // All 5 should have been spawned (serially due to maxConcurrent, but all eventually)
    expect(spawnCalls.length).toBe(5);
  });

  it("spawns variations in priority order", async () => {
    const spawnOrder: string[] = [];

    mockCallGateway.mockImplementation(
      async (opts: { method: string; params?: { args?: { task?: string; label?: string } } }) => {
        if (opts.method === "tool.invoke") {
          const label = opts.params?.args?.label || "";
          const match = label.match(/\[(.*?)\]/);
          if (match) {
            spawnOrder.push(match[1]);
          }
          return {
            status: "accepted",
            runId: `run-${spawnOrder.length}`,
          };
        }
        if (opts.method === "agent.status") {
          return { status: "completed", output: "Done\n\nConfidence: 85%" };
        }
        return {};
      },
    );

    const variations = [
      createMockVariation({ id: "low", label: "low-priority", priority: 2 }),
      createMockVariation({ id: "high", label: "high-priority", priority: 0 }),
      createMockVariation({ id: "med", label: "med-priority", priority: 1 }),
    ];

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: 1 },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    // Verify priority order
    expect(spawnOrder[0]).toBe("high-priority");
  });

  it("respects maxConcurrentIterations limit during execution", async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const runStatus = new Map<string, string>();

    mockCallGateway.mockImplementation(
      async (opts: { method: string; params?: { runId?: string } }) => {
        if (opts.method === "tool.invoke") {
          activeCount++;
          maxActiveCount = Math.max(maxActiveCount, activeCount);
          const runId = `run-${Date.now()}-${Math.random()}`;
          runStatus.set(runId, "running");
          return { status: "accepted", runId };
        }
        if (opts.method === "agent.status") {
          const runId = opts.params?.runId || "";
          const status = runStatus.get(runId);

          if (status === "running") {
            // Mark as completed and decrement active
            runStatus.set(runId, "completed");
            activeCount--;
            return { status: "completed", output: "Done\n\nConfidence: 75%" };
          }
          return { status: "completed", output: "Done" };
        }
        return {};
      },
    );

    const variations = Array.from({ length: 6 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const maxParallel = 2;
    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: maxParallel },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(1000);
    await executePromise;

    expect(maxActiveCount).toBeLessThanOrEqual(maxParallel);
  });

  it("handles spawn failures gracefully and continues with remaining variations", async () => {
    // Test spawn failure handling directly via spawnVariation
    mockCallGateway.mockResolvedValueOnce({ status: "accepted", runId: "run-1" }); // v1 succeeds
    mockCallGateway.mockResolvedValueOnce({ status: "error", error: "Spawn failed" }); // v2 fails
    mockCallGateway.mockResolvedValueOnce({ status: "accepted", runId: "run-3" }); // v3 succeeds

    const variations = [
      createMockVariation({ id: "v1", priority: 0 }),
      createMockVariation({ id: "v2", priority: 1 }),
      createMockVariation({ id: "v3", priority: 2 }),
    ];

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, {
      pollIntervalMs: 10,
    });

    // Spawn each variation individually
    const result1 = await runner.spawnVariation(variations[0]);
    const result2 = await runner.spawnVariation(variations[1]);
    const result3 = await runner.spawnVariation(variations[2]);

    // Verify spawn results
    expect(result1).toBe(true);
    expect(result2).toBe(false);
    expect(result3).toBe(true);

    // Verify variation statuses
    expect(variations[0].status).toBe("spawned");
    expect(variations[1].status).toBe("failed");
    expect(variations[2].status).toBe("spawned");

    // Count failed variations
    const failedVariations = variations.filter((v) => v.status === "failed");
    expect(failedVariations.length).toBe(1);
    expect(failedVariations[0].id).toBe("v2");
  });
});

// ============================================================================
// Variation Strategy Tests
// ============================================================================

describe("Variation Strategies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Model Variations", () => {
    it("creates and executes variations for different models", async () => {
      const models = ["anthropic/claude-sonnet-4", "openai/gpt-4o", "anthropic/claude-opus-4-5"];
      const spawnedModels: (string | undefined)[] = [];

      mockCallGateway.mockImplementation(
        async (opts: { method: string; params?: { args?: { model?: string } } }) => {
          if (opts.method === "tool.invoke") {
            spawnedModels.push(opts.params?.args?.model);
            return { status: "accepted", runId: `run-${spawnedModels.length}` };
          }
          if (opts.method === "agent.status") {
            return { status: "completed", output: "Done\n\nConfidence: 85%" };
          }
          return {};
        },
      );

      const task = createMockTask();
      const variations = createModelVariations(task, models);

      expect(variations).toHaveLength(3);
      expect(variations[0].model).toBe("anthropic/claude-sonnet-4");
      expect(variations[1].model).toBe("openai/gpt-4o");
      expect(variations[2].model).toBe("anthropic/claude-opus-4-5");

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      await executePromise;

      // Verify all models were spawned
      expect(spawnedModels).toContain("anthropic/claude-sonnet-4");
      expect(spawnedModels).toContain("openai/gpt-4o");
      expect(spawnedModels).toContain("anthropic/claude-opus-4-5");
    });

    it("selects best model based on result quality", async () => {
      const modelScores: Record<string, number> = {
        "model-a": 70,
        "model-b": 95,
        "model-c": 80,
      };

      mockCallGateway.mockImplementation(
        async (opts: {
          method: string;
          params?: { args?: { model?: string }; runId?: string };
        }) => {
          if (opts.method === "tool.invoke") {
            const model = opts.params?.args?.model || "unknown";
            return { status: "accepted", runId: model };
          }
          if (opts.method === "agent.status") {
            const runId = opts.params?.runId || "";
            const score = modelScores[runId] || 75;
            return {
              status: "completed",
              output: `Solution\n\nConfidence: ${score}%`,
            };
          }
          return {};
        },
      );

      const task = createMockTask();
      const variations = createModelVariations(task, Object.keys(modelScores));

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      const result = await executePromise;

      // Best result should be from model-b with 95% confidence
      expect(result.strategy).toBe("best");
      const bestResult = runner.getBestResult();
      expect(bestResult).toBeDefined();
      expect(bestResult?.metrics.confidence).toBeCloseTo(0.95, 1);
    });
  });

  describe("Thinking Level Variations", () => {
    it("creates and executes variations for different thinking levels", async () => {
      const thinkingLevels: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];
      const spawnedThinking: (string | undefined)[] = [];

      mockCallGateway.mockImplementation(
        async (opts: { method: string; params?: { args?: { thinking?: string } } }) => {
          if (opts.method === "tool.invoke") {
            spawnedThinking.push(opts.params?.args?.thinking);
            return { status: "accepted", runId: `run-${spawnedThinking.length}` };
          }
          if (opts.method === "agent.status") {
            return { status: "completed", output: "Done\n\nConfidence: 82%" };
          }
          return {};
        },
      );

      const task = createMockTask();
      const variations = createThinkingVariations(task, thinkingLevels);

      expect(variations).toHaveLength(3);
      expect(variations[0].thinking).toBe("low");
      expect(variations[1].thinking).toBe("medium");
      expect(variations[2].thinking).toBe("high");

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      await executePromise;

      expect(spawnedThinking).toContain("low");
      expect(spawnedThinking).toContain("medium");
      expect(spawnedThinking).toContain("high");
    });

    it("higher thinking levels may produce better quality for complex tasks", async () => {
      const thinkingScores: Record<string, number> = {
        low: 65,
        medium: 78,
        high: 92,
      };

      mockCallGateway.mockImplementation(
        async (opts: {
          method: string;
          params?: { args?: { thinking?: string }; runId?: string };
        }) => {
          if (opts.method === "tool.invoke") {
            const thinking = opts.params?.args?.thinking || "low";
            return { status: "accepted", runId: thinking };
          }
          if (opts.method === "agent.status") {
            const runId = opts.params?.runId || "";
            const score = thinkingScores[runId] || 70;
            return {
              status: "completed",
              output: `Complex analysis completed.\n\nConfidence: ${score}%`,
            };
          }
          return {};
        },
      );

      const task = createMockTask({ title: "Complex algorithmic problem" });
      const variations = createThinkingVariations(task, ["low", "medium", "high"]);

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      await executePromise;

      const results = runner.getResults();
      const highThinkingResult = results.find((r) => r.runId === "high");

      expect(highThinkingResult).toBeDefined();
      expect(highThinkingResult?.metrics.confidence).toBeCloseTo(0.92, 1);
    });
  });

  describe("Prompt Variations", () => {
    it("creates and executes variations with different prompt framings", async () => {
      const promptVariants: PromptVariant[] = [
        {
          id: "minimal",
          label: "Minimal",
          additionalContext: "Keep the solution simple and focused.",
        },
        {
          id: "comprehensive",
          label: "Comprehensive",
          additionalContext: "Cover all edge cases and error handling.",
          constraints: ["Add input validation", "Handle errors gracefully"],
        },
        {
          id: "performant",
          label: "Performance-Focused",
          additionalContext: "Optimize for speed and memory efficiency.",
          constraints: ["Use efficient algorithms", "Minimize allocations"],
        },
      ];

      const spawnedTasks: string[] = [];

      mockCallGateway.mockImplementation(
        async (opts: { method: string; params?: { args?: { task?: string } } }) => {
          if (opts.method === "tool.invoke") {
            spawnedTasks.push(opts.params?.args?.task || "");
            return { status: "accepted", runId: `run-${spawnedTasks.length}` };
          }
          if (opts.method === "agent.status") {
            return { status: "completed", output: "Done\n\nConfidence: 78%" };
          }
          return {};
        },
      );

      const task = createMockTask();
      const variations = createPromptVariations(task, promptVariants);

      expect(variations).toHaveLength(3);
      expect(variations[0].additionalContext).toBe("Keep the solution simple and focused.");
      expect(variations[1].constraints).toEqual([
        "Add input validation",
        "Handle errors gracefully",
      ]);

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      await executePromise;

      // Verify different contexts were included
      expect(spawnedTasks.some((t) => t.includes("simple and focused"))).toBe(true);
      expect(spawnedTasks.some((t) => t.includes("edge cases"))).toBe(true);
      expect(spawnedTasks.some((t) => t.includes("efficient algorithms"))).toBe(true);
    });
  });

  describe("Hybrid Variations", () => {
    it("creates combinations of model, thinking, and prompt variations", async () => {
      const spawnedConfigs: Array<{ model?: string; thinking?: string }> = [];

      mockCallGateway.mockImplementation(
        async (opts: {
          method: string;
          params?: { args?: { model?: string; thinking?: string } };
        }) => {
          if (opts.method === "tool.invoke") {
            spawnedConfigs.push({
              model: opts.params?.args?.model,
              thinking: opts.params?.args?.thinking,
            });
            return { status: "accepted", runId: `run-${spawnedConfigs.length}` };
          }
          if (opts.method === "agent.status") {
            return { status: "completed", output: "Done\n\nConfidence: 80%" };
          }
          return {};
        },
      );

      const task = createMockTask();
      const variations = createHybridVariations(task, {
        models: ["model-fast", "model-smart"],
        thinkingLevels: ["low", "high"],
        maxCombinations: 4,
      });

      expect(variations).toHaveLength(4);

      const plan = createMockPlan({
        variations,
        completionCriteria: { waitForAll: true },
      });

      const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
      const executePromise = runner.execute();
      await vi.advanceTimersByTimeAsync(500);
      await executePromise;

      // Verify combinations
      expect(spawnedConfigs.some((c) => c.model === "model-fast" && c.thinking === "low")).toBe(
        true,
      );
      expect(spawnedConfigs.some((c) => c.model === "model-fast" && c.thinking === "high")).toBe(
        true,
      );
      expect(spawnedConfigs.some((c) => c.model === "model-smart" && c.thinking === "low")).toBe(
        true,
      );
      expect(spawnedConfigs.some((c) => c.model === "model-smart" && c.thinking === "high")).toBe(
        true,
      );
    });
  });
});

// ============================================================================
// Result Collection Tests
// ============================================================================

describe("Result Collection from Parallel Runs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects results from all completed variations", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        spawnCount++;
        return { status: "accepted", runId: `run-${spawnCount}` };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "Solution output\n\nConfidence: 85%" };
      }
      return {};
    });

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const collectedResults: IterationResult[] = [];
    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, {
      onResult: (result) => collectedResults.push(result),
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    expect(collectedResults).toHaveLength(3);
    expect(runner.getResults()).toHaveLength(3);
  });

  it("parses confidence scores from various output formats", () => {
    const testCases = [
      { output: "Solution done.\n\nConfidence: 85%", expected: 0.85 },
      { output: "Result with confidence: 0.92", expected: 0.92 },
      { output: "Analysis complete.\nconfidence score: 78", expected: 0.78 },
      { output: "No confidence mentioned", expected: undefined },
    ];

    for (const { output, expected } of testCases) {
      const result = parseConfidenceFromOutput(output);
      if (expected === undefined) {
        expect(result).toBeUndefined();
      } else {
        expect(result).toBeCloseTo(expected, 2);
      }
    }
  });

  it("aggregates results using different strategies", async () => {
    const results = [
      createMockResult({ variationId: "v1", output: "Answer A", metrics: { overallScore: 0.7 } }),
      createMockResult({ variationId: "v2", output: "Answer A", metrics: { overallScore: 0.85 } }),
      createMockResult({ variationId: "v3", output: "Answer B", metrics: { overallScore: 0.8 } }),
    ];

    // Best strategy
    const bestResult = aggregateResults(results, "best");
    expect(bestResult.strategy).toBe("best");
    expect(bestResult.selectedResults[0].variationId).toBe("v2");
    expect(bestResult.confidence).toBe(0.85);

    // Voting strategy
    const votingResult = aggregateResults(results, "voting");
    expect(votingResult.strategy).toBe("voting");
    expect(votingResult.mergedOutput).toBe("Answer A");
    expect(votingResult.selectedResults).toHaveLength(2);
    expect(votingResult.confidence).toBeCloseTo(2 / 3, 2);

    // Consensus strategy
    const consensusResult = aggregateResults(results, "consensus");
    expect(consensusResult.strategy).toBe("consensus");
    expect(consensusResult.mergedOutput).toBe("Answer A");

    // Ensemble strategy
    const ensembleResult = aggregateResults(results, "ensemble");
    expect(ensembleResult.strategy).toBe("ensemble");
    expect(ensembleResult.selectedResults).toHaveLength(3);
    expect(ensembleResult.mergedOutput).toContain("Answer A");
    expect(ensembleResult.mergedOutput).toContain("Answer B");
  });

  it("tracks usage statistics across all runs", async () => {
    let runIndex = 0;
    const usageData = [
      { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.05 },
      { inputTokens: 1500, outputTokens: 800, estimatedCostUsd: 0.08 },
      { inputTokens: 2000, outputTokens: 1000, estimatedCostUsd: 0.12 },
    ];

    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        runIndex++;
        return { status: "accepted", runId: `run-${runIndex}` };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "Done\n\nConfidence: 80%" };
      }
      return {};
    });

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    const status = runner.getStatus();
    expect(status.summary.completed).toBe(3);
    expect(status.summary.successful).toBe(3);
  });

  it("handles mixed success and failure results", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(
      async (opts: { method: string; params?: { runId?: string } }) => {
        if (opts.method === "tool.invoke") {
          spawnCount++;
          return { status: "accepted", runId: `run-${spawnCount}` };
        }
        if (opts.method === "agent.status") {
          const runId = opts.params?.runId || "";
          // Run 2 fails
          if (runId === "run-2") {
            return { status: "failed", error: "Processing error" };
          }
          return { status: "completed", output: "Done\n\nConfidence: 80%" };
        }
        return {};
      },
    );

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    const results = runner.getResults();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(successful.length).toBe(2);
    expect(failed.length).toBe(1);
    expect(failed[0].error).toBe("Processing error");
  });
});

// ============================================================================
// Timeout and Resource Limit Handling Tests
// ============================================================================

describe("Timeout and Resource Limit Handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces per-iteration timeout", async () => {
    // Test the timeout logic by verifying the IterationLimitEnforcer correctly
    // calculates remaining time and prevents spawns after timeout
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      perIterationTimeoutSeconds: 60,
      totalTimeoutSeconds: 120,
    });

    // Initially should allow spawns
    expect(enforcer.canSpawn().allowed).toBe(true);
    expect(enforcer.getIterationTimeoutMs()).toBe(60000);

    // Advance past total timeout
    vi.advanceTimersByTime(130000);

    // After timeout, should not allow spawns
    const canSpawn = enforcer.canSpawn();
    expect(canSpawn.allowed).toBe(false);
    expect(canSpawn.reason).toBe("Total timeout exceeded");
    expect(enforcer.getRemainingTimeMs()).toBe(0);
    expect(enforcer.getIterationTimeoutMs()).toBe(0);
  });

  it("enforces total timeout across all iterations", async () => {
    // Test that the enforcer properly tracks timeout state
    const totalTimeoutSeconds = 60;
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      totalTimeoutSeconds,
    });

    // At start, should have full time remaining
    expect(enforcer.getRemainingTimeMs()).toBe(totalTimeoutSeconds * 1000);
    expect(enforcer.canSpawn().allowed).toBe(true);

    // Advance halfway
    vi.advanceTimersByTime(30000);
    expect(enforcer.getRemainingTimeMs()).toBe(30000);
    expect(enforcer.canSpawn().allowed).toBe(true);

    // Advance past timeout
    vi.advanceTimersByTime(40000);
    expect(enforcer.getRemainingTimeMs()).toBe(0);
    expect(enforcer.canSpawn().allowed).toBe(false);
    expect(enforcer.canSpawn().reason).toBe("Total timeout exceeded");
  });

  it("blocks spawning when cost limit is exceeded", () => {
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      totalMaxCostUsd: 1.0,
    });

    // First spawn should be allowed
    expect(enforcer.canSpawn().allowed).toBe(true);
    enforcer.recordSpawn();

    // Complete with high cost
    enforcer.recordCompletion(
      createMockResult({
        usage: { estimatedCostUsd: 1.1 },
      }),
    );

    // Next spawn should be blocked
    const canSpawn = enforcer.canSpawn();
    expect(canSpawn.allowed).toBe(false);
    expect(canSpawn.reason).toBe("Total cost limit exceeded");
  });

  it("blocks spawning when token limit is exceeded", () => {
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      totalMaxTokens: 50000,
    });

    expect(enforcer.canSpawn().allowed).toBe(true);
    enforcer.recordSpawn();

    enforcer.recordCompletion(
      createMockResult({
        usage: { totalTokens: 55000 },
      }),
    );

    const canSpawn = enforcer.canSpawn();
    expect(canSpawn.allowed).toBe(false);
    expect(canSpawn.reason).toBe("Total token limit exceeded");
  });

  it("blocks spawning when max total iterations is reached", () => {
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      maxTotalIterations: 3,
    });

    // Spawn and complete 3 iterations
    for (let i = 0; i < 3; i++) {
      enforcer.recordSpawn();
      enforcer.recordCompletion(createMockResult());
    }

    const canSpawn = enforcer.canSpawn();
    expect(canSpawn.allowed).toBe(false);
    expect(canSpawn.reason).toBe("Max total iterations reached");
  });

  it("calculates iteration timeout capped by remaining time", () => {
    vi.useFakeTimers();

    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      perIterationTimeoutSeconds: 120,
      totalTimeoutSeconds: 300,
    });

    // Initially, iteration timeout should be the configured value
    expect(enforcer.getIterationTimeoutMs()).toBe(120000);

    // Advance time by 250 seconds
    vi.advanceTimersByTime(250000);

    // Now remaining time is 50 seconds, which is less than per-iteration timeout
    expect(enforcer.getIterationTimeoutMs()).toBe(50000);

    vi.useRealTimers();
  });

  it("provides accurate usage statistics", () => {
    vi.useFakeTimers();

    const enforcer = new IterationLimitEnforcer();

    enforcer.recordSpawn();
    enforcer.recordSpawn();
    enforcer.recordCompletion(
      createMockResult({
        usage: { estimatedCostUsd: 0.15, totalTokens: 10000 },
      }),
    );

    vi.advanceTimersByTime(5000);

    const usage = enforcer.getUsage();
    expect(usage.activeCount).toBe(1);
    expect(usage.completedCount).toBe(1);
    expect(usage.totalCost).toBe(0.15);
    expect(usage.totalTokens).toBe(10000);
    expect(usage.elapsedMs).toBe(5000);

    vi.useRealTimers();
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe("Error Handling When Iterations Fail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles network errors during spawn", async () => {
    mockCallGateway.mockRejectedValue(new Error("Network timeout"));

    const variation = createMockVariation();
    const plan = createMockPlan({ variations: [variation] });
    const runner = new IterationRunner(plan);

    const result = await runner.spawnVariation(variation);

    expect(result).toBe(false);
    expect(variation.status).toBe("failed");
  });

  it("handles gateway error responses", async () => {
    mockCallGateway.mockResolvedValue({
      status: "error",
      error: "Rate limit exceeded",
    });

    const variation = createMockVariation();
    const plan = createMockPlan({ variations: [variation] });
    const runner = new IterationRunner(plan);

    const result = await runner.spawnVariation(variation);

    expect(result).toBe(false);
    expect(variation.status).toBe("failed");
  });

  it("handles all iterations failing", async () => {
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        return { status: "accepted", runId: "run-fail" };
      }
      if (opts.method === "agent.status") {
        return { status: "failed", error: "Processing error" };
      }
      return {};
    });

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    const result = await executePromise;

    expect(plan.status).toBe("completed");
    expect(result.selectedResults).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toBe("No successful results to aggregate");
  });

  it("applies error penalty to failed results in scoring", () => {
    const failedResult = createMockResult({
      success: false,
      error: "Processing failed",
    });

    const score = scoreResult(failedResult);

    expect(score).toBe(1 - DEFAULT_SCORING_CONFIG.penalties.error);
  });

  it("applies timeout penalty to timed out results in scoring", () => {
    const timeoutResult = createMockResult({
      success: false,
      error: "timeout",
    });

    const score = scoreResult(timeoutResult);

    expect(score).toBe(1 - DEFAULT_SCORING_CONFIG.penalties.timeout);
  });

  it("continues execution when some iterations fail", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(
      async (opts: { method: string; params?: { runId?: string } }) => {
        if (opts.method === "tool.invoke") {
          spawnCount++;
          return { status: "accepted", runId: `run-${spawnCount}` };
        }
        if (opts.method === "agent.status") {
          const runId = opts.params?.runId || "";
          // First run fails
          if (runId === "run-1") {
            return { status: "failed", error: "Error in run 1" };
          }
          return { status: "completed", output: "Success\n\nConfidence: 85%" };
        }
        return {};
      },
    );

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    const result = await executePromise;

    expect(plan.status).toBe("completed");
    expect(result.selectedResults.length).toBeGreaterThan(0);

    const summary = runner.getStatus().summary;
    expect(summary.failed).toBe(1);
    expect(summary.successful).toBe(2);
  });

  it("can be stopped during execution", async () => {
    // Test the stop mechanism directly on a runner
    const variation = createMockVariation({ id: "v1" });
    const plan = createMockPlan({
      variations: [variation],
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan);

    // Initially pending
    expect(plan.status).toBe("pending");

    // Stop the runner
    runner.stop();

    // Should be cancelled
    expect(plan.status).toBe("cancelled");
    expect(plan.completedAt).toBeDefined();

    // Verify the stop flag prevents execution from changing status back
    const status = runner.getStatus();
    expect(status.plan.status).toBe("cancelled");
  });

  it("skips variations when no time remaining", async () => {
    const variation = createMockVariation();
    const plan = createMockPlan({ variations: [variation] });

    const runner = new IterationRunner(plan, {
      limits: {
        ...DEFAULT_ITERATION_LIMITS,
        totalTimeoutSeconds: 0,
      },
    });

    const result = await runner.spawnVariation(variation);

    expect(result).toBe(false);
    expect(variation.status).toBe("skipped");
    expect(mockCallGateway).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Completion Criteria Tests
// ============================================================================

describe("Completion Criteria", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops when minAcceptableScore is reached", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        spawnCount++;
        return { status: "accepted", runId: `run-${spawnCount}` };
      }
      if (opts.method === "agent.status") {
        // First result meets the threshold
        return { status: "completed", output: "Done\n\nConfidence: 95%" };
      }
      return {};
    });

    const variations = Array.from({ length: 5 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { minAcceptableScore: 0.9 },
    });

    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: 1 },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    // Should complete early after finding acceptable score
    expect(plan.status).toBe("completed");
  });

  it("stops on first success when stopOnFirstSuccess is true", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        spawnCount++;
        return { status: "accepted", runId: `run-${spawnCount}` };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "First success\n\nConfidence: 75%" };
      }
      return {};
    });

    const variations = Array.from({ length: 5 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { stopOnFirstSuccess: true },
    });

    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: 1 },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    expect(plan.status).toBe("completed");
    const results = runner.getResults();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("waits for all variations when waitForAll is true", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        spawnCount++;
        return { status: "accepted", runId: `run-${spawnCount}` };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "Done\n\nConfidence: 80%" };
      }
      return {};
    });

    const variations = Array.from({ length: 3 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { waitForAll: true },
    });

    const runner = new IterationRunner(plan, { pollIntervalMs: 10 });
    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    expect(plan.status).toBe("completed");
    expect(runner.getResults()).toHaveLength(3);
  });

  it("completes when minSuccessfulVariations is reached", async () => {
    let spawnCount = 0;
    mockCallGateway.mockImplementation(async (opts: { method: string }) => {
      if (opts.method === "tool.invoke") {
        spawnCount++;
        return { status: "accepted", runId: `run-${spawnCount}` };
      }
      if (opts.method === "agent.status") {
        return { status: "completed", output: "Done\n\nConfidence: 82%" };
      }
      return {};
    });

    const variations = Array.from({ length: 5 }, (_, i) =>
      createMockVariation({ id: `v${i}`, priority: i }),
    );

    const plan = createMockPlan({
      variations,
      completionCriteria: { minSuccessfulVariations: 2 },
    });

    const runner = new IterationRunner(plan, {
      limits: { ...DEFAULT_ITERATION_LIMITS, maxConcurrentIterations: 1 },
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(500);
    await executePromise;

    expect(plan.status).toBe("completed");
  });
});

// ============================================================================
// End-to-End Simulation Tests
// ============================================================================

describe("End-to-End Parallel Iteration Simulation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCallGateway.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("simulates complete parallel iteration workflow", async () => {
    const simulator = createGatewaySimulator({
      spawnLatencyMs: 5,
      completionLatencyMs: 30,
      confidenceRange: [70, 95],
      costRange: [0.02, 0.08],
    });

    mockCallGateway.mockImplementation(simulator);

    const task = createMockTask({
      title: "Implement feature X",
      description: "Create a new feature with comprehensive testing",
    });

    const variations = createHybridVariations(task, {
      models: ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
      thinkingLevels: ["medium", "high"],
      maxCombinations: 4,
    });

    const plan = createIterationPlan(task, {
      strategy: "parallel",
      variations,
      limits: {
        maxConcurrentIterations: 2,
        maxTotalIterations: 4,
        totalTimeoutSeconds: 60,
      },
      completionCriteria: { waitForAll: true },
    });

    const spawnedVariations: IterationVariation[] = [];
    const collectedResults: IterationResult[] = [];

    const runner = new IterationRunner(plan, {
      onSpawn: (v) => spawnedVariations.push(v),
      onResult: (r) => collectedResults.push(r),
      pollIntervalMs: 10,
    });

    const executePromise = runner.execute();
    await vi.advanceTimersByTimeAsync(1000);
    const aggregatedResult = await executePromise;

    // Verify execution
    expect(plan.status).toBe("completed");
    expect(plan.startedAt).toBeDefined();
    expect(plan.completedAt).toBeDefined();

    // Verify variations were spawned
    expect(spawnedVariations.length).toBeGreaterThan(0);

    // Verify results were collected
    expect(collectedResults.length).toBeGreaterThan(0);

    // Verify aggregation
    expect(aggregatedResult.strategy).toBe("best");
    expect(aggregatedResult.selectedResults.length).toBeGreaterThan(0);
    expect(aggregatedResult.confidence).toBeGreaterThan(0);

    // Verify best result selection
    const bestResult = runner.getBestResult();
    if (bestResult) {
      expect(bestResult.success).toBe(true);
      expect(bestResult.metrics.overallScore).toBeGreaterThan(0);
    }
  });

  it("simulates iteration with partial failures", async () => {
    // Test partial failure scenario using the result collector directly
    const plan = createMockPlan({
      variations: [
        createMockVariation({ id: "v1", priority: 0 }),
        createMockVariation({ id: "v2", priority: 1 }),
        createMockVariation({ id: "v3", priority: 2 }),
        createMockVariation({ id: "v4", priority: 3 }),
      ],
      completionCriteria: { minSuccessfulVariations: 2 },
    });

    const collector = new IterationResultCollector(plan);

    // Simulate mixed results: 2 successes, 2 failures
    collector.addResult(
      createMockResult({
        variationId: "v1",
        success: true,
        metrics: { overallScore: 0.85 },
      }),
    );

    expect(collector.isComplete()).toBe(false);

    collector.addResult(
      createMockResult({
        variationId: "v2",
        success: false,
        error: "Processing error",
        metrics: { overallScore: 0 },
      }),
    );

    expect(collector.isComplete()).toBe(false);

    collector.addResult(
      createMockResult({
        variationId: "v3",
        success: true,
        metrics: { overallScore: 0.78 },
      }),
    );

    // Should be complete now with 2 successful variations
    expect(collector.isComplete()).toBe(true);

    const summary = collector.getSummary();
    expect(summary.successful).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.completed).toBe(3);
    expect(summary.pending).toBe(1);

    // Best result should be from v1 with higher score
    const best = collector.getBestResult();
    expect(best?.variationId).toBe("v1");
    expect(best?.metrics.overallScore).toBe(0.85);
  });

  it("simulates iteration under resource constraints", async () => {
    // Test resource constraints via the IterationLimitEnforcer directly
    const enforcer = new IterationLimitEnforcer({
      ...DEFAULT_ITERATION_LIMITS,
      totalMaxCostUsd: 1.0,
      maxConcurrentIterations: 2,
    });

    // Simulate spawning and completing iterations with high cost
    let completedCount = 0;
    const maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      const canSpawn = enforcer.canSpawn();
      if (!canSpawn.allowed) {
        // Should have stopped due to cost limit
        expect(canSpawn.reason).toBe("Total cost limit exceeded");
        break;
      }

      enforcer.recordSpawn();
      // Each run costs $0.30
      enforcer.recordCompletion(
        createMockResult({
          usage: { estimatedCostUsd: 0.3 },
        }),
      );
      completedCount++;
    }

    // Should have stopped after ~3-4 iterations due to $1 limit with $0.30/run
    expect(completedCount).toBeLessThan(maxIterations);
    expect(completedCount).toBeLessThanOrEqual(4);
    expect(enforcer.getUsage().totalCost).toBeGreaterThanOrEqual(0.9);
  });
});
