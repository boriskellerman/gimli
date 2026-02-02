/**
 * Programmatic Agent SDK Types
 *
 * These types provide a clean interface for programmatic agent execution,
 * inspired by the Claude Agent SDK's design patterns.
 */

import type { ClientToolDefinition } from "../agents/pi-embedded-runner/run/params.js";
import type { ImageContent, AgentStreamParams } from "../commands/agent/types.js";
import type { ThinkLevel, VerboseLevel } from "../auto-reply/thinking.js";

/**
 * Options for configuring agent execution.
 */
export type AgentQueryOptions = {
  /**
   * Current working directory for the agent.
   * Defaults to the configured agent workspace directory.
   */
  cwd?: string;

  /**
   * Agent ID to use. Defaults to the configured default agent.
   */
  agentId?: string;

  /**
   * Session ID for conversation continuity.
   * If not provided, a new session will be created.
   */
  sessionId?: string;

  /**
   * Session key for named session lookup (e.g., "main-telegram:+1234567890").
   */
  sessionKey?: string;

  /**
   * Target identifier (E.164 phone number for direct addressing).
   */
  to?: string;

  /**
   * Model provider override (e.g., "anthropic", "openai").
   */
  provider?: string;

  /**
   * Model name override (e.g., "claude-3-5-sonnet-20241022").
   */
  model?: string;

  /**
   * Thinking level: "off", "low", "medium", "high", "xhigh".
   */
  thinkingLevel?: ThinkLevel;

  /**
   * Verbose output level: "on", "off", "full".
   */
  verboseLevel?: VerboseLevel;

  /**
   * Maximum execution time in milliseconds.
   */
  timeoutMs?: number;

  /**
   * Image attachments for multimodal messages.
   */
  images?: ImageContent[];

  /**
   * Custom tool definitions for the agent to use.
   */
  customTools?: ClientToolDefinition[];

  /**
   * Abort signal for cancellation.
   */
  abortSignal?: AbortSignal;

  /**
   * Additional system prompt to append to the default.
   */
  systemPrompt?: string;

  /**
   * Stream parameters (temperature, maxTokens).
   */
  streamParams?: AgentStreamParams;

  /**
   * Whether to deliver the response via configured channels.
   */
  deliver?: boolean;

  /**
   * Lane for execution queue management.
   */
  lane?: string;
};

/**
 * Message types emitted during agent execution.
 */
export type AgentMessageType =
  | "assistant"
  | "assistant_chunk"
  | "tool_call"
  | "tool_result"
  | "reasoning"
  | "result"
  | "error";

/**
 * Base message interface.
 */
export type AgentMessageBase = {
  type: AgentMessageType;
  timestamp: number;
  sessionId: string;
};

/**
 * Assistant message chunk during streaming.
 */
export type AgentAssistantChunkMessage = AgentMessageBase & {
  type: "assistant_chunk";
  text?: string;
  mediaUrls?: string[];
};

/**
 * Complete assistant message.
 */
export type AgentAssistantMessage = AgentMessageBase & {
  type: "assistant";
  text?: string;
  mediaUrls?: string[];
  audioAsVoice?: boolean;
};

/**
 * Tool invocation message.
 */
export type AgentToolCallMessage = AgentMessageBase & {
  type: "tool_call";
  toolId: string;
  toolName: string;
  arguments: string;
};

/**
 * Tool result message.
 */
export type AgentToolResultMessage = AgentMessageBase & {
  type: "tool_result";
  toolId: string;
  text?: string;
  mediaUrls?: string[];
};

/**
 * Reasoning/thinking output.
 */
export type AgentReasoningMessage = AgentMessageBase & {
  type: "reasoning";
  text?: string;
};

/**
 * Final result message.
 */
export type AgentResultMessage = AgentMessageBase & {
  type: "result";
  subtype: "success" | "error" | "timeout" | "aborted";
  result?: string;
  payloads?: Array<{
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    isError?: boolean;
  }>;
  meta: {
    durationMs: number;
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
    stopReason?: string;
  };
};

/**
 * Error message.
 */
export type AgentErrorMessage = AgentMessageBase & {
  type: "error";
  error: string;
  code?: string;
};

/**
 * Union of all agent message types.
 */
export type AgentMessage =
  | AgentAssistantChunkMessage
  | AgentAssistantMessage
  | AgentToolCallMessage
  | AgentToolResultMessage
  | AgentReasoningMessage
  | AgentResultMessage
  | AgentErrorMessage;

/**
 * Callback function for receiving agent messages.
 */
export type AgentMessageCallback = (message: AgentMessage) => void | Promise<void>;

/**
 * Result of a non-streaming agent query.
 */
export type AgentQueryResult = {
  sessionId: string;
  result?: string;
  payloads: Array<{
    text?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    isError?: boolean;
  }>;
  meta: {
    durationMs: number;
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
    stopReason?: string;
    aborted?: boolean;
  };
};
