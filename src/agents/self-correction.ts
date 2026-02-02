/**
 * Self-correction capabilities for agents.
 *
 * Self-correction allows agents to analyze and retry failed tool operations,
 * giving the LLM a chance to fix its own mistakes (e.g., wrong file path,
 * invalid JSON, incorrect parameters).
 *
 * This is different from the existing retry mechanisms:
 * - Model fallback: switches to backup models on API failures
 * - Auth profile rotation: cycles through API keys on rate limits
 * - Context overflow compaction: auto-summarizes when context is full
 *
 * Self-correction specifically handles recoverable tool errors where the
 * model can learn from the error message and retry with corrected inputs.
 */

import type { GimliConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";

/**
 * Self-correction configuration.
 */
export type SelfCorrectionConfig = {
  /**
   * Enable self-correction for tool errors (default: true).
   */
  enabled?: boolean;

  /**
   * Maximum number of self-correction attempts per run (default: 2).
   * After this many correction attempts, the error is surfaced to the user.
   */
  maxAttempts?: number;

  /**
   * Delay in milliseconds before triggering self-correction (default: 0).
   * This can help avoid rate limits when retrying quickly.
   */
  delayMs?: number;

  /**
   * Custom self-correction prompt. Use {toolName} and {error} placeholders.
   * Default prompt instructs the agent to analyze the error and retry.
   */
  prompt?: string;

  /**
   * Tool names to exclude from self-correction (always surface errors immediately).
   * Useful for tools where retrying doesn't make sense (e.g., external API calls).
   */
  excludeTools?: string[];

  /**
   * Error patterns to exclude from self-correction (regex strings).
   * Errors matching these patterns will be surfaced immediately.
   */
  excludeErrorPatterns?: string[];
};

/**
 * Self-correction state tracked during a run.
 */
export type SelfCorrectionState = {
  /** Number of self-correction attempts made so far. */
  attempts: number;
  /** Tool errors encountered in the current run. */
  toolErrors: Array<{
    toolName: string;
    error: string;
    timestamp: number;
  }>;
  /** Whether self-correction is currently active. */
  active: boolean;
  /** Last self-correction prompt sent. */
  lastPrompt?: string;
};

/**
 * Default self-correction prompt template.
 */
export const DEFAULT_SELF_CORRECTION_PROMPT = `The previous tool call "{toolName}" failed with error: {error}

Analyze this error and determine the correct approach:
1. If the error indicates a wrong path, parameter, or format - retry with corrected values
2. If the error suggests the operation cannot succeed - explain why and try an alternative approach
3. If you need more information - use appropriate tools to gather it first

Do not repeat the exact same operation that failed. Either fix the issue or try a different approach.`;

/**
 * Creates a new self-correction state.
 */
export function createSelfCorrectionState(): SelfCorrectionState {
  return {
    attempts: 0,
    toolErrors: [],
    active: false,
    lastPrompt: undefined,
  };
}

/**
 * Resolves self-correction configuration from the config.
 */
export function resolveSelfCorrectionConfig(config?: GimliConfig): Required<SelfCorrectionConfig> {
  const defaults: Required<SelfCorrectionConfig> = {
    enabled: true,
    maxAttempts: 2,
    delayMs: 0,
    prompt: DEFAULT_SELF_CORRECTION_PROMPT,
    excludeTools: [],
    excludeErrorPatterns: [],
  };

  const agentDefaults = config?.agents?.defaults as
    | (AgentDefaultsConfig & { selfCorrection?: SelfCorrectionConfig })
    | undefined;
  const userConfig = agentDefaults?.selfCorrection;

  if (!userConfig) {
    return defaults;
  }

  return {
    enabled: userConfig.enabled ?? defaults.enabled,
    maxAttempts: userConfig.maxAttempts ?? defaults.maxAttempts,
    delayMs: userConfig.delayMs ?? defaults.delayMs,
    prompt: userConfig.prompt ?? defaults.prompt,
    excludeTools: userConfig.excludeTools ?? defaults.excludeTools,
    excludeErrorPatterns: userConfig.excludeErrorPatterns ?? defaults.excludeErrorPatterns,
  };
}

/**
 * Determines if a tool error is eligible for self-correction.
 */
export function isEligibleForSelfCorrection(params: {
  toolName: string;
  error: string;
  config: Required<SelfCorrectionConfig>;
  state: SelfCorrectionState;
}): boolean {
  const { toolName, error, config, state } = params;

  // Check if self-correction is enabled
  if (!config.enabled) {
    return false;
  }

  // Check max attempts
  if (state.attempts >= config.maxAttempts) {
    return false;
  }

  // Check excluded tools
  const normalizedToolName = toolName.toLowerCase().trim();
  if (config.excludeTools.some((t) => t.toLowerCase().trim() === normalizedToolName)) {
    return false;
  }

  // Check excluded error patterns
  const errorLower = error.toLowerCase();
  for (const pattern of config.excludeErrorPatterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(error)) {
        return false;
      }
    } catch {
      // Invalid regex, check as substring
      if (errorLower.includes(pattern.toLowerCase())) {
        return false;
      }
    }
  }

  // Check if this is a recoverable error (validation, parameter errors, etc.)
  const isRecoverable = isRecoverableToolError(error);

  return isRecoverable;
}

/**
 * Determines if a tool error is likely recoverable through self-correction.
 */
export function isRecoverableToolError(error: string): boolean {
  const errorLower = error.toLowerCase();

  // Recoverable error patterns (the model can fix these)
  const recoverablePatterns = [
    // Parameter validation errors
    "required",
    "missing",
    "invalid",
    "must be",
    "must have",
    "needs",
    "requires",
    "expected",
    "cannot be empty",
    "cannot be null",

    // Path/file errors
    "not found",
    "no such file",
    "enoent",
    "does not exist",
    "path",
    "directory",
    "file",

    // Format errors
    "parse",
    "json",
    "syntax",
    "malformed",
    "format",
    "encoding",

    // Type errors
    "type",
    "string",
    "number",
    "boolean",
    "array",
    "object",

    // Range errors
    "out of range",
    "too long",
    "too short",
    "exceeds",
    "maximum",
    "minimum",
  ];

  // Non-recoverable error patterns (don't retry these)
  const nonRecoverablePatterns = [
    // Permission/auth errors (model can't fix these)
    "permission denied",
    "access denied",
    "unauthorized",
    "forbidden",
    "authentication",

    // Network errors (transient, different retry mechanism)
    "network",
    "connection",
    "timeout",
    "timed out",
    "etimedout",
    "econnrefused",
    "econnreset",

    // Rate limits (handled by auth profile rotation)
    "rate limit",
    "too many requests",
    "quota exceeded",

    // Disk/resource errors
    "disk full",
    "no space",
    "out of memory",

    // Process errors
    "killed",
    "signal",
    "segfault",
  ];

  // Check for non-recoverable patterns first
  for (const pattern of nonRecoverablePatterns) {
    if (errorLower.includes(pattern)) {
      return false;
    }
  }

  // Check for recoverable patterns
  for (const pattern of recoverablePatterns) {
    if (errorLower.includes(pattern)) {
      return true;
    }
  }

  // Default: not recoverable (be conservative)
  return false;
}

/**
 * Builds the self-correction prompt for a failed tool operation.
 */
export function buildSelfCorrectionPrompt(params: {
  toolName: string;
  error: string;
  config: Required<SelfCorrectionConfig>;
}): string {
  const { toolName, error, config } = params;

  return config.prompt.replace(/\{toolName\}/g, toolName).replace(/\{error\}/g, error.trim());
}

/**
 * Records a tool error in the self-correction state.
 */
export function recordToolError(state: SelfCorrectionState, toolName: string, error: string): void {
  state.toolErrors.push({
    toolName,
    error,
    timestamp: Date.now(),
  });
}

/**
 * Gets the last tool error from the self-correction state.
 */
export function getLastToolError(
  state: SelfCorrectionState,
): { toolName: string; error: string } | undefined {
  if (state.toolErrors.length === 0) {
    return undefined;
  }
  return state.toolErrors[state.toolErrors.length - 1];
}

/**
 * Marks a self-correction attempt as started.
 */
export function startSelfCorrectionAttempt(state: SelfCorrectionState, prompt: string): void {
  state.attempts += 1;
  state.active = true;
  state.lastPrompt = prompt;
}

/**
 * Marks a self-correction attempt as completed.
 */
export function completeSelfCorrectionAttempt(state: SelfCorrectionState): void {
  state.active = false;
}

/**
 * Resets the self-correction state for a new run.
 */
export function resetSelfCorrectionState(state: SelfCorrectionState): void {
  state.attempts = 0;
  state.toolErrors = [];
  state.active = false;
  state.lastPrompt = undefined;
}
