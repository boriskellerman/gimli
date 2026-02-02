/**
 * Scout Runner
 *
 * Orchestrates scout agent runs using the sub-agent system.
 */

import crypto from "node:crypto";
import path from "node:path";

import { STATE_DIR } from "../../config/paths.js";
import { callGateway } from "../../gateway/call.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";

import {
  type ScoutType,
  type ScoutDepth,
  type ScoutConfig,
  type ScoutResult,
  type ScoutStore,
  type ScoutStatus,
  DEFAULT_SCOUT_CONFIG,
} from "./types.js";
import { getScoutSystemPrompt, buildScoutTaskPrompt, buildCompositeScoutTasks } from "./prompts.js";

/**
 * Get the path to the scout store file.
 */
function getScoutStorePath(): string {
  return path.join(STATE_DIR, "scouts", "runs.json");
}

/**
 * Load the scout store.
 */
function loadScoutStore(): ScoutStore {
  const storePath = getScoutStorePath();
  const raw = loadJsonFile(storePath);

  if (raw && typeof raw === "object") {
    const existing = raw as Partial<ScoutStore>;
    if (existing.runs && typeof existing.runs === "object") {
      return {
        runs: existing.runs as Record<string, ScoutResult>,
        stats: existing.stats || {
          total: 0,
          byStatus: {} as Record<ScoutStatus, number>,
          byType: {} as Record<ScoutType, number>,
          avgDurationByType: {} as Record<ScoutType, number>,
          avgCostByType: {} as Record<ScoutType, number>,
          totalCostUsd: 0,
        },
        lastUpdated: existing.lastUpdated || Date.now(),
      };
    }
  }

  return {
    runs: {},
    stats: {
      total: 0,
      byStatus: {} as Record<ScoutStatus, number>,
      byType: {} as Record<ScoutType, number>,
      avgDurationByType: {} as Record<ScoutType, number>,
      avgCostByType: {} as Record<ScoutType, number>,
      totalCostUsd: 0,
    },
    lastUpdated: Date.now(),
  };
}

/**
 * Save the scout store.
 */
function saveScoutStore(store: ScoutStore): void {
  store.lastUpdated = Date.now();
  const storePath = getScoutStorePath();
  saveJsonFile(storePath, store);
}

/**
 * Generate a unique scout ID.
 */
function generateScoutId(): string {
  const uuid = crypto.randomUUID().split("-")[0];
  return `scout-${uuid}`;
}

/**
 * Update store statistics after a scout run.
 */
function updateStats(store: ScoutStore, result: ScoutResult): void {
  const { stats } = store;

  stats.total += 1;
  stats.byStatus[result.status] = (stats.byStatus[result.status] || 0) + 1;
  stats.byType[result.type] = (stats.byType[result.type] || 0) + 1;

  if (result.durationMs && result.status === "completed") {
    const count = stats.byType[result.type] || 1;
    const prevAvg = stats.avgDurationByType[result.type] || 0;
    stats.avgDurationByType[result.type] = (prevAvg * (count - 1) + result.durationMs) / count;
  }

  if (result.costUsd && result.status === "completed") {
    const count = stats.byType[result.type] || 1;
    const prevAvg = stats.avgCostByType[result.type] || 0;
    stats.avgCostByType[result.type] = (prevAvg * (count - 1) + result.costUsd) / count;
    stats.totalCostUsd += result.costUsd;
  }
}

/**
 * Run a single scout using the sub-agent system.
 */
async function runSingleScout(params: {
  id: string;
  type: ScoutType;
  query: string;
  scope?: string;
  depth: ScoutDepth;
  timeoutSeconds: number;
  model?: string;
  thinkingLevel?: string;
  requesterSessionKey: string;
}): Promise<ScoutResult> {
  const {
    id,
    type,
    query,
    scope,
    depth,
    timeoutSeconds,
    model,
    thinkingLevel,
    requesterSessionKey,
  } = params;

  const result: ScoutResult = {
    id,
    type,
    query,
    scope,
    status: "pending",
    startedAt: Date.now(),
  };

  try {
    result.status = "running";

    // Build the scout task
    const systemPrompt = getScoutSystemPrompt(type);
    const taskPrompt = buildScoutTaskPrompt({ type, query, scope, depth });

    // Create a unique session key for this scout
    const scoutSessionKey = `scout:${id}`;
    result.sessionKey = scoutSessionKey;

    // Spawn the scout as a sub-agent
    const spawnResult = (await callGateway({
      method: "agent",
      params: {
        sessionKey: scoutSessionKey,
        message: taskPrompt,
        deliver: false,
        extraSystemPrompt: systemPrompt,
        model,
        thinking: thinkingLevel,
        timeout: timeoutSeconds,
        label: `Scout: ${type}`,
        spawnedBy: requesterSessionKey,
      },
      timeoutMs: (timeoutSeconds + 30) * 1000,
      expectFinal: true,
    })) as {
      status?: string;
      reply?: string;
      error?: string;
      usage?: { inputTokens?: number; outputTokens?: number };
    };

    result.endedAt = Date.now();
    result.durationMs = result.endedAt - result.startedAt;

    if (spawnResult?.status === "ok" || spawnResult?.reply) {
      result.status = "completed";
      // Parse findings from the reply
      // For now, store raw reply - parsing can be added later
      result.findings = {
        type,
        data: { rawReply: spawnResult.reply },
      } as unknown as ScoutResult["findings"];

      // Estimate cost from tokens
      if (spawnResult.usage) {
        const inputTokens = spawnResult.usage.inputTokens || 0;
        const outputTokens = spawnResult.usage.outputTokens || 0;
        // Rough estimate based on Claude Sonnet pricing
        result.costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
      }
    } else if (spawnResult?.status === "timeout") {
      result.status = "timeout";
      result.error = "Scout exceeded time limit";
    } else {
      result.status = "failed";
      result.error = spawnResult?.error || "Unknown error";
    }
  } catch (err) {
    result.endedAt = Date.now();
    result.durationMs = result.endedAt - result.startedAt;
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Run a composite scout (feature or bug) that spawns multiple child scouts.
 */
async function runCompositeScout(params: {
  id: string;
  type: "feature" | "bug";
  query: string;
  scope?: string;
  depth: ScoutDepth;
  timeoutSeconds: number;
  model?: string;
  thinkingLevel?: string;
  parallel: boolean;
  maxConcurrent: number;
  requesterSessionKey: string;
}): Promise<ScoutResult> {
  const {
    id,
    type,
    query,
    scope,
    depth,
    timeoutSeconds,
    model,
    thinkingLevel,
    parallel,
    maxConcurrent,
    requesterSessionKey,
  } = params;

  const result: ScoutResult = {
    id,
    type,
    query,
    scope,
    status: "pending",
    startedAt: Date.now(),
    childScouts: [],
  };

  const childTasks = buildCompositeScoutTasks({ type, query, scope, depth });
  const childResults: ScoutResult[] = [];

  try {
    result.status = "running";

    if (parallel) {
      // Run child scouts in parallel with concurrency limit
      const runBatch = async (tasks: typeof childTasks) => {
        return Promise.all(
          tasks.map(async (task) => {
            const childId = generateScoutId();
            result.childScouts?.push(childId);

            return runSingleScout({
              id: childId,
              type: task.type,
              query: task.task,
              scope,
              depth,
              timeoutSeconds: Math.floor(timeoutSeconds / 2), // Child scouts get half the time
              model,
              thinkingLevel,
              requesterSessionKey,
            });
          }),
        );
      };

      // Process in batches to respect maxConcurrent
      for (let i = 0; i < childTasks.length; i += maxConcurrent) {
        const batch = childTasks.slice(i, i + maxConcurrent);
        const batchResults = await runBatch(batch);
        childResults.push(...batchResults);
      }
    } else {
      // Run child scouts sequentially
      for (const task of childTasks) {
        const childId = generateScoutId();
        result.childScouts?.push(childId);

        const childResult = await runSingleScout({
          id: childId,
          type: task.type,
          query: task.task,
          scope,
          depth,
          timeoutSeconds: Math.floor(timeoutSeconds / childTasks.length),
          model,
          thinkingLevel,
          requesterSessionKey,
        });

        childResults.push(childResult);

        // Stop early if a child fails critically
        if (childResult.status === "failed" && type === "bug") {
          // For bug scouts, continue even if some children fail
          continue;
        }
      }
    }

    result.endedAt = Date.now();
    result.durationMs = result.endedAt - result.startedAt;

    // Determine overall status
    const failedCount = childResults.filter((r) => r.status === "failed").length;
    const completedCount = childResults.filter((r) => r.status === "completed").length;

    if (completedCount === childResults.length) {
      result.status = "completed";
    } else if (failedCount === childResults.length) {
      result.status = "failed";
      result.error = "All child scouts failed";
    } else {
      result.status = "completed"; // Partial success is still success
    }

    // Aggregate cost from children
    result.costUsd = childResults.reduce((sum, r) => sum + (r.costUsd || 0), 0);

    // Build composite findings
    // This is simplified - a real implementation would parse and merge findings
    result.findings = {
      type,
      data: {
        query,
        childResults: childResults.map((r) => ({
          id: r.id,
          type: r.type,
          status: r.status,
          findings: r.findings,
        })),
        recommendations: [], // Would be synthesized from child findings
        suggestedChanges: [], // Would be derived from findings
      },
    } as unknown as ScoutResult["findings"];
  } catch (err) {
    result.endedAt = Date.now();
    result.durationMs = result.endedAt - result.startedAt;
    result.status = "failed";
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Run a scout with the given configuration.
 */
export async function runScout(
  config: Partial<ScoutConfig> & { type: ScoutType; query: string },
  requesterSessionKey: string,
): Promise<ScoutResult> {
  const fullConfig: ScoutConfig = {
    ...DEFAULT_SCOUT_CONFIG,
    ...config,
  };

  const store = loadScoutStore();
  const scoutId = generateScoutId();

  let result: ScoutResult;

  if (fullConfig.type === "feature" || fullConfig.type === "bug") {
    result = await runCompositeScout({
      id: scoutId,
      type: fullConfig.type,
      query: fullConfig.query,
      scope: fullConfig.scope,
      depth: fullConfig.depth,
      timeoutSeconds: fullConfig.timeoutSeconds,
      model: fullConfig.model,
      thinkingLevel: fullConfig.thinkingLevel,
      parallel: fullConfig.parallel,
      maxConcurrent: fullConfig.maxConcurrent,
      requesterSessionKey,
    });
  } else {
    result = await runSingleScout({
      id: scoutId,
      type: fullConfig.type,
      query: fullConfig.query,
      scope: fullConfig.scope,
      depth: fullConfig.depth,
      timeoutSeconds: fullConfig.timeoutSeconds,
      model: fullConfig.model,
      thinkingLevel: fullConfig.thinkingLevel,
      requesterSessionKey,
    });
  }

  // Save result to store
  store.runs[scoutId] = result;
  updateStats(store, result);

  // Clean up old runs (keep last 100)
  const runIds = Object.keys(store.runs).sort(
    (a, b) => (store.runs[b]?.startedAt || 0) - (store.runs[a]?.startedAt || 0),
  );
  if (runIds.length > 100) {
    for (const oldId of runIds.slice(100)) {
      delete store.runs[oldId];
    }
  }

  saveScoutStore(store);

  return result;
}

/**
 * Get a scout result by ID.
 */
export function getScoutResult(scoutId: string): ScoutResult | undefined {
  const store = loadScoutStore();
  return store.runs[scoutId];
}

/**
 * List recent scout runs.
 */
export function listScoutRuns(options?: {
  limit?: number;
  type?: ScoutType;
  status?: ScoutStatus;
}): ScoutResult[] {
  const store = loadScoutStore();
  let runs = Object.values(store.runs);

  if (options?.type) {
    runs = runs.filter((r) => r.type === options.type);
  }

  if (options?.status) {
    runs = runs.filter((r) => r.status === options.status);
  }

  runs.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));

  if (options?.limit) {
    runs = runs.slice(0, options.limit);
  }

  return runs;
}

/**
 * Cancel a running scout.
 */
export async function cancelScout(scoutId: string): Promise<boolean> {
  const store = loadScoutStore();
  const result = store.runs[scoutId];

  if (!result) {
    return false;
  }

  if (result.status !== "running" && result.status !== "pending") {
    return false;
  }

  result.status = "cancelled";
  result.endedAt = Date.now();
  result.durationMs = result.endedAt - result.startedAt;

  // If there's a session, try to delete it
  if (result.sessionKey) {
    try {
      await callGateway({
        method: "sessions.delete",
        params: { key: result.sessionKey, deleteTranscript: true },
        timeoutMs: 5000,
      });
    } catch {
      // Best effort - ignore errors
    }
  }

  saveScoutStore(store);
  return true;
}

/**
 * Get scout statistics.
 */
export function getScoutStats(): ScoutStore["stats"] {
  const store = loadScoutStore();
  return store.stats;
}
