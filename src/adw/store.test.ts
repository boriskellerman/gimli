import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { ADWStore, getADWStore, resetADWStore } from "./store.js";

// Mock the file system operations
vi.mock("../infra/json-file.js", () => ({
  loadJsonFile: vi.fn(() => null),
  saveJsonFile: vi.fn(),
}));

describe("ADW Store", () => {
  let store: ADWStore;

  beforeEach(() => {
    resetADWStore();
    store = new ADWStore();
  });

  afterEach(() => {
    resetADWStore();
    vi.clearAllMocks();
  });

  describe("createRun", () => {
    it("creates a new run with pending status", () => {
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Build a new feature",
      });

      expect(run.id).toBeDefined();
      expect(run.status).toBe("pending");
      expect(run.workflowType).toBe("plan-build");
      expect(run.trigger).toBe("manual");
      expect(run.task).toBe("Build a new feature");
      expect(run.createdAt).toBeGreaterThan(0);
      expect(run.steps).toEqual([]);
      expect(run.artifacts).toEqual([]);
    });

    it("includes optional parameters", () => {
      const run = store.createRun({
        workflowType: "test-fix",
        workflowName: "Custom Test Fix",
        trigger: "github-pr",
        triggerMeta: { prNumber: 123 },
        task: "Fix failing tests",
        taskId: "TASK-456",
        config: { timeoutSeconds: 600 },
        labels: ["urgent", "bugfix"],
      });

      expect(run.workflowName).toBe("Custom Test Fix");
      expect(run.triggerMeta).toEqual({ prNumber: 123 });
      expect(run.taskId).toBe("TASK-456");
      expect(run.config?.timeoutSeconds).toBe(600);
      expect(run.labels).toEqual(["urgent", "bugfix"]);
    });

    it("initializes usage with zeros", () => {
      const run = store.createRun({
        workflowType: "scout-research",
        trigger: "manual",
        task: "Research options",
      });

      expect(run.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        stepCount: 0,
        successfulSteps: 0,
        failedSteps: 0,
      });
    });
  });

  describe("getRun", () => {
    it("returns run by ID", () => {
      const created = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Test task",
      });

      const retrieved = store.getRun(created.id);
      expect(retrieved?.id).toBe(created.id);
    });

    it("returns undefined for unknown ID", () => {
      const retrieved = store.getRun("non-existent-id");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("run status management", () => {
    it("starts a run", () => {
      const run = store.createRun({
        workflowType: "test-fix",
        trigger: "manual",
        task: "Fix tests",
      });

      store.startRun(run.id);

      const updated = store.getRun(run.id);
      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBeGreaterThan(0);
    });

    it("completes a run", () => {
      const run = store.createRun({
        workflowType: "test-fix",
        trigger: "manual",
        task: "Fix tests",
      });

      store.startRun(run.id);
      store.completeRun(run.id, "All tests pass", { completeness: 1.0 });

      const updated = store.getRun(run.id);
      expect(updated?.status).toBe("completed");
      expect(updated?.output).toBe("All tests pass");
      expect(updated?.metrics?.completeness).toBe(1.0);
      expect(updated?.endedAt).toBeGreaterThan(0);
      expect(updated?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("fails a run", () => {
      const run = store.createRun({
        workflowType: "test-fix",
        trigger: "manual",
        task: "Fix tests",
      });

      store.startRun(run.id);
      store.failRun(run.id, "Connection timeout");

      const updated = store.getRun(run.id);
      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe("Connection timeout");
      expect(updated?.endedAt).toBeGreaterThan(0);
    });
  });

  describe("step management", () => {
    it("adds a step to a run", () => {
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Build feature",
      });

      const step = store.addStep(run.id, {
        id: "step-1",
        name: "Research",
        status: "pending",
      });

      expect(step.order).toBe(0);
      expect(step.name).toBe("Research");

      const updated = store.getRun(run.id);
      expect(updated?.steps.length).toBe(1);
    });

    it("throws when adding step to non-existent run", () => {
      expect(() =>
        store.addStep("non-existent", {
          id: "step-1",
          name: "Test",
          status: "pending",
        }),
      ).toThrow(/not found/);
    });

    it("starts and completes a step", () => {
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Build feature",
      });

      const step = store.addStep(run.id, {
        id: "step-1",
        name: "Research",
        status: "pending",
      });

      store.startStep(run.id, step.id);
      let updated = store.getRun(run.id);
      expect(updated?.steps[0].status).toBe("running");
      expect(updated?.steps[0].startedAt).toBeGreaterThan(0);

      store.completeStep(run.id, step.id, "Found relevant patterns", "text", {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      });

      updated = store.getRun(run.id);
      expect(updated?.steps[0].status).toBe("completed");
      expect(updated?.steps[0].output).toBe("Found relevant patterns");
      expect(updated?.steps[0].usage?.totalTokens).toBe(300);
    });

    it("fails a step", () => {
      const run = store.createRun({
        workflowType: "test-fix",
        trigger: "manual",
        task: "Fix tests",
      });

      const step = store.addStep(run.id, {
        id: "step-1",
        name: "Run Tests",
        status: "pending",
      });

      store.startStep(run.id, step.id);
      store.failStep(run.id, step.id, "Tests crashed");

      const updated = store.getRun(run.id);
      expect(updated?.steps[0].status).toBe("failed");
      expect(updated?.steps[0].error).toBe("Tests crashed");
    });
  });

  describe("artifact management", () => {
    it("adds an artifact to a run", () => {
      const run = store.createRun({
        workflowType: "review-document",
        trigger: "manual",
        task: "Generate docs",
      });

      const artifact = store.addArtifact(run.id, {
        id: "artifact-1",
        type: "file",
        name: "README.md",
        path: "/docs/README.md",
      });

      expect(artifact.createdAt).toBeGreaterThan(0);

      const updated = store.getRun(run.id);
      expect(updated?.artifacts.length).toBe(1);
      expect(updated?.artifacts[0].name).toBe("README.md");
    });
  });

  describe("queryRuns", () => {
    beforeEach(() => {
      // Create several runs for querying
      store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Task 1",
        labels: ["feature"],
      });

      const run2 = store.createRun({
        workflowType: "test-fix",
        trigger: "github-pr",
        task: "Task 2",
        taskId: "TASK-100",
      });
      store.completeRun(run2.id, "Done");

      store.createRun({
        workflowType: "plan-build",
        trigger: "orchestrator",
        task: "Task 3",
        labels: ["feature", "urgent"],
      });
    });

    it("filters by workflow type", () => {
      const results = store.queryRuns({ workflowType: "plan-build" });
      expect(results.every((r) => r.workflowType === "plan-build")).toBe(true);
    });

    it("filters by status", () => {
      const results = store.queryRuns({ status: "completed" });
      expect(results.every((r) => r.status === "completed")).toBe(true);
    });

    it("filters by multiple statuses", () => {
      const results = store.queryRuns({ status: ["pending", "completed"] });
      expect(results.every((r) => r.status === "pending" || r.status === "completed")).toBe(true);
    });

    it("filters by trigger", () => {
      const results = store.queryRuns({ trigger: "orchestrator" });
      expect(results.every((r) => r.trigger === "orchestrator")).toBe(true);
    });

    it("filters by taskId", () => {
      const results = store.queryRuns({ taskId: "TASK-100" });
      expect(results.length).toBe(1);
      expect(results[0].taskId).toBe("TASK-100");
    });

    it("filters by labels", () => {
      const results = store.queryRuns({ labels: ["urgent"] });
      expect(results.every((r) => r.labels?.includes("urgent"))).toBe(true);
    });

    it("applies pagination", () => {
      const all = store.queryRuns({});
      const paginated = store.queryRuns({ limit: 2, offset: 1 });

      expect(paginated.length).toBe(Math.min(2, all.length - 1));
    });

    it("sorts by creation time, newest first", () => {
      const results = store.queryRuns({});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].createdAt).toBeGreaterThanOrEqual(results[i].createdAt);
      }
    });
  });

  describe("getSummary", () => {
    it("returns summary statistics", () => {
      store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Task 1",
      });

      const run2 = store.createRun({
        workflowType: "test-fix",
        trigger: "github-pr",
        task: "Task 2",
      });
      store.completeRun(run2.id, "Done");

      const summary = store.getSummary();

      expect(summary.totalRuns).toBeGreaterThanOrEqual(2);
      expect(summary.byStatus.pending).toBeGreaterThanOrEqual(1);
      expect(summary.byStatus.completed).toBeGreaterThanOrEqual(1);
      expect(summary.byWorkflowType["plan-build"]).toBeGreaterThanOrEqual(1);
      expect(summary.byTrigger.manual).toBeGreaterThanOrEqual(1);
    });
  });

  describe("deleteRun", () => {
    it("deletes a run", () => {
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "To delete",
      });

      expect(store.getRun(run.id)).toBeDefined();

      const deleted = store.deleteRun(run.id);
      expect(deleted).toBe(true);
      expect(store.getRun(run.id)).toBeUndefined();
    });

    it("returns false for non-existent run", () => {
      const deleted = store.deleteRun("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("pruneOldRuns", () => {
    it("prunes runs older than max age", () => {
      // Create a run and manually set its createdAt to be old
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Old task",
      });

      // Complete it so it can be pruned
      store.completeRun(run.id, "Done");

      // Manually age the run
      const retrieved = store.getRun(run.id);
      if (retrieved) {
        (retrieved as { createdAt: number }).createdAt = Date.now() - 1000 * 60 * 60 * 24 * 10; // 10 days ago
      }

      const pruned = store.pruneOldRuns(1000 * 60 * 60 * 24 * 7); // 7 days
      expect(pruned).toBeGreaterThanOrEqual(1);
    });

    it("does not prune running runs", () => {
      const run = store.createRun({
        workflowType: "plan-build",
        trigger: "manual",
        task: "Running task",
      });
      store.startRun(run.id);

      // Manually age the run
      const retrieved = store.getRun(run.id);
      if (retrieved) {
        (retrieved as { createdAt: number }).createdAt = Date.now() - 1000 * 60 * 60 * 24 * 10;
      }

      const countBefore = store.count;
      store.pruneOldRuns(1000 * 60 * 60 * 24 * 7);
      expect(store.count).toBe(countBefore);
    });
  });

  describe("singleton", () => {
    it("getADWStore returns same instance", () => {
      resetADWStore();
      const store1 = getADWStore();
      const store2 = getADWStore();
      expect(store1).toBe(store2);
    });

    it("resetADWStore creates new instance", () => {
      const store1 = getADWStore();
      resetADWStore();
      const store2 = getADWStore();
      expect(store1).not.toBe(store2);
    });
  });
});
