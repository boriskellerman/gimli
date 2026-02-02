import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  getWorkflowRunStore,
  resetWorkflowRunStore,
  validateWorkflowConfig,
  WorkflowRunStore,
  type WorkflowResult,
} from "./hooks-workflow.js";

describe("validateWorkflowConfig", () => {
  test("validates a minimal workflow config", () => {
    const result = validateWorkflowConfig({
      id: "test-workflow",
      name: "Test Workflow",
      steps: [
        {
          id: "step-1",
          name: "Step 1",
          message: "Do something",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.id).toBe("test-workflow");
      expect(result.config.name).toBe("Test Workflow");
      expect(result.config.steps).toHaveLength(1);
      expect(result.config.steps[0].condition).toBe("always");
    }
  });

  test("validates a complete workflow config", () => {
    const result = validateWorkflowConfig({
      id: "full-workflow",
      name: "Full Workflow",
      sessionKey: "wf:test",
      deliver: true,
      channel: "discord",
      to: "channel-123",
      model: "anthropic/claude-3-5-sonnet",
      thinking: "high",
      continueOnError: true,
      steps: [
        {
          id: "step-1",
          name: "Plan",
          message: "Create a plan",
          model: "anthropic/claude-3-haiku",
          thinking: "low",
          timeoutSeconds: 60,
          condition: "always",
        },
        {
          id: "step-2",
          name: "Execute",
          message: "Execute the plan",
          condition: "previous-success",
        },
        {
          id: "step-3",
          name: "Error Handler",
          message: "Handle errors",
          condition: "previous-error",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sessionKey).toBe("wf:test");
      expect(result.config.deliver).toBe(true);
      expect(result.config.continueOnError).toBe(true);
      expect(result.config.steps[0].model).toBe("anthropic/claude-3-haiku");
      expect(result.config.steps[1].condition).toBe("previous-success");
      expect(result.config.steps[2].condition).toBe("previous-error");
    }
  });

  test("rejects missing id", () => {
    const result = validateWorkflowConfig({
      name: "Test",
      steps: [{ id: "s1", name: "Step", message: "Do" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("workflow.id required");
    }
  });

  test("rejects missing name", () => {
    const result = validateWorkflowConfig({
      id: "test",
      steps: [{ id: "s1", name: "Step", message: "Do" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("workflow.name required");
    }
  });

  test("rejects empty steps array", () => {
    const result = validateWorkflowConfig({
      id: "test",
      name: "Test",
      steps: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("workflow.steps required");
    }
  });

  test("rejects missing step.id", () => {
    const result = validateWorkflowConfig({
      id: "test",
      name: "Test",
      steps: [{ name: "Step", message: "Do" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("steps[0].id required");
    }
  });

  test("rejects missing step.message", () => {
    const result = validateWorkflowConfig({
      id: "test",
      name: "Test",
      steps: [{ id: "s1", name: "Step" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("steps[0].message required");
    }
  });

  test("rejects invalid step.condition", () => {
    const result = validateWorkflowConfig({
      id: "test",
      name: "Test",
      steps: [{ id: "s1", name: "Step", message: "Do", condition: "invalid" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('condition must be "always"');
    }
  });

  test("rejects null config", () => {
    const result = validateWorkflowConfig(null);
    expect(result.ok).toBe(false);
  });

  test("trims whitespace from string fields", () => {
    const result = validateWorkflowConfig({
      id: "  test  ",
      name: "  Test  ",
      steps: [
        {
          id: "  s1  ",
          name: "  Step  ",
          message: "  Do  ",
          model: "  model  ",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.id).toBe("test");
      expect(result.config.name).toBe("Test");
      expect(result.config.steps[0].id).toBe("s1");
      expect(result.config.steps[0].name).toBe("Step");
      expect(result.config.steps[0].message).toBe("Do");
      expect(result.config.steps[0].model).toBe("model");
    }
  });
});

describe("WorkflowRunStore", () => {
  let store: WorkflowRunStore;

  beforeEach(() => {
    store = new WorkflowRunStore();
  });

  test("createWorkflowRun creates a pending workflow", () => {
    const workflow = store.createWorkflowRun({
      workflowRunId: "wf-run-1",
      workflowId: "test-workflow",
      workflowName: "Test Workflow",
      stepsTotal: 3,
    });

    expect(workflow.workflowRunId).toBe("wf-run-1");
    expect(workflow.workflowId).toBe("test-workflow");
    expect(workflow.workflowName).toBe("Test Workflow");
    expect(workflow.status).toBe("pending");
    expect(workflow.stepsTotal).toBe(3);
    expect(workflow.stepsCompleted).toBe(0);
  });

  test("startWorkflowRun updates status", () => {
    store.createWorkflowRun({
      workflowRunId: "wf-run-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    store.startWorkflowRun("wf-run-1");

    const workflow = store.getWorkflowRun("wf-run-1");
    expect(workflow?.status).toBe("running");
    expect(workflow?.startedAt).toBeGreaterThan(0);
  });

  test("updateWorkflowStep updates current step", () => {
    store.createWorkflowRun({
      workflowRunId: "wf-run-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 3,
    });

    store.updateWorkflowStep("wf-run-1", "step-2", 2);

    const workflow = store.getWorkflowRun("wf-run-1");
    expect(workflow?.currentStep).toBe("step-2");
    expect(workflow?.stepsCompleted).toBe(2);
  });

  test("completeWorkflowRun stores result", () => {
    store.createWorkflowRun({
      workflowRunId: "wf-run-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 2,
    });

    const result: WorkflowResult = {
      workflowId: "test",
      workflowName: "Test",
      status: "completed",
      steps: [
        {
          stepId: "s1",
          stepName: "Step 1",
          status: "ok",
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
        {
          stepId: "s2",
          stepName: "Step 2",
          status: "ok",
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
      ],
      startedAt: Date.now(),
      completedAt: Date.now(),
      summary: "2/2 completed",
    };

    store.completeWorkflowRun("wf-run-1", result);

    const workflow = store.getWorkflowRun("wf-run-1");
    expect(workflow?.status).toBe("completed");
    expect(workflow?.result).toEqual(result);
    expect(workflow?.completedAt).toBeGreaterThan(0);
  });

  test("listWorkflowRuns returns sorted workflows", () => {
    vi.useFakeTimers();

    vi.setSystemTime(1000);
    store.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    vi.setSystemTime(2000);
    store.createWorkflowRun({
      workflowRunId: "wf-2",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    const result = store.listWorkflowRuns();
    expect(result.total).toBe(2);
    expect(result.workflows[0].workflowRunId).toBe("wf-2");

    vi.useRealTimers();
  });

  test("listWorkflowRuns filters by workflowId", () => {
    store.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "workflow-a",
      workflowName: "A",
      stepsTotal: 1,
    });
    store.createWorkflowRun({
      workflowRunId: "wf-2",
      workflowId: "workflow-b",
      workflowName: "B",
      stepsTotal: 1,
    });

    const result = store.listWorkflowRuns({ workflowId: "workflow-a" });
    expect(result.total).toBe(1);
    expect(result.workflows[0].workflowId).toBe("workflow-a");
  });

  test("listWorkflowRuns filters by status", () => {
    store.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });
    store.createWorkflowRun({
      workflowRunId: "wf-2",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    store.startWorkflowRun("wf-1");

    const running = store.listWorkflowRuns({ status: "running" });
    expect(running.total).toBe(1);
    expect(running.workflows[0].workflowRunId).toBe("wf-1");

    const pending = store.listWorkflowRuns({ status: "pending" });
    expect(pending.total).toBe(1);
    expect(pending.workflows[0].workflowRunId).toBe("wf-2");
  });

  test("evicts expired workflows", () => {
    vi.useFakeTimers();
    const shortTtlStore = new WorkflowRunStore({ ttlMs: 1000 });

    shortTtlStore.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    vi.advanceTimersByTime(1500);

    expect(shortTtlStore.getWorkflowRun("wf-1")).toBeUndefined();

    vi.useRealTimers();
  });

  test("evicts oldest when max exceeded", () => {
    const smallStore = new WorkflowRunStore({ maxWorkflows: 2 });

    smallStore.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });
    smallStore.createWorkflowRun({
      workflowRunId: "wf-2",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });
    smallStore.createWorkflowRun({
      workflowRunId: "wf-3",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    expect(smallStore.getWorkflowRun("wf-1")).toBeUndefined();
    expect(smallStore.getWorkflowRun("wf-3")).toBeDefined();
  });
});

describe("global WorkflowRunStore singleton", () => {
  afterEach(() => {
    resetWorkflowRunStore();
  });

  test("getWorkflowRunStore returns same instance", () => {
    const store1 = getWorkflowRunStore();
    const store2 = getWorkflowRunStore();
    expect(store1).toBe(store2);
  });

  test("resetWorkflowRunStore creates new instance", () => {
    const store1 = getWorkflowRunStore();
    store1.createWorkflowRun({
      workflowRunId: "wf-1",
      workflowId: "test",
      workflowName: "Test",
      stepsTotal: 1,
    });

    resetWorkflowRunStore();

    const store2 = getWorkflowRunStore();
    expect(store2).not.toBe(store1);
    expect(store2.listWorkflowRuns().total).toBe(0);
  });
});
