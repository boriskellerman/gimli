/**
 * Workflow types for plan → build → test → review → document pipeline.
 * Enables structured, trackable development workflows.
 */

export type WorkflowStage = "plan" | "build" | "test" | "review" | "document";

export type WorkflowStepStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export type WorkflowStep = {
  id: string;
  stage: WorkflowStage;
  description: string;
  status: WorkflowStepStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  output?: string;
};

export type WorkflowState = {
  id: string;
  name: string;
  description: string;
  currentStage: WorkflowStage;
  steps: WorkflowStep[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  status: "active" | "completed" | "failed" | "paused";
};

export type WorkflowCreateOptions = {
  name: string;
  description: string;
  steps?: Array<{
    stage: WorkflowStage;
    description: string;
  }>;
};

export type WorkflowListOptions = {
  status?: WorkflowState["status"];
  stage?: WorkflowStage;
  limit?: number;
};

export type WorkflowCommandOpts = {
  subcommand?: string;
  name?: string;
  description?: string;
  id?: string;
  stage?: string;
  json?: boolean;
  verbose?: boolean;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  status: WorkflowState["status"];
  currentStage: WorkflowStage;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Stage order for workflow progression.
 * Workflows move through stages sequentially.
 */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  "plan",
  "build",
  "test",
  "review",
  "document",
] as const;

/**
 * Get the next stage in the workflow sequence.
 * Returns null if already at the final stage.
 */
export function getNextStage(current: WorkflowStage): WorkflowStage | null {
  const index = WORKFLOW_STAGES.indexOf(current);
  if (index === -1 || index >= WORKFLOW_STAGES.length - 1) return null;
  return WORKFLOW_STAGES[index + 1] ?? null;
}

/**
 * Get the previous stage in the workflow sequence.
 * Returns null if already at the first stage.
 */
export function getPreviousStage(current: WorkflowStage): WorkflowStage | null {
  const index = WORKFLOW_STAGES.indexOf(current);
  if (index <= 0) return null;
  return WORKFLOW_STAGES[index - 1] ?? null;
}

/**
 * Check if a stage value is valid.
 */
export function isValidStage(stage: string): stage is WorkflowStage {
  return WORKFLOW_STAGES.includes(stage as WorkflowStage);
}

/**
 * Generate a unique workflow ID.
 */
export function generateWorkflowId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `wf-${timestamp}-${random}`;
}

/**
 * Generate a unique step ID.
 */
export function generateStepId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `step-${timestamp}-${random}`;
}
