/**
 * Workflow endpoint for AI Developer Workflows (ADWs).
 *
 * ADWs are deterministic code wrappers around agent calls with:
 * - Multiple sequential steps
 * - Validation between steps
 * - Structured logging
 * - Result aggregation
 *
 * This implements the PETER framework's Execute phase with structured workflows.
 */

import type { HookMessageChannel } from "./hooks.js";

export type WorkflowStepConfig = {
  /** Step identifier */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Message/prompt for this step */
  message: string;
  /** Optional: override model for this step */
  model?: string;
  /** Optional: override thinking level for this step */
  thinking?: string;
  /** Optional: timeout for this step in seconds */
  timeoutSeconds?: number;
  /** Optional: condition to check before running (skips if false) */
  condition?: "always" | "previous-success" | "previous-error";
};

export type WorkflowConfig = {
  /** Workflow identifier */
  id: string;
  /** Human-readable workflow name */
  name: string;
  /** Session key for workflow runs */
  sessionKey?: string;
  /** Steps to execute in order */
  steps: WorkflowStepConfig[];
  /** Delivery configuration */
  deliver?: boolean;
  channel?: HookMessageChannel;
  to?: string;
  /** Global model override (can be overridden per-step) */
  model?: string;
  /** Global thinking level (can be overridden per-step) */
  thinking?: string;
  /** Whether to continue on step errors */
  continueOnError?: boolean;
};

export type WorkflowStepResult = {
  stepId: string;
  stepName: string;
  status: "ok" | "error" | "skipped";
  runId?: string;
  summary?: string;
  outputText?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
};

export type WorkflowResult = {
  workflowId: string;
  workflowName: string;
  status: "completed" | "error" | "partial";
  steps: WorkflowStepResult[];
  startedAt: number;
  completedAt: number;
  /** Summary of overall workflow */
  summary: string;
};

export type WorkflowRunMetadata = {
  workflowRunId: string;
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "completed" | "error";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  currentStep?: string;
  stepsCompleted: number;
  stepsTotal: number;
  result?: WorkflowResult;
};

const DEFAULT_WORKFLOW_TTL_MS = 3600 * 1000; // 1 hour
const DEFAULT_MAX_WORKFLOWS = 500;

/**
 * In-memory store for workflow run tracking.
 */
export class WorkflowRunStore {
  private workflows = new Map<string, WorkflowRunMetadata>();
  private readonly ttlMs: number;
  private readonly maxWorkflows: number;

  constructor(config?: { ttlMs?: number; maxWorkflows?: number }) {
    this.ttlMs = config?.ttlMs ?? DEFAULT_WORKFLOW_TTL_MS;
    this.maxWorkflows = config?.maxWorkflows ?? DEFAULT_MAX_WORKFLOWS;
  }

  createWorkflowRun(params: {
    workflowRunId: string;
    workflowId: string;
    workflowName: string;
    stepsTotal: number;
  }): WorkflowRunMetadata {
    this.evictExpired();
    this.evictOverflow();

    const metadata: WorkflowRunMetadata = {
      workflowRunId: params.workflowRunId,
      workflowId: params.workflowId,
      workflowName: params.workflowName,
      status: "pending",
      createdAt: Date.now(),
      stepsCompleted: 0,
      stepsTotal: params.stepsTotal,
    };

    this.workflows.set(params.workflowRunId, metadata);
    return metadata;
  }

  startWorkflowRun(workflowRunId: string): void {
    const workflow = this.workflows.get(workflowRunId);
    if (!workflow) return;

    workflow.status = "running";
    workflow.startedAt = Date.now();
  }

  updateWorkflowStep(workflowRunId: string, stepId: string, stepsCompleted: number): void {
    const workflow = this.workflows.get(workflowRunId);
    if (!workflow) return;

    workflow.currentStep = stepId;
    workflow.stepsCompleted = stepsCompleted;
  }

  completeWorkflowRun(workflowRunId: string, result: WorkflowResult): void {
    const workflow = this.workflows.get(workflowRunId);
    if (!workflow) return;

    workflow.status = result.status === "error" ? "error" : "completed";
    workflow.completedAt = Date.now();
    workflow.result = result;
    workflow.stepsCompleted = result.steps.filter((s) => s.status !== "skipped").length;
  }

  getWorkflowRun(workflowRunId: string): WorkflowRunMetadata | undefined {
    this.evictExpired();
    return this.workflows.get(workflowRunId);
  }

  listWorkflowRuns(opts?: {
    status?: WorkflowRunMetadata["status"];
    workflowId?: string;
    limit?: number;
    offset?: number;
  }): { workflows: WorkflowRunMetadata[]; total: number } {
    this.evictExpired();

    let filtered = Array.from(this.workflows.values());

    if (opts?.status) {
      filtered = filtered.filter((w) => w.status === opts.status);
    }
    if (opts?.workflowId) {
      filtered = filtered.filter((w) => w.workflowId === opts.workflowId);
    }

    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const total = filtered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    const workflows = filtered.slice(offset, offset + limit);

    return { workflows, total };
  }

  clear(): void {
    this.workflows.clear();
  }

  private evictExpired(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;

    for (const [id, workflow] of this.workflows) {
      if (workflow.createdAt < cutoff) {
        this.workflows.delete(id);
      }
    }
  }

  private evictOverflow(): void {
    if (this.workflows.size < this.maxWorkflows) return;

    const entries = Array.from(this.workflows.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );

    const toRemove = entries.length - this.maxWorkflows + 1;
    for (let i = 0; i < toRemove; i++) {
      this.workflows.delete(entries[i][0]);
    }
  }
}

let globalWorkflowStore: WorkflowRunStore | null = null;

export function getWorkflowRunStore(): WorkflowRunStore {
  if (!globalWorkflowStore) {
    globalWorkflowStore = new WorkflowRunStore();
  }
  return globalWorkflowStore;
}

export function resetWorkflowRunStore(): void {
  globalWorkflowStore = null;
}

/**
 * Validate a workflow configuration.
 */
export function validateWorkflowConfig(
  config: unknown,
): { ok: true; config: WorkflowConfig } | { ok: false; error: string } {
  if (!config || typeof config !== "object") {
    return { ok: false, error: "workflow config required" };
  }

  const cfg = config as Record<string, unknown>;

  if (typeof cfg.id !== "string" || !cfg.id.trim()) {
    return { ok: false, error: "workflow.id required" };
  }

  if (typeof cfg.name !== "string" || !cfg.name.trim()) {
    return { ok: false, error: "workflow.name required" };
  }

  if (!Array.isArray(cfg.steps) || cfg.steps.length === 0) {
    return { ok: false, error: "workflow.steps required (non-empty array)" };
  }

  const steps: WorkflowStepConfig[] = [];
  for (let i = 0; i < cfg.steps.length; i++) {
    const step = cfg.steps[i] as Record<string, unknown>;
    if (!step || typeof step !== "object") {
      return { ok: false, error: `workflow.steps[${i}] must be an object` };
    }

    if (typeof step.id !== "string" || !step.id.trim()) {
      return { ok: false, error: `workflow.steps[${i}].id required` };
    }

    if (typeof step.name !== "string" || !step.name.trim()) {
      return { ok: false, error: `workflow.steps[${i}].name required` };
    }

    if (typeof step.message !== "string" || !step.message.trim()) {
      return { ok: false, error: `workflow.steps[${i}].message required` };
    }

    const condition = step.condition;
    if (
      condition !== undefined &&
      condition !== "always" &&
      condition !== "previous-success" &&
      condition !== "previous-error"
    ) {
      return {
        ok: false,
        error: `workflow.steps[${i}].condition must be "always", "previous-success", or "previous-error"`,
      };
    }

    steps.push({
      id: (step.id as string).trim(),
      name: (step.name as string).trim(),
      message: (step.message as string).trim(),
      model: typeof step.model === "string" ? step.model.trim() : undefined,
      thinking: typeof step.thinking === "string" ? step.thinking.trim() : undefined,
      timeoutSeconds:
        typeof step.timeoutSeconds === "number" && step.timeoutSeconds > 0
          ? Math.floor(step.timeoutSeconds)
          : undefined,
      condition: (condition as WorkflowStepConfig["condition"]) ?? "always",
    });
  }

  const validatedConfig: WorkflowConfig = {
    id: (cfg.id as string).trim(),
    name: (cfg.name as string).trim(),
    sessionKey: typeof cfg.sessionKey === "string" ? cfg.sessionKey.trim() : undefined,
    steps,
    deliver: cfg.deliver === true,
    channel: typeof cfg.channel === "string" ? (cfg.channel as HookMessageChannel) : undefined,
    to: typeof cfg.to === "string" ? cfg.to.trim() : undefined,
    model: typeof cfg.model === "string" ? cfg.model.trim() : undefined,
    thinking: typeof cfg.thinking === "string" ? cfg.thinking.trim() : undefined,
    continueOnError: cfg.continueOnError === true,
  };

  return { ok: true, config: validatedConfig };
}
