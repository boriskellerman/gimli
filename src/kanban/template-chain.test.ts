/**
 * Tests for Template Chain System
 *
 * Validates the complete template chaining infrastructure:
 * - Chain definitions (bug, feature, chore)
 * - Chain building and composition
 * - Chain execution with stage management
 * - Template type detection and chain selection
 * - Error handling and retries
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUG_FIX_CHAIN,
  buildChain,
  CHORE_CHAIN,
  type ChainContext,
  type ChainExecutorDeps,
  composeChains,
  createDefaultChainDeps,
  createExecutionPlan,
  createStage,
  detectTemplateType,
  executeChain,
  FEATURE_DEV_CHAIN,
  selectChain,
  type StageConfig,
  type StageResult,
  type StageType,
  TEMPLATE_CHAINS,
} from "./template-chain.js";

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Create mock executor dependencies for testing
 */
function createMockDeps(options?: {
  stageResults?: Record<StageType, Partial<StageResult>>;
  shouldFail?: StageType[];
  failAfterAttempts?: number;
}): ChainExecutorDeps {
  const attemptCounts = new Map<string, number>();

  return {
    log: vi.fn(),
    now: () => Date.now(),
    executeStage: vi.fn(async (stage: StageConfig, context: ChainContext): Promise<StageResult> => {
      const stageKey = `${stage.type}-${context.currentStage}`;
      const attempts = (attemptCounts.get(stageKey) ?? 0) + 1;
      attemptCounts.set(stageKey, attempts);

      // Simulate failure if requested
      if (options?.shouldFail?.includes(stage.type)) {
        if (!options.failAfterAttempts || attempts <= options.failAfterAttempts) {
          throw new Error(`Stage ${stage.type} failed (attempt ${attempts})`);
        }
      }

      const baseResult: StageResult = {
        stageId: `stage-${context.currentStage}-${stage.type}`,
        stageType: stage.type,
        status: "completed",
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        durationMs: 1000,
        output: `Output from ${stage.type} stage`,
        metrics: {
          tokensUsed: 500,
          confidence: 0.85,
          filesChanged: 1,
        },
        artifacts: [
          {
            type: "report",
            content: `Report from ${stage.type}`,
          },
        ],
      };

      // Merge with custom stage results if provided
      if (options?.stageResults?.[stage.type]) {
        return { ...baseResult, ...options.stageResults[stage.type] };
      }

      return baseResult;
    }),
  };
}

// ============================================================================
// Pre-defined Chain Tests
// ============================================================================

describe("Pre-defined Template Chains", () => {
  describe("BUG_FIX_CHAIN", () => {
    it("has correct structure", () => {
      expect(BUG_FIX_CHAIN.id).toBe("bug-fix");
      expect(BUG_FIX_CHAIN.templateType).toBe("bug");
      expect(BUG_FIX_CHAIN.stages).toHaveLength(6);
    });

    it("has all required stages", () => {
      const stageTypes = BUG_FIX_CHAIN.stages.map((s) => s.type);
      expect(stageTypes).toContain("investigate");
      expect(stageTypes).toContain("design");
      expect(stageTypes).toContain("implement");
      expect(stageTypes).toContain("test");
      expect(stageTypes).toContain("review");
      expect(stageTypes).toContain("document");
    });

    it("marks critical stages as required", () => {
      const requiredStages = BUG_FIX_CHAIN.stages.filter((s) => s.required);
      expect(requiredStages.map((s) => s.type)).toContain("investigate");
      expect(requiredStages.map((s) => s.type)).toContain("implement");
      expect(requiredStages.map((s) => s.type)).toContain("test");
    });

    it("has entry prompt with Request-Validate-Resolve pattern", () => {
      expect(BUG_FIX_CHAIN.entryPrompt).toContain("Request");
      expect(BUG_FIX_CHAIN.entryPrompt).toContain("Validate");
      expect(BUG_FIX_CHAIN.entryPrompt).toContain("Resolve");
    });

    it("has sensible exit criteria", () => {
      expect(BUG_FIX_CHAIN.exitCriteria.minStagesCompleted).toBe(5);
      expect(BUG_FIX_CHAIN.exitCriteria.requireAllCritical).toBe(true);
      expect(BUG_FIX_CHAIN.exitCriteria.minConfidence).toBe(0.8);
    });
  });

  describe("FEATURE_DEV_CHAIN", () => {
    it("has correct structure", () => {
      expect(FEATURE_DEV_CHAIN.id).toBe("feature-dev");
      expect(FEATURE_DEV_CHAIN.templateType).toBe("feature");
      expect(FEATURE_DEV_CHAIN.stages).toHaveLength(6);
    });

    it("has all required stages", () => {
      const stageTypes = FEATURE_DEV_CHAIN.stages.map((s) => s.type);
      expect(stageTypes).toContain("design");
      expect(stageTypes).toContain("plan");
      expect(stageTypes).toContain("implement");
      expect(stageTypes).toContain("test");
      expect(stageTypes).toContain("review");
      expect(stageTypes).toContain("document");
    });

    it("allows retries on implement stage", () => {
      const implementStage = FEATURE_DEV_CHAIN.stages.find((s) => s.type === "implement");
      expect(implementStage?.retryOnFailure).toBe(true);
      expect(implementStage?.maxRetries).toBe(3);
    });

    it("has higher exit criteria than bug chain", () => {
      expect(FEATURE_DEV_CHAIN.exitCriteria.minStagesCompleted).toBe(6);
      expect(FEATURE_DEV_CHAIN.exitCriteria.minConfidence).toBe(0.85);
    });
  });

  describe("CHORE_CHAIN", () => {
    it("has correct structure", () => {
      expect(CHORE_CHAIN.id).toBe("chore");
      expect(CHORE_CHAIN.templateType).toBe("chore");
      expect(CHORE_CHAIN.stages).toHaveLength(4);
    });

    it("is more lightweight than other chains", () => {
      expect(CHORE_CHAIN.stages.length).toBeLessThan(FEATURE_DEV_CHAIN.stages.length);
      expect(CHORE_CHAIN.exitCriteria.minStagesCompleted).toBe(3);
      expect(CHORE_CHAIN.exitCriteria.minConfidence).toBe(0.75);
    });

    it("has cleanup as optional stage", () => {
      const cleanupStage = CHORE_CHAIN.stages.find((s) => s.type === "cleanup");
      expect(cleanupStage?.required).toBe(false);
    });
  });

  describe("TEMPLATE_CHAINS registry", () => {
    it("contains all template types", () => {
      expect(TEMPLATE_CHAINS.bug).toBe(BUG_FIX_CHAIN);
      expect(TEMPLATE_CHAINS.feature).toBe(FEATURE_DEV_CHAIN);
      expect(TEMPLATE_CHAINS.chore).toBe(CHORE_CHAIN);
    });
  });
});

// ============================================================================
// Chain Building Tests
// ============================================================================

describe("Chain Building", () => {
  describe("createStage", () => {
    it("creates a stage with required fields", () => {
      const stage = createStage("implement", "Build the feature");

      expect(stage.type).toBe("implement");
      expect(stage.prompt).toBe("Build the feature");
      expect(stage.required).toBe(true);
      expect(stage.timeout).toBe(120000);
    });

    it("allows overriding defaults", () => {
      const stage = createStage("test", "Run tests", {
        required: false,
        timeout: 60000,
        retryOnFailure: true,
        maxRetries: 5,
      });

      expect(stage.required).toBe(false);
      expect(stage.timeout).toBe(60000);
      expect(stage.retryOnFailure).toBe(true);
      expect(stage.maxRetries).toBe(5);
    });

    it("supports skip conditions", () => {
      const skipCondition = (ctx: ChainContext) => ctx.stageResults.length > 0;
      const stage = createStage("document", "Update docs", { skipCondition });

      expect(stage.skipCondition).toBe(skipCondition);
    });

    it("supports output validation", () => {
      const validateOutput = (result: StageResult) => result.status === "completed";
      const stage = createStage("review", "Code review", { validateOutput });

      expect(stage.validateOutput).toBe(validateOutput);
    });
  });

  describe("buildChain", () => {
    it("creates a custom chain with required fields", () => {
      const stages = [
        createStage("plan", "Plan the work"),
        createStage("build", "Execute the plan"),
      ];

      const chain = buildChain("custom-chain", "Custom Workflow", "feature", stages);

      expect(chain.id).toBe("custom-chain");
      expect(chain.name).toBe("Custom Workflow");
      expect(chain.templateType).toBe("feature");
      expect(chain.stages).toHaveLength(2);
    });

    it("uses sensible defaults for exit criteria", () => {
      const stages = [createStage("plan", "Plan"), createStage("build", "Build")];

      const chain = buildChain("test", "Test", "chore", stages);

      expect(chain.exitCriteria.minStagesCompleted).toBe(1); // stages.length - 1
      expect(chain.exitCriteria.requireAllCritical).toBe(true);
      expect(chain.exitCriteria.minConfidence).toBe(0.8);
    });

    it("allows custom exit criteria", () => {
      const stages = [createStage("plan", "Plan"), createStage("build", "Build")];

      const chain = buildChain("test", "Test", "chore", stages, {
        exitCriteria: {
          minStagesCompleted: 2,
          minConfidence: 0.95,
        },
      });

      expect(chain.exitCriteria.minStagesCompleted).toBe(2);
      expect(chain.exitCriteria.minConfidence).toBe(0.95);
    });

    it("supports custom description and entry prompt", () => {
      const stages = [createStage("plan", "Plan")];

      const chain = buildChain("test", "Test", "feature", stages, {
        description: "A custom description",
        entryPrompt: "Custom entry instructions",
      });

      expect(chain.description).toBe("A custom description");
      expect(chain.entryPrompt).toBe("Custom entry instructions");
    });
  });

  describe("composeChains", () => {
    it("combines multiple chains into one", () => {
      const bugChain = buildChain("mini-bug", "Mini Bug", "bug", [
        createStage("investigate", "Find bug"),
        createStage("implement", "Fix bug"),
      ]);

      const testChain = buildChain("mini-test", "Mini Test", "feature", [
        createStage("test", "Run tests"),
        createStage("review", "Review"),
      ]);

      const composed = composeChains([bugChain, testChain], {
        id: "composed",
        name: "Composed Workflow",
      });

      expect(composed.id).toBe("composed");
      expect(composed.stages.length).toBe(4);
    });

    it("adds transition prompts between chains", () => {
      const chain1 = buildChain("c1", "C1", "bug", [createStage("implement", "Impl")]);
      const chain2 = buildChain("c2", "C2", "feature", [createStage("test", "Test")]);

      const composed = composeChains([chain1, chain2], {
        id: "composed",
        name: "Composed",
        transitionPrompts: {
          c2: "Now moving to testing phase",
        },
      });

      // Should have: impl, transition plan, test
      expect(composed.stages.length).toBe(3);
      expect(composed.stages[1].type).toBe("plan");
      expect(composed.stages[1].prompt).toContain("TRANSITION");
    });

    it("inherits template type from first chain", () => {
      const chain1 = buildChain("c1", "C1", "bug", [createStage("investigate", "Inv")]);
      const chain2 = buildChain("c2", "C2", "feature", [createStage("test", "Test")]);

      const composed = composeChains([chain1, chain2], { id: "composed", name: "Composed" });

      expect(composed.templateType).toBe("bug");
    });
  });
});

// ============================================================================
// Chain Execution Tests
// ============================================================================

describe("Chain Execution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createExecutionPlan", () => {
    it("creates a plan with correct structure", () => {
      const plan = createExecutionPlan(
        BUG_FIX_CHAIN,
        "task-123",
        "Fix memory leak",
        "Memory is leaking in the cache module",
      );

      expect(plan.chainId).toBe("bug-fix");
      expect(plan.taskId).toBe("task-123");
      expect(plan.status).toBe("pending");
      expect(plan.stages).toHaveLength(6);
    });

    it("initializes context correctly", () => {
      const plan = createExecutionPlan(FEATURE_DEV_CHAIN, "task-456", "Add dark mode");

      expect(plan.context.taskId).toBe("task-456");
      expect(plan.context.taskTitle).toBe("Add dark mode");
      expect(plan.context.templateType).toBe("feature");
      expect(plan.context.currentStage).toBe(0);
      expect(plan.context.totalStages).toBe(6);
      expect(plan.context.stageResults).toHaveLength(0);
      expect(plan.context.sharedContext).toEqual({});
    });

    it("includes metadata in context", () => {
      const plan = createExecutionPlan(CHORE_CHAIN, "task-789", "Update deps", undefined, {
        priority: "high",
        labels: ["deps", "maintenance"],
      });

      expect(plan.context.metadata.priority).toBe("high");
      expect(plan.context.metadata.labels).toEqual(["deps", "maintenance"]);
    });

    it("records timestamps", () => {
      const plan = createExecutionPlan(BUG_FIX_CHAIN, "task-123", "Fix bug");

      expect(plan.createdAt).toBeDefined();
      expect(plan.context.metadata.startedAt).toBeDefined();
      expect(plan.startedAt).toBeUndefined(); // Set when execution starts
    });
  });

  describe("executeChain", () => {
    it("executes all stages in order", async () => {
      const chain = buildChain("simple", "Simple", "feature", [
        createStage("plan", "Plan"),
        createStage("build", "Build"),
        createStage("test", "Test"),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Simple task");
      const deps = createMockDeps();

      const result = await executeChain(chain, plan, deps);

      expect(deps.executeStage).toHaveBeenCalledTimes(3);
      expect(result.stagesCompleted).toBe(3);
      expect(result.status).toBe("completed");
    });

    it("returns completed status when all stages succeed", async () => {
      const plan = createExecutionPlan(CHORE_CHAIN, "task-1", "Update deps");
      const deps = createMockDeps();

      const result = await executeChain(CHORE_CHAIN, plan, deps);

      expect(result.status).toBe("completed");
      expect(result.summary.success).toBe(true);
    });

    it("returns failed status when required stage fails", async () => {
      const chain = buildChain("fail-test", "Fail Test", "bug", [
        createStage("investigate", "Investigate"),
        createStage("implement", "Implement", { required: true }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps({ shouldFail: ["implement"] });

      const result = await executeChain(chain, plan, deps);

      expect(result.status).toBe("failed");
      expect(result.summary.success).toBe(false);
    });

    it("continues when optional stage fails", async () => {
      const chain = buildChain("optional-fail", "Optional Fail", "feature", [
        createStage("plan", "Plan", { required: true }),
        createStage("document", "Document", { required: false }),
        createStage("cleanup", "Cleanup", { required: true }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps({ shouldFail: ["document"] });

      const result = await executeChain(chain, plan, deps);

      // Should complete because document is optional
      expect(result.stagesCompleted).toBe(2);
      expect(result.stageResults.find((r) => r.stageType === "document")?.status).toBe("failed");
    });

    it("retries failed stages when configured", async () => {
      const chain = buildChain("retry-test", "Retry Test", "feature", [
        createStage("implement", "Implement", {
          required: true,
          retryOnFailure: true,
          maxRetries: 2,
        }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      // Fail on first 2 attempts, succeed on 3rd
      const deps = createMockDeps({ shouldFail: ["implement"], failAfterAttempts: 2 });

      const result = await executeChain(chain, plan, deps);

      expect(deps.executeStage).toHaveBeenCalledTimes(3);
      expect(result.status).toBe("completed");
    });

    it("skips stages when skip condition is met", async () => {
      const chain = buildChain("skip-test", "Skip Test", "chore", [
        createStage("plan", "Plan"),
        createStage("cleanup", "Cleanup", {
          required: false,
          skipCondition: (ctx) => ctx.stageResults.length > 0,
        }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps();

      const result = await executeChain(chain, plan, deps);

      expect(deps.executeStage).toHaveBeenCalledTimes(1);
      expect(result.stageResults.find((r) => r.stageType === "cleanup")?.status).toBe("skipped");
    });

    it("validates stage output when validator is provided", async () => {
      const chain = buildChain("validate-test", "Validate Test", "feature", [
        createStage("test", "Test", {
          required: true,
          retryOnFailure: true,
          maxRetries: 1,
          validateOutput: (result) => (result.metrics?.confidence ?? 0) > 0.9,
        }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      // Default confidence is 0.85, which fails validation
      const deps = createMockDeps({
        stageResults: {
          test: { metrics: { confidence: 0.85 } },
        },
      });

      const result = await executeChain(chain, plan, deps);

      // Should fail because validation fails
      expect(result.stageResults[0].status).toBe("failed");
      expect(result.stageResults[0].error).toContain("validation failed");
    });

    it("accumulates metrics across stages", async () => {
      const chain = buildChain("metrics-test", "Metrics Test", "feature", [
        createStage("plan", "Plan"),
        createStage("build", "Build"),
        createStage("test", "Test"),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps({
        stageResults: {
          plan: { metrics: { tokensUsed: 100, filesChanged: 0 } },
          build: { metrics: { tokensUsed: 500, filesChanged: 5 } },
          test: { metrics: { tokensUsed: 200, testsRun: 10, testsPassed: 9 } },
        },
      });

      const result = await executeChain(chain, plan, deps);

      expect(result.metrics.totalTokensUsed).toBe(800);
      expect(result.metrics.filesChanged).toBe(5);
      expect(result.metrics.testsRun).toBe(10);
      expect(result.metrics.testsPassed).toBe(9);
    });

    it("collects artifacts from all stages", async () => {
      const chain = buildChain("artifacts-test", "Artifacts Test", "bug", [
        createStage("investigate", "Investigate"),
        createStage("implement", "Implement"),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps();

      const result = await executeChain(chain, plan, deps);

      expect(result.artifacts.length).toBe(2);
    });

    it("passes context between stages", async () => {
      const chain = buildChain("context-test", "Context Test", "feature", [
        createStage("plan", "Plan"),
        createStage("build", "Build"),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps({
        stageResults: {
          plan: {
            nextStageContext: { planResult: "detailed plan" },
          },
        },
      });

      await executeChain(chain, plan, deps);

      // Verify context was passed
      const secondCall = (deps.executeStage as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(secondCall[1].sharedContext.planResult).toBe("detailed plan");
    });

    it("generates meaningful summary on success", async () => {
      const plan = createExecutionPlan(FEATURE_DEV_CHAIN, "task-1", "Add feature");
      const deps = createMockDeps();

      const result = await executeChain(FEATURE_DEV_CHAIN, plan, deps);

      expect(result.summary.success).toBe(true);
      expect(result.summary.recommendation).toContain("completed successfully");
      expect(result.summary.nextSteps).toBeDefined();
    });

    it("generates meaningful summary on failure", async () => {
      const chain = buildChain("fail-chain", "Fail Chain", "bug", [
        createStage("investigate", "Investigate", { required: true }),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps({ shouldFail: ["investigate"] });

      const result = await executeChain(chain, plan, deps);

      expect(result.summary.success).toBe(false);
      expect(result.summary.recommendation).toContain("failed");
      expect(result.summary.nextSteps).toBeDefined();
      expect(result.summary.nextSteps?.some((s) => s.includes("investigate"))).toBe(true);
    });

    it("updates plan status during execution", async () => {
      const chain = buildChain("status-test", "Status Test", "chore", [
        createStage("plan", "Plan"),
      ]);

      const plan = createExecutionPlan(chain, "task-1", "Task");
      const deps = createMockDeps();

      await executeChain(chain, plan, deps);

      expect(plan.status).toBe("completed");
      expect(plan.startedAt).toBeDefined();
      expect(plan.completedAt).toBeDefined();
    });
  });
});

// ============================================================================
// Template Detection & Selection Tests
// ============================================================================

describe("Template Detection & Selection", () => {
  describe("detectTemplateType", () => {
    describe("label-based detection", () => {
      it("detects bug from labels", () => {
        expect(detectTemplateType(["bug"], "Some title")).toBe("bug");
        expect(detectTemplateType(["bugfix"], "Some title")).toBe("bug");
        expect(detectTemplateType(["fix"], "Some title")).toBe("bug");
      });

      it("detects feature from labels", () => {
        expect(detectTemplateType(["feature"], "Some title")).toBe("feature");
        expect(detectTemplateType(["enhancement"], "Some title")).toBe("feature");
        expect(detectTemplateType(["feat"], "Some title")).toBe("feature");
        expect(detectTemplateType(["new"], "Some title")).toBe("feature");
      });

      it("detects chore from labels", () => {
        expect(detectTemplateType(["chore"], "Some title")).toBe("chore");
        expect(detectTemplateType(["maintenance"], "Some title")).toBe("chore");
        expect(detectTemplateType(["deps"], "Some title")).toBe("chore");
        expect(detectTemplateType(["refactor"], "Some title")).toBe("chore");
      });

      it("is case-insensitive", () => {
        expect(detectTemplateType(["BUG"], "Title")).toBe("bug");
        expect(detectTemplateType(["FEATURE"], "Title")).toBe("feature");
        expect(detectTemplateType(["CHORE"], "Title")).toBe("chore");
      });
    });

    describe("content-based detection", () => {
      it("detects bug from title/description", () => {
        expect(detectTemplateType([], "Fix the memory bug")).toBe("bug");
        expect(detectTemplateType([], "Error handling is broken")).toBe("bug");
        expect(detectTemplateType([], "Something", "This fixes the crash")).toBe("bug");
      });

      it("detects feature from title/description", () => {
        expect(detectTemplateType([], "Add dark mode feature")).toBe("feature");
        expect(detectTemplateType([], "Implement new API endpoint")).toBe("feature");
        expect(detectTemplateType([], "Title", "Add support for OAuth")).toBe("feature");
      });

      it("detects chore from title/description", () => {
        expect(detectTemplateType([], "Update dependencies")).toBe("chore");
        expect(detectTemplateType([], "Upgrade React to v19")).toBe("chore");
        expect(detectTemplateType([], "Refactor authentication module")).toBe("chore");
        expect(detectTemplateType([], "Cleanup unused imports")).toBe("chore");
      });
    });

    it("prioritizes labels over content", () => {
      // Label says bug, content says feature
      expect(detectTemplateType(["bug"], "Add new feature")).toBe("bug");

      // Label says feature, content says bug
      expect(detectTemplateType(["feature"], "Fix the bug")).toBe("feature");
    });

    it("defaults to feature for ambiguous cases", () => {
      expect(detectTemplateType([], "Do something")).toBe("feature");
      expect(detectTemplateType([], "")).toBe("feature");
    });
  });

  describe("selectChain", () => {
    it("selects bug chain for bug tasks", () => {
      const chain = selectChain("task-1", "Fix crash", ["bug"]);
      expect(chain).toBe(BUG_FIX_CHAIN);
    });

    it("selects feature chain for feature tasks", () => {
      const chain = selectChain("task-2", "Add dark mode", ["feature"]);
      expect(chain).toBe(FEATURE_DEV_CHAIN);
    });

    it("selects chore chain for maintenance tasks", () => {
      const chain = selectChain("task-3", "Update deps", ["chore"]);
      expect(chain).toBe(CHORE_CHAIN);
    });

    it("uses content detection when no labels", () => {
      const bugChain = selectChain("task-1", "Fix the memory leak", []);
      expect(bugChain).toBe(BUG_FIX_CHAIN);

      const featureChain = selectChain("task-2", "Add new API", []);
      expect(featureChain).toBe(FEATURE_DEV_CHAIN);
    });

    it("supports custom chains", () => {
      const customBugChain = buildChain("custom-bug", "Custom Bug", "bug", [
        createStage("plan", "Plan"),
      ]);

      const chain = selectChain("task-1", "Fix bug", ["bug"], undefined, {
        bug: customBugChain,
        feature: FEATURE_DEV_CHAIN,
        chore: CHORE_CHAIN,
      });

      expect(chain).toBe(customBugChain);
    });
  });
});

// ============================================================================
// Default Dependencies Tests
// ============================================================================

describe("Default Dependencies", () => {
  describe("createDefaultChainDeps", () => {
    it("creates deps with default implementations", () => {
      const deps = createDefaultChainDeps();

      expect(typeof deps.log).toBe("function");
      expect(typeof deps.executeStage).toBe("function");
      expect(typeof deps.now).toBe("function");
    });

    it("now() returns current timestamp", () => {
      const deps = createDefaultChainDeps();
      const before = Date.now();
      const result = deps.now();
      const after = Date.now();

      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });

    it("allows custom log function", () => {
      const customLog = vi.fn();
      const deps = createDefaultChainDeps({ logFn: customLog });

      deps.log("info", "test message", { data: "value" });

      expect(customLog).toHaveBeenCalledWith("info", "test message", { data: "value" });
    });

    it("allows custom stage executor", async () => {
      const customExecutor = vi.fn(async () => ({
        stageId: "custom-stage",
        stageType: "plan" as StageType,
        status: "completed" as const,
        startedAt: Date.now(),
        completedAt: Date.now(),
      }));

      const deps = createDefaultChainDeps({ stageExecutor: customExecutor });

      const context: ChainContext = {
        taskId: "task-1",
        taskTitle: "Test",
        templateType: "feature",
        currentStage: 0,
        totalStages: 1,
        stageResults: [],
        sharedContext: {},
        metadata: { startedAt: Date.now() },
      };

      await deps.executeStage(createStage("plan", "Plan"), context);

      expect(customExecutor).toHaveBeenCalled();
    });

    it("default executeStage returns stub result", async () => {
      const deps = createDefaultChainDeps();

      const context: ChainContext = {
        taskId: "task-1",
        taskTitle: "Test",
        templateType: "feature",
        currentStage: 0,
        totalStages: 1,
        stageResults: [],
        sharedContext: {},
        metadata: { startedAt: Date.now() },
      };

      const result = await deps.executeStage(createStage("plan", "Plan"), context);

      expect(result.status).toBe("completed");
      expect(result.stageType).toBe("plan");
      expect(result.output).toContain("stub");
    });
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe("Integration: End-to-End Feature Development", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes complete bug fix workflow", async () => {
    const plan = createExecutionPlan(
      BUG_FIX_CHAIN,
      "bug-123",
      "Memory leak in cache",
      "The cache module is not releasing memory properly",
      { priority: "high", labels: ["bug", "performance"] },
    );

    const deps = createMockDeps({
      stageResults: {
        investigate: {
          output: "Found root cause: WeakMap not being used for cache entries",
          metrics: { confidence: 0.95 },
        },
        implement: {
          output: "Replaced Map with WeakMap, added cleanup routine",
          metrics: { filesChanged: 2, confidence: 0.9 },
        },
        test: {
          output: "All tests pass, added regression test",
          metrics: { testsRun: 45, testsPassed: 45, confidence: 0.95 },
        },
      },
    });

    const result = await executeChain(BUG_FIX_CHAIN, plan, deps);

    expect(result.status).toBe("completed");
    expect(result.summary.success).toBe(true);
    expect(result.stagesCompleted).toBe(6);
  });

  it("executes complete feature development workflow", async () => {
    const plan = createExecutionPlan(
      FEATURE_DEV_CHAIN,
      "feature-456",
      "Add dark mode support",
      "Users want a dark theme option",
      { priority: "medium", labels: ["feature", "ui"] },
    );

    const deps = createMockDeps({
      stageResults: {
        design: {
          output: "Using CSS variables for theming, toggle in settings",
          metrics: { confidence: 0.9 },
        },
        implement: {
          output: "Added ThemeProvider, dark.css, settings toggle",
          metrics: { filesChanged: 8, linesAdded: 250, confidence: 0.88 },
        },
        test: {
          output: "Visual regression tests pass, unit tests added",
          metrics: { testsRun: 30, testsPassed: 30, confidence: 0.92 },
        },
        document: {
          output: "Updated changelog, added theming docs",
          metrics: { confidence: 0.85 },
        },
      },
    });

    const result = await executeChain(FEATURE_DEV_CHAIN, plan, deps);

    expect(result.status).toBe("completed");
    expect(result.summary.success).toBe(true);
    expect(result.metrics.filesChanged).toBeGreaterThan(0);
    expect(result.metrics.testsRun).toBeGreaterThan(0);
  });

  it("handles partial completion gracefully", async () => {
    const plan = createExecutionPlan(CHORE_CHAIN, "chore-789", "Update dependencies");

    const deps = createMockDeps({
      shouldFail: ["cleanup"], // Optional stage fails
    });

    const result = await executeChain(CHORE_CHAIN, plan, deps);

    // Should still be completed because cleanup is optional
    expect(result.status).toBe("completed");
    expect(result.stagesCompleted).toBe(3); // plan, build, verify succeeded
  });

  it("composes and executes multi-chain workflow", async () => {
    // Create a composed workflow: bug fix → feature enhancement
    const bugMiniChain = buildChain("bug-mini", "Quick Bug Fix", "bug", [
      createStage("investigate", "Find the bug"),
      createStage("implement", "Fix it"),
    ]);

    const featureMiniChain = buildChain("feature-mini", "Quick Feature", "feature", [
      createStage("implement", "Add enhancement"),
      createStage("test", "Verify"),
    ]);

    const composedChain = composeChains([bugMiniChain, featureMiniChain], {
      id: "bug-then-feature",
      name: "Bug Fix + Enhancement",
      description: "Fix the bug, then enhance the feature",
      transitionPrompts: {
        "feature-mini": "Bug is fixed, now adding enhancement",
      },
    });

    const plan = createExecutionPlan(composedChain, "composite-task", "Fix bug and enhance");
    const deps = createMockDeps();

    const result = await executeChain(composedChain, plan, deps);

    // Should have: investigate, implement, transition, implement, test
    expect(result.stagesCompleted).toBe(5);
    expect(result.status).toBe("completed");
  });
});
