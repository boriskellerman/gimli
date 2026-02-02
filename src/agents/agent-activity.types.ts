/**
 * Multi-agent observability types.
 * Provides data structures for tracking agent activity, context, and work across the system.
 */

import type { DeliveryContext } from "../utils/delivery-context.js";

/**
 * The current status of an agent run.
 */
export type AgentRunStatus = "pending" | "running" | "completed" | "failed" | "aborted";

/**
 * A snapshot of an active or recent agent run.
 */
export type AgentRunSnapshot = {
  /** Unique run identifier. */
  runId: string;
  /** Agent ID handling this run. */
  agentId: string;
  /** Session key for this run. */
  sessionKey: string;
  /** Current status of the run. */
  status: AgentRunStatus;
  /** Timestamp when the run started. */
  startedAt: number;
  /** Timestamp when the run ended (if finished). */
  endedAt?: number;
  /** Duration in milliseconds (updated in real-time for running tasks). */
  durationMs?: number;
  /** Brief description of what the agent is working on. */
  task?: string;
  /** The triggering message or input (truncated for display). */
  inputPreview?: string;
  /** Whether this is a subagent run. */
  isSubagent: boolean;
  /** Parent session key if this is a subagent. */
  parentSessionKey?: string;
  /** Delivery context (channel info). */
  deliveryContext?: DeliveryContext;
  /** Model being used. */
  model?: string;
  /** Provider for the model. */
  modelProvider?: string;
  /** Current tool being executed (if any). */
  currentTool?: string;
  /** Last error message (if status is 'failed'). */
  error?: string;
  /** Count of events emitted by this run. */
  eventCount: number;
  /** Count of tool calls made. */
  toolCallCount: number;
  /** Label for display purposes. */
  label?: string;
};

/**
 * Aggregate status for an agent.
 */
export type AgentObservabilityStatus = {
  /** Agent ID. */
  agentId: string;
  /** Agent display name. */
  name?: string;
  /** Number of active runs. */
  activeRuns: number;
  /** Number of completed runs in the observation window. */
  completedRuns: number;
  /** Number of failed runs in the observation window. */
  failedRuns: number;
  /** Total runs in the observation window. */
  totalRuns: number;
  /** Most recent run ID. */
  latestRunId?: string;
  /** Most recent activity timestamp. */
  lastActivityAt?: number;
  /** Active run snapshots. */
  runs: AgentRunSnapshot[];
};

/**
 * System-wide observability snapshot.
 */
export type MultiAgentObservabilitySnapshot = {
  /** Timestamp when snapshot was taken. */
  ts: number;
  /** Total active agent runs across all agents. */
  totalActiveRuns: number;
  /** Total agents with activity. */
  totalAgentsWithActivity: number;
  /** Per-agent status. */
  agents: AgentObservabilityStatus[];
};

/**
 * Options for querying agent activity.
 */
export type AgentActivityQueryOptions = {
  /** Filter to specific agent IDs. */
  agentIds?: string[];
  /** Include only active runs. */
  activeOnly?: boolean;
  /** Maximum number of runs per agent. */
  limitPerAgent?: number;
  /** Include runs from the last N minutes. */
  windowMinutes?: number;
  /** Include subagent runs. */
  includeSubagents?: boolean;
};

/**
 * An event emitted when agent activity changes.
 */
export type AgentActivityEvent = {
  type: "run:start" | "run:update" | "run:end";
  runId: string;
  agentId: string;
  snapshot: AgentRunSnapshot;
  ts: number;
};
