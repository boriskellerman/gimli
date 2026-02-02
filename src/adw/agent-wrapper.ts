/**
 * Agent Wrapper - Deterministic wrapper around non-deterministic agent calls
 *
 * Provides a structured way to call agents with:
 * - Consistent input/output schemas
 * - Validation before and after calls
 * - Retry logic with exponential backoff
 * - Logging and observability
 * - Result tracking
 *
 * This is the core of the ADW (AI Developer Workflow) pattern:
 * deterministic code orchestrating non-deterministic agent execution.
 */

import crypto from "node:crypto";
import type { AgentCallConfig, AgentCallInput, AgentCallOutput, StepRetryConfig } from "./types.js";

export type AgentCallResult =
  | {
      status: "success";
      output: AgentCallOutput;
      durationMs: number;
      attempts: number;
    }
  | {
      status: "error";
      error: string;
      cause?: unknown;
      durationMs: number;
      attempts: number;
    };

export type AgentCallLog = {
  callId: string;
  input: AgentCallInput;
  result: AgentCallResult;
  startedAt: number;
  endedAt: number;
  metadata?: Record<string, unknown>;
};

export type AgentExecutor = (input: AgentCallInput) => Promise<AgentCallOutput>;

export type AgentWrapperOptions = {
  /** Custom executor function (for testing or alternative backends) */
  executor?: AgentExecutor;

  /** Default configuration for all calls */
  defaultConfig?: AgentCallConfig;

  /** Default retry configuration */
  defaultRetry?: StepRetryConfig;

  /** Input validator */
  validateInput?: (input: AgentCallInput) => boolean | string | Promise<boolean | string>;

  /** Output validator */
  validateOutput?: (output: AgentCallOutput) => boolean | string | Promise<boolean | string>;

  /** Called before each agent call */
  onBeforeCall?: (input: AgentCallInput, callId: string) => void | Promise<void>;

  /** Called after each agent call */
  onAfterCall?: (log: AgentCallLog) => void | Promise<void>;

  /** Called on retry */
  onRetry?: (
    input: AgentCallInput,
    attempt: number,
    maxAttempts: number,
    error: unknown,
  ) => void | Promise<void>;
};

const DEFAULT_RETRY_CONFIG: Required<StepRetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: 0.1,
  isRetryable: (error) => {
    // Retry on network errors, rate limits, and transient failures
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const retryablePatterns = [
      "timeout",
      "rate limit",
      "too many requests",
      "429",
      "500",
      "502",
      "503",
      "504",
      "econnreset",
      "econnrefused",
      "etimedout",
      "network",
      "overloaded",
    ];
    return retryablePatterns.some((pattern) => message.includes(pattern));
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyJitter(delayMs: number, jitter: number): number {
  if (jitter <= 0) return delayMs;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * (1 + offset)));
}

function calculateDelay(attempt: number, config: Required<StepRetryConfig>): number {
  const baseDelay = config.initialDelayMs * 2 ** (attempt - 1);
  const cappedDelay = Math.min(baseDelay, config.maxDelayMs);
  return applyJitter(cappedDelay, config.jitter);
}

function mergeRetryConfig(
  defaultConfig?: StepRetryConfig,
  callConfig?: StepRetryConfig,
): Required<StepRetryConfig> {
  return {
    maxAttempts:
      callConfig?.maxAttempts ?? defaultConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    initialDelayMs:
      callConfig?.initialDelayMs ??
      defaultConfig?.initialDelayMs ??
      DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs:
      callConfig?.maxDelayMs ?? defaultConfig?.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    jitter: callConfig?.jitter ?? defaultConfig?.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
    isRetryable:
      callConfig?.isRetryable ?? defaultConfig?.isRetryable ?? DEFAULT_RETRY_CONFIG.isRetryable,
  };
}

/**
 * Stub executor that simulates an agent call
 * In production, this would be replaced with actual agent execution
 */
async function stubExecutor(input: AgentCallInput): Promise<AgentCallOutput> {
  // Simulate processing delay
  await sleep(100);

  return {
    text: `[Stub response to: ${input.prompt.slice(0, 50)}...]`,
    model: input.config?.model ?? "stub-model",
    provider: input.config?.provider ?? "stub",
    usage: {
      inputTokens: Math.ceil(input.prompt.length / 4),
      outputTokens: 50,
      totalTokens: Math.ceil(input.prompt.length / 4) + 50,
    },
  };
}

/**
 * Agent Wrapper - wraps agent calls in deterministic code
 */
export class AgentWrapper {
  private options: AgentWrapperOptions;
  private executor: AgentExecutor;
  private callLogs: AgentCallLog[] = [];

  constructor(options: AgentWrapperOptions = {}) {
    this.options = options;
    this.executor = options.executor ?? stubExecutor;
  }

  /**
   * Get all call logs
   */
  getCallLogs(): readonly AgentCallLog[] {
    return this.callLogs;
  }

  /**
   * Clear call logs
   */
  clearCallLogs(): void {
    this.callLogs = [];
  }

  /**
   * Execute an agent call with retry logic
   */
  async call(
    input: AgentCallInput,
    options?: {
      retry?: StepRetryConfig;
      metadata?: Record<string, unknown>;
    },
  ): Promise<AgentCallResult> {
    const callId = crypto.randomUUID();
    const startedAt = Date.now();
    const retryConfig = mergeRetryConfig(this.options.defaultRetry, options?.retry);

    // Merge configs
    const mergedInput: AgentCallInput = {
      ...input,
      config: {
        ...this.options.defaultConfig,
        ...input.config,
      },
    };

    // Input validation
    if (this.options.validateInput) {
      const validation = await this.options.validateInput(mergedInput);
      if (validation !== true) {
        const errorMsg = typeof validation === "string" ? validation : "Input validation failed";
        const result: AgentCallResult = {
          status: "error",
          error: errorMsg,
          durationMs: Date.now() - startedAt,
          attempts: 0,
        };

        this.callLogs.push({
          callId,
          input: mergedInput,
          result,
          startedAt,
          endedAt: Date.now(),
          metadata: options?.metadata,
        });

        return result;
      }
    }

    // Notify before call
    await this.options.onBeforeCall?.(mergedInput, callId);

    let lastError: unknown;
    let attempts = 0;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      attempts = attempt;

      try {
        const output = await this.executor(mergedInput);

        // Output validation
        if (this.options.validateOutput) {
          const validation = await this.options.validateOutput(output);
          if (validation !== true) {
            const errorMsg =
              typeof validation === "string" ? validation : "Output validation failed";
            throw new Error(errorMsg);
          }
        }

        const result: AgentCallResult = {
          status: "success",
          output,
          durationMs: Date.now() - startedAt,
          attempts,
        };

        const log: AgentCallLog = {
          callId,
          input: mergedInput,
          result,
          startedAt,
          endedAt: Date.now(),
          metadata: options?.metadata,
        };

        this.callLogs.push(log);
        await this.options.onAfterCall?.(log);

        return result;
      } catch (err) {
        lastError = err;

        // Check if we should retry: must have more attempts AND error must be retryable
        const canRetry = attempt < retryConfig.maxAttempts;
        const isRetryable = retryConfig.isRetryable(err, attempt);

        if (canRetry && isRetryable) {
          const delay = calculateDelay(attempt, retryConfig);
          await this.options.onRetry?.(mergedInput, attempt, retryConfig.maxAttempts, err);
          await sleep(delay);
        } else {
          // Not retryable or out of attempts - break out of retry loop
          break;
        }
      }
    }

    const result: AgentCallResult = {
      status: "error",
      error: lastError instanceof Error ? lastError.message : String(lastError),
      cause: lastError,
      durationMs: Date.now() - startedAt,
      attempts,
    };

    const log: AgentCallLog = {
      callId,
      input: mergedInput,
      result,
      startedAt,
      endedAt: Date.now(),
      metadata: options?.metadata,
    };

    this.callLogs.push(log);
    await this.options.onAfterCall?.(log);

    return result;
  }

  /**
   * Execute multiple agent calls in sequence
   */
  async callSequence(
    inputs: AgentCallInput[],
    options?: {
      retry?: StepRetryConfig;
      metadata?: Record<string, unknown>;
      stopOnError?: boolean;
    },
  ): Promise<AgentCallResult[]> {
    const results: AgentCallResult[] = [];
    const stopOnError = options?.stopOnError ?? true;

    for (const input of inputs) {
      const result = await this.call(input, {
        retry: options?.retry,
        metadata: options?.metadata,
      });

      results.push(result);

      if (result.status === "error" && stopOnError) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute multiple agent calls in parallel with concurrency limit
   */
  async callParallel(
    inputs: AgentCallInput[],
    options?: {
      retry?: StepRetryConfig;
      metadata?: Record<string, unknown>;
      maxConcurrency?: number;
    },
  ): Promise<AgentCallResult[]> {
    const maxConcurrency = options?.maxConcurrency ?? inputs.length;

    if (maxConcurrency >= inputs.length) {
      // Run all in parallel
      return Promise.all(
        inputs.map((input) =>
          this.call(input, {
            retry: options?.retry,
            metadata: options?.metadata,
          }),
        ),
      );
    }

    // Run with concurrency limit using a simple semaphore pattern
    const results: AgentCallResult[] = Array.from({ length: inputs.length }) as AgentCallResult[];
    let currentIndex = 0;
    let activeCount = 0;

    return new Promise((resolve) => {
      const startNext = () => {
        while (activeCount < maxConcurrency && currentIndex < inputs.length) {
          const index = currentIndex++;
          activeCount++;

          void this.call(inputs[index]!, {
            retry: options?.retry,
            metadata: options?.metadata,
          }).then((result) => {
            results[index] = result;
            activeCount--;

            if (currentIndex >= inputs.length && activeCount === 0) {
              resolve(results);
            } else {
              startNext();
            }
          });
        }
      };

      startNext();
    });
  }
}

/**
 * Create an agent wrapper with default options
 */
export function createAgentWrapper(options?: AgentWrapperOptions): AgentWrapper {
  return new AgentWrapper(options);
}

/**
 * Create a step that wraps an agent call for use in workflows
 */
export function createAgentStep(
  id: string,
  name: string,
  promptTemplate: string | ((input: unknown) => string),
  options?: {
    config?: AgentCallConfig;
    retry?: StepRetryConfig;
    validate?: (output: AgentCallOutput) => boolean | string;
    transform?: (output: AgentCallOutput) => unknown;
  },
) {
  return {
    id,
    name,
    execute: async (input: unknown, context: { wrapper: AgentWrapper }) => {
      const prompt = typeof promptTemplate === "function" ? promptTemplate(input) : promptTemplate;

      const result = await context.wrapper.call(
        {
          prompt,
          config: options?.config,
        },
        { retry: options?.retry },
      );

      if (result.status === "error") {
        throw new Error(result.error);
      }

      if (options?.validate) {
        const validation = options.validate(result.output);
        if (validation !== true) {
          throw new Error(
            typeof validation === "string" ? validation : "Agent output validation failed",
          );
        }
      }

      return options?.transform ? options.transform(result.output) : result.output;
    },
  };
}
