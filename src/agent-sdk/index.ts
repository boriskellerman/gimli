/**
 * Gimli Agent SDK
 *
 * Programmatic interface for executing Gimli agents, inspired by the
 * Claude Agent SDK patterns. Provides async-iterable streaming, one-shot
 * queries, and callback-based execution modes.
 *
 * @example
 * ```typescript
 * import { query, queryOnce, AgentMessage } from "gimli/plugin-sdk";
 *
 * // Streaming with async iteration
 * for await (const message of query("What files are here?")) {
 *   if (message.type === "assistant_chunk") {
 *     process.stdout.write(message.text ?? "");
 *   }
 * }
 *
 * // One-shot query
 * const result = await queryOnce("What is 2 + 2?");
 * console.log(result.result);
 * ```
 *
 * @module
 */

// Query functions
export { query, queryOnce, queryWithCallback } from "./query.js";

// Types
export type {
  // Options
  AgentQueryOptions,
  AgentQueryResult,
  // Messages
  AgentMessage,
  AgentMessageType,
  AgentMessageBase,
  AgentAssistantChunkMessage,
  AgentAssistantMessage,
  AgentToolCallMessage,
  AgentToolResultMessage,
  AgentReasoningMessage,
  AgentResultMessage,
  AgentErrorMessage,
  AgentMessageCallback,
} from "./types.js";
