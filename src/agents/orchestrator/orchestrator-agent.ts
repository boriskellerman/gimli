/**
 * Orchestrator Agent Factory
 *
 * Creates and manages Orchestrator Agent instances following TAC principles.
 * The O-Agent coordinates multi-agent operations, manages agent fleets,
 * and integrates with AI Developer Workflows (ADWs).
 */

import crypto from "node:crypto";

import { loadConfig } from "../../config/config.js";
import { callGateway } from "../../gateway/call.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { AGENT_LANE_SUBAGENT } from "../lanes.js";
import { registerSubagentRun } from "../subagent-registry.js";
import {
  triggerADW,
  getADWRunStatus,
  listAvailableADWs,
  cancelADWRun,
} from "../../adw/connector.js";
import type { ADWTriggerParams } from "../../adw/types.js";
import {
  buildMinimalOrchestratorPrompt,
  buildOrchestratorSystemPrompt,
  buildGimliOrchestratorPrompt,
} from "./orchestrator-system-prompt.js";
import {
  applyOrchestratorPreset,
  type CreateOrchestratorParams,
  type FleetStatus,
  type ManagedAgentState,
  type OrchestratorConfig,
  type OrchestratorEvent,
  type OrchestratorSpawnParams,
  type OrchestratorSpawnResult,
  ORCHESTRATOR_PRESETS,
} from "./orchestrator-types.js";

// ============================================================================
// Registry
// ============================================================================

/**
 * In-memory registry for tracking orchestrator instances.
 */
const orchestratorRegistry = new Map<
  string,
  {
    config: OrchestratorConfig;
    sessionKey: string;
    startedAt: number;
    managedAgents: Map<string, ManagedAgentState>;
    adwRuns: Set<string>;
    events: OrchestratorEvent[];
  }
>();

/**
 * Generate a unique orchestrator session key.
 */
function generateOrchestratorSessionKey(orchestratorId: string, agentId: string): string {
  return `agent:${agentId}:orchestrator:${orchestratorId}:${crypto.randomUUID()}`;
}

/**
 * Emit an orchestrator event for observability.
 */
function emitOrchestratorEvent(
  orchestratorId: string,
  type: OrchestratorEvent["type"],
  data: Record<string, unknown>,
): void {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return;

  const event: OrchestratorEvent = {
    type,
    timestamp: Date.now(),
    orchestratorId,
    data,
  };
  entry.events.push(event);

  // Keep only last 100 events to prevent memory bloat
  if (entry.events.length > 100) {
    entry.events = entry.events.slice(-100);
  }
}

// ============================================================================
// Orchestrator Lifecycle
// ============================================================================

/**
 * Create a new Orchestrator Agent configuration.
 */
export function createOrchestratorConfig(
  id: string,
  options: Partial<OrchestratorConfig> & { preset?: keyof typeof ORCHESTRATOR_PRESETS } = {},
): OrchestratorConfig {
  const { preset = "standard", ...overrides } = options;
  const presetConfig = applyOrchestratorPreset(preset, overrides);

  return {
    id,
    name: overrides.name ?? `Orchestrator-${id}`,
    role: presetConfig.role ?? "coordinator",
    managedAgents: overrides.managedAgents ?? ["*"],
    model: overrides.model,
    canCreateAgents: presetConfig.canCreateAgents ?? true,
    canDeleteAgents: presetConfig.canDeleteAgents ?? false,
    canTriggerADWs: presetConfig.canTriggerADWs ?? false,
    availableADWs: overrides.availableADWs,
    workspaceDir: overrides.workspaceDir,
    maxConcurrentAgents: presetConfig.maxConcurrentAgents ?? 10,
    defaultAgentTimeout: presetConfig.defaultAgentTimeout ?? 600,
    customInstructions: overrides.customInstructions,
  };
}

/**
 * Create and start an Orchestrator Agent session.
 *
 * This spawns an agent with the orchestrator system prompt and returns
 * the session key for tracking and interaction.
 */
export async function createOrchestratorSession(
  params: CreateOrchestratorParams,
): Promise<{ sessionKey: string; runId: string }> {
  const cfg = loadConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const agentId = normalizeAgentId(defaultAgentId);

  // Generate unique session key for this orchestrator
  const sessionKey = params.sessionKey ?? generateOrchestratorSessionKey(params.config.id, agentId);

  // Build the orchestrator system prompt (use Gimli-enhanced version)
  const systemPrompt = buildGimliOrchestratorPrompt({
    role: params.config.role,
    managedAgents: params.config.managedAgents,
    canCreateAgents: params.config.canCreateAgents,
    canDeleteAgents: params.config.canDeleteAgents,
    canTriggerADWs: params.config.canTriggerADWs,
    availableADWs: params.config.availableADWs,
    workspaceDir: params.config.workspaceDir ?? process.cwd(),
    label: params.config.name ?? params.config.id,
    requesterContext: params.requesterContext,
    customInstructions: params.config.customInstructions,
  });

  // Register the orchestrator in our tracking registry
  orchestratorRegistry.set(params.config.id, {
    config: params.config,
    sessionKey,
    startedAt: Date.now(),
    managedAgents: new Map(),
    adwRuns: new Set(),
    events: [],
  });

  const idempotencyKey = crypto.randomUUID();

  // Spawn the orchestrator agent via gateway
  const response = (await callGateway({
    method: "agent",
    params: {
      message: params.task,
      sessionKey,
      channel: params.channel,
      accountId: params.accountId,
      to: params.to,
      idempotencyKey,
      deliver: params.deliver ?? false,
      lane: AGENT_LANE_SUBAGENT,
      extraSystemPrompt: systemPrompt,
      label: params.config.name ?? `Orchestrator: ${params.config.id}`,
    },
    timeoutMs: 15_000,
  })) as { runId?: string };

  const runId = response?.runId ?? idempotencyKey;

  // Emit creation event
  emitOrchestratorEvent(params.config.id, "agent_spawned", {
    sessionKey,
    runId,
    task: params.task,
  });

  return { sessionKey, runId };
}

// ============================================================================
// Agent Management (CRUD)
// ============================================================================

/**
 * Spawn a sub-agent from the orchestrator.
 *
 * This is the CRUD "Create" operation for agents managed by the orchestrator.
 */
export async function orchestratorSpawnAgent(
  orchestratorId: string,
  params: OrchestratorSpawnParams,
): Promise<OrchestratorSpawnResult> {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) {
    return { success: false, error: `Orchestrator ${orchestratorId} not found` };
  }

  const config = entry.config;

  // Check if we're at max concurrent agents
  const activeCount = Array.from(entry.managedAgents.values()).filter(
    (a) => a.status === "running" || a.status === "pending",
  ).length;

  if (config.maxConcurrentAgents && activeCount >= config.maxConcurrentAgents) {
    return {
      success: false,
      error: `Max concurrent agents (${config.maxConcurrentAgents}) reached`,
    };
  }

  // Check if target agent is in managed scope
  if (params.agentId && !config.managedAgents.includes("*")) {
    const normalizedTarget = normalizeAgentId(params.agentId);
    const allowed = config.managedAgents.some((id) => normalizeAgentId(id) === normalizedTarget);
    if (!allowed) {
      return { success: false, error: `Agent ${params.agentId} not in managed scope` };
    }
  }

  const cfg = loadConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const targetAgentId = params.agentId ? normalizeAgentId(params.agentId) : defaultAgentId;

  // Generate child session key
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
  const childIdem = crypto.randomUUID();

  // Build minimal task context
  const taskPrompt = buildMinimalOrchestratorPrompt({
    task: params.task,
    managedAgents: config.managedAgents,
  });

  const timeout = params.timeoutSeconds ?? config.defaultAgentTimeout ?? 600;

  try {
    const response = (await callGateway({
      method: "agent",
      params: {
        message: params.task,
        sessionKey: childSessionKey,
        idempotencyKey: childIdem,
        deliver: false,
        lane: AGENT_LANE_SUBAGENT,
        extraSystemPrompt: taskPrompt,
        thinking: params.thinking,
        timeout: timeout > 0 ? timeout : undefined,
        label: params.label || undefined,
        spawnedBy: entry.sessionKey,
      },
      timeoutMs: 10_000,
    })) as { runId?: string };

    const runId = response?.runId ?? childIdem;

    // Register in subagent registry for cleanup handling
    registerSubagentRun({
      runId,
      childSessionKey,
      requesterSessionKey: entry.sessionKey,
      requesterDisplayKey: entry.sessionKey,
      task: params.task,
      cleanup: params.cleanup ?? "keep",
      label: params.label,
      runTimeoutSeconds: timeout,
    });

    // Track in our managed agents map
    const agentState: ManagedAgentState = {
      sessionKey: childSessionKey,
      label: params.label,
      task: params.task,
      status: "running",
      spawnedAt: Date.now(),
      runId,
    };
    entry.managedAgents.set(childSessionKey, agentState);

    // Emit spawn event
    emitOrchestratorEvent(orchestratorId, "agent_spawned", {
      sessionKey: childSessionKey,
      runId,
      task: params.task,
      label: params.label,
    });

    return { success: true, sessionKey: childSessionKey, runId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    emitOrchestratorEvent(orchestratorId, "error", {
      operation: "spawn",
      error: errorMsg,
      task: params.task,
    });
    return { success: false, error: errorMsg };
  }
}

/**
 * Get the current fleet status for an orchestrator.
 *
 * This is the CRUD "Read" operation for observability.
 */
export function getOrchestratorFleetStatus(orchestratorId: string): FleetStatus | null {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return null;

  const agents = Array.from(entry.managedAgents.values());
  const activeAgents = agents.filter((a) => a.status === "running" || a.status === "pending");
  const completedAgents = agents.filter((a) => a.status === "completed");
  const failedAgents = agents.filter((a) => a.status === "failed" || a.status === "timeout");

  // Calculate total tokens if available
  let totalTokens: number | undefined;
  for (const agent of agents) {
    if (agent.tokenUsage?.total) {
      totalTokens = (totalTokens ?? 0) + agent.tokenUsage.total;
    }
  }

  return {
    totalAgents: agents.length,
    activeAgents: activeAgents.length,
    completedAgents: completedAgents.length,
    failedAgents: failedAgents.length,
    totalTokens,
    agents,
  };
}

/**
 * Update a managed agent's status.
 *
 * This is the CRUD "Update" operation.
 */
export function updateManagedAgentStatus(
  orchestratorId: string,
  sessionKey: string,
  update: Partial<ManagedAgentState>,
): boolean {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return false;

  const agent = entry.managedAgents.get(sessionKey);
  if (!agent) return false;

  // Apply updates
  Object.assign(agent, update);

  // Emit appropriate event based on status change
  if (update.status === "completed") {
    emitOrchestratorEvent(orchestratorId, "agent_completed", {
      sessionKey,
      result: update.result,
    });
  } else if (update.status === "failed") {
    emitOrchestratorEvent(orchestratorId, "agent_failed", {
      sessionKey,
      error: update.error,
    });
  } else if (update.status === "timeout") {
    emitOrchestratorEvent(orchestratorId, "agent_timeout", {
      sessionKey,
    });
  }

  return true;
}

/**
 * Remove a managed agent from tracking (soft delete).
 *
 * This is the CRUD "Delete" operation.
 */
export function removeManagedAgent(orchestratorId: string, sessionKey: string): boolean {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return false;

  return entry.managedAgents.delete(sessionKey);
}

// ============================================================================
// ADW Integration
// ============================================================================

/**
 * Trigger an ADW workflow from the orchestrator.
 */
export async function orchestratorTriggerADW(
  orchestratorId: string,
  params: Omit<ADWTriggerParams, "triggerMeta"> & { triggerMeta?: Record<string, unknown> },
): Promise<{ success: boolean; runId?: string; error?: string }> {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) {
    return { success: false, error: `Orchestrator ${orchestratorId} not found` };
  }

  const config = entry.config;

  // Check if orchestrator can trigger ADWs
  if (!config.canTriggerADWs) {
    return { success: false, error: "This orchestrator cannot trigger ADWs" };
  }

  // Check if workflow is in allowed list (if specified)
  if (
    config.availableADWs &&
    config.availableADWs.length > 0 &&
    !config.availableADWs.includes(params.workflowId)
  ) {
    return {
      success: false,
      error: `Workflow ${params.workflowId} not in allowed list for this orchestrator`,
    };
  }

  // Add orchestrator metadata to trigger
  const fullParams: ADWTriggerParams = {
    ...params,
    triggerMeta: {
      ...params.triggerMeta,
      orchestratorId,
      orchestratorSessionKey: entry.sessionKey,
      workspaceDir: config.workspaceDir,
    },
  };

  // Trigger the ADW
  const result = await triggerADW(fullParams);

  if (result.success && result.runId) {
    // Track the ADW run
    entry.adwRuns.add(result.runId);

    // Emit event
    emitOrchestratorEvent(orchestratorId, "adw_triggered", {
      workflowId: params.workflowId,
      runId: result.runId,
      task: params.task,
    });
  }

  return {
    success: result.success,
    runId: result.runId,
    error: result.error,
  };
}

/**
 * Get the status of an ADW run.
 */
export function orchestratorGetADWStatus(orchestratorId: string, runId: string) {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return null;

  // Verify this orchestrator owns this run
  if (!entry.adwRuns.has(runId)) return null;

  return getADWRunStatus(runId);
}

/**
 * List available ADWs for the orchestrator.
 */
export function orchestratorListADWs(orchestratorId: string) {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return [];

  const config = entry.config;
  if (!config.canTriggerADWs) return [];

  const allADWs = listAvailableADWs();

  // Filter by allowed list if specified
  if (config.availableADWs && config.availableADWs.length > 0) {
    return allADWs.filter((adw) => config.availableADWs!.includes(adw.id));
  }

  return allADWs;
}

/**
 * Cancel an ADW run.
 */
export function orchestratorCancelADW(orchestratorId: string, runId: string): boolean {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return false;

  // Verify this orchestrator owns this run
  if (!entry.adwRuns.has(runId)) return false;

  const cancelled = cancelADWRun(runId);
  if (cancelled) {
    emitOrchestratorEvent(orchestratorId, "adw_failed", {
      runId,
      reason: "cancelled",
    });
  }

  return cancelled;
}

// ============================================================================
// Observability
// ============================================================================

/**
 * Get recent events from an orchestrator for observability.
 */
export function getOrchestratorEvents(orchestratorId: string, limit = 50): OrchestratorEvent[] {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return [];

  return entry.events.slice(-limit);
}

/**
 * Get the configuration for a registered orchestrator.
 */
export function getOrchestratorConfig(orchestratorId: string): OrchestratorConfig | null {
  const entry = orchestratorRegistry.get(orchestratorId);
  return entry?.config ?? null;
}

/**
 * List all registered orchestrators.
 */
export function listOrchestrators(): Array<{
  id: string;
  name?: string;
  role: string;
  sessionKey: string;
  startedAt: number;
  managedAgentCount: number;
  adwRunCount: number;
}> {
  return Array.from(orchestratorRegistry.entries()).map(([id, entry]) => ({
    id,
    name: entry.config.name,
    role: entry.config.role,
    sessionKey: entry.sessionKey,
    startedAt: entry.startedAt,
    managedAgentCount: entry.managedAgents.size,
    adwRunCount: entry.adwRuns.size,
  }));
}

/**
 * Shutdown an orchestrator and clean up resources.
 */
export function shutdownOrchestrator(orchestratorId: string): boolean {
  return orchestratorRegistry.delete(orchestratorId);
}

/**
 * Send a message to an orchestrator session.
 */
export async function sendToOrchestrator(
  orchestratorId: string,
  message: string,
): Promise<boolean> {
  const entry = orchestratorRegistry.get(orchestratorId);
  if (!entry) return false;

  try {
    await callGateway({
      method: "agent",
      params: {
        sessionKey: entry.sessionKey,
        message,
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
      },
      timeoutMs: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Exports
// ============================================================================

export {
  buildOrchestratorSystemPrompt,
  buildMinimalOrchestratorPrompt,
  buildGimliOrchestratorPrompt,
} from "./orchestrator-system-prompt.js";
export type { OrchestratorRole } from "./orchestrator-system-prompt.js";
export {
  type OrchestratorConfig,
  type ManagedAgentState,
  type WorkflowStep,
  type ExecutionPlan,
  type OrchestratorEvent,
  type OrchestratorSpawnParams,
  type OrchestratorSpawnResult,
  type CreateOrchestratorParams,
  type FleetStatus,
  ORCHESTRATOR_PRESETS,
  applyOrchestratorPreset,
} from "./orchestrator-types.js";
