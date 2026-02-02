/**
 * ADW Runner
 *
 * Orchestrates AI Developer Workflows with step execution,
 * logging, validation, and automatic retries.
 */

import { randomUUID } from "node:crypto";
import type {
  ADWWorkflowDefinition,
  ADWStepDefinition,
  ADWStepResult,
  ADWStepContext,
  ADWRunOptions,
  ADWWorkflowResult,
  ADWLogger,
  ADWRetryConfig,
  ADWStepLog,
} from "./types.js";
import { withRetry, mergeRetryConfig } from "./retry.js";
import { validateStepOutput } from "./validation.js";
import {
  createADWLogger,
  createStepLogger,
  createWorkflowLog,
  createStepLog,
  completeStepLog,
  completeWorkflowLog,
  persistWorkflowLog,
} from "./logger.js";

/**
 * Run an ADW workflow.
 *
 * @param workflow - Workflow definition
 * @param input - Initial input for the workflow
 * @param options - Run options
 * @returns Workflow result with outputs and logs
 */
export async function runADWWorkflow(
  workflow: ADWWorkflowDefinition,
  input: Record<string, unknown> = {},
  options: ADWRunOptions = {},
): Promise<ADWWorkflowResult> {
  const workflowId = randomUUID();

  // Initialize logger
  const logger =
    options.logger ??
    createADWLogger({
      workflowId,
      workflowName: workflow.name,
      minLevel: "info",
    });

  // Initialize workflow log
  const workflowLog = createWorkflowLog(workflowId, workflow.name, options.context);
  workflowLog.status = "running";

  // Initialize state
  const results = new Map<string, ADWStepResult>();
  const outputs = new Map<string, unknown>();
  const errors: Array<{ stepId: string; error: string }> = [];
  const sharedContext: Record<string, unknown> = { ...input, ...options.context };

  logger.info("Starting workflow", {
    workflowId,
    workflowName: workflow.name,
    stepCount: workflow.steps.length,
  });

  // Notify workflow start hook
  if (workflow.hooks?.onWorkflowStart) {
    try {
      await workflow.hooks.onWorkflowStart(workflowId, sharedContext);
    } catch (err) {
      logger.warn("onWorkflowStart hook failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Create workflow timeout if specified
  let workflowAbortController: AbortController | undefined;
  let workflowTimeout: NodeJS.Timeout | undefined;

  if (workflow.timeoutMs || options.timeoutMs) {
    workflowAbortController = new AbortController();
    const timeoutMs = options.timeoutMs ?? workflow.timeoutMs!;
    workflowTimeout = setTimeout(() => {
      logger.error("Workflow timed out", { timeoutMs });
      workflowAbortController!.abort();
    }, timeoutMs);
  }

  // Combine abort signals
  const abortSignal = options.abortSignal ?? workflowAbortController?.signal;

  try {
    // Build dependency graph and execution order
    const executionOrder = resolveExecutionOrder(workflow.steps);

    for (const stepDef of executionOrder) {
      // Check for abort
      if (abortSignal?.aborted) {
        logger.info("Workflow cancelled", { stepId: stepDef.id });
        break;
      }

      // Check dependencies
      if (stepDef.dependsOn?.length) {
        const unmetDeps = stepDef.dependsOn.filter((depId) => {
          const depResult = results.get(depId);
          return !depResult || depResult.status !== "success";
        });
        if (unmetDeps.length > 0) {
          logger.info("Skipping step due to unmet dependencies", {
            stepId: stepDef.id,
            unmetDeps,
          });

          const skipLog = createStepLog(stepDef.id, stepDef.name, 1, 1);
          const completedLog = completeStepLog(skipLog, "skipped");
          workflowLog.steps.push(completedLog);

          results.set(stepDef.id, {
            status: "skipped",
            durationMs: 0,
            attempts: 0,
            retryable: false,
          });
          continue;
        }
      }

      // Check condition
      if (stepDef.condition) {
        const stepContext = createStepContext({
          workflowId,
          workflowName: workflow.name,
          stepDef,
          attempt: 1,
          maxAttempts: 1,
          results,
          sharedContext,
          abortSignal,
          logger,
        });

        try {
          const shouldRun = await stepDef.condition(stepContext);
          if (!shouldRun) {
            logger.info("Skipping step due to condition", { stepId: stepDef.id });

            const skipLog = createStepLog(stepDef.id, stepDef.name, 1, 1);
            const completedLog = completeStepLog(skipLog, "skipped");
            workflowLog.steps.push(completedLog);

            results.set(stepDef.id, {
              status: "skipped",
              durationMs: 0,
              attempts: 0,
              retryable: false,
            });
            continue;
          }
        } catch (err) {
          logger.warn("Step condition threw error, skipping step", {
            stepId: stepDef.id,
            error: err instanceof Error ? err.message : String(err),
          });

          const skipLog = createStepLog(stepDef.id, stepDef.name, 1, 1);
          const completedLog = completeStepLog(skipLog, "skipped");
          workflowLog.steps.push(completedLog);

          results.set(stepDef.id, {
            status: "skipped",
            durationMs: 0,
            attempts: 0,
            retryable: false,
          });
          continue;
        }
      }

      // Execute step
      const stepResult = await executeStep({
        stepDef,
        workflowId,
        workflowName: workflow.name,
        defaultRetry: workflow.defaultRetry,
        overrideRetry: options.retry,
        results,
        sharedContext,
        abortSignal,
        logger,
        hooks: workflow.hooks,
        workflowLog,
      });

      results.set(stepDef.id, stepResult);

      if (stepResult.status === "success") {
        outputs.set(stepDef.id, stepResult.output);
      } else if (stepResult.status === "failed") {
        errors.push({
          stepId: stepDef.id,
          error: stepResult.error ?? "Unknown error",
        });

        // Check if workflow should continue
        if (!stepDef.continueOnFailure) {
          logger.error("Stopping workflow due to step failure", {
            stepId: stepDef.id,
            error: stepResult.error,
          });
          break;
        }
      }
    }
  } finally {
    if (workflowTimeout) {
      clearTimeout(workflowTimeout);
    }
  }

  // Determine final status
  const wasCancelled = abortSignal?.aborted ?? false;
  const hasFailed = errors.length > 0;
  const finalStatus = wasCancelled ? "cancelled" : hasFailed ? "failed" : "success";

  // Complete workflow log
  const completedLog = completeWorkflowLog(workflowLog, finalStatus);

  logger.info("Workflow completed", {
    workflowId,
    status: finalStatus,
    durationMs: completedLog.durationMs,
    stepsRun: workflowLog.steps.length,
    errors: errors.length,
  });

  // Persist logs if requested
  if (options.persistLogs && options.logDir) {
    try {
      const logPath = await persistWorkflowLog(completedLog, options.logDir);
      logger.debug("Workflow log persisted", { logPath });
    } catch (err) {
      logger.warn("Failed to persist workflow log", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Notify workflow end hook
  if (workflow.hooks?.onWorkflowEnd) {
    try {
      await workflow.hooks.onWorkflowEnd(completedLog);
    } catch (err) {
      logger.warn("onWorkflowEnd hook failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    status: finalStatus,
    log: completedLog,
    outputs,
    errors,
  };
}

// ============================================================================
// Step Execution
// ============================================================================

type ExecuteStepParams = {
  stepDef: ADWStepDefinition;
  workflowId: string;
  workflowName: string;
  defaultRetry?: Partial<ADWRetryConfig>;
  overrideRetry?: Partial<ADWRetryConfig>;
  results: Map<string, ADWStepResult>;
  sharedContext: Record<string, unknown>;
  abortSignal?: AbortSignal;
  logger: ADWLogger;
  hooks?: ADWWorkflowDefinition["hooks"];
  workflowLog: ReturnType<typeof createWorkflowLog>;
};

async function executeStep(params: ExecuteStepParams): Promise<ADWStepResult> {
  const {
    stepDef,
    workflowId,
    workflowName,
    defaultRetry,
    overrideRetry,
    results,
    sharedContext,
    abortSignal,
    logger,
    hooks,
    workflowLog,
  } = params;

  // Merge retry configs: default < step < override
  const retryConfig = mergeRetryConfig(
    mergeRetryConfig(defaultRetry ?? {}, stepDef.retry),
    overrideRetry,
  );

  const maxAttempts = retryConfig.maxAttempts;
  let stepLog: ADWStepLog | null = null;
  let lastStepLog: ADWStepLog | null = null;

  logger.info("Starting step", {
    stepId: stepDef.id,
    stepName: stepDef.name,
    maxAttempts,
  });

  // Execute with retry
  const retryResult = await withRetry({
    fn: async () => {
      const currentAttempt = (stepLog?.attempt ?? 0) + 1;

      // Create step log for this attempt
      stepLog = createStepLog(stepDef.id, stepDef.name, currentAttempt, maxAttempts);
      stepLog.status = "running";

      // Notify step start hook
      if (hooks?.onStepStart) {
        try {
          await hooks.onStepStart(stepLog);
        } catch {
          // Ignore hook errors
        }
      }

      // Create step context
      const stepContext = createStepContext({
        workflowId,
        workflowName,
        stepDef,
        attempt: currentAttempt,
        maxAttempts,
        results,
        sharedContext,
        abortSignal,
        logger,
      });

      // Create step-specific logger
      const stepLogger = createStepLogger(logger, stepDef.id, stepDef.name, currentAttempt);

      // Execute the step with timeout if configured
      let output: unknown;
      if (stepDef.timeoutMs) {
        output = await withStepTimeout(
          stepDef.execute(sharedContext, { ...stepContext, log: stepLogger }),
          stepDef.timeoutMs,
        );
      } else {
        output = await stepDef.execute(sharedContext, { ...stepContext, log: stepLogger });
      }

      // Validate output if configured
      if (stepDef.validation) {
        const validationResult = await validateStepOutput(output, stepDef.validation, stepLogger);

        if (!validationResult.valid) {
          // Notify validation failure hook
          if (hooks?.onValidationFailure) {
            try {
              await hooks.onValidationFailure(stepDef.id, validationResult);
            } catch {
              // Ignore hook errors
            }
          }

          // Complete step log with validation failure
          lastStepLog = completeStepLog(
            stepLog,
            "failed",
            output,
            `Validation failed: ${validationResult.errors?.join("; ")}`,
            "VALIDATION_ERROR",
            validationResult,
          );
          workflowLog.steps.push(lastStepLog);

          // Notify step end hook
          if (hooks?.onStepEnd) {
            try {
              await hooks.onStepEnd(lastStepLog);
            } catch {
              // Ignore hook errors
            }
          }

          throw new ValidationError(
            `Validation failed: ${validationResult.errors?.join("; ")}`,
            validationResult,
          );
        }

        // Store successful validation result
        stepLog.validation = validationResult;
      }

      // Complete step log with success
      lastStepLog = completeStepLog(stepLog, "success", output);
      workflowLog.steps.push(lastStepLog);

      // Notify step end hook
      if (hooks?.onStepEnd) {
        try {
          await hooks.onStepEnd(lastStepLog);
        } catch {
          // Ignore hook errors
        }
      }

      return output;
    },
    config: retryConfig,
    abortSignal,
    logger,
    label: `Step ${stepDef.name}`,
    onRetry: async (attempt, error, _delayMs) => {
      // Complete the failed attempt log
      if (stepLog) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode =
          error instanceof ValidationError
            ? "VALIDATION_ERROR"
            : (error as { code?: string })?.code;

        lastStepLog = completeStepLog(stepLog, "retrying", undefined, errorMessage, errorCode);
        workflowLog.steps.push(lastStepLog);

        // Notify step end hook for the failed attempt
        if (hooks?.onStepEnd) {
          try {
            await hooks.onStepEnd(lastStepLog);
          } catch {
            // Ignore hook errors
          }
        }
      }

      // Notify retry hook
      if (hooks?.onRetry) {
        try {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await hooks.onRetry(stepDef.id, attempt + 1, errorMessage);
        } catch {
          // Ignore hook errors
        }
      }
    },
  });

  if (retryResult.success) {
    logger.info("Step completed successfully", {
      stepId: stepDef.id,
      attempts: retryResult.attempts,
      durationMs: retryResult.totalDurationMs,
    });

    return {
      status: "success",
      output: retryResult.result,
      durationMs: retryResult.totalDurationMs,
      attempts: retryResult.attempts,
      retryable: false,
      validation: (lastStepLog as ADWStepLog | null)?.validation,
    };
  }

  // Handle failure
  const errorMessage =
    retryResult.error instanceof Error ? retryResult.error.message : String(retryResult.error);

  const errorCode =
    retryResult.error instanceof ValidationError
      ? "VALIDATION_ERROR"
      : (retryResult.error as { code?: string })?.code;

  logger.error("Step failed after all attempts", {
    stepId: stepDef.id,
    attempts: retryResult.attempts,
    durationMs: retryResult.totalDurationMs,
    error: errorMessage,
    retryable: retryResult.retryable,
  });

  // If we don't have a final failed log, create one
  const finalStepLog = lastStepLog as ADWStepLog | null;
  if (!finalStepLog || finalStepLog.status !== "failed") {
    if (stepLog) {
      lastStepLog = completeStepLog(stepLog, "failed", undefined, errorMessage, errorCode);
      workflowLog.steps.push(lastStepLog);

      if (hooks?.onStepEnd) {
        try {
          await hooks.onStepEnd(lastStepLog);
        } catch {
          // Ignore hook errors
        }
      }
    }
  }

  return {
    status: "failed",
    error: errorMessage,
    errorCode,
    durationMs: retryResult.totalDurationMs,
    attempts: retryResult.attempts,
    retryable: retryResult.retryable,
    validation: lastStepLog?.validation,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function createStepContext(params: {
  workflowId: string;
  workflowName: string;
  stepDef: ADWStepDefinition;
  attempt: number;
  maxAttempts: number;
  results: Map<string, ADWStepResult>;
  sharedContext: Record<string, unknown>;
  abortSignal?: AbortSignal;
  logger: ADWLogger;
}): ADWStepContext {
  return {
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    stepId: params.stepDef.id,
    stepName: params.stepDef.name,
    attempt: params.attempt,
    maxAttempts: params.maxAttempts,
    previousResults: params.results,
    sharedContext: params.sharedContext,
    abortSignal: params.abortSignal,
    log: params.logger,
  };
}

/**
 * Resolve execution order based on dependencies using topological sort.
 */
function resolveExecutionOrder(steps: ADWStepDefinition[]): ADWStepDefinition[] {
  const graph = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  const stepById = new Map<string, ADWStepDefinition>();

  // Initialize
  for (const step of steps) {
    stepById.set(step.id, step);
    graph.set(step.id, new Set());
    inDegree.set(step.id, 0);
  }

  // Build dependency graph
  for (const step of steps) {
    if (step.dependsOn?.length) {
      for (const depId of step.dependsOn) {
        if (graph.has(depId)) {
          graph.get(depId)!.add(step.id);
          inDegree.set(step.id, (inDegree.get(step.id) ?? 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = [];
  const result: ADWStepDefinition[] = [];

  // Start with nodes that have no dependencies
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const step = stepById.get(id);
    if (step) {
      result.push(step);
    }

    const dependents = graph.get(id) ?? new Set();
    for (const depId of dependents) {
      const newDegree = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, newDegree);
      if (newDegree === 0) {
        queue.push(depId);
      }
    }
  }

  // If we couldn't order all steps, there's a cycle - return original order
  if (result.length !== steps.length) {
    console.warn("Circular dependency detected in workflow steps, using original order");
    return steps;
  }

  return result;
}

async function withStepTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new StepTimeoutError(`Step timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

// ============================================================================
// Custom Errors
// ============================================================================

class ValidationError extends Error {
  readonly validationResult: { valid: boolean; errors?: string[]; warnings?: string[] };

  constructor(message: string, result: { valid: boolean; errors?: string[]; warnings?: string[] }) {
    super(message);
    this.name = "ValidationError";
    this.validationResult = result;
  }
}

class StepTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepTimeoutError";
  }
}

// ============================================================================
// Workflow Builder
// ============================================================================

/**
 * Builder for creating ADW workflows with a fluent API.
 */
export class ADWWorkflowBuilder {
  private definition: Partial<ADWWorkflowDefinition> = {
    steps: [],
  };

  constructor(id: string, name: string) {
    this.definition.id = id;
    this.definition.name = name;
  }

  description(desc: string): this {
    this.definition.description = desc;
    return this;
  }

  timeout(ms: number): this {
    this.definition.timeoutMs = ms;
    return this;
  }

  defaultRetry(config: Partial<ADWRetryConfig>): this {
    this.definition.defaultRetry = config;
    return this;
  }

  step<TInput = unknown, TOutput = unknown>(stepDef: ADWStepDefinition<TInput, TOutput>): this {
    this.definition.steps!.push(stepDef as ADWStepDefinition);
    return this;
  }

  hooks(hooks: ADWWorkflowDefinition["hooks"]): this {
    this.definition.hooks = hooks;
    return this;
  }

  build(): ADWWorkflowDefinition {
    if (!this.definition.id || !this.definition.name) {
      throw new Error("Workflow must have id and name");
    }
    if (!this.definition.steps?.length) {
      throw new Error("Workflow must have at least one step");
    }
    return this.definition as ADWWorkflowDefinition;
  }
}

/**
 * Create a new workflow builder.
 */
export function createWorkflow(id: string, name: string): ADWWorkflowBuilder {
  return new ADWWorkflowBuilder(id, name);
}
