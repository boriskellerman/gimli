/**
 * ADW (AI Developer Workflow) Result Store
 *
 * Provides persistent storage for ADW execution results.
 * Follows the versioned JSON store pattern used by subagent-registry.
 */

import crypto from "node:crypto";
import path from "node:path";

import { STATE_DIR } from "../config/paths.js";
import { loadJsonFile, saveJsonFile } from "../infra/json-file.js";
import type {
  ADWArtifact,
  ADWRun,
  ADWRunFilter,
  ADWStatus,
  ADWStep,
  ADWSummary,
  ADWTrigger,
  ADWWorkflowType,
} from "./types.js";

// ============================================================================
// Persistence Types
// ============================================================================

export type PersistedADWStoreVersion = 1;

interface PersistedADWStoreV1 {
  version: 1;
  runs: Record<string, ADWRun>;
}

type PersistedADWStore = PersistedADWStoreV1;

const STORE_VERSION = 1 as const;

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Resolve the ADW store file path.
 */
export function resolveADWStorePath(): string {
  return path.join(STATE_DIR, "adw", "runs.json");
}

// ============================================================================
// Persistence Layer
// ============================================================================

/**
 * Load ADW runs from disk.
 */
export function loadADWStoreFromDisk(): Map<string, ADWRun> {
  const pathname = resolveADWStorePath();
  const raw = loadJsonFile(pathname);
  if (!raw || typeof raw !== "object") return new Map();

  const record = raw as Partial<PersistedADWStore>;
  if (record.version !== 1) return new Map();

  const runsRaw = record.runs;
  if (!runsRaw || typeof runsRaw !== "object") return new Map();

  const out = new Map<string, ADWRun>();
  for (const [runId, entry] of Object.entries(runsRaw)) {
    if (!entry || typeof entry !== "object") continue;
    const typed = entry as ADWRun;
    if (!typed.id || typeof typed.id !== "string") continue;
    out.set(runId, typed);
  }

  return out;
}

/**
 * Save ADW runs to disk.
 */
export function saveADWStoreToDisk(runs: Map<string, ADWRun>): void {
  const pathname = resolveADWStorePath();
  const serialized: Record<string, ADWRun> = {};
  for (const [runId, entry] of runs.entries()) {
    serialized[runId] = entry;
  }
  const out: PersistedADWStore = {
    version: STORE_VERSION,
    runs: serialized,
  };
  saveJsonFile(pathname, out);
}

// ============================================================================
// ADW Store Class
// ============================================================================

/**
 * ADW Result Store - manages persistent storage for ADW execution results.
 */
export class ADWStore {
  private runs: Map<string, ADWRun>;

  constructor() {
    this.runs = loadADWStoreFromDisk();
  }

  /**
   * Generate a unique run ID.
   */
  generateRunId(): string {
    return crypto.randomUUID();
  }

  /**
   * Create a new ADW run record.
   */
  createRun(params: {
    workflowType: ADWWorkflowType;
    workflowName?: string;
    trigger: ADWTrigger;
    triggerMeta?: Record<string, unknown>;
    task: string;
    taskId?: string;
    config?: ADWRun["config"];
    labels?: string[];
  }): ADWRun {
    const run: ADWRun = {
      id: this.generateRunId(),
      workflowType: params.workflowType,
      workflowName: params.workflowName,
      trigger: params.trigger,
      triggerMeta: params.triggerMeta,
      status: "pending",
      createdAt: Date.now(),
      task: params.task,
      taskId: params.taskId,
      config: params.config,
      steps: [],
      artifacts: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        stepCount: 0,
        successfulSteps: 0,
        failedSteps: 0,
      },
      metrics: {},
      labels: params.labels,
    };

    this.runs.set(run.id, run);
    this.persist();
    return run;
  }

  /**
   * Get a run by ID.
   */
  getRun(runId: string): ADWRun | undefined {
    return this.runs.get(runId);
  }

  /**
   * Update a run's status and timing.
   */
  updateRunStatus(runId: string, status: ADWStatus): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = status;

    if (status === "running" && !run.startedAt) {
      run.startedAt = Date.now();
    }

    if (["completed", "failed", "cancelled", "timeout"].includes(status)) {
      run.endedAt = Date.now();
      if (run.startedAt) {
        run.durationMs = run.endedAt - run.startedAt;
      }
    }

    this.persist();
  }

  /**
   * Mark a run as started.
   */
  startRun(runId: string): void {
    this.updateRunStatus(runId, "running");
  }

  /**
   * Mark a run as completed.
   */
  completeRun(runId: string, output?: string, metrics?: ADWRun["metrics"]): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = "completed";
    run.endedAt = Date.now();
    if (run.startedAt) {
      run.durationMs = run.endedAt - run.startedAt;
    }
    if (output !== undefined) run.output = output;
    if (metrics) run.metrics = { ...run.metrics, ...metrics };

    this.recalculateUsage(runId);
    this.persist();
  }

  /**
   * Mark a run as failed.
   */
  failRun(runId: string, error: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = "failed";
    run.error = error;
    run.endedAt = Date.now();
    if (run.startedAt) {
      run.durationMs = run.endedAt - run.startedAt;
    }

    this.recalculateUsage(runId);
    this.persist();
  }

  /**
   * Add a step to a run.
   */
  addStep(runId: string, step: Omit<ADWStep, "order">): ADWStep {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const fullStep: ADWStep = {
      ...step,
      order: run.steps.length,
    };

    run.steps.push(fullStep);
    this.persist();
    return fullStep;
  }

  /**
   * Update a step within a run.
   */
  updateStep(runId: string, stepId: string, updates: Partial<ADWStep>): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const step = run.steps.find((s) => s.id === stepId);
    if (!step) return;

    Object.assign(step, updates);

    // Calculate duration if completed
    if (step.endedAt && step.startedAt) {
      step.durationMs = step.endedAt - step.startedAt;
    }

    this.persist();
  }

  /**
   * Start a step.
   */
  startStep(runId: string, stepId: string): void {
    this.updateStep(runId, stepId, {
      status: "running",
      startedAt: Date.now(),
    });
  }

  /**
   * Complete a step successfully.
   */
  completeStep(
    runId: string,
    stepId: string,
    output?: string,
    outputType?: ADWStep["outputType"],
    usage?: ADWStep["usage"],
    metrics?: ADWStep["metrics"],
  ): void {
    const updates: Partial<ADWStep> = {
      status: "completed",
      endedAt: Date.now(),
    };

    if (output !== undefined) updates.output = output;
    if (outputType) updates.outputType = outputType;
    if (usage) updates.usage = usage;
    if (metrics) updates.metrics = metrics;

    this.updateStep(runId, stepId, updates);
    this.recalculateUsage(runId);
  }

  /**
   * Fail a step.
   */
  failStep(runId: string, stepId: string, error: string): void {
    this.updateStep(runId, stepId, {
      status: "failed",
      endedAt: Date.now(),
      error,
    });
    this.recalculateUsage(runId);
  }

  /**
   * Add an artifact to a run.
   */
  addArtifact(runId: string, artifact: Omit<ADWArtifact, "createdAt">): ADWArtifact {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    const fullArtifact: ADWArtifact = {
      ...artifact,
      createdAt: Date.now(),
    };

    run.artifacts.push(fullArtifact);
    this.persist();
    return fullArtifact;
  }

  /**
   * Recalculate aggregate usage from steps.
   */
  private recalculateUsage(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let successfulSteps = 0;
    let failedSteps = 0;

    for (const step of run.steps) {
      if (step.usage) {
        inputTokens += step.usage.inputTokens || 0;
        outputTokens += step.usage.outputTokens || 0;
        totalTokens += step.usage.totalTokens || 0;
        estimatedCostUsd += step.usage.estimatedCostUsd || 0;
      }

      if (step.status === "completed") successfulSteps++;
      else if (step.status === "failed") failedSteps++;
    }

    run.usage = {
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      stepCount: run.steps.length,
      successfulSteps,
      failedSteps,
    };
  }

  /**
   * Query runs with filters.
   */
  queryRuns(filter: ADWRunFilter = {}): ADWRun[] {
    let results = Array.from(this.runs.values());

    if (filter.workflowType) {
      results = results.filter((r) => r.workflowType === filter.workflowType);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      results = results.filter((r) => statuses.includes(r.status));
    }

    if (filter.trigger) {
      results = results.filter((r) => r.trigger === filter.trigger);
    }

    if (filter.taskId) {
      results = results.filter((r) => r.taskId === filter.taskId);
    }

    if (filter.createdAfter !== undefined) {
      results = results.filter((r) => r.createdAt >= filter.createdAfter!);
    }

    if (filter.createdBefore !== undefined) {
      results = results.filter((r) => r.createdAt <= filter.createdBefore!);
    }

    if (filter.labels && filter.labels.length > 0) {
      results = results.filter(
        (r) => r.labels && filter.labels!.some((label) => r.labels!.includes(label)),
      );
    }

    // Sort by creation time, newest first
    results.sort((a, b) => b.createdAt - a.createdAt);

    // Apply pagination
    if (filter.offset) {
      results = results.slice(filter.offset);
    }
    if (filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get all runs (optionally paginated).
   */
  getAllRuns(limit?: number, offset?: number): ADWRun[] {
    return this.queryRuns({ limit, offset });
  }

  /**
   * Get runs by status.
   */
  getRunsByStatus(status: ADWStatus): ADWRun[] {
    return this.queryRuns({ status });
  }

  /**
   * Get recent runs.
   */
  getRecentRuns(count: number = 10): ADWRun[] {
    return this.queryRuns({ limit: count });
  }

  /**
   * Get summary statistics.
   */
  getSummary(): ADWSummary {
    const runs = Array.from(this.runs.values());

    const byStatus: Record<ADWStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      timeout: 0,
    };

    const byWorkflowType: Record<ADWWorkflowType, number> = {
      "plan-build": 0,
      "test-fix": 0,
      "review-document": 0,
      "scout-research": 0,
      custom: 0,
    };

    const byTrigger: Record<ADWTrigger, number> = {
      manual: 0,
      webhook: 0,
      "github-issue": 0,
      "github-pr": 0,
      cron: 0,
      "upstream-sync": 0,
      orchestrator: 0,
      agent: 0,
    };

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;
    let totalScore = 0;
    let scoredRuns = 0;
    let successfulRuns = 0;
    let completedRuns = 0;

    for (const run of runs) {
      byStatus[run.status]++;
      byWorkflowType[run.workflowType]++;
      byTrigger[run.trigger]++;

      totalInputTokens += run.usage.inputTokens;
      totalOutputTokens += run.usage.outputTokens;
      totalTokens += run.usage.totalTokens;
      totalCostUsd += run.usage.estimatedCostUsd;

      if (run.durationMs) {
        totalDurationMs += run.durationMs;
      }

      if (run.metrics.overallScore !== undefined) {
        totalScore += run.metrics.overallScore;
        scoredRuns++;
      }

      if (run.status === "completed") {
        successfulRuns++;
        completedRuns++;
      } else if (["failed", "cancelled", "timeout"].includes(run.status)) {
        completedRuns++;
      }
    }

    return {
      totalRuns: runs.length,
      byStatus,
      byWorkflowType,
      byTrigger,
      totalUsage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        estimatedCostUsd: totalCostUsd,
      },
      successRate: completedRuns > 0 ? successfulRuns / completedRuns : 0,
      avgDurationMs: completedRuns > 0 ? totalDurationMs / completedRuns : 0,
      avgScore: scoredRuns > 0 ? totalScore / scoredRuns : 0,
    };
  }

  /**
   * Delete a run by ID.
   */
  deleteRun(runId: string): boolean {
    const deleted = this.runs.delete(runId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  /**
   * Delete runs older than the specified age.
   */
  pruneOldRuns(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;

    for (const [runId, run] of this.runs.entries()) {
      // Only prune completed/failed/cancelled runs
      if (!["completed", "failed", "cancelled", "timeout"].includes(run.status)) continue;
      if (run.createdAt < cutoff) {
        this.runs.delete(runId);
        deleted++;
      }
    }

    if (deleted > 0) {
      this.persist();
    }

    return deleted;
  }

  /**
   * Reload store from disk (useful for testing or external changes).
   */
  reload(): void {
    this.runs = loadADWStoreFromDisk();
  }

  /**
   * Persist current state to disk.
   */
  private persist(): void {
    saveADWStoreToDisk(this.runs);
  }

  /**
   * Get count of runs.
   */
  get count(): number {
    return this.runs.size;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storeInstance: ADWStore | undefined;

/**
 * Get the ADW store singleton.
 */
export function getADWStore(): ADWStore {
  if (!storeInstance) {
    storeInstance = new ADWStore();
  }
  return storeInstance;
}

/**
 * Reset the store singleton (for testing).
 */
export function resetADWStore(): void {
  storeInstance = undefined;
}
