/**
 * FleetManager - Single-interface pattern for agent fleet management
 *
 * Implements the TAC Orchestrator's three pillars:
 * 1. CRUD for Agents - Create, Read, Update, Delete agent configurations
 * 2. Observability - Real-time visibility into agent state and operations
 * 3. Orchestration - Unified control plane for the agent fleet
 *
 * This provides a cohesive API that consolidates agent management operations
 * previously scattered across agent-scope.ts, subagent-registry.ts, and agent-events.ts.
 */

import { loadConfig, writeConfigFile } from "../config/config.js";
import type { GimliConfig } from "../config/types.js";
import type { AgentConfig, AgentsConfig } from "../config/types.agents.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  listAgentIds,
  resolveAgentConfig,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import {
  type AgentEventPayload,
  type AgentRunContext,
  onAgentEvent,
  registerAgentRunContext,
} from "../infra/agent-events.js";
import {
  type SubagentRunRecord,
  listSubagentRunsForRequester,
} from "../agents/subagent-registry.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Comprehensive agent summary combining configuration and runtime state.
 */
export type AgentSummary = {
  id: string;
  name?: string;
  isDefault: boolean;
  workspace: string;
  agentDir: string;
  model?: AgentConfig["model"];
  identity?: AgentConfig["identity"];
  sandbox?: AgentConfig["sandbox"];
  tools?: AgentConfig["tools"];
  subagents?: AgentConfig["subagents"];
  heartbeat?: AgentConfig["heartbeat"];
};

/**
 * Agent runtime state for observability.
 */
export type AgentRuntimeState = {
  runId: string;
  sessionKey?: string;
  verboseLevel?: string;
  isHeartbeat?: boolean;
  startedAt?: number;
  status: "running" | "completed" | "error" | "unknown";
};

/**
 * Fleet-wide statistics for observability dashboard.
 */
export type FleetStats = {
  totalAgents: number;
  activeRuns: number;
  subagentRuns: number;
  defaultAgentId: string;
  agentIds: string[];
};

/**
 * Options for creating a new agent.
 */
export type CreateAgentOptions = {
  id: string;
  name?: string;
  isDefault?: boolean;
  workspace?: string;
  model?: AgentConfig["model"];
  identity?: AgentConfig["identity"];
  sandbox?: AgentConfig["sandbox"];
  tools?: AgentConfig["tools"];
  subagents?: AgentConfig["subagents"];
  heartbeat?: AgentConfig["heartbeat"];
};

/**
 * Options for updating an existing agent.
 */
export type UpdateAgentOptions = Partial<Omit<CreateAgentOptions, "id">>;

/**
 * Event listener callback type for agent events.
 */
export type FleetEventListener = (event: AgentEventPayload) => void;

// ─────────────────────────────────────────────────────────────────────────────
// FleetManager Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single-interface pattern for managing an agent fleet.
 *
 * Consolidates CRUD operations, observability, and orchestration into one API.
 *
 * @example
 * ```typescript
 * const fleet = new FleetManager();
 *
 * // CRUD operations
 * await fleet.createAgent({ id: "researcher", name: "Research Agent" });
 * const agent = fleet.getAgent("researcher");
 * await fleet.updateAgent("researcher", { name: "Senior Researcher" });
 * await fleet.deleteAgent("researcher");
 *
 * // Observability
 * const stats = fleet.getFleetStats();
 * const runs = fleet.getActiveRuns("researcher");
 * fleet.onEvent((event) => console.log(event));
 *
 * // Fleet-wide operations
 * const all = fleet.listAgents();
 * ```
 */
export class FleetManager {
  private eventListeners: Set<FleetEventListener> = new Set();
  private eventUnsubscribe: (() => void) | null = null;
  private activeRuns: Map<string, AgentRuntimeState> = new Map();

  constructor() {
    this.initializeEventListener();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // CRUD Operations (Pillar 1)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Create a new agent configuration.
   *
   * @param options - Agent configuration options
   * @returns The created agent summary
   * @throws Error if agent with same ID already exists
   */
  async createAgent(options: CreateAgentOptions): Promise<AgentSummary> {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(options.id);

    // Check for existing agent
    const existingIds = listAgentIds(cfg);
    if (existingIds.includes(normalizedId)) {
      throw new Error(`Agent with id "${normalizedId}" already exists`);
    }

    // Build new agent config
    const newAgent: AgentConfig = {
      id: normalizedId,
      default: options.isDefault,
      name: options.name,
      workspace: options.workspace,
      model: options.model,
      identity: options.identity,
      sandbox: options.sandbox,
      tools: options.tools,
      subagents: options.subagents,
      heartbeat: options.heartbeat,
    };

    // Update config
    const agents: AgentsConfig = cfg.agents ?? { list: [] };
    const list = [...(agents.list ?? [])];
    list.push(newAgent);

    const updatedConfig: GimliConfig = {
      ...cfg,
      agents: { ...agents, list },
    };
    await writeConfigFile(updatedConfig);

    return this.getAgent(normalizedId)!;
  }

  /**
   * Get an agent's configuration and computed properties.
   *
   * @param agentId - The agent ID to retrieve
   * @returns Agent summary or undefined if not found
   */
  getAgent(agentId: string): AgentSummary | undefined {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(agentId);
    const agentConfig = resolveAgentConfig(cfg, normalizedId);

    if (!agentConfig) {
      // Check if it's the implicit default agent
      const ids = listAgentIds(cfg);
      if (!ids.includes(normalizedId)) {
        return undefined;
      }
    }

    const defaultId = resolveDefaultAgentId(cfg);
    const workspace = resolveAgentWorkspaceDir(cfg, normalizedId);
    const agentDir = resolveAgentDir(cfg, normalizedId);

    return {
      id: normalizedId,
      name: agentConfig?.name,
      isDefault: normalizedId === defaultId,
      workspace,
      agentDir,
      model: agentConfig?.model,
      identity: agentConfig?.identity,
      sandbox: agentConfig?.sandbox,
      tools: agentConfig?.tools,
      subagents: agentConfig?.subagents,
      heartbeat: agentConfig?.heartbeat,
    };
  }

  /**
   * Update an existing agent's configuration.
   *
   * @param agentId - The agent ID to update
   * @param updates - Partial configuration updates
   * @returns Updated agent summary
   * @throws Error if agent not found
   */
  async updateAgent(agentId: string, updates: UpdateAgentOptions): Promise<AgentSummary> {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(agentId);

    const agents: AgentsConfig = cfg.agents ?? { list: [] };
    const list = [...(agents.list ?? [])];
    const index = list.findIndex((a) => normalizeAgentId(a.id) === normalizedId);

    if (index === -1) {
      throw new Error(`Agent "${normalizedId}" not found`);
    }

    // Merge updates
    const existing = list[index];
    const updated: AgentConfig = {
      ...existing,
      name: updates.name !== undefined ? updates.name : existing.name,
      default: updates.isDefault !== undefined ? updates.isDefault : existing.default,
      workspace: updates.workspace !== undefined ? updates.workspace : existing.workspace,
      model: updates.model !== undefined ? updates.model : existing.model,
      identity: updates.identity !== undefined ? updates.identity : existing.identity,
      sandbox: updates.sandbox !== undefined ? updates.sandbox : existing.sandbox,
      tools: updates.tools !== undefined ? updates.tools : existing.tools,
      subagents: updates.subagents !== undefined ? updates.subagents : existing.subagents,
      heartbeat: updates.heartbeat !== undefined ? updates.heartbeat : existing.heartbeat,
    };

    list[index] = updated;
    const updatedConfig: GimliConfig = {
      ...cfg,
      agents: { ...agents, list },
    };
    await writeConfigFile(updatedConfig);

    return this.getAgent(normalizedId)!;
  }

  /**
   * Delete an agent configuration.
   *
   * @param agentId - The agent ID to delete
   * @returns true if deleted, false if not found
   */
  async deleteAgent(agentId: string): Promise<boolean> {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(agentId);

    const agents: AgentsConfig = cfg.agents ?? { list: [] };
    const list = [...(agents.list ?? [])];
    const index = list.findIndex((a) => normalizeAgentId(a.id) === normalizedId);

    if (index === -1) {
      return false;
    }

    list.splice(index, 1);
    const updatedConfig: GimliConfig = {
      ...cfg,
      agents: { ...agents, list },
    };
    await writeConfigFile(updatedConfig);

    return true;
  }

  /**
   * List all configured agents with their summaries.
   *
   * @returns Array of agent summaries
   */
  listAgents(): AgentSummary[] {
    const cfg = loadConfig();
    const ids = listAgentIds(cfg);
    return ids.map((id) => this.getAgent(id)!).filter(Boolean);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Observability (Pillar 2)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get fleet-wide statistics.
   *
   * @returns Fleet statistics including agent counts and active runs
   */
  getFleetStats(): FleetStats {
    const cfg = loadConfig();
    const agentIds = listAgentIds(cfg);
    const defaultAgentId = resolveDefaultAgentId(cfg);

    // Count active runs across all agents
    const activeRuns = this.activeRuns.size;

    // Count total subagent runs (from all requesters)
    let subagentRuns = 0;
    for (const agentId of agentIds) {
      const sessionKey = `agent:${agentId}:main`;
      const runs = listSubagentRunsForRequester(sessionKey);
      subagentRuns += runs.length;
    }

    return {
      totalAgents: agentIds.length,
      activeRuns,
      subagentRuns,
      defaultAgentId,
      agentIds,
    };
  }

  /**
   * Get runtime state for a specific run.
   *
   * @param runId - The run ID to query
   * @returns Runtime state or undefined if not tracked
   */
  getRunState(runId: string): AgentRuntimeState | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * Get all active runs, optionally filtered by agent.
   *
   * @param agentId - Optional agent ID to filter by
   * @returns Array of active runtime states
   */
  getActiveRuns(agentId?: string): AgentRuntimeState[] {
    const runs = Array.from(this.activeRuns.values());
    if (!agentId) return runs;

    const normalizedId = normalizeAgentId(agentId);
    return runs.filter((run) => {
      if (!run.sessionKey) return false;
      return run.sessionKey.includes(`agent:${normalizedId}:`);
    });
  }

  /**
   * Get subagent runs for a parent session.
   *
   * @param requesterSessionKey - The parent session key
   * @returns Array of subagent run records
   */
  getSubagentRuns(requesterSessionKey: string): SubagentRunRecord[] {
    return listSubagentRunsForRequester(requesterSessionKey);
  }

  /**
   * Register a run context for tracking.
   *
   * @param runId - The run ID
   * @param context - The run context
   */
  registerRun(runId: string, context: AgentRunContext): void {
    registerAgentRunContext(runId, context);
    this.activeRuns.set(runId, {
      runId,
      sessionKey: context.sessionKey,
      verboseLevel: context.verboseLevel,
      isHeartbeat: context.isHeartbeat,
      startedAt: Date.now(),
      status: "running",
    });
  }

  /**
   * Subscribe to fleet-wide agent events.
   *
   * @param listener - Callback for agent events
   * @returns Unsubscribe function
   */
  onEvent(listener: FleetEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Orchestration Helpers (Pillar 3)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Get the default agent ID.
   *
   * @returns The default agent ID
   */
  getDefaultAgentId(): string {
    const cfg = loadConfig();
    return resolveDefaultAgentId(cfg);
  }

  /**
   * Set which agent is the default.
   *
   * @param agentId - The agent ID to make default
   * @throws Error if agent not found
   */
  async setDefaultAgent(agentId: string): Promise<void> {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(agentId);

    const agents: AgentsConfig = cfg.agents ?? { list: [] };
    const list = [...(agents.list ?? [])];
    const targetIndex = list.findIndex((a) => normalizeAgentId(a.id) === normalizedId);

    if (targetIndex === -1) {
      throw new Error(`Agent "${normalizedId}" not found`);
    }

    // Clear default from all, set on target
    for (let i = 0; i < list.length; i++) {
      list[i] = { ...list[i], default: i === targetIndex };
    }

    const updatedConfig: GimliConfig = {
      ...cfg,
      agents: { ...agents, list },
    };
    await writeConfigFile(updatedConfig);
  }

  /**
   * Check if an agent exists.
   *
   * @param agentId - The agent ID to check
   * @returns true if agent exists
   */
  hasAgent(agentId: string): boolean {
    const cfg = loadConfig();
    const normalizedId = normalizeAgentId(agentId);
    return listAgentIds(cfg).includes(normalizedId);
  }

  /**
   * Get the workspace directory for an agent.
   *
   * @param agentId - The agent ID
   * @returns Workspace directory path
   */
  getWorkspaceDir(agentId: string): string {
    const cfg = loadConfig();
    return resolveAgentWorkspaceDir(cfg, agentId);
  }

  /**
   * Get the agent state directory.
   *
   * @param agentId - The agent ID
   * @returns Agent state directory path
   */
  getAgentDir(agentId: string): string {
    const cfg = loadConfig();
    return resolveAgentDir(cfg, agentId);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internal Methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Initialize the internal event listener for tracking run state.
   */
  private initializeEventListener(): void {
    if (this.eventUnsubscribe) return;

    this.eventUnsubscribe = onAgentEvent((event) => {
      // Update internal run tracking
      if (event.stream === "lifecycle") {
        const phase = event.data?.phase;
        const existing = this.activeRuns.get(event.runId);

        if (phase === "start" && !existing) {
          this.activeRuns.set(event.runId, {
            runId: event.runId,
            sessionKey: event.sessionKey,
            startedAt:
              typeof event.data?.startedAt === "number" ? event.data.startedAt : Date.now(),
            status: "running",
          });
        } else if (phase === "end" || phase === "error") {
          if (existing) {
            existing.status = phase === "error" ? "error" : "completed";
          }
          // Clean up after a delay to allow final event delivery
          setTimeout(() => this.activeRuns.delete(event.runId), 5000);
        }
      }

      // Broadcast to fleet listeners
      for (const listener of this.eventListeners) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    });
  }

  /**
   * Dispose of resources. Call when done with the FleetManager.
   */
  dispose(): void {
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe();
      this.eventUnsubscribe = null;
    }
    this.eventListeners.clear();
    this.activeRuns.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

let defaultFleetManager: FleetManager | null = null;

/**
 * Get the default FleetManager singleton.
 *
 * @returns The default FleetManager instance
 */
export function getFleetManager(): FleetManager {
  if (!defaultFleetManager) {
    defaultFleetManager = new FleetManager();
  }
  return defaultFleetManager;
}

/**
 * Reset the default FleetManager (primarily for testing).
 */
export function resetFleetManager(): void {
  if (defaultFleetManager) {
    defaultFleetManager.dispose();
    defaultFleetManager = null;
  }
}
