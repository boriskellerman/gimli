/**
 * ADW Retry Logic
 *
 * Implements exponential backoff with jitter for resilient step execution.
 * Follows AWS best practices for retry strategies.
 */

import type { ADWRetryConfig, ADWLogger } from "./types.js";
import { DEFAULT_RETRY_CONFIG } from "./types.js";

/**
 * Calculate the delay before the next retry attempt.
 * Uses exponential backoff with jitter to prevent thundering herd.
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(attempt: number, config: ADWRetryConfig): number {
  // attempt 1 is the first retry, so delay starts from initialDelayMs
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Apply jitter: random value between (1 - jitterFactor) and (1 + jitterFactor)
  const jitterMultiplier = 1 + (Math.random() * 2 - 1) * config.jitterFactor;
  const delayWithJitter = Math.round(cappedDelay * jitterMultiplier);

  return Math.max(0, delayWithJitter);
}

/**
 * Check if an error is retryable based on the configuration.
 *
 * @param error - Error to check
 * @param config - Retry configuration
 * @returns Whether the error is retryable
 */
export function isRetryableError(error: unknown, config: ADWRetryConfig): boolean {
  const errorInfo = extractErrorInfo(error);

  // First check non-retryable errors (they take precedence)
  if (config.nonRetryableErrors?.length) {
    for (const pattern of config.nonRetryableErrors) {
      if (matchesErrorPattern(errorInfo, pattern)) {
        return false;
      }
    }
  }

  // Then check retryable errors
  if (config.retryableErrors?.length) {
    for (const pattern of config.retryableErrors) {
      if (matchesErrorPattern(errorInfo, pattern)) {
        return true;
      }
    }
  }

  // Default: unknown errors are retryable
  return true;
}

type ErrorInfo = {
  message: string;
  code?: string;
  status?: number;
  name?: string;
};

/**
 * Extract structured information from an error.
 */
function extractErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    const info: ErrorInfo = {
      message: error.message,
      name: error.name,
    };

    // Check for common error properties
    const errObj = error as Record<string, unknown>;
    if (typeof errObj.code === "string") info.code = errObj.code;
    if (typeof errObj.status === "number") info.status = errObj.status;
    if (typeof errObj.statusCode === "number") info.status = errObj.statusCode;

    return info;
  }

  if (typeof error === "string") {
    return { message: error };
  }

  if (error && typeof error === "object") {
    const errObj = error as Record<string, unknown>;
    const msg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(error);
    return {
      message: msg,
      code: typeof errObj.code === "string" ? errObj.code : undefined,
      status:
        typeof errObj.status === "number"
          ? errObj.status
          : typeof errObj.statusCode === "number"
            ? errObj.statusCode
            : undefined,
      name: typeof errObj.name === "string" ? errObj.name : undefined,
    };
  }

  return { message: String(error) };
}

/**
 * Check if error info matches a pattern.
 * Pattern can be a string code, status code, or partial message match.
 */
function matchesErrorPattern(errorInfo: ErrorInfo, pattern: string): boolean {
  const patternLower = pattern.toLowerCase();

  // Check code
  if (errorInfo.code?.toLowerCase() === patternLower) return true;

  // Check status as string
  if (errorInfo.status?.toString() === pattern) return true;

  // Check name
  if (errorInfo.name?.toLowerCase() === patternLower) return true;

  // Check message contains pattern
  if (errorInfo.message.toLowerCase().includes(patternLower)) return true;

  return false;
}

/**
 * Sleep for a specified duration with optional abort signal support.
 *
 * @param ms - Duration in milliseconds
 * @param abortSignal - Optional abort signal
 * @returns Promise that resolves after the delay or rejects if aborted
 */
export async function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;

  return new Promise((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    if (abortSignal) {
      const onAbort = () => {
        clearTimeout(timeoutId);
        reject(new Error("Aborted"));
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Options for the retry wrapper.
 */
export type RetryOptions<T> = {
  /** Function to execute with retries */
  fn: () => Promise<T>;
  /** Retry configuration */
  config?: Partial<ADWRetryConfig>;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Logger for retry events */
  logger?: ADWLogger;
  /** Called before each retry */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void | Promise<void>;
  /** Label for logging */
  label?: string;
};

/**
 * Result of a retry operation.
 */
export type RetryResult<T> = {
  success: boolean;
  result?: T;
  error?: unknown;
  attempts: number;
  totalDurationMs: number;
  retryable: boolean;
};

/**
 * Execute a function with automatic retries.
 *
 * @param options - Retry options
 * @returns Result with success/failure and metadata
 */
export async function withRetry<T>(options: RetryOptions<T>): Promise<RetryResult<T>> {
  const config: ADWRetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...options.config,
  };

  const startTime = Date.now();
  let lastError: unknown;
  let retryable = true;
  let finalAttempts = 0;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    finalAttempts = attempt;

    // Check for abort before each attempt
    if (options.abortSignal?.aborted) {
      return {
        success: false,
        error: new Error("Aborted"),
        attempts: attempt,
        totalDurationMs: Date.now() - startTime,
        retryable: false,
      };
    }

    try {
      const result = await options.fn();
      return {
        success: true,
        result,
        attempts: attempt,
        totalDurationMs: Date.now() - startTime,
        retryable: false,
      };
    } catch (error) {
      lastError = error;
      retryable = isRetryableError(error, config);

      const isLastAttempt = attempt >= config.maxAttempts;
      const shouldRetry = retryable && !isLastAttempt;

      const errorInfo = extractErrorInfo(error);
      options.logger?.warn(
        `${options.label ?? "Operation"} failed (attempt ${attempt}/${config.maxAttempts})`,
        {
          error: errorInfo.message,
          code: errorInfo.code,
          status: errorInfo.status,
          retryable,
          willRetry: shouldRetry,
        },
      );

      if (!shouldRetry) {
        break;
      }

      // Calculate delay and wait before next attempt
      const delayMs = calculateRetryDelay(attempt, config);

      options.logger?.info(`Retrying ${options.label ?? "operation"} in ${delayMs}ms`, {
        attempt: attempt + 1,
        maxAttempts: config.maxAttempts,
        delayMs,
      });

      if (options.onRetry) {
        await options.onRetry(attempt, error, delayMs);
      }

      await sleep(delayMs, options.abortSignal);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: finalAttempts,
    totalDurationMs: Date.now() - startTime,
    retryable,
  };
}

/**
 * Create a retry configuration by merging with defaults.
 *
 * @param partial - Partial configuration to merge
 * @returns Complete retry configuration
 */
export function createRetryConfig(partial?: Partial<ADWRetryConfig>): ADWRetryConfig {
  return {
    ...DEFAULT_RETRY_CONFIG,
    ...partial,
    // Merge arrays properly
    retryableErrors: partial?.retryableErrors ?? DEFAULT_RETRY_CONFIG.retryableErrors,
    nonRetryableErrors: partial?.nonRetryableErrors ?? DEFAULT_RETRY_CONFIG.nonRetryableErrors,
  };
}

/**
 * Merge two retry configurations.
 *
 * @param base - Base configuration
 * @param override - Override configuration
 * @returns Merged configuration
 */
export function mergeRetryConfig(
  base: Partial<ADWRetryConfig>,
  override?: Partial<ADWRetryConfig>,
): ADWRetryConfig {
  if (!override) return createRetryConfig(base);

  return {
    maxAttempts: override.maxAttempts ?? base.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    initialDelayMs:
      override.initialDelayMs ?? base.initialDelayMs ?? DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs: override.maxDelayMs ?? base.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier:
      override.backoffMultiplier ??
      base.backoffMultiplier ??
      DEFAULT_RETRY_CONFIG.backoffMultiplier,
    jitterFactor: override.jitterFactor ?? base.jitterFactor ?? DEFAULT_RETRY_CONFIG.jitterFactor,
    retryableErrors:
      override.retryableErrors ?? base.retryableErrors ?? DEFAULT_RETRY_CONFIG.retryableErrors,
    nonRetryableErrors:
      override.nonRetryableErrors ??
      base.nonRetryableErrors ??
      DEFAULT_RETRY_CONFIG.nonRetryableErrors,
  };
}
