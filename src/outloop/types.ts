/**
 * Types for the Outloop HTTP trigger → agent execution pipeline.
 *
 * This implements the PETER framework: Prompt → Environment → Trigger → Execute → Result
 * as described in TAC Phase 9.3 Grade 1.
 */

import type { HookMessageChannel } from "../gateway/hooks.js";

/**
 * Request payload for triggering an ADW (AI Developer Workflow).
 * Sent via POST to the ADW trigger endpoint.
 */
export type ADWTriggerRequest = {
  /** The message/prompt to send to the agent */
  message: string;
  /** Optional name for this ADW execution (for logging/tracking) */
  name?: string;
  /** Optional agent ID to use (defaults to configured default agent) */
  agentId?: string;
  /** Optional session key for the agent (defaults to auto-generated) */
  sessionKey?: string;
  /** Optional model override (e.g., "claude-sonnet-4-20250514") */
  model?: string;
  /** Optional thinking level override (off/minimal/low/medium/high/xhigh) */
  thinking?: string;
  /** Timeout in seconds for agent execution */
  timeoutSeconds?: number;
  /** Whether to deliver output to a channel */
  deliver?: boolean;
  /** Target channel for delivery (last, telegram, discord, etc.) */
  channel?: HookMessageChannel;
  /** Target recipient for delivery */
  to?: string;
  /** Wake mode: "now" wakes the main session immediately, "next-heartbeat" queues for later */
  wakeMode?: "now" | "next-heartbeat";
  /** Allow potentially unsafe external content without prompt injection scanning */
  allowUnsafeExternalContent?: boolean;
  /** Metadata for tracking and auditing */
  metadata?: ADWTriggerMetadata;
};

/**
 * Metadata attached to ADW executions for tracking and auditing.
 */
export type ADWTriggerMetadata = {
  /** Source of the trigger (e.g., "github-issue", "cron", "manual") */
  source?: string;
  /** External reference ID (e.g., GitHub issue number) */
  externalId?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Custom key-value pairs */
  custom?: Record<string, unknown>;
};

/**
 * Response from triggering an ADW.
 * Returned immediately (202 Accepted) since execution is async.
 */
export type ADWTriggerResponse = {
  ok: true;
  /** Unique run ID for tracking this execution */
  runId: string;
  /** Session key used for the execution */
  sessionKey: string;
  /** Agent ID that will execute the ADW */
  agentId: string;
  /** Timestamp when the ADW was triggered */
  triggeredAt: string;
};

/**
 * Error response when ADW trigger fails validation.
 */
export type ADWTriggerErrorResponse = {
  ok: false;
  error: string;
  /** Optional error code for programmatic handling */
  code?: string;
};

/**
 * Result of an ADW execution (retrieved after completion).
 */
export type ADWExecutionResult = {
  /** Unique run ID */
  runId: string;
  /** Execution status */
  status: "ok" | "error" | "skipped" | "pending" | "running";
  /** Summary of the agent's work */
  summary?: string;
  /** Full output text from the agent */
  outputText?: string;
  /** Error message if status is "error" */
  error?: string;
  /** Execution timing */
  timing?: {
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
  };
  /** Agent metadata */
  agent?: {
    agentId: string;
    model?: string;
    provider?: string;
  };
  /** Token usage */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

/**
 * Internal state for tracking active ADW executions.
 */
export type ADWExecutionState = {
  runId: string;
  status: ADWExecutionResult["status"];
  request: ADWTriggerRequest;
  sessionKey: string;
  agentId: string;
  startedAt: Date;
  completedAt?: Date;
  result?: ADWExecutionResult;
};

/**
 * Configuration for the ADW trigger endpoint.
 */
export type ADWTriggerConfig = {
  /** Whether ADW triggers are enabled */
  enabled: boolean;
  /** Bearer token for authentication */
  token: string;
  /** Base path for the ADW endpoint (e.g., "/adw") */
  basePath: string;
  /** Maximum request body size in bytes */
  maxBodyBytes: number;
  /** Default timeout for agent executions in seconds */
  defaultTimeoutSeconds: number;
  /** Default thinking level */
  defaultThinking?: string;
  /** Whether to store execution results */
  storeResults: boolean;
  /** Directory for storing results */
  resultsDir?: string;
};

/**
 * Normalized ADW trigger payload after validation.
 */
export type NormalizedADWPayload = {
  message: string;
  name: string;
  agentId?: string;
  sessionKey: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
  deliver: boolean;
  channel: HookMessageChannel;
  to?: string;
  wakeMode: "now" | "next-heartbeat";
  allowUnsafeExternalContent: boolean;
  metadata?: ADWTriggerMetadata;
};
