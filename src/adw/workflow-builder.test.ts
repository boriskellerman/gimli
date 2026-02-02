import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createWorkflow,
  createPlanBuildWorkflow,
  createBuildTestFixWorkflow,
  createReviewDocumentWorkflow,
  createScoutPlanBuildWorkflow,
  createIterationWorkflow,
} from "./workflow-builder.js";
import { WorkflowRunner } from "./workflow-runner.js";

describe("WorkflowBuilder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic building", () => {
    it("creates a simple workflow", () => {
      const workflow = createWorkflow("test", "Test Workflow")
        .describe("A test workflow")
        .setVersion("1.0.0")
        .build();

      expect(workflow.id).toBe("test");
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.description).toBe("A test workflow");
      expect(workflow.version).toBe("1.0.0");
    });

    it("adds steps to workflow", () => {
      const workflow = createWorkflow("test")
        .addStep("step1", "Step 1", async (input: number) => input + 1)
        .addStep("step2", "Step 2", async (input: number) => input * 2)
        .build();

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0]?.id).toBe("step1");
      expect(workflow.steps[1]?.id).toBe("step2");
    });

    it("configures retry settings", () => {
      const workflow = createWorkflow("test")
        .withRetry({ maxAttempts: 5, initialDelayMs: 500 })
        .addStep("step1", "Step 1", async (input: number) => input)
        .build();

      expect(workflow.defaultRetry?.maxAttempts).toBe(5);
      expect(workflow.defaultRetry?.initialDelayMs).toBe(500);
    });

    it("configures timeout", () => {
      const workflow = createWorkflow("test")
        .withTimeout(60000)
        .addStep("step1", "Step 1", async (input: number) => input)
        .build();

      expect(workflow.timeoutMs).toBe(60000);
    });

    it("configures continueOnError", () => {
      const workflow = createWorkflow("test")
        .continueOnError()
        .addStep("step1", "Step 1", async (input: number) => input)
        .build();

      expect(workflow.abortOnError).toBe(false);
    });
  });

  describe("context initialization", () => {
    it("initializes context from input", async () => {
      type Context = { multiplier: number };

      const workflow = createWorkflow<number, number, Context>("test")
        .initContext((input) => ({ multiplier: input }))
        .addStep("multiply", "Multiply", async (input: number, ctx) => input * ctx.multiplier)
        .build();

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.context).toEqual({ multiplier: 5 });
      const stepResult = result.stepResults.get("multiply");
      expect(stepResult?.status).toBe("success");
      if (stepResult?.status === "success") {
        expect(stepResult.data).toBe(25);
      }
    });
  });

  describe("output transformation", () => {
    it("transforms workflow output", async () => {
      const workflow = createWorkflow<number, string, unknown>("test")
        .addStep("double", "Double", async (input: number) => input * 2)
        .transformOutput((results) => {
          const doubleResult = results.get("double");
          if (doubleResult?.status === "success") {
            return `Result: ${doubleResult.data}`;
          }
          return "Error";
        })
        .build();

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.output).toBe("Result: 10");
    });
  });

  describe("conditional steps", () => {
    it("skips conditional steps based on context", async () => {
      type Context = { shouldDouble: boolean };
      const executedSteps: string[] = [];

      const workflow = createWorkflow<number, number, Context>("test")
        .initContext(() => ({ shouldDouble: false }))
        .addStep("add", "Add", async (input: number) => {
          executedSteps.push("add");
          return input + 1;
        })
        .addConditionalStep(
          "double",
          "Double",
          (ctx) => ctx.shouldDouble,
          async (input: number) => {
            executedSteps.push("double");
            return input * 2;
          },
        )
        .addStep("final", "Final", async (input: number) => {
          executedSteps.push("final");
          return input;
        })
        .build();

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executedSteps).toEqual(["add", "final"]);
    });

    it("executes conditional steps when condition is true", async () => {
      type Context = { shouldDouble: boolean };
      const executedSteps: string[] = [];

      const workflow = createWorkflow<number, number, Context>("test")
        .initContext(() => ({ shouldDouble: true }))
        .addStep("add", "Add", async (input: number) => {
          executedSteps.push("add");
          return input + 1;
        })
        .addConditionalStep(
          "double",
          "Double",
          (ctx) => ctx.shouldDouble,
          async (input: number) => {
            executedSteps.push("double");
            return input * 2;
          },
        )
        .build();

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      await runPromise;

      expect(executedSteps).toEqual(["add", "double"]);
    });
  });

  describe("validation steps", () => {
    it("adds validation-only steps", async () => {
      const workflow = createWorkflow<number, number, unknown>("test")
        .addStep("double", "Double", async (input: number) => input * 2)
        .addValidation("check", "Check Result", (data: number) =>
          data > 0 ? true : "Result must be positive",
        )
        .build();

      const runner = new WorkflowRunner(workflow);

      // Valid case
      const validPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const validResult = await validPromise;
      expect(validResult.status).toBe("completed");

      // Invalid case (negative input results in negative output)
      const invalidPromise = runner.run(-5);
      await vi.runAllTimersAsync();
      const invalidResult = await invalidPromise;
      expect(invalidResult.status).toBe("failed");
      expect(invalidResult.error).toContain("Result must be positive");
    });
  });
});

describe("Pre-built Workflow Patterns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createPlanBuildWorkflow", () => {
    it("executes plan then build", async () => {
      const executedPhases: string[] = [];

      const workflow = createPlanBuildWorkflow<
        { task: string },
        { steps: string[] },
        { output: string },
        unknown
      >("plan-build", {
        plan: async (input) => {
          executedPhases.push("plan");
          return { steps: [`Plan for: ${input.task}`] };
        },
        build: async (plan) => {
          executedPhases.push("build");
          return { output: plan.steps.join(", ") };
        },
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ task: "test task" });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executedPhases).toEqual(["plan", "build"]);
    });

    it("validates plan before build", async () => {
      const workflow = createPlanBuildWorkflow<
        { task: string },
        { steps: string[] },
        { output: string },
        unknown
      >("plan-build", {
        plan: async () => ({ steps: [] }),
        build: async (plan) => ({ output: plan.steps.join(", ") }),
        validatePlan: (plan) => (plan.steps.length > 0 ? true : "Plan must have steps"),
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ task: "test" });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Plan must have steps");
    });
  });

  describe("createReviewDocumentWorkflow", () => {
    it("executes review then document", async () => {
      const executedPhases: string[] = [];

      const workflow = createReviewDocumentWorkflow<
        { code: string },
        { issues: string[] },
        { report: string },
        unknown
      >("review-doc", {
        review: async (input) => {
          executedPhases.push("review");
          return { issues: [`Reviewed: ${input.code}`] };
        },
        document: async (review) => {
          executedPhases.push("document");
          return { report: review.issues.join("\n") };
        },
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ code: "function test() {}" });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executedPhases).toEqual(["review", "document"]);
    });
  });

  describe("createScoutPlanBuildWorkflow", () => {
    it("executes scout, plan, then build", async () => {
      const executedPhases: string[] = [];

      const workflow = createScoutPlanBuildWorkflow<
        { feature: string },
        { findings: string[] },
        { plan: string },
        { result: string },
        unknown
      >("scout-plan-build", {
        scout: async (input) => {
          executedPhases.push("scout");
          return { findings: [`Found: ${input.feature}`] };
        },
        plan: async (scout) => {
          executedPhases.push("plan");
          return { plan: scout.findings.join(", ") };
        },
        build: async (plan) => {
          executedPhases.push("build");
          return { result: plan.plan };
        },
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ feature: "new feature" });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executedPhases).toEqual(["scout", "plan", "build"]);
    });
  });

  describe("createIterationWorkflow", () => {
    it("generates iterations, executes, and selects best", async () => {
      const workflow = createIterationWorkflow<
        { value: number },
        { score: number; approach: string },
        { winner: string },
        unknown
      >("iteration", {
        generateIterations: async (input) => [
          { value: input.value * 1 },
          { value: input.value * 2 },
          { value: input.value * 3 },
        ],
        executeIteration: async (input) => ({
          score: input.value,
          approach: `approach-${input.value}`,
        }),
        selectBest: async (iterations) => {
          const best = iterations.reduce((a, b) => (a.score > b.score ? a : b));
          return { winner: best.approach };
        },
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ value: 10 });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      const selectResult = result.stepResults.get("select");
      expect(selectResult?.status).toBe("success");
      if (selectResult?.status === "success") {
        expect((selectResult.data as { winner: string }).winner).toBe("approach-30");
      }
    });
  });

  describe("createBuildTestFixWorkflow", () => {
    it("executes build, test, and conditionally fix", async () => {
      const executedPhases: string[] = [];

      const workflow = createBuildTestFixWorkflow<
        { code: string },
        { compiled: string },
        { passed: boolean; errors: string[] },
        { fixed: string },
        { testResult?: { passed: boolean; errors: string[] } }
      >("build-test-fix", {
        build: async (input) => {
          executedPhases.push("build");
          return { compiled: input.code };
        },
        test: async (_build) => {
          executedPhases.push("test");
          return { passed: true, errors: [] };
        },
        fix: async () => {
          executedPhases.push("fix");
          return { fixed: "fixed code" };
        },
        shouldFix: (test) => !test.passed,
        initContext: () => ({}),
      });

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ code: "good code" });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      // Fix should not be called since tests passed
      expect(executedPhases).toEqual(["build", "test"]);
    });
  });
});
