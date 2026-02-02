import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runADWWorkflow, createWorkflow, ADWWorkflowBuilder } from "./runner.js";
import type { ADWWorkflowDefinition } from "./types.js";

describe("runADWWorkflow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes a simple workflow", async () => {
    const workflow: ADWWorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step1",
          name: "Step 1",
          execute: async () => "result1",
        },
      ],
    };

    const result = await runADWWorkflow(workflow);

    expect(result.status).toBe("success");
    expect(result.outputs.get("step1")).toBe("result1");
    expect(result.log.steps.length).toBe(1);
    expect(result.log.steps[0].status).toBe("success");
  });

  it("executes multiple steps in sequence", async () => {
    const executionOrder: string[] = [];

    const workflow: ADWWorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step1",
          name: "Step 1",
          execute: async () => {
            executionOrder.push("step1");
            return "result1";
          },
        },
        {
          id: "step2",
          name: "Step 2",
          execute: async () => {
            executionOrder.push("step2");
            return "result2";
          },
        },
      ],
    };

    const result = await runADWWorkflow(workflow);

    expect(result.status).toBe("success");
    expect(executionOrder).toEqual(["step1", "step2"]);
    expect(result.outputs.get("step1")).toBe("result1");
    expect(result.outputs.get("step2")).toBe("result2");
  });

  it("handles step failure", async () => {
    const workflow: ADWWorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step1",
          name: "Step 1",
          execute: async () => {
            throw new Error("Step failed");
          },
        },
      ],
      defaultRetry: { maxAttempts: 1 },
    };

    const result = await runADWWorkflow(workflow);

    expect(result.status).toBe("failed");
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].stepId).toBe("step1");
    expect(result.errors[0].error).toBe("Step failed");
  });

  it("continues on failure when configured", async () => {
    const workflow: ADWWorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step1",
          name: "Step 1",
          execute: async () => {
            throw new Error("Step failed");
          },
          continueOnFailure: true,
        },
        {
          id: "step2",
          name: "Step 2",
          execute: async () => "result2",
        },
      ],
      defaultRetry: { maxAttempts: 1 },
    };

    const result = await runADWWorkflow(workflow);

    expect(result.status).toBe("failed"); // Overall workflow failed
    expect(result.errors.length).toBe(1);
    expect(result.outputs.get("step2")).toBe("result2"); // But step2 ran
  });

  it("stops on failure when not configured to continue", async () => {
    const step2Execute = vi.fn();

    const workflow: ADWWorkflowDefinition = {
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step1",
          name: "Step 1",
          execute: async () => {
            throw new Error("Step failed");
          },
        },
        {
          id: "step2",
          name: "Step 2",
          execute: step2Execute,
        },
      ],
      defaultRetry: { maxAttempts: 1 },
    };

    await runADWWorkflow(workflow);

    expect(step2Execute).not.toHaveBeenCalled();
  });

  describe("retries", () => {
    it("retries failed steps", async () => {
      let attempts = 0;

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              attempts++;
              if (attempts < 2) {
                throw new Error("Transient error");
              }
              return "success";
            },
          },
        ],
        defaultRetry: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
      };

      const resultPromise = runADWWorkflow(workflow);

      // First attempt fails
      await vi.advanceTimersByTimeAsync(0);
      // Wait for retry delay
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result.status).toBe("success");
      expect(attempts).toBe(2);
    });

    it("uses step-specific retry config", async () => {
      let attempts = 0;

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              attempts++;
              throw new Error("Always fails");
            },
            retry: { maxAttempts: 2 },
          },
        ],
        defaultRetry: { maxAttempts: 5, initialDelayMs: 100, jitterFactor: 0 },
      };

      const resultPromise = runADWWorkflow(workflow);

      // First attempt
      await vi.advanceTimersByTimeAsync(0);
      // Retry
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result.status).toBe("failed");
      expect(attempts).toBe(2); // Not 5, uses step config
    });
  });

  describe("validation", () => {
    it("validates step output", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => ({ name: "test" }),
            validation: {
              required: true,
              validator: (output) => {
                const obj = output as { name?: string };
                if (!obj.name) {
                  return { valid: false, errors: ["Missing name"] };
                }
                return { valid: true };
              },
            },
          },
        ],
        defaultRetry: { maxAttempts: 1 },
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("success");
    });

    it("fails on validation error", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => ({}),
            validation: {
              required: true,
              validator: () => ({ valid: false, errors: ["Invalid output"] }),
            },
          },
        ],
        defaultRetry: { maxAttempts: 1 },
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("failed");
      expect(result.errors[0].error).toContain("Invalid output");
    });

    it("retries on validation failure", async () => {
      let attempts = 0;

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              attempts++;
              return { valid: attempts >= 2 };
            },
            validation: {
              required: true,
              validator: (output) => {
                const obj = output as { valid: boolean };
                return {
                  valid: obj.valid,
                  errors: obj.valid ? undefined : ["Not valid yet"],
                };
              },
            },
          },
        ],
        defaultRetry: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
      };

      const resultPromise = runADWWorkflow(workflow);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result.status).toBe("success");
      expect(attempts).toBe(2);
    });
  });

  describe("dependencies", () => {
    it("respects step dependencies", async () => {
      const executionOrder: string[] = [];

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step2",
            name: "Step 2",
            dependsOn: ["step1"],
            execute: async () => {
              executionOrder.push("step2");
              return "result2";
            },
          },
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              executionOrder.push("step1");
              return "result1";
            },
          },
        ],
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("success");
      expect(executionOrder).toEqual(["step1", "step2"]);
    });

    it("skips steps with unmet dependencies", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              throw new Error("Failed");
            },
            continueOnFailure: true,
          },
          {
            id: "step2",
            name: "Step 2",
            dependsOn: ["step1"],
            execute: async () => "result2",
          },
        ],
        defaultRetry: { maxAttempts: 1 },
      };

      const result = await runADWWorkflow(workflow);

      expect(result.log.steps.find((s) => s.stepId === "step2")?.status).toBe("skipped");
    });
  });

  describe("conditions", () => {
    it("skips steps when condition returns false", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            condition: () => false,
            execute: async () => "should not run",
          },
        ],
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("success");
      expect(result.log.steps[0].status).toBe("skipped");
      expect(result.outputs.has("step1")).toBe(false);
    });

    it("runs steps when condition returns true", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            condition: () => true,
            execute: async () => "result",
          },
        ],
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("success");
      expect(result.outputs.get("step1")).toBe("result");
    });

    it("condition can access previous results", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => ({ shouldContinue: true }),
          },
          {
            id: "step2",
            name: "Step 2",
            condition: (ctx) => {
              const prev = ctx.previousResults.get("step1");
              return (prev?.output as { shouldContinue: boolean })?.shouldContinue ?? false;
            },
            execute: async () => "ran because of step1",
          },
        ],
      };

      const result = await runADWWorkflow(workflow);

      expect(result.status).toBe("success");
      expect(result.outputs.get("step2")).toBe("ran because of step1");
    });
  });

  describe("hooks", () => {
    it("calls onWorkflowStart hook", async () => {
      const onWorkflowStart = vi.fn();

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [{ id: "step1", name: "Step 1", execute: async () => "result" }],
        hooks: { onWorkflowStart },
      };

      await runADWWorkflow(workflow);

      expect(onWorkflowStart).toHaveBeenCalledTimes(1);
    });

    it("calls onWorkflowEnd hook", async () => {
      const onWorkflowEnd = vi.fn();

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [{ id: "step1", name: "Step 1", execute: async () => "result" }],
        hooks: { onWorkflowEnd },
      };

      await runADWWorkflow(workflow);

      expect(onWorkflowEnd).toHaveBeenCalledTimes(1);
      expect(onWorkflowEnd.mock.calls[0][0].status).toBe("success");
    });

    it("calls onStepStart and onStepEnd hooks", async () => {
      const onStepStart = vi.fn();
      const onStepEnd = vi.fn();

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [{ id: "step1", name: "Step 1", execute: async () => "result" }],
        hooks: { onStepStart, onStepEnd },
      };

      await runADWWorkflow(workflow);

      expect(onStepStart).toHaveBeenCalledTimes(1);
      expect(onStepEnd).toHaveBeenCalledTimes(1);
    });

    it("calls onRetry hook", async () => {
      const onRetry = vi.fn();
      let attempts = 0;

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              attempts++;
              if (attempts < 2) throw new Error("fail");
              return "success";
            },
          },
        ],
        defaultRetry: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
        hooks: { onRetry },
      };

      const resultPromise = runADWWorkflow(workflow);

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);

      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith("step1", 2, "fail");
    });
  });

  describe("abort signal", () => {
    it("cancels workflow on abort", async () => {
      const controller = new AbortController();

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async () => {
              controller.abort();
              return "result1";
            },
          },
          {
            id: "step2",
            name: "Step 2",
            execute: async () => "result2",
          },
        ],
      };

      const result = await runADWWorkflow(workflow, {}, { abortSignal: controller.signal });

      expect(result.status).toBe("cancelled");
    });
  });

  describe("context", () => {
    it("passes initial context to steps", async () => {
      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (input) => (input as { value: string }).value,
          },
        ],
      };

      const result = await runADWWorkflow(workflow, { value: "from context" });

      expect(result.outputs.get("step1")).toBe("from context");
    });

    it("provides step context to execute function", async () => {
      let receivedContext: unknown;

      const workflow: ADWWorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        steps: [
          {
            id: "step1",
            name: "Step 1",
            execute: async (_input, ctx) => {
              receivedContext = ctx;
              return "result";
            },
          },
        ],
      };

      await runADWWorkflow(workflow);

      expect(receivedContext).toBeDefined();
      const ctx = receivedContext as {
        workflowId: string;
        stepId: string;
        attempt: number;
      };
      expect(ctx.workflowId).toBeDefined();
      expect(ctx.stepId).toBe("step1");
      expect(ctx.attempt).toBe(1);
    });
  });
});

describe("ADWWorkflowBuilder", () => {
  it("builds a workflow", () => {
    const workflow = createWorkflow("test", "Test Workflow")
      .description("A test workflow")
      .timeout(60000)
      .defaultRetry({ maxAttempts: 5 })
      .step({
        id: "step1",
        name: "Step 1",
        execute: async () => "result",
      })
      .build();

    expect(workflow.id).toBe("test");
    expect(workflow.name).toBe("Test Workflow");
    expect(workflow.description).toBe("A test workflow");
    expect(workflow.timeoutMs).toBe(60000);
    expect(workflow.defaultRetry?.maxAttempts).toBe(5);
    expect(workflow.steps.length).toBe(1);
  });

  it("throws when building without id", () => {
    expect(() => new ADWWorkflowBuilder("", "Test").build()).toThrow(
      "Workflow must have id and name",
    );
  });

  it("throws when building without steps", () => {
    expect(() => createWorkflow("test", "Test Workflow").build()).toThrow(
      "Workflow must have at least one step",
    );
  });
});
