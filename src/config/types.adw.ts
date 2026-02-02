/**
 * Configuration types for ADW (AI Developer Workflows).
 *
 * ADWs are programmatically triggered agent executions via HTTP endpoints,
 * part of the TAC Orchestrator Phase 9.3 Grade 1 implementation.
 */

/**
 * Configuration for the ADW HTTP trigger endpoint.
 */
export type ADWConfig = {
  /** Whether ADW triggers are enabled */
  enabled?: boolean;
  /** Bearer token for authentication (required when enabled) */
  token?: string;
  /** Base path for the ADW endpoint (default: "/adw") */
  path?: string;
  /** Maximum request body size in bytes (default: 512KB) */
  maxBodyBytes?: number;
  /** Default timeout for agent executions in seconds (default: 300) */
  defaultTimeoutSeconds?: number;
  /** Default thinking level for ADW executions */
  defaultThinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Whether to store execution results to disk (default: true) */
  storeResults?: boolean;
  /** Directory for storing results (default: ~/.gimli/adw-results/) */
  resultsDir?: string;
  /** Maximum number of results to retain in memory */
  maxActiveResults?: number;
  /** Default agent ID for ADW executions (uses configured default if not set) */
  defaultAgentId?: string;
};
