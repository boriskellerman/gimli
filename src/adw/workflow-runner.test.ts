import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WorkflowRunner, runWorkflow } from "./workflow-runner.js";
import type { WorkflowDefinition, WorkflowEvent } from "./types.js";

describe("WorkflowRunner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic execution", () => {
    it("executes a simple workflow with one step", async () => {
      const workflow: WorkflowDefinition<{ value: number }, { result: number }, unknown> = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Double the value",
            execute: async (input: { value: number }) => ({ result: input.value * 2 }),
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run({ value: 5 });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(result.stepLogs).toHaveLength(1);
      expect(result.stepLogs[0]?.status).toBe("completed");

      const stepResult = result.stepResults.get("step1");
      expect(stepResult?.status).toBe("success");
      if (stepResult?.status === "success") {
        expect(stepResult.data).toEqual({ result: 10 });
      }
    });

    it("executes multiple steps in sequence", async () => {
      const executionOrder: string[] = [];

      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "multi-step",
        name: "Multi Step Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => {
              executionOrder.push("step1");
              return input + 1;
            },
          },
          {
            id: "step2",
            name: "Step 2",
            execute: async (input: number) => {
              executionOrder.push("step2");
              return input * 2;
            },
          },
          {
            id: "step3",
            name: "Step 3",
            execute: async (input: number) => {
              executionOrder.push("step3");
              return input + 10;
            },
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executionOrder).toEqual(["step1", "step2", "step3"]);
      expect(result.stepLogs).toHaveLength(3);
    });

    it("passes output from one step to the next", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "chain",
        name: "Chain Workflow",
        steps: [
          {
            id: "add",
            name: "Add 10",
            execute: async (input: number) => input + 10,
          },
          {
            id: "multiply",
            name: "Multiply by 2",
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      const multiplyResult = result.stepResults.get("multiply");
      expect(multiplyResult?.status).toBe("success");
      if (multiplyResult?.status === "success") {
        // (5 + 10) * 2 = 30
        expect(multiplyResult.data).toBe(30);
      }
    });
  });

  describe("error handling", () => {
    it("stops on error when abortOnError is true (default)", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "error-workflow",
        name: "Error Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => input,
          },
          {
            id: "step2",
            name: "Step 2 (fails)",
            execute: async () => {
              throw new Error("Step 2 failed");
            },
          },
          {
            id: "step3",
            name: "Step 3",
            execute: async (input: number) => input,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("failed");
      expect(result.error).toContain("Step 2 failed");
      expect(result.stepLogs).toHaveLength(2);
      expect(result.stepLogs[1]?.status).toBe("failed");
    });

    it("continues on error when continueOnError is true", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "continue-workflow",
        name: "Continue Workflow",
        abortOnError: false,
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => input,
          },
          {
            id: "step2",
            name: "Step 2 (fails)",
            execute: async () => {
              throw new Error("Step 2 failed");
            },
            continueOnError: true,
          },
          {
            id: "step3",
            name: "Step 3",
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(result.stepLogs).toHaveLength(3);
      expect(result.stepLogs[1]?.status).toBe("failed");
      expect(result.stepLogs[2]?.status).toBe("completed");
    });
  });

  describe("retry logic", () => {
    it("retries failed steps", async () => {
      let attempts = 0;

      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "retry-workflow",
        name: "Retry Workflow",
        defaultRetry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          jitter: 0,
        },
        steps: [
          {
            id: "flaky",
            name: "Flaky Step",
            execute: async (input: number) => {
              attempts++;
              if (attempts < 3) {
                throw new Error("Flaky error");
              }
              return input;
            },
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(attempts).toBe(3);

      const stepResult = result.stepResults.get("flaky");
      expect(stepResult?.attempts).toBe(3);
    });

    it("fails after max retries", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "fail-workflow",
        name: "Fail Workflow",
        defaultRetry: {
          maxAttempts: 2,
          initialDelayMs: 100,
          jitter: 0,
        },
        steps: [
          {
            id: "always-fail",
            name: "Always Fail",
            execute: async () => {
              throw new Error("Always fails");
            },
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("failed");
      expect(result.stepLogs[0]?.attempts).toBe(2);
    });
  });

  describe("validation", () => {
    it("validates input before step execution", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "validate-input",
        name: "Validate Input",
        steps: [
          {
            id: "validated",
            name: "Validated Step",
            validate: (input: number) => (input > 0 ? true : "Input must be positive"),
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);

      // Valid input
      const validPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const validResult = await validPromise;
      expect(validResult.status).toBe("completed");

      // Invalid input
      const invalidPromise = runner.run(-5);
      await vi.runAllTimersAsync();
      const invalidResult = await invalidPromise;
      expect(invalidResult.status).toBe("failed");
      expect(invalidResult.error).toContain("Input must be positive");
    });

    it("validates output after step execution", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "validate-output",
        name: "Validate Output",
        steps: [
          {
            id: "validated",
            name: "Validated Step",
            execute: async (input: number) => input * 2,
            validateOutput: (output: number) => (output < 100 ? true : "Output too large"),
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);

      // Valid output
      const validPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const validResult = await validPromise;
      expect(validResult.status).toBe("completed");

      // Invalid output (60 * 2 = 120 > 100)
      const invalidPromise = runner.run(60);
      await vi.runAllTimersAsync();
      const invalidResult = await invalidPromise;
      expect(invalidResult.status).toBe("failed");
      expect(invalidResult.error).toContain("Output too large");
    });
  });

  describe("step skipping", () => {
    it("skips steps when shouldSkip returns true", async () => {
      const executedSteps: string[] = [];

      const workflow: WorkflowDefinition<{ skipStep2: boolean }, unknown, { skipStep2: boolean }> =
        {
          id: "skip-workflow",
          name: "Skip Workflow",
          initContext: (input) => input,
          steps: [
            {
              id: "step1",
              name: "Step 1",
              execute: async (input: unknown) => {
                executedSteps.push("step1");
                return input;
              },
            },
            {
              id: "step2",
              name: "Step 2",
              shouldSkip: (ctx) => ctx.skipStep2,
              execute: async (input: unknown) => {
                executedSteps.push("step2");
                return input;
              },
            },
            {
              id: "step3",
              name: "Step 3",
              execute: async (input: unknown) => {
                executedSteps.push("step3");
                return input;
              },
            },
          ],
        };

      const runner = new WorkflowRunner(workflow);

      const runPromise = runner.run({ skipStep2: true });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      expect(executedSteps).toEqual(["step1", "step3"]);
      expect(result.stepLogs[1]?.status).toBe("skipped");
    });
  });

  describe("events", () => {
    it("emits workflow and step events", async () => {
      const events: WorkflowEvent[] = [];

      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "event-workflow",
        name: "Event Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      runner.addEventListener((event) => events.push(event));

      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      await runPromise;

      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("workflow:start");
      expect(eventTypes).toContain("step:start");
      expect(eventTypes).toContain("step:complete");
      expect(eventTypes).toContain("workflow:complete");
    });

    it("emits retry events", async () => {
      let attempts = 0;
      const events: WorkflowEvent[] = [];

      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "retry-events",
        name: "Retry Events",
        defaultRetry: {
          maxAttempts: 3,
          initialDelayMs: 100,
          jitter: 0,
        },
        steps: [
          {
            id: "flaky",
            name: "Flaky",
            execute: async () => {
              attempts++;
              if (attempts < 2) {
                throw new Error("Flaky");
              }
              return "done";
            },
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      runner.addEventListener((event) => events.push(event));

      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      await runPromise;

      const retryEvents = events.filter((e) => e.type === "step:retry");
      expect(retryEvents).toHaveLength(1);
      expect(retryEvents[0]?.attempt).toBe(1);
    });
  });

  describe("context", () => {
    it("initializes context from input", async () => {
      type Context = { multiplier: number };

      const workflow: WorkflowDefinition<number, number, Context> = {
        id: "context-workflow",
        name: "Context Workflow",
        initContext: (input) => ({ multiplier: input }),
        steps: [
          {
            id: "use-context",
            name: "Use Context",
            execute: async (input: number, ctx: Context) => input * ctx.multiplier,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      const stepResult = result.stepResults.get("use-context");
      expect(stepResult?.status).toBe("success");
      if (stepResult?.status === "success") {
        // 5 * 5 = 25
        expect(stepResult.data).toBe(25);
      }
    });
  });

  describe("abort signal", () => {
    it("aborts workflow when signal is triggered", async () => {
      const controller = new AbortController();

      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "abort-workflow",
        name: "Abort Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => {
              controller.abort();
              return input;
            },
          },
          {
            id: "step2",
            name: "Step 2",
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5, { abortSignal: controller.signal });
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("aborted");
      expect(result.stepLogs).toHaveLength(1);
    });
  });

  describe("runWorkflow helper", () => {
    it("creates and runs a workflow in one call", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "helper-workflow",
        name: "Helper Workflow",
        steps: [
          {
            id: "double",
            name: "Double",
            execute: async (input: number) => input * 2,
          },
        ],
      };

      const runPromise = runWorkflow(workflow, 5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.status).toBe("completed");
      const stepResult = result.stepResults.get("double");
      expect(stepResult?.status).toBe("success");
      if (stepResult?.status === "success") {
        expect(stepResult.data).toBe(10);
      }
    });
  });

  describe("timing", () => {
    it("tracks duration for workflow and steps", async () => {
      const workflow: WorkflowDefinition<number, number, unknown> = {
        id: "timing-workflow",
        name: "Timing Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input: number) => input,
          },
        ],
      };

      const runner = new WorkflowRunner(workflow);
      const runPromise = runner.run(5);
      await vi.runAllTimersAsync();
      const result = await runPromise;

      expect(result.durationMs).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.stepLogs[0]?.durationMs).toBeDefined();
    });
  });
});
