/**
 * AI Developer Workflow (ADW) Base Framework
 *
 * ADWs are deterministic code wrappers around non-deterministic agent calls.
 * They follow the PETER Framework: Prompt, Environment, Trigger, Execute, Result.
 *
 * This module provides the foundation for building composable ADWs that can:
 * - Execute agent tasks with logging and validation
 * - Handle retries and timeouts
 * - Store structured results
 * - Support triggering from GitHub issues/PRs
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { ThinkLevel } from "../auto-reply/thinking.js";
import { callGateway } from "../gateway/call.js";

// ============================================================================
// Core Types
// ============================================================================

/**
 * ADW execution status
 */
export type ADWStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled"
  | "retrying";

/**
 * Stage status within an ADW
 */
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * ADW trigger types
 */
export type TriggerType =
  | "manual"
  | "github_issue"
  | "github_pr"
  | "webhook"
  | "cron"
  | "orchestrator";

/**
 * Configuration for a workflow stage
 */
export interface StageConfig {
  /** Unique stage identifier */
  id: string;
  /** Human-readable stage name */
  name: string;
  /** Description of what this stage does */
  description: string;

  /** Agent configuration */
  agent: {
    /** Model to use (e.g., "claude-sonnet-4-20250514") */
    model?: string;
    /** Thinking level for extended thinking */
    thinking?: ThinkLevel;
    /** System prompt additions for this stage */
    systemPromptAdditions?: string;
  };

  /** Timeout in seconds for this stage */
  timeoutSeconds: number;

  /** Whether this stage is required (workflow fails if stage fails) */
  required: boolean;

  /** Dependencies on other stage IDs (must complete first) */
  dependsOn?: string[];
}

/**
 * Result of a single stage execution
 */
export interface StageResult {
  stageId: string;
  stageName: string;
  status: StageStatus;

  // Timing
  startedAt: number;
  endedAt: number;
  durationMs: number;

  // Output
  output?: string;
  structuredOutput?: Record<string, unknown>;

  // Error info
  error?: string;
  errorDetails?: Record<string, unknown>;

  // Resource usage
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  };

  // Metadata
  runId?: string;
  sessionKey?: string;
  retryCount: number;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Initial delay between retries in ms */
  initialDelayMs: number;
  /** Maximum delay between retries in ms */
  maxDelayMs: number;
  /** Exponential backoff factor */
  backoffFactor: number;
  /** Errors that should trigger a retry */
  retryableErrors?: string[];
}

/**
 * Validation rules for ADW execution
 */
export interface ValidationRules {
  /** Pre-execution checks */
  preConditions?: Array<{
    name: string;
    check: () => Promise<boolean>;
    errorMessage: string;
  }>;
  /** Post-execution checks */
  postConditions?: Array<{
    name: string;
    check: (result: ADWResult) => Promise<boolean>;
    errorMessage: string;
  }>;
}

/**
 * Complete ADW definition
 */
export interface ADWDefinition {
  /** Unique workflow identifier */
  id: string;
  /** Workflow name */
  name: string;
  /** Workflow description */
  description: string;
  /** Version for tracking changes */
  version: string;

  /** Stages in execution order */
  stages: StageConfig[];

  /** Retry configuration */
  retryConfig: RetryConfig;

  /** Validation rules */
  validation?: ValidationRules;

  /** Total timeout for the workflow in seconds */
  totalTimeoutSeconds: number;

  /** Tags for categorization */
  tags?: string[];
}

/**
 * ADW execution context (passed to stages)
 */
export interface ADWContext {
  /** Workflow execution ID */
  executionId: string;
  /** Trigger information */
  trigger: {
    type: TriggerType;
    source?: string;
    metadata?: Record<string, unknown>;
  };
  /** Input parameters for the workflow */
  input: Record<string, unknown>;
  /** Results from previous stages (keyed by stage ID) */
  stageResults: Map<string, StageResult>;
  /** Shared data between stages */
  sharedData: Map<string, unknown>;
  /** Working directory */
  workingDir: string;
  /** Log function */
  log: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
}

/**
 * Complete ADW execution result
 */
export interface ADWResult {
  /** Execution ID */
  executionId: string;
  /** Workflow definition ID */
  workflowId: string;
  /** Overall status */
  status: ADWStatus;

  // Timing
  startedAt: number;
  endedAt: number;
  durationMs: number;

  // Stage results
  stageResults: StageResult[];

  // Final output
  output?: string;
  structuredOutput?: Record<string, unknown>;

  // Error info
  error?: string;
  errorDetails?: Record<string, unknown>;

  // Trigger info
  trigger: {
    type: TriggerType;
    source?: string;
  };

  // Resource totals
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };

  // Metadata
  retryCount: number;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  retryableErrors: ["timeout", "rate_limit", "connection_error", "server_error"],
};

export const DEFAULT_STAGE_TIMEOUT_SECONDS = 300; // 5 minutes
export const DEFAULT_TOTAL_TIMEOUT_SECONDS = 1800; // 30 minutes

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique execution ID
 */
export function generateExecutionId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().slice(0, 8);
  return `adw-${timestamp}-${random}`;
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffFactor, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: string, config: RetryConfig): boolean {
  if (!config.retryableErrors) return true;
  const errorLower = error.toLowerCase();
  return config.retryableErrors.some((e) => errorLower.includes(e.toLowerCase()));
}

/**
 * Sleep for a duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Logger
// ============================================================================

export interface ADWLogger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

/**
 * Create a simple console logger
 */
export function createConsoleLogger(prefix: string): ADWLogger {
  const format = (level: string, message: string) => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${prefix}] [${level}] ${message}`;
  };

  return {
    debug: (msg, data) => console.debug(format("DEBUG", msg), data ?? ""),
    info: (msg, data) => console.info(format("INFO", msg), data ?? ""),
    warn: (msg, data) => console.warn(format("WARN", msg), data ?? ""),
    error: (msg, data) => console.error(format("ERROR", msg), data ?? ""),
  };
}

/**
 * Create a file-backed logger
 */
export function createFileLogger(logFile: string, prefix: string): ADWLogger {
  const logs: string[] = [];
  const consoleLogger = createConsoleLogger(prefix);

  const writeLog = async () => {
    if (logs.length > 0) {
      await fs.appendFile(logFile, logs.join("\n") + "\n");
      logs.length = 0;
    }
  };

  const format = (level: string, message: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    const dataStr = data ? ` | ${JSON.stringify(data)}` : "";
    return `[${timestamp}] [${prefix}] [${level}] ${message}${dataStr}`;
  };

  return {
    debug: (msg, data) => {
      logs.push(format("DEBUG", msg, data));
      consoleLogger.debug(msg, data);
      void writeLog();
    },
    info: (msg, data) => {
      logs.push(format("INFO", msg, data));
      consoleLogger.info(msg, data);
      void writeLog();
    },
    warn: (msg, data) => {
      logs.push(format("WARN", msg, data));
      consoleLogger.warn(msg, data);
      void writeLog();
    },
    error: (msg, data) => {
      logs.push(format("ERROR", msg, data));
      consoleLogger.error(msg, data);
      void writeLog();
    },
  };
}

// ============================================================================
// Stage Execution
// ============================================================================

interface SpawnResponse {
  status: string;
  runId?: string;
  childSessionKey?: string;
  error?: string;
}

interface AgentStatusResponse {
  status?: string;
  output?: string;
  error?: string;
}

/**
 * Execute a single stage
 */
export async function executeStage(
  stage: StageConfig,
  prompt: string,
  context: ADWContext,
  logger: ADWLogger,
): Promise<StageResult> {
  const startedAt = Date.now();
  const runId = `stage-${stage.id}-${Date.now()}`;

  logger.info(`Starting stage: ${stage.name}`, { stageId: stage.id });

  try {
    // Build the task prompt with any additions
    const fullPrompt = stage.agent.systemPromptAdditions
      ? `${stage.agent.systemPromptAdditions}\n\n${prompt}`
      : prompt;

    // Spawn agent
    const spawnResult = (await callGateway({
      method: "tool.invoke",
      params: {
        tool: "sessions_spawn",
        args: {
          task: fullPrompt,
          label: `${context.executionId}:${stage.name}`,
          model: stage.agent.model,
          thinking: stage.agent.thinking,
          runTimeoutSeconds: stage.timeoutSeconds,
          cleanup: "keep",
        },
      },
      timeoutMs: 10_000,
    })) as SpawnResponse;

    if (spawnResult.status !== "accepted" || !spawnResult.runId) {
      return {
        stageId: stage.id,
        stageName: stage.name,
        status: "failed",
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        error: spawnResult.error || "Failed to spawn agent",
        runId,
        retryCount: 0,
      };
    }

    // Poll for completion
    const actualRunId = spawnResult.runId;
    const sessionKey = spawnResult.childSessionKey;
    const pollInterval = 2000;
    const maxPollTime = stage.timeoutSeconds * 1000;
    let pollElapsed = 0;

    while (pollElapsed < maxPollTime) {
      await sleep(pollInterval);
      pollElapsed += pollInterval;

      try {
        const statusResult = (await callGateway({
          method: "agent.status",
          params: { runId: actualRunId },
          timeoutMs: 5_000,
        })) as AgentStatusResponse;

        if (statusResult.status === "completed" || statusResult.status === "ok") {
          const endedAt = Date.now();
          logger.info(`Stage completed: ${stage.name}`, { durationMs: endedAt - startedAt });

          return {
            stageId: stage.id,
            stageName: stage.name,
            status: "completed",
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            output: statusResult.output,
            runId: actualRunId,
            sessionKey,
            retryCount: 0,
          };
        }

        if (statusResult.status === "error" || statusResult.status === "failed") {
          const endedAt = Date.now();
          logger.error(`Stage failed: ${stage.name}`, { error: statusResult.error });

          return {
            stageId: stage.id,
            stageName: stage.name,
            status: "failed",
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            error: statusResult.error || "Stage execution failed",
            runId: actualRunId,
            sessionKey,
            retryCount: 0,
          };
        }
      } catch {
        // Polling error, continue
      }
    }

    // Timeout
    logger.warn(`Stage timed out: ${stage.name}`);
    return {
      stageId: stage.id,
      stageName: stage.name,
      status: "failed",
      startedAt,
      endedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      error: "Stage timed out",
      runId: actualRunId,
      sessionKey,
      retryCount: 0,
    };
  } catch (error) {
    const endedAt = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Stage error: ${stage.name}`, { error: errorMessage });

    return {
      stageId: stage.id,
      stageName: stage.name,
      status: "failed",
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      error: errorMessage,
      runId,
      retryCount: 0,
    };
  }
}

/**
 * Execute a stage with retry logic
 */
export async function executeStageWithRetry(
  stage: StageConfig,
  prompt: string,
  context: ADWContext,
  retryConfig: RetryConfig,
  logger: ADWLogger,
): Promise<StageResult> {
  let lastResult: StageResult | undefined;
  let retryCount = 0;

  while (retryCount <= retryConfig.maxRetries) {
    if (retryCount > 0) {
      const delay = calculateRetryDelay(retryCount - 1, retryConfig);
      logger.info(`Retrying stage ${stage.name} in ${delay}ms (attempt ${retryCount + 1})`);
      await sleep(delay);
    }

    const result = await executeStage(stage, prompt, context, logger);
    result.retryCount = retryCount;

    if (result.status === "completed") {
      return result;
    }

    lastResult = result;

    // Check if error is retryable
    if (result.error && !isRetryableError(result.error, retryConfig)) {
      logger.warn(`Non-retryable error in stage ${stage.name}: ${result.error}`);
      break;
    }

    retryCount++;
  }

  return lastResult!;
}

// ============================================================================
// ADW Execution
// ============================================================================

/**
 * Execute a complete ADW
 */
export async function executeADW(
  definition: ADWDefinition,
  input: Record<string, unknown>,
  trigger: { type: TriggerType; source?: string; metadata?: Record<string, unknown> },
  buildPrompt: (stage: StageConfig, context: ADWContext) => string,
  options?: {
    workingDir?: string;
    logger?: ADWLogger;
    resultsDir?: string;
  },
): Promise<ADWResult> {
  const executionId = generateExecutionId();
  const startedAt = Date.now();

  const logger = options?.logger ?? createConsoleLogger(definition.id);
  const workingDir = options?.workingDir ?? process.cwd();

  logger.info(`Starting ADW: ${definition.name}`, {
    executionId,
    trigger: trigger.type,
    input: Object.keys(input),
  });

  // Create context
  const context: ADWContext = {
    executionId,
    trigger,
    input,
    stageResults: new Map(),
    sharedData: new Map(),
    workingDir,
    log: (level, message, data) => logger[level](message, data),
  };

  // Track results
  const stageResults: StageResult[] = [];
  let status: ADWStatus = "running";
  let error: string | undefined;

  try {
    // Run pre-conditions
    if (definition.validation?.preConditions) {
      for (const condition of definition.validation.preConditions) {
        const passed = await condition.check();
        if (!passed) {
          throw new Error(`Pre-condition failed: ${condition.errorMessage}`);
        }
      }
    }

    // Execute stages in order
    for (const stage of definition.stages) {
      // Check dependencies
      if (stage.dependsOn) {
        for (const depId of stage.dependsOn) {
          const depResult = context.stageResults.get(depId);
          if (!depResult || depResult.status !== "completed") {
            if (stage.required) {
              throw new Error(`Required dependency ${depId} not satisfied for stage ${stage.id}`);
            }
            // Skip non-required stage with unsatisfied deps
            stageResults.push({
              stageId: stage.id,
              stageName: stage.name,
              status: "skipped",
              startedAt: Date.now(),
              endedAt: Date.now(),
              durationMs: 0,
              retryCount: 0,
            });
            continue;
          }
        }
      }

      // Build prompt for this stage
      const prompt = buildPrompt(stage, context);

      // Execute with retry
      const result = await executeStageWithRetry(
        stage,
        prompt,
        context,
        definition.retryConfig,
        logger,
      );

      stageResults.push(result);
      context.stageResults.set(stage.id, result);

      // Check for failure
      if (result.status !== "completed" && stage.required) {
        throw new Error(`Required stage ${stage.name} failed: ${result.error}`);
      }

      // Check total timeout
      if (Date.now() - startedAt > definition.totalTimeoutSeconds * 1000) {
        throw new Error("Total workflow timeout exceeded");
      }
    }

    status = "completed";
    logger.info(`ADW completed: ${definition.name}`, { executionId });
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
    logger.error(`ADW failed: ${definition.name}`, { executionId, error });
  }

  const endedAt = Date.now();

  // Calculate total usage
  const totalUsage = stageResults.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + (r.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (r.usage?.outputTokens ?? 0),
      estimatedCostUsd: acc.estimatedCostUsd + (r.usage?.estimatedCostUsd ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  );

  // Build result
  const result: ADWResult = {
    executionId,
    workflowId: definition.id,
    status,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    stageResults,
    trigger: { type: trigger.type, source: trigger.source },
    totalUsage,
    retryCount: Math.max(...stageResults.map((r) => r.retryCount)),
    error,
  };

  // Run post-conditions (informational only)
  if (status === "completed" && definition.validation?.postConditions) {
    for (const condition of definition.validation.postConditions) {
      const passed = await condition.check(result);
      if (!passed) {
        logger.warn(`Post-condition warning: ${condition.errorMessage}`);
      }
    }
  }

  // Store result if results directory specified
  if (options?.resultsDir) {
    try {
      await fs.mkdir(options.resultsDir, { recursive: true });
      const resultFile = path.join(options.resultsDir, `${executionId}.json`);
      await fs.writeFile(resultFile, JSON.stringify(result, null, 2));
      logger.info(`Result saved to ${resultFile}`);
    } catch {
      logger.warn("Failed to save result to file");
    }
  }

  return result;
}

// ============================================================================
// Result Storage
// ============================================================================

/**
 * Load ADW results from a directory
 */
export async function loadResults(resultsDir: string): Promise<ADWResult[]> {
  try {
    const files = await fs.readdir(resultsDir);
    const results: ADWResult[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = await fs.readFile(path.join(resultsDir, file), "utf-8");
        results.push(JSON.parse(content) as ADWResult);
      }
    }

    return results.sort((a, b) => b.startedAt - a.startedAt);
  } catch {
    return [];
  }
}

/**
 * Get result by execution ID
 */
export async function getResult(
  executionId: string,
  resultsDir: string,
): Promise<ADWResult | null> {
  try {
    const content = await fs.readFile(path.join(resultsDir, `${executionId}.json`), "utf-8");
    return JSON.parse(content) as ADWResult;
  } catch {
    return null;
  }
}

/**
 * Format ADW result as markdown
 */
export function formatResultAsMarkdown(result: ADWResult): string {
  const lines: string[] = [
    `# ADW Execution: ${result.workflowId}`,
    "",
    `**Execution ID**: ${result.executionId}`,
    `**Status**: ${result.status.toUpperCase()}`,
    `**Duration**: ${(result.durationMs / 1000).toFixed(1)}s`,
    `**Trigger**: ${result.trigger.type}${result.trigger.source ? ` (${result.trigger.source})` : ""}`,
    "",
  ];

  if (result.error) {
    lines.push(`## Error`, "", `\`\`\``, result.error, `\`\`\``, "");
  }

  lines.push("## Stages", "");
  lines.push("| Stage | Status | Duration |");
  lines.push("|-------|--------|----------|");

  for (const stage of result.stageResults) {
    const statusIcon =
      stage.status === "completed" ? "✅" : stage.status === "skipped" ? "⏭️" : "❌";
    lines.push(
      `| ${stage.stageName} | ${statusIcon} ${stage.status} | ${(stage.durationMs / 1000).toFixed(1)}s |`,
    );
  }

  lines.push("");
  lines.push("## Resource Usage", "");
  lines.push(`- **Input Tokens**: ${result.totalUsage.inputTokens.toLocaleString()}`);
  lines.push(`- **Output Tokens**: ${result.totalUsage.outputTokens.toLocaleString()}`);
  lines.push(`- **Estimated Cost**: $${result.totalUsage.estimatedCostUsd.toFixed(4)}`);

  return lines.join("\n");
}
