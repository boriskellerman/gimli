/**
 * Multi-agent activity tracker.
 * Tracks live agent runs, their context, and work for system-wide observability.
 */

import { onAgentEvent, type AgentEventPayload } from "../infra/agent-events.js";
import { parseAgentSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { normalizeDeliveryContext, type DeliveryContext } from "../utils/delivery-context.js";
import type {
  AgentActivityEvent,
  AgentActivityQueryOptions,
  AgentObservabilityStatus,
  AgentRunSnapshot,
  AgentRunStatus,
  MultiAgentObservabilitySnapshot,
} from "./agent-activity.types.js";

export type { AgentActivityEvent, AgentActivityQueryOptions, AgentRunSnapshot };

const INPUT_PREVIEW_MAX_LEN = 120;
const DEFAULT_WINDOW_MINUTES = 30;
const MAX_RUNS_PER_AGENT = 100;
const CLEANUP_INTERVAL_MS = 60_000;

// In-memory registry of active and recent runs.
const runRegistry = new Map<string, AgentRunSnapshot>();
const activityListeners = new Set<(event: AgentActivityEvent) => void>();
let cleanupTimer: NodeJS.Timeout | null = null;
let eventListenerStop: (() => void) | null = null;
let initialized = false;

function truncateInput(input: string | undefined, maxLen: number): string | undefined {
  if (!input) return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.slice(0, maxLen - 1) + "…";
}

function extractAgentId(sessionKey: string | undefined): string {
  if (!sessionKey) return "unknown";
  const parsed = parseAgentSessionKey(sessionKey);
  return parsed?.agentId ? normalizeAgentId(parsed.agentId) : "unknown";
}

function isSubagentSession(sessionKey: string | undefined): boolean {
  if (!sessionKey) return false;
  return sessionKey.includes(":subagent:");
}

function extractParentSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey) return undefined;
  const subagentIndex = sessionKey.indexOf(":subagent:");
  if (subagentIndex === -1) return undefined;
  // Parent key is the base agent session (typically "agent:id:main" or similar).
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed) return undefined;
  return `agent:${parsed.agentId}:main`;
}

function emitActivityEvent(event: AgentActivityEvent) {
  for (const listener of activityListeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors.
    }
  }
}

function handleLifecycleEvent(evt: AgentEventPayload) {
  const { runId, sessionKey } = evt;
  const data = evt.data ?? {};
  const phase = data.phase as string | undefined;

  if (phase === "start") {
    const now = Date.now();
    const startedAt = typeof data.startedAt === "number" ? data.startedAt : now;
    const agentId = extractAgentId(sessionKey);
    const isSubagent = isSubagentSession(sessionKey);
    const parentSessionKey = extractParentSessionKey(sessionKey);
    const task = typeof data.task === "string" ? data.task : undefined;
    const inputPreview = truncateInput(
      typeof data.input === "string" ? data.input : undefined,
      INPUT_PREVIEW_MAX_LEN,
    );
    const model = typeof data.model === "string" ? data.model : undefined;
    const modelProvider = typeof data.modelProvider === "string" ? data.modelProvider : undefined;
    const label = typeof data.label === "string" ? data.label : undefined;
    const deliveryContext = normalizeDeliveryContext(data.deliveryContext as DeliveryContext);

    const snapshot: AgentRunSnapshot = {
      runId,
      agentId,
      sessionKey: sessionKey ?? "",
      status: "running",
      startedAt,
      durationMs: 0,
      task,
      inputPreview,
      isSubagent,
      parentSessionKey,
      deliveryContext,
      model,
      modelProvider,
      label,
      eventCount: 1,
      toolCallCount: 0,
    };

    runRegistry.set(runId, snapshot);
    emitActivityEvent({
      type: "run:start",
      runId,
      agentId,
      snapshot,
      ts: now,
    });
    return;
  }

  if (phase === "end" || phase === "error") {
    const now = Date.now();
    const existing = runRegistry.get(runId);
    if (!existing) return;

    const endedAt = typeof data.endedAt === "number" ? data.endedAt : now;
    const aborted = data.aborted === true;
    const error = typeof data.error === "string" ? data.error : undefined;

    let status: AgentRunStatus = "completed";
    if (phase === "error") status = "failed";
    else if (aborted) status = "aborted";

    const updated: AgentRunSnapshot = {
      ...existing,
      status,
      endedAt,
      durationMs: endedAt - existing.startedAt,
      error,
      eventCount: existing.eventCount + 1,
    };

    runRegistry.set(runId, updated);
    emitActivityEvent({
      type: "run:end",
      runId,
      agentId: existing.agentId,
      snapshot: updated,
      ts: now,
    });
    return;
  }
}

function handleToolEvent(evt: AgentEventPayload) {
  const { runId } = evt;
  const existing = runRegistry.get(runId);
  if (!existing) return;

  const data = evt.data ?? {};
  const toolName = typeof data.name === "string" ? data.name : undefined;
  const phase = data.phase as string | undefined;

  const now = Date.now();
  const updated: AgentRunSnapshot = {
    ...existing,
    eventCount: existing.eventCount + 1,
    durationMs: now - existing.startedAt,
  };

  if (phase === "start" && toolName) {
    updated.currentTool = toolName;
    updated.toolCallCount = existing.toolCallCount + 1;
  } else if (phase === "end" || phase === "error") {
    updated.currentTool = undefined;
  }

  runRegistry.set(runId, updated);
  emitActivityEvent({
    type: "run:update",
    runId,
    agentId: existing.agentId,
    snapshot: updated,
    ts: now,
  });
}

function handleAgentEvent(evt: AgentEventPayload) {
  if (!evt?.runId) return;

  switch (evt.stream) {
    case "lifecycle":
      handleLifecycleEvent(evt);
      break;
    case "tool":
      handleToolEvent(evt);
      break;
    default:
      // Update event count for other streams.
      const existing = runRegistry.get(evt.runId);
      if (existing) {
        const now = Date.now();
        runRegistry.set(evt.runId, {
          ...existing,
          eventCount: existing.eventCount + 1,
          durationMs: now - existing.startedAt,
        });
      }
  }
}

function cleanupOldRuns() {
  const now = Date.now();
  const windowMs = DEFAULT_WINDOW_MINUTES * 60_000;
  const cutoff = now - windowMs;

  for (const [runId, snapshot] of runRegistry.entries()) {
    // Keep active runs regardless of age.
    if (snapshot.status === "running" || snapshot.status === "pending") continue;

    // Remove completed runs older than the window.
    const endedAt = snapshot.endedAt ?? snapshot.startedAt;
    if (endedAt < cutoff) {
      runRegistry.delete(runId);
    }
  }

  // Limit runs per agent to prevent memory bloat.
  const runsByAgent = new Map<string, AgentRunSnapshot[]>();
  for (const snapshot of runRegistry.values()) {
    const runs = runsByAgent.get(snapshot.agentId) ?? [];
    runs.push(snapshot);
    runsByAgent.set(snapshot.agentId, runs);
  }

  for (const [_agentId, runs] of runsByAgent.entries()) {
    if (runs.length <= MAX_RUNS_PER_AGENT) continue;
    // Sort by start time descending and remove oldest.
    runs.sort((a, b) => b.startedAt - a.startedAt);
    const toRemove = runs.slice(MAX_RUNS_PER_AGENT);
    for (const snapshot of toRemove) {
      if (snapshot.status === "running" || snapshot.status === "pending") continue;
      runRegistry.delete(snapshot.runId);
    }
  }
}

/**
 * Initialize the agent activity tracker.
 * Must be called once to start listening for agent events.
 */
export function initAgentActivityTracker() {
  if (initialized) return;
  initialized = true;

  eventListenerStop = onAgentEvent(handleAgentEvent);

  cleanupTimer = setInterval(cleanupOldRuns, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}

/**
 * Stop the agent activity tracker and clean up resources.
 */
export function stopAgentActivityTracker() {
  if (!initialized) return;

  if (eventListenerStop) {
    eventListenerStop();
    eventListenerStop = null;
  }

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  initialized = false;
}

/**
 * Reset the activity tracker for testing.
 */
export function resetAgentActivityTrackerForTests() {
  stopAgentActivityTracker();
  runRegistry.clear();
  activityListeners.clear();
}

/**
 * Subscribe to agent activity events.
 * Returns an unsubscribe function.
 */
export function onAgentActivityEvent(listener: (event: AgentActivityEvent) => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

/**
 * Get a snapshot of a specific run.
 */
export function getRunSnapshot(runId: string): AgentRunSnapshot | undefined {
  return runRegistry.get(runId);
}

/**
 * List all tracked runs.
 */
export function listRuns(opts?: AgentActivityQueryOptions): AgentRunSnapshot[] {
  const now = Date.now();
  const windowMinutes = opts?.windowMinutes ?? DEFAULT_WINDOW_MINUTES;
  const windowMs = windowMinutes * 60_000;
  const cutoff = now - windowMs;
  const agentIds = opts?.agentIds ? new Set(opts.agentIds.map(normalizeAgentId)) : null;
  const activeOnly = opts?.activeOnly ?? false;
  const includeSubagents = opts?.includeSubagents ?? true;

  let runs = Array.from(runRegistry.values());

  // Filter by window.
  runs = runs.filter((r) => {
    const timestamp = r.endedAt ?? r.startedAt;
    return timestamp >= cutoff;
  });

  // Filter by agent IDs.
  if (agentIds) {
    runs = runs.filter((r) => agentIds.has(r.agentId));
  }

  // Filter active only.
  if (activeOnly) {
    runs = runs.filter((r) => r.status === "running" || r.status === "pending");
  }

  // Filter subagents.
  if (!includeSubagents) {
    runs = runs.filter((r) => !r.isSubagent);
  }

  // Sort by start time descending.
  runs.sort((a, b) => b.startedAt - a.startedAt);

  return runs;
}

/**
 * Get observability status for a specific agent.
 */
export function getAgentObservabilityStatus(
  agentId: string,
  opts?: AgentActivityQueryOptions,
): AgentObservabilityStatus {
  const normalizedId = normalizeAgentId(agentId);
  const runs = listRuns({ ...opts, agentIds: [normalizedId] });
  const limitPerAgent = opts?.limitPerAgent ?? 10;

  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "pending").length;
  const completedRuns = runs.filter((r) => r.status === "completed").length;
  const failedRuns = runs.filter((r) => r.status === "failed" || r.status === "aborted").length;

  const latestRun = runs[0];
  const lastActivityAt = latestRun?.endedAt ?? latestRun?.startedAt;

  return {
    agentId: normalizedId,
    activeRuns,
    completedRuns,
    failedRuns,
    totalRuns: runs.length,
    latestRunId: latestRun?.runId,
    lastActivityAt,
    runs: runs.slice(0, limitPerAgent),
  };
}

/**
 * Get a system-wide observability snapshot.
 */
export function getMultiAgentObservabilitySnapshot(
  opts?: AgentActivityQueryOptions,
): MultiAgentObservabilitySnapshot {
  const now = Date.now();
  const runs = listRuns(opts);

  // Group runs by agent.
  const runsByAgent = new Map<string, AgentRunSnapshot[]>();
  for (const run of runs) {
    const agentRuns = runsByAgent.get(run.agentId) ?? [];
    agentRuns.push(run);
    runsByAgent.set(run.agentId, agentRuns);
  }

  const limitPerAgent = opts?.limitPerAgent ?? 10;

  const agents: AgentObservabilityStatus[] = [];
  for (const [agentId, agentRuns] of runsByAgent.entries()) {
    const activeRuns = agentRuns.filter(
      (r) => r.status === "running" || r.status === "pending",
    ).length;
    const completedRuns = agentRuns.filter((r) => r.status === "completed").length;
    const failedRuns = agentRuns.filter(
      (r) => r.status === "failed" || r.status === "aborted",
    ).length;
    const latestRun = agentRuns[0];
    const lastActivityAt = latestRun?.endedAt ?? latestRun?.startedAt;

    agents.push({
      agentId,
      activeRuns,
      completedRuns,
      failedRuns,
      totalRuns: agentRuns.length,
      latestRunId: latestRun?.runId,
      lastActivityAt,
      runs: agentRuns.slice(0, limitPerAgent),
    });
  }

  // Sort agents by last activity (most recent first).
  agents.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

  const totalActiveRuns = runs.filter(
    (r) => r.status === "running" || r.status === "pending",
  ).length;

  return {
    ts: now,
    totalActiveRuns,
    totalAgentsWithActivity: agents.length,
    agents,
  };
}

/**
 * Register an external run (e.g., from a subagent registry).
 * Used to inject runs that were started before the tracker was initialized.
 */
export function registerExternalRun(snapshot: AgentRunSnapshot) {
  if (!snapshot.runId) return;
  runRegistry.set(snapshot.runId, snapshot);
}

/**
 * Update an existing run snapshot.
 */
export function updateRunSnapshot(runId: string, updates: Partial<AgentRunSnapshot>) {
  const existing = runRegistry.get(runId);
  if (!existing) return;

  const updated = { ...existing, ...updates };
  runRegistry.set(runId, updated);

  emitActivityEvent({
    type: "run:update",
    runId,
    agentId: existing.agentId,
    snapshot: updated,
    ts: Date.now(),
  });
}

/**
 * Mark a run as completed.
 */
export function markRunCompleted(runId: string, opts?: { error?: string; aborted?: boolean }) {
  const existing = runRegistry.get(runId);
  if (!existing) return;

  const now = Date.now();
  let status: AgentRunStatus = "completed";
  if (opts?.error) status = "failed";
  else if (opts?.aborted) status = "aborted";

  const updated: AgentRunSnapshot = {
    ...existing,
    status,
    endedAt: now,
    durationMs: now - existing.startedAt,
    error: opts?.error,
  };

  runRegistry.set(runId, updated);
  emitActivityEvent({
    type: "run:end",
    runId,
    agentId: existing.agentId,
    snapshot: updated,
    ts: now,
  });
}
