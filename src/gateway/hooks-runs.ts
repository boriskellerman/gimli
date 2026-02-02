/**
 * Hook run tracking for observability and ADW support.
 *
 * Stores run metadata and results in memory with a configurable TTL.
 * Provides endpoints for checking run status and retrieving results.
 */

import { randomUUID } from "node:crypto";

export type HookRunStatus = "pending" | "running" | "completed" | "error";

export type HookRunMetadata = {
  runId: string;
  name: string;
  sessionKey: string;
  status: HookRunStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  summary?: string;
  outputText?: string;
  error?: string;
};

const DEFAULT_RUN_TTL_MS = 3600 * 1000; // 1 hour
const DEFAULT_MAX_RUNS = 1000;

export type HookRunStoreConfig = {
  /** Time-to-live for run entries in milliseconds. Default: 1 hour */
  ttlMs?: number;
  /** Maximum number of runs to keep. Oldest are evicted first. Default: 1000 */
  maxRuns?: number;
};

/**
 * In-memory store for hook run tracking.
 * Automatically evicts old entries based on TTL and max count.
 */
export class HookRunStore {
  private runs = new Map<string, HookRunMetadata>();
  private readonly ttlMs: number;
  private readonly maxRuns: number;

  constructor(config?: HookRunStoreConfig) {
    this.ttlMs = config?.ttlMs ?? DEFAULT_RUN_TTL_MS;
    this.maxRuns = config?.maxRuns ?? DEFAULT_MAX_RUNS;
  }

  /**
   * Create a new run entry with pending status.
   */
  createRun(params: { name: string; sessionKey: string; runId?: string }): string {
    this.evictExpired();
    this.evictOverflow();

    const runId = params.runId ?? randomUUID();
    const now = Date.now();

    const run: HookRunMetadata = {
      runId,
      name: params.name,
      sessionKey: params.sessionKey,
      status: "pending",
      createdAt: now,
    };

    this.runs.set(runId, run);
    return runId;
  }

  /**
   * Mark a run as started (running status).
   */
  startRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = "running";
    run.startedAt = Date.now();
  }

  /**
   * Mark a run as completed with results.
   */
  completeRun(
    runId: string,
    result: {
      status: "ok" | "error" | "skipped";
      summary?: string;
      outputText?: string;
      error?: string;
    },
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    run.status = result.status === "error" ? "error" : "completed";
    run.completedAt = Date.now();
    run.summary = result.summary;
    run.outputText = result.outputText;
    run.error = result.error;
  }

  /**
   * Get a run by ID.
   */
  getRun(runId: string): HookRunMetadata | undefined {
    this.evictExpired();
    return this.runs.get(runId);
  }

  /**
   * List recent runs, optionally filtered by status or name.
   */
  listRuns(opts?: { status?: HookRunStatus; name?: string; limit?: number; offset?: number }): {
    runs: HookRunMetadata[];
    total: number;
  } {
    this.evictExpired();

    let filtered = Array.from(this.runs.values());

    if (opts?.status) {
      filtered = filtered.filter((r) => r.status === opts.status);
    }
    if (opts?.name) {
      const nameLower = opts.name.toLowerCase();
      filtered = filtered.filter((r) => r.name.toLowerCase().includes(nameLower));
    }

    // Sort by createdAt descending (newest first)
    filtered.sort((a, b) => b.createdAt - a.createdAt);

    const total = filtered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    const runs = filtered.slice(offset, offset + limit);

    return { runs, total };
  }

  /**
   * Delete a run by ID. Returns true if the run existed.
   */
  deleteRun(runId: string): boolean {
    return this.runs.delete(runId);
  }

  /**
   * Clear all runs. Useful for testing.
   */
  clear(): void {
    this.runs.clear();
  }

  /**
   * Get count of runs by status.
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    error: number;
  } {
    this.evictExpired();

    let pending = 0;
    let running = 0;
    let completed = 0;
    let error = 0;

    for (const run of this.runs.values()) {
      switch (run.status) {
        case "pending":
          pending++;
          break;
        case "running":
          running++;
          break;
        case "completed":
          completed++;
          break;
        case "error":
          error++;
          break;
      }
    }

    return { total: this.runs.size, pending, running, completed, error };
  }

  private evictExpired(): void {
    const now = Date.now();
    const cutoff = now - this.ttlMs;

    for (const [runId, run] of this.runs) {
      if (run.createdAt < cutoff) {
        this.runs.delete(runId);
      }
    }
  }

  private evictOverflow(): void {
    if (this.runs.size < this.maxRuns) return;

    // Sort by createdAt ascending (oldest first)
    const entries = Array.from(this.runs.entries()).sort((a, b) => a[1].createdAt - b[1].createdAt);

    // Remove oldest entries until we're under the limit
    const toRemove = entries.length - this.maxRuns + 1;
    for (let i = 0; i < toRemove; i++) {
      this.runs.delete(entries[i][0]);
    }
  }
}

// Global singleton instance for the gateway
let globalStore: HookRunStore | null = null;

export function getHookRunStore(): HookRunStore {
  if (!globalStore) {
    globalStore = new HookRunStore();
  }
  return globalStore;
}

export function resetHookRunStore(): void {
  globalStore = null;
}

// For testing
export function createHookRunStore(config?: HookRunStoreConfig): HookRunStore {
  return new HookRunStore(config);
}
