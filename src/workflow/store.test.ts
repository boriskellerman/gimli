import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkflowStore, type WorkflowStore } from "./store.js";

describe("workflow store", () => {
  let store: WorkflowStore;
  let testDir: string;
  let storePath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `gimli-workflow-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    storePath = join(testDir, "workflows.json");
    store = createWorkflowStore(storePath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("create", () => {
    it("creates a new workflow with required fields", () => {
      const workflow = store.create({
        name: "Test workflow",
        description: "A test workflow",
      });

      expect(workflow.id).toMatch(/^wf-/);
      expect(workflow.name).toBe("Test workflow");
      expect(workflow.description).toBe("A test workflow");
      expect(workflow.currentStage).toBe("plan");
      expect(workflow.status).toBe("active");
      expect(workflow.steps).toEqual([]);
      expect(workflow.createdAt).toBeInstanceOf(Date);
      expect(workflow.updatedAt).toBeInstanceOf(Date);
    });

    it("creates workflow with initial steps", () => {
      const workflow = store.create({
        name: "With steps",
        description: "Has steps",
        steps: [
          { stage: "plan", description: "Define requirements" },
          { stage: "build", description: "Implement feature" },
        ],
      });

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0]?.stage).toBe("plan");
      expect(workflow.steps[0]?.description).toBe("Define requirements");
      expect(workflow.steps[1]?.stage).toBe("build");
    });

    it("persists workflow to disk", () => {
      store.create({ name: "Persisted", description: "Should persist" });
      store.close();

      const reloadedStore = createWorkflowStore(storePath);
      const workflows = reloadedStore.list();
      expect(workflows).toHaveLength(1);
      expect(workflows[0]?.name).toBe("Persisted");
      reloadedStore.close();
    });
  });

  describe("get", () => {
    it("returns workflow by full ID", () => {
      const created = store.create({ name: "Find me", description: "" });
      const found = store.get(created.id);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("returns workflow by partial ID prefix", () => {
      const created = store.create({ name: "Partial match", description: "" });
      const partialId = created.id.slice(0, 8);
      const found = store.get(partialId);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
    });

    it("returns null for non-existent ID", () => {
      const found = store.get("non-existent");
      expect(found).toBeNull();
    });
  });

  describe("list", () => {
    it("returns empty array when no workflows", () => {
      const workflows = store.list();
      expect(workflows).toEqual([]);
    });

    it("returns all workflows", () => {
      store.create({ name: "First", description: "" });
      store.create({ name: "Second", description: "" });
      store.create({ name: "Third", description: "" });

      const workflows = store.list();
      expect(workflows).toHaveLength(3);
    });

    it("filters by status", () => {
      store.create({ name: "Active", description: "" });
      const completedWorkflow = store.create({ name: "Completed", description: "" });
      store.update(completedWorkflow.id, { status: "completed" });

      const active = store.list({ status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe("Active");

      const completed = store.list({ status: "completed" });
      expect(completed).toHaveLength(1);
      expect(completed[0]?.name).toBe("Completed");
    });

    it("filters by stage", () => {
      store.create({ name: "Plan stage", description: "" });
      const buildWorkflow = store.create({ name: "Build stage", description: "" });
      store.advanceStage(buildWorkflow.id);

      const planStage = store.list({ stage: "plan" });
      expect(planStage).toHaveLength(1);
      expect(planStage[0]?.name).toBe("Plan stage");

      const buildStage = store.list({ stage: "build" });
      expect(buildStage).toHaveLength(1);
      expect(buildStage[0]?.name).toBe("Build stage");
    });

    it("applies limit", () => {
      store.create({ name: "First", description: "" });
      store.create({ name: "Second", description: "" });
      store.create({ name: "Third", description: "" });

      const limited = store.list({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it("sorts by most recently updated", () => {
      const firstWorkflow = store.create({ name: "First", description: "" });
      store.create({ name: "Second", description: "" });

      // Update firstWorkflow to make it most recent
      store.update(firstWorkflow.id, { description: "Updated" });

      const workflows = store.list();
      expect(workflows[0]?.name).toBe("First");
    });
  });

  describe("update", () => {
    it("updates workflow fields", () => {
      const created = store.create({ name: "Original", description: "Old desc" });
      const updated = store.update(created.id, {
        name: "Updated",
        description: "New desc",
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe("Updated");
      expect(updated?.description).toBe("New desc");
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it("preserves ID and createdAt", () => {
      const created = store.create({ name: "Test", description: "" });
      const originalId = created.id;
      const originalCreatedAt = created.createdAt;

      // Attempt to change ID (should be ignored)
      const updated = store.update(created.id, {
        id: "fake-id" as unknown as undefined,
        name: "Changed",
      });

      expect(updated?.id).toBe(originalId);
      expect(updated?.createdAt.getTime()).toBe(originalCreatedAt.getTime());
    });

    it("returns null for non-existent workflow", () => {
      const result = store.update("non-existent", { name: "New name" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes existing workflow", () => {
      const created = store.create({ name: "To delete", description: "" });
      const deleted = store.delete(created.id);

      expect(deleted).toBe(true);
      expect(store.get(created.id)).toBeNull();
    });

    it("returns false for non-existent workflow", () => {
      const deleted = store.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("addStep", () => {
    it("adds step to workflow", () => {
      const workflow = store.create({ name: "With step", description: "" });
      const step = store.addStep(workflow.id, "plan", "Define requirements");

      expect(step).not.toBeNull();
      expect(step?.id).toMatch(/^step-/);
      expect(step?.stage).toBe("plan");
      expect(step?.description).toBe("Define requirements");
      expect(step?.status).toBe("pending");

      const updated = store.get(workflow.id);
      expect(updated?.steps).toHaveLength(1);
    });

    it("returns null for non-existent workflow", () => {
      const step = store.addStep("non-existent", "plan", "Description");
      expect(step).toBeNull();
    });
  });

  describe("updateStep", () => {
    it("updates step fields", () => {
      const workflow = store.create({ name: "Test", description: "" });
      const step = store.addStep(workflow.id, "plan", "Original");

      const updated = store.updateStep(workflow.id, step!.id, {
        status: "completed",
        completedAt: new Date(),
      });

      expect(updated).toBe(true);

      const reloaded = store.get(workflow.id);
      const updatedStep = reloaded?.steps.find((s) => s.id === step!.id);
      expect(updatedStep?.status).toBe("completed");
      expect(updatedStep?.completedAt).toBeInstanceOf(Date);
    });

    it("returns false for non-existent workflow", () => {
      const result = store.updateStep("non-existent", "step-id", { status: "completed" });
      expect(result).toBe(false);
    });

    it("returns false for non-existent step", () => {
      const workflow = store.create({ name: "Test", description: "" });
      const result = store.updateStep(workflow.id, "non-existent", { status: "completed" });
      expect(result).toBe(false);
    });
  });

  describe("advanceStage", () => {
    it("advances from plan to build", () => {
      const workflow = store.create({ name: "Test", description: "" });
      expect(workflow.currentStage).toBe("plan");

      const advanced = store.advanceStage(workflow.id);
      expect(advanced?.currentStage).toBe("build");
    });

    it("advances through all stages", () => {
      const workflow = store.create({ name: "Test", description: "" });

      let current = workflow;
      const stages = ["build", "test", "review", "document"];

      for (const expectedStage of stages) {
        const advanced = store.advanceStage(current.id);
        expect(advanced?.currentStage).toBe(expectedStage);
        current = advanced!;
      }
    });

    it("marks workflow as completed when advancing from final stage", () => {
      const workflow = store.create({ name: "Test", description: "" });

      // Advance to document stage
      store.advanceStage(workflow.id);
      store.advanceStage(workflow.id);
      store.advanceStage(workflow.id);
      store.advanceStage(workflow.id);

      // Advance from document (final) stage
      const completed = store.advanceStage(workflow.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });

    it("returns null for non-existent workflow", () => {
      const result = store.advanceStage("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("getSummary", () => {
    it("returns summary for workflow", () => {
      const workflow = store.create({ name: "Test", description: "" });
      store.addStep(workflow.id, "plan", "Step 1");
      store.addStep(workflow.id, "plan", "Step 2");

      const summary = store.getSummary(workflow.id);

      expect(summary).not.toBeNull();
      expect(summary?.id).toBe(workflow.id);
      expect(summary?.name).toBe("Test");
      expect(summary?.status).toBe("active");
      expect(summary?.currentStage).toBe("plan");
      expect(summary?.progress.total).toBe(2);
      expect(summary?.progress.completed).toBe(0);
      expect(summary?.progress.percentage).toBe(0);
    });

    it("calculates progress correctly", () => {
      const workflow = store.create({ name: "Test", description: "" });
      const step1 = store.addStep(workflow.id, "plan", "Step 1");
      store.addStep(workflow.id, "plan", "Step 2");

      store.updateStep(workflow.id, step1!.id, { status: "completed" });

      const summary = store.getSummary(workflow.id);
      expect(summary?.progress.completed).toBe(1);
      expect(summary?.progress.total).toBe(2);
      expect(summary?.progress.percentage).toBe(50);
    });

    it("returns null for non-existent workflow", () => {
      const summary = store.getSummary("non-existent");
      expect(summary).toBeNull();
    });
  });

  describe("persistence", () => {
    it("rehydrates dates correctly", () => {
      const workflow = store.create({ name: "Date test", description: "" });
      store.addStep(workflow.id, "plan", "Step with dates");
      store.close();

      const reloadedStore = createWorkflowStore(storePath);
      const reloaded = reloadedStore.get(workflow.id);

      expect(reloaded?.createdAt).toBeInstanceOf(Date);
      expect(reloaded?.updatedAt).toBeInstanceOf(Date);
      expect(reloaded?.steps[0]?.createdAt).toBeInstanceOf(Date);

      reloadedStore.close();
    });
  });
});
