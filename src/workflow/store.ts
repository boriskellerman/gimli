/**
 * Workflow store for persisting workflow state.
 * Uses JSON file storage in the Gimli data directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  WorkflowCreateOptions,
  WorkflowListOptions,
  WorkflowStage,
  WorkflowState,
  WorkflowStep,
  WorkflowSummary,
} from "./types.js";
import { generateStepId, generateWorkflowId, WORKFLOW_STAGES } from "./types.js";

export type WorkflowStore = {
  create: (options: WorkflowCreateOptions) => WorkflowState;
  get: (id: string) => WorkflowState | null;
  list: (options?: WorkflowListOptions) => WorkflowState[];
  update: (id: string, updates: Partial<WorkflowState>) => WorkflowState | null;
  delete: (id: string) => boolean;
  addStep: (workflowId: string, stage: WorkflowStage, description: string) => WorkflowStep | null;
  updateStep: (workflowId: string, stepId: string, updates: Partial<WorkflowStep>) => boolean;
  advanceStage: (workflowId: string) => WorkflowState | null;
  getSummary: (id: string) => WorkflowSummary | null;
  close: () => void;
};

type StoreData = {
  workflows: WorkflowState[];
  version: number;
};

const STORE_VERSION = 1;

function getDefaultStorePath(): string {
  return join(homedir(), ".gimli", "workflows.json");
}

function ensureDirectory(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadStore(path: string): StoreData {
  if (!existsSync(path)) {
    return { workflows: [], version: STORE_VERSION };
  }
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as StoreData;
  // Rehydrate dates from JSON
  for (const workflow of data.workflows) {
    workflow.createdAt = new Date(workflow.createdAt);
    workflow.updatedAt = new Date(workflow.updatedAt);
    if (workflow.completedAt) workflow.completedAt = new Date(workflow.completedAt);
    for (const step of workflow.steps) {
      step.createdAt = new Date(step.createdAt);
      if (step.startedAt) step.startedAt = new Date(step.startedAt);
      if (step.completedAt) step.completedAt = new Date(step.completedAt);
    }
  }
  return data;
}

function saveStore(path: string, data: StoreData): void {
  ensureDirectory(path);
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

export function createWorkflowStore(storePath?: string): WorkflowStore {
  const path = storePath ?? getDefaultStorePath();
  let data = loadStore(path);

  const save = () => saveStore(path, data);

  const create = (options: WorkflowCreateOptions): WorkflowState => {
    const now = new Date();
    const workflow: WorkflowState = {
      id: generateWorkflowId(),
      name: options.name,
      description: options.description,
      currentStage: "plan",
      steps:
        options.steps?.map((s) => ({
          id: generateStepId(),
          stage: s.stage,
          description: s.description,
          status: "pending",
          createdAt: now,
        })) ?? [],
      createdAt: now,
      updatedAt: now,
      status: "active",
    };
    data.workflows.push(workflow);
    save();
    return workflow;
  };

  const get = (id: string): WorkflowState | null => {
    return data.workflows.find((w) => w.id === id || w.id.startsWith(id)) ?? null;
  };

  const list = (options?: WorkflowListOptions): WorkflowState[] => {
    let results = [...data.workflows];

    if (options?.status) {
      results = results.filter((w) => w.status === options.status);
    }
    if (options?.stage) {
      results = results.filter((w) => w.currentStage === options.stage);
    }

    // Sort by most recently updated
    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (options?.limit && options.limit > 0) {
      results = results.slice(0, options.limit);
    }

    return results;
  };

  const update = (id: string, updates: Partial<WorkflowState>): WorkflowState | null => {
    const workflow = get(id);
    if (!workflow) return null;

    const index = data.workflows.findIndex((w) => w.id === workflow.id);
    if (index === -1) return null;

    const updated: WorkflowState = {
      ...workflow,
      ...updates,
      id: workflow.id, // Prevent ID change
      createdAt: workflow.createdAt, // Prevent createdAt change
      updatedAt: new Date(),
    };
    data.workflows[index] = updated;
    save();
    return updated;
  };

  const deleteWorkflow = (id: string): boolean => {
    const workflow = get(id);
    if (!workflow) return false;

    const index = data.workflows.findIndex((w) => w.id === workflow.id);
    if (index === -1) return false;

    data.workflows.splice(index, 1);
    save();
    return true;
  };

  const addStep = (
    workflowId: string,
    stage: WorkflowStage,
    description: string,
  ): WorkflowStep | null => {
    const workflow = get(workflowId);
    if (!workflow) return null;

    const step: WorkflowStep = {
      id: generateStepId(),
      stage,
      description,
      status: "pending",
      createdAt: new Date(),
    };

    workflow.steps.push(step);
    workflow.updatedAt = new Date();
    save();
    return step;
  };

  const updateStep = (
    workflowId: string,
    stepId: string,
    updates: Partial<WorkflowStep>,
  ): boolean => {
    const workflow = get(workflowId);
    if (!workflow) return false;

    const step = workflow.steps.find((s) => s.id === stepId || s.id.startsWith(stepId));
    if (!step) return false;

    Object.assign(step, updates, { id: step.id }); // Prevent ID change
    workflow.updatedAt = new Date();
    save();
    return true;
  };

  const advanceStage = (workflowId: string): WorkflowState | null => {
    const workflow = get(workflowId);
    if (!workflow) return null;

    const currentIndex = WORKFLOW_STAGES.indexOf(workflow.currentStage);
    if (currentIndex === -1 || currentIndex >= WORKFLOW_STAGES.length - 1) {
      // Already at final stage, mark as completed
      workflow.status = "completed";
      workflow.completedAt = new Date();
      workflow.updatedAt = new Date();
      save();
      return workflow;
    }

    const nextStage = WORKFLOW_STAGES[currentIndex + 1];
    if (!nextStage) return null;

    workflow.currentStage = nextStage;
    workflow.updatedAt = new Date();
    save();
    return workflow;
  };

  const getSummary = (id: string): WorkflowSummary | null => {
    const workflow = get(id);
    if (!workflow) return null;

    const completedSteps = workflow.steps.filter((s) => s.status === "completed").length;
    const totalSteps = workflow.steps.length || WORKFLOW_STAGES.length;

    return {
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      currentStage: workflow.currentStage,
      progress: {
        completed: completedSteps,
        total: totalSteps,
        percentage: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      },
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    };
  };

  const close = () => {
    save();
  };

  return {
    create,
    get,
    list,
    update,
    delete: deleteWorkflow,
    addStep,
    updateStep,
    advanceStage,
    getSummary,
    close,
  };
}
