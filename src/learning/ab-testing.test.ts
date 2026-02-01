import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadExperimentState,
  saveExperimentState,
  createEmptyState,
  initializeExperiments,
  setExperimentActive,
  getActiveExperiments,
  assignVariant,
  getAssignedVariants,
  recordAssignment,
  recordVariantFeedback,
  calculateExperimentResults,
  getWinningVariant,
  buildStrategyInstruction,
  createExperiment,
  deleteExperiment,
  getExperimentsSummary,
  graduateWinningVariant,
  resetExperimentMetrics,
  resolveExperimentsPath,
  defaultExperiments,
  type StrategyExperiment,
  type ExperimentState,
} from "./ab-testing.js";

// Mock the paths module to use temp directory
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => testStateDir,
}));

let testStateDir: string;

beforeEach(async () => {
  testStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ab-test-"));
});

afterEach(async () => {
  try {
    await fs.rm(testStateDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("experiment state storage", () => {
  const testAgentId = "test-agent";

  it("returns empty state when no file exists", async () => {
    const state = await loadExperimentState(testAgentId);
    expect(state.experiments).toEqual([]);
    expect(state.assignments).toEqual([]);
    expect(state.metrics).toEqual({});
  });

  it("creates empty state correctly", () => {
    const state = createEmptyState();
    expect(state.experiments).toEqual([]);
    expect(state.assignments).toEqual([]);
    expect(state.metrics).toEqual({});
    expect(state.updatedAt).toBeDefined();
  });

  it("saves and loads state correctly", async () => {
    const state: ExperimentState = {
      experiments: [
        {
          id: "test-exp",
          dimension: "response-length",
          name: "Test Experiment",
          variants: [
            {
              id: "short",
              name: "Short",
              description: "Short responses",
              instruction: "Keep it short",
            },
          ],
          active: true,
          createdAt: new Date().toISOString(),
          trafficAllocation: 1.0,
        },
      ],
      assignments: [],
      metrics: {},
      updatedAt: new Date().toISOString(),
    };

    await saveExperimentState(testAgentId, state);
    const loaded = await loadExperimentState(testAgentId);

    expect(loaded.experiments).toHaveLength(1);
    expect(loaded.experiments[0].id).toBe("test-exp");
    expect(loaded.experiments[0].active).toBe(true);
  });

  it("handles corrupted file gracefully", async () => {
    const filePath = resolveExperimentsPath(testAgentId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "not valid json{{{", "utf8");

    const state = await loadExperimentState(testAgentId);
    expect(state.experiments).toEqual([]);
  });
});

describe("experiment initialization", () => {
  const testAgentId = "init-agent";

  it("initializes with default experiments", async () => {
    const state = await initializeExperiments(testAgentId);

    expect(state.experiments.length).toBe(defaultExperiments.length);
    expect(state.experiments.some((e) => e.id === "response-length-v1")).toBe(true);
    expect(state.experiments.some((e) => e.id === "explanation-style-v1")).toBe(true);
    expect(state.experiments.some((e) => e.id === "proactivity-v1")).toBe(true);
  });

  it("does not duplicate experiments on re-initialization", async () => {
    await initializeExperiments(testAgentId);
    const state = await initializeExperiments(testAgentId);

    // Should still have same count, not doubled
    expect(state.experiments.length).toBe(defaultExperiments.length);
  });

  it("preserves existing experiments when initializing", async () => {
    // Create a custom experiment first
    await createExperiment(testAgentId, {
      id: "custom-exp",
      dimension: "response-length",
      name: "Custom Test",
      variants: [{ id: "v1", name: "V1", description: "Variant 1", instruction: "Do V1" }],
      active: true,
      trafficAllocation: 0.5,
    });

    const state = await initializeExperiments(testAgentId);

    // Should have custom + defaults
    expect(state.experiments.some((e) => e.id === "custom-exp")).toBe(true);
    expect(state.experiments.length).toBe(defaultExperiments.length + 1);
  });
});

describe("experiment activation", () => {
  const testAgentId = "active-agent";

  it("activates an experiment", async () => {
    await initializeExperiments(testAgentId);

    const result = await setExperimentActive(testAgentId, "response-length-v1", true);
    expect(result).toBe(true);

    const active = await getActiveExperiments(testAgentId);
    expect(active.some((e) => e.id === "response-length-v1")).toBe(true);
  });

  it("deactivates an experiment", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await setExperimentActive(testAgentId, "response-length-v1", false);

    const active = await getActiveExperiments(testAgentId);
    expect(active.some((e) => e.id === "response-length-v1")).toBe(false);
  });

  it("returns false for non-existent experiment", async () => {
    const result = await setExperimentActive(testAgentId, "non-existent", true);
    expect(result).toBe(false);
  });

  it("returns only active experiments", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await setExperimentActive(testAgentId, "explanation-style-v1", true);
    await setExperimentActive(testAgentId, "proactivity-v1", false);

    const active = await getActiveExperiments(testAgentId);
    expect(active).toHaveLength(2);
    expect(active.every((e) => e.active)).toBe(true);
  });
});

describe("variant assignment", () => {
  it("assigns variant deterministically based on session key", () => {
    const experiment: StrategyExperiment = {
      id: "test-exp",
      dimension: "response-length",
      name: "Test",
      variants: [
        { id: "a", name: "A", description: "A", instruction: "A" },
        { id: "b", name: "B", description: "B", instruction: "B" },
        { id: "c", name: "C", description: "C", instruction: "C" },
      ],
      active: true,
      createdAt: new Date().toISOString(),
      trafficAllocation: 1.0,
    };

    const sessionKey = "user-123:session-456";

    // Same inputs should give same outputs
    const variant1 = assignVariant(experiment, sessionKey);
    const variant2 = assignVariant(experiment, sessionKey);

    expect(variant1).toBeDefined();
    expect(variant2).toBeDefined();
    expect(variant1!.id).toBe(variant2!.id);
  });

  it("distributes variants across different sessions", () => {
    const experiment: StrategyExperiment = {
      id: "test-exp",
      dimension: "response-length",
      name: "Test",
      variants: [
        { id: "a", name: "A", description: "A", instruction: "A" },
        { id: "b", name: "B", description: "B", instruction: "B" },
      ],
      active: true,
      createdAt: new Date().toISOString(),
      trafficAllocation: 1.0,
    };

    const assignments = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const variant = assignVariant(experiment, `session-${i}`);
      if (variant) {
        assignments.add(variant.id);
      }
    }

    // With enough sessions, we should see both variants
    expect(assignments.size).toBe(2);
  });

  it("returns null for inactive experiment", () => {
    const experiment: StrategyExperiment = {
      id: "test-exp",
      dimension: "response-length",
      name: "Test",
      variants: [{ id: "a", name: "A", description: "A", instruction: "A" }],
      active: false,
      createdAt: new Date().toISOString(),
      trafficAllocation: 1.0,
    };

    const variant = assignVariant(experiment, "session-1");
    expect(variant).toBeNull();
  });

  it("respects traffic allocation", () => {
    const experiment: StrategyExperiment = {
      id: "test-exp",
      dimension: "response-length",
      name: "Test",
      variants: [{ id: "a", name: "A", description: "A", instruction: "A" }],
      active: true,
      createdAt: new Date().toISOString(),
      trafficAllocation: 0.5, // Only 50% of traffic
    };

    let assigned = 0;
    let notAssigned = 0;

    for (let i = 0; i < 1000; i++) {
      const variant = assignVariant(experiment, `session-${i}`);
      if (variant) {
        assigned++;
      } else {
        notAssigned++;
      }
    }

    // With 50% allocation, we expect roughly even split (with some variance)
    expect(assigned).toBeGreaterThan(400);
    expect(assigned).toBeLessThan(600);
    expect(notAssigned).toBeGreaterThan(400);
    expect(notAssigned).toBeLessThan(600);
  });
});

describe("variant assignment tracking", () => {
  const testAgentId = "tracking-agent";

  it("records variant assignments", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    const state = await loadExperimentState(testAgentId);
    expect(state.assignments).toHaveLength(1);
    expect(state.assignments[0].experimentId).toBe("response-length-v1");
    expect(state.assignments[0].variantId).toBe("concise");
    expect(state.assignments[0].sessionKey).toBe("session-1");
  });

  it("does not duplicate assignments for same session", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    const state = await loadExperimentState(testAgentId);
    expect(state.assignments).toHaveLength(1);
  });

  it("increments exposure count on assignment", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-2");
    await recordAssignment(testAgentId, "response-length-v1", "detailed", "session-3");

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];

    const conciseMetric = metrics.find((m) => m.variantId === "concise");
    const detailedMetric = metrics.find((m) => m.variantId === "detailed");

    expect(conciseMetric?.exposures).toBe(2);
    expect(detailedMetric?.exposures).toBe(1);
  });
});

describe("feedback recording", () => {
  const testAgentId = "feedback-agent";

  it("records positive feedback", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];
    const conciseMetric = metrics.find((m) => m.variantId === "concise");

    expect(conciseMetric?.positiveCount).toBe(1);
    expect(conciseMetric?.negativeCount).toBe(0);
  });

  it("records negative feedback", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", false);

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];
    const conciseMetric = metrics.find((m) => m.variantId === "concise");

    expect(conciseMetric?.positiveCount).toBe(0);
    expect(conciseMetric?.negativeCount).toBe(1);
  });

  it("calculates success rate correctly", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    // 3 positive, 1 negative = 75% success
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", false);

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];
    const conciseMetric = metrics.find((m) => m.variantId === "concise");

    expect(conciseMetric?.successRate).toBe(0.75);
  });

  it("updates confidence based on sample size", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    // Add 15 positive feedbacks (half of MIN_SAMPLES_FOR_SIGNIFICANCE = 30)
    for (let i = 0; i < 15; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];
    const conciseMetric = metrics.find((m) => m.variantId === "concise");

    expect(conciseMetric?.confidence).toBe(0.5);
  });
});

describe("experiment results calculation", () => {
  const testAgentId = "results-agent";

  it("returns null for experiment without metrics", async () => {
    await initializeExperiments(testAgentId);

    const results = await calculateExperimentResults(testAgentId, "response-length-v1");
    expect(results).toBeNull();
  });

  it("calculates results with metrics", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    // Add some feedback
    for (let i = 0; i < 10; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }

    const results = await calculateExperimentResults(testAgentId, "response-length-v1");

    expect(results).not.toBeNull();
    expect(results?.experimentId).toBe("response-length-v1");
    expect(results?.totalSamples).toBe(10);
    expect(results?.variantMetrics.length).toBeGreaterThan(0);
  });

  it("identifies winning variant with sufficient data", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    // Initialize metrics for all variants
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordAssignment(testAgentId, "response-length-v1", "detailed", "session-2");
    await recordAssignment(testAgentId, "response-length-v1", "adaptive", "session-3");

    // Concise: 40 positive, 0 negative (100% success)
    for (let i = 0; i < 40; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }

    // Detailed: 20 positive, 20 negative (50% success)
    for (let i = 0; i < 20; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "detailed", true);
      await recordVariantFeedback(testAgentId, "response-length-v1", "detailed", false);
    }

    // Adaptive: 5 positive, 35 negative (12.5% success)
    for (let i = 0; i < 5; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "adaptive", true);
    }
    for (let i = 0; i < 35; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "adaptive", false);
    }

    const results = await calculateExperimentResults(testAgentId, "response-length-v1");

    expect(results?.winningVariant).toBe("concise");
    expect(results?.significance).toBeGreaterThan(0.9);
  });

  it("does not declare winner with insufficient data", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");

    // Only 5 feedback entries (below threshold)
    for (let i = 0; i < 5; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }

    const results = await calculateExperimentResults(testAgentId, "response-length-v1");

    expect(results?.winningVariant).toBeNull();
  });
});

describe("getting winning variant", () => {
  const testAgentId = "winner-agent";

  it("returns null when no winner determined", async () => {
    await initializeExperiments(testAgentId);

    const winner = await getWinningVariant(testAgentId, "response-length-v1");
    expect(winner).toBeNull();
  });

  it("returns winning variant with sufficient data", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    // Set up a clear winner
    await recordAssignment(testAgentId, "response-length-v1", "concise", "s1");
    await recordAssignment(testAgentId, "response-length-v1", "detailed", "s2");

    // Concise wins clearly
    for (let i = 0; i < 50; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }

    for (let i = 0; i < 50; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "detailed", false);
    }

    const winner = await getWinningVariant(testAgentId, "response-length-v1");

    expect(winner).not.toBeNull();
    expect(winner?.id).toBe("concise");
  });
});

describe("strategy instruction building", () => {
  const testAgentId = "instruction-agent";

  it("returns empty string when no active experiments", async () => {
    await initializeExperiments(testAgentId);

    const instruction = await buildStrategyInstruction(testAgentId, "session-1");
    expect(instruction).toBe("");
  });

  it("builds instruction from active experiments", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    const instruction = await buildStrategyInstruction(testAgentId, "session-1");

    expect(instruction).toContain("Response strategy guidelines:");
    // Should contain one of the variant instructions
    expect(
      instruction.includes("brief") ||
        instruction.includes("thorough") ||
        instruction.includes("Match response length"),
    ).toBe(true);
  });

  it("combines instructions from multiple active experiments", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await setExperimentActive(testAgentId, "proactivity-v1", true);

    const instruction = await buildStrategyInstruction(testAgentId, "session-1");

    // Should have multiple bullet points
    const bulletCount = (instruction.match(/- /g) || []).length;
    expect(bulletCount).toBe(2);
  });
});

describe("custom experiment creation", () => {
  const testAgentId = "custom-agent";

  it("creates a custom experiment", async () => {
    const experiment = await createExperiment(testAgentId, {
      id: "custom-test",
      dimension: "response-length",
      name: "My Custom Test",
      variants: [
        { id: "v1", name: "Version 1", description: "First version", instruction: "Do V1" },
        { id: "v2", name: "Version 2", description: "Second version", instruction: "Do V2" },
      ],
      active: true,
      trafficAllocation: 0.5,
    });

    expect(experiment.id).toBe("custom-test");
    expect(experiment.createdAt).toBeDefined();

    const state = await loadExperimentState(testAgentId);
    expect(state.experiments.some((e) => e.id === "custom-test")).toBe(true);
  });
});

describe("experiment deletion", () => {
  const testAgentId = "delete-agent";

  it("deletes an experiment", async () => {
    await initializeExperiments(testAgentId);

    const deleted = await deleteExperiment(testAgentId, "response-length-v1");
    expect(deleted).toBe(true);

    const state = await loadExperimentState(testAgentId);
    expect(state.experiments.some((e) => e.id === "response-length-v1")).toBe(false);
  });

  it("returns false when deleting non-existent experiment", async () => {
    const deleted = await deleteExperiment(testAgentId, "non-existent");
    expect(deleted).toBe(false);
  });

  it("cleans up related assignments and metrics", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);

    await deleteExperiment(testAgentId, "response-length-v1");

    const state = await loadExperimentState(testAgentId);
    expect(state.assignments.some((a) => a.experimentId === "response-length-v1")).toBe(false);
    expect(state.metrics["response-length-v1"]).toBeUndefined();
  });
});

describe("experiment summary", () => {
  const testAgentId = "summary-agent";

  it("returns summary of all experiments", async () => {
    await initializeExperiments(testAgentId);

    const summary = await getExperimentsSummary(testAgentId);

    expect(summary.length).toBe(defaultExperiments.length);
    for (const item of summary) {
      expect(item.experiment).toBeDefined();
      // Results may be null if no data
    }
  });

  it("includes results for experiments with data", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);

    const summary = await getExperimentsSummary(testAgentId);
    const lengthExp = summary.find((s) => s.experiment.id === "response-length-v1");

    expect(lengthExp?.results).not.toBeNull();
    expect(lengthExp?.results?.totalSamples).toBe(1);
  });
});

describe("graduating winning variant", () => {
  const testAgentId = "graduate-agent";

  it("returns null when no winner", async () => {
    await initializeExperiments(testAgentId);

    const graduated = await graduateWinningVariant(testAgentId, "response-length-v1");
    expect(graduated).toBeNull();
  });

  it("graduates winning variant and deactivates experiment", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);

    // Set up a clear winner
    await recordAssignment(testAgentId, "response-length-v1", "concise", "s1");
    await recordAssignment(testAgentId, "response-length-v1", "detailed", "s2");

    for (let i = 0; i < 50; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    }
    for (let i = 0; i < 50; i++) {
      await recordVariantFeedback(testAgentId, "response-length-v1", "detailed", false);
    }

    const graduated = await graduateWinningVariant(testAgentId, "response-length-v1");

    expect(graduated).not.toBeNull();
    expect(graduated?.id).toBe("concise");

    // Experiment should be deactivated
    const active = await getActiveExperiments(testAgentId);
    expect(active.some((e) => e.id === "response-length-v1")).toBe(false);
  });
});

describe("resetting experiment metrics", () => {
  const testAgentId = "reset-agent";

  it("resets metrics for an experiment", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);
    await recordVariantFeedback(testAgentId, "response-length-v1", "concise", true);

    await resetExperimentMetrics(testAgentId, "response-length-v1");

    const state = await loadExperimentState(testAgentId);
    const metrics = state.metrics["response-length-v1"];

    for (const metric of metrics) {
      expect(metric.exposures).toBe(0);
      expect(metric.positiveCount).toBe(0);
      expect(metric.negativeCount).toBe(0);
      expect(metric.successRate).toBe(0);
    }
  });

  it("clears assignments for the experiment", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await recordAssignment(testAgentId, "response-length-v1", "concise", "session-1");
    await recordAssignment(testAgentId, "response-length-v1", "detailed", "session-2");

    await resetExperimentMetrics(testAgentId, "response-length-v1");

    const state = await loadExperimentState(testAgentId);
    expect(state.assignments.filter((a) => a.experimentId === "response-length-v1")).toHaveLength(
      0,
    );
  });
});

describe("path resolution", () => {
  it("resolves experiments path correctly", () => {
    const expPath = resolveExperimentsPath("test-agent");
    expect(expPath).toContain("agents");
    expect(expPath).toContain("test-agent");
    expect(expPath).toContain("ab-experiments.json");
  });
});

describe("getAssignedVariants", () => {
  const testAgentId = "assigned-agent";

  it("returns empty map when no active experiments", async () => {
    await initializeExperiments(testAgentId);

    const assignments = await getAssignedVariants(testAgentId, "session-1");
    expect(assignments.size).toBe(0);
  });

  it("returns assignments for all active experiments", async () => {
    await initializeExperiments(testAgentId);
    await setExperimentActive(testAgentId, "response-length-v1", true);
    await setExperimentActive(testAgentId, "proactivity-v1", true);

    const assignments = await getAssignedVariants(testAgentId, "session-1");

    expect(assignments.size).toBe(2);
    expect(assignments.has("response-length-v1")).toBe(true);
    expect(assignments.has("proactivity-v1")).toBe(true);
  });
});

describe("default experiments structure", () => {
  it("has expected default experiments", () => {
    expect(defaultExperiments.length).toBeGreaterThanOrEqual(5);

    const dimensions = defaultExperiments.map((e) => e.dimension);
    expect(dimensions).toContain("response-length");
    expect(dimensions).toContain("explanation-style");
    expect(dimensions).toContain("example-inclusion");
    expect(dimensions).toContain("proactivity");
    expect(dimensions).toContain("confirmation-style");
  });

  it("all default experiments have at least 2 variants", () => {
    for (const exp of defaultExperiments) {
      expect(exp.variants.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("all variants have required fields", () => {
    for (const exp of defaultExperiments) {
      for (const variant of exp.variants) {
        expect(variant.id).toBeDefined();
        expect(variant.name).toBeDefined();
        expect(variant.description).toBeDefined();
        expect(variant.instruction).toBeDefined();
        expect(variant.instruction.length).toBeGreaterThan(0);
      }
    }
  });
});
