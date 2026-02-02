/**
 * Orchestrator Agent Types
 *
 * Type definitions for the O-Agent (Orchestrator Agent) system.
 * Follows TAC principles for multi-agent coordination.
 */

import type { DeliveryContext } from "../../utils/delivery-context.js";
import type { OrchestratorRole } from "./orchestrator-system-prompt.js";

/**
 * Configuration for an Orchestrator Agent instance.
 */
export type OrchestratorConfig = {
  /** Unique identifier for this orchestrator. */
  id: string;
  /** Human-readable name for the orchestrator. */
  name?: string;
  /** The orchestrator's primary role. */
  role: OrchestratorRole;
  /** Agent IDs this orchestrator can manage. Use ["*"] for all. */
  managedAgents: string[];
  /** Model to use for the orchestrator (provider/model format). */
  model?: string;
  /** Whether the orchestrator can create new agent sessions. */
  canCreateAgents: boolean;
  /** Whether the orchestrator can delete/terminate agent sessions. */
  canDeleteAgents: boolean;
  /** Whether the orchestrator can trigger AI Developer Workflows. */
  canTriggerADWs: boolean;
  /** Names of ADWs this orchestrator can trigger. */
  availableADWs?: string[];
  /** Workspace directory for the orchestrator. */
  workspaceDir?: string;
  /** Maximum concurrent agents this orchestrator can manage. */
  maxConcurrentAgents?: number;
  /** Default timeout for spawned agents (seconds). */
  defaultAgentTimeout?: number;
  /** Custom instructions appended to the system prompt. */
  customInstructions?: string;
};

/**
 * State of a managed agent as tracked by the orchestrator.
 */
export type ManagedAgentState = {
  /** The agent's session key. */
  sessionKey: string;
  /** Human-readable label for the task. */
  label?: string;
  /** The task assigned to this agent. */
  task: string;
  /** Current status of the agent. */
  status: "pending" | "running" | "completed" | "failed" | "timeout" | "cancelled";
  /** When the agent was spawned. */
  spawnedAt: number;
  /** When the agent completed (if applicable). */
  completedAt?: number;
  /** The run ID for tracking. */
  runId?: string;
  /** Error message if failed. */
  error?: string;
  /** Result summary if completed. */
  result?: string;
  /** Token usage (if available). */
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
};

/**
 * A planned workflow step in the orchestrator's execution plan.
 */
export type WorkflowStep = {
  /** Unique step identifier. */
  stepId: string;
  /** Step name/label. */
  name: string;
  /** The task to execute. */
  task: string;
  /** Which agent type/id should handle this. */
  agentTarget?: string;
  /** Dependencies - step IDs that must complete first. */
  dependsOn?: string[];
  /** Whether this step can run in parallel with siblings. */
  parallel?: boolean;
  /** Timeout for this step (seconds). */
  timeout?: number;
  /** Current status of this step. */
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  /** Result of this step if completed. */
  result?: unknown;
};

/**
 * An execution plan created by the orchestrator.
 */
export type ExecutionPlan = {
  /** Unique plan identifier. */
  planId: string;
  /** Human-readable plan name. */
  name: string;
  /** High-level description of what this plan accomplishes. */
  description: string;
  /** The steps in execution order. */
  steps: WorkflowStep[];
  /** When this plan was created. */
  createdAt: number;
  /** Current overall status. */
  status: "draft" | "executing" | "completed" | "failed" | "cancelled";
  /** Which orchestrator created this plan. */
  orchestratorId: string;
};

/**
 * Event emitted by the orchestrator for observability.
 */
export type OrchestratorEvent = {
  /** Event type. */
  type:
    | "agent_spawned"
    | "agent_completed"
    | "agent_failed"
    | "agent_timeout"
    | "plan_created"
    | "plan_started"
    | "plan_completed"
    | "plan_failed"
    | "step_started"
    | "step_completed"
    | "step_failed"
    | "adw_triggered"
    | "adw_completed"
    | "adw_failed"
    | "error";
  /** When this event occurred. */
  timestamp: number;
  /** The orchestrator that emitted this event. */
  orchestratorId: string;
  /** Additional event-specific data. */
  data: Record<string, unknown>;
};

/**
 * Parameters for spawning an agent from the orchestrator.
 */
export type OrchestratorSpawnParams = {
  /** The task to assign to the agent. */
  task: string;
  /** Optional label for tracking. */
  label?: string;
  /** Target agent ID (if delegating to a specific agent). */
  agentId?: string;
  /** Model override for this specific task. */
  model?: string;
  /** Thinking level override. */
  thinking?: string;
  /** Timeout in seconds. */
  timeoutSeconds?: number;
  /** Whether to delete the session after completion. */
  cleanup?: "delete" | "keep";
  /** Priority level for this task. */
  priority?: "low" | "normal" | "high";
  /** Context to pass to the spawned agent. */
  context?: Record<string, unknown>;
};

/**
 * Result of an orchestrator spawn operation.
 */
export type OrchestratorSpawnResult = {
  /** Whether the spawn was successful. */
  success: boolean;
  /** The child session key if successful. */
  sessionKey?: string;
  /** The run ID for tracking. */
  runId?: string;
  /** Error message if failed. */
  error?: string;
};

/**
 * Parameters for creating an orchestrator session.
 */
export type CreateOrchestratorParams = {
  /** Orchestrator configuration. */
  config: OrchestratorConfig;
  /** Initial task for the orchestrator. */
  task: string;
  /** Optional session key override. */
  sessionKey?: string;
  /** Channel for delivery. */
  channel?: string;
  /** Account ID for delivery. */
  accountId?: string;
  /** Recipient for delivery. */
  to?: string;
  /** Whether to deliver responses. */
  deliver?: boolean;
  /** Requester context. */
  requesterContext?: {
    sessionKey?: string;
    origin?: DeliveryContext;
  };
};

/**
 * Fleet status summary for observability.
 */
export type FleetStatus = {
  /** Total agents in the fleet. */
  totalAgents: number;
  /** Currently active agents. */
  activeAgents: number;
  /** Agents completed in the current session. */
  completedAgents: number;
  /** Agents that failed in the current session. */
  failedAgents: number;
  /** Total tokens used across all agents. */
  totalTokens?: number;
  /** Estimated cost across all agents. */
  estimatedCost?: number;
  /** Managed agent states. */
  agents: ManagedAgentState[];
};

/**
 * Default orchestrator configuration presets.
 */
export const ORCHESTRATOR_PRESETS: Record<string, Partial<OrchestratorConfig>> = {
  /** Minimal coordinator for simple delegation tasks. */
  minimal: {
    role: "coordinator",
    canCreateAgents: true,
    canDeleteAgents: false,
    canTriggerADWs: false,
    maxConcurrentAgents: 3,
    defaultAgentTimeout: 300,
  },
  /** Standard coordinator with full capabilities. */
  standard: {
    role: "coordinator",
    canCreateAgents: true,
    canDeleteAgents: true,
    canTriggerADWs: true,
    maxConcurrentAgents: 10,
    defaultAgentTimeout: 600,
  },
  /** Supervisor focused on monitoring and intervention. */
  supervisor: {
    role: "supervisor",
    canCreateAgents: false,
    canDeleteAgents: true,
    canTriggerADWs: false,
    maxConcurrentAgents: 20,
    defaultAgentTimeout: 900,
  },
  /** Planner focused on workflow design. */
  planner: {
    role: "planner",
    canCreateAgents: true,
    canDeleteAgents: false,
    canTriggerADWs: false,
    maxConcurrentAgents: 5,
    defaultAgentTimeout: 300,
  },
  /** Full autonomous executor with ADW capabilities. */
  executor: {
    role: "executor",
    canCreateAgents: true,
    canDeleteAgents: true,
    canTriggerADWs: true,
    maxConcurrentAgents: 15,
    defaultAgentTimeout: 1200,
  },
};

/**
 * Apply a preset to an orchestrator config.
 */
export function applyOrchestratorPreset(
  preset: keyof typeof ORCHESTRATOR_PRESETS,
  overrides: Partial<OrchestratorConfig> = {},
): Partial<OrchestratorConfig> {
  const base = ORCHESTRATOR_PRESETS[preset];
  if (!base) {
    throw new Error(`Unknown orchestrator preset: ${preset}`);
  }
  return { ...base, ...overrides };
}
