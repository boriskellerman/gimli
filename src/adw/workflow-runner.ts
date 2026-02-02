/**
 * Workflow Runner - Deterministic orchestration of agent workflows
 *
 * Executes ADW (AI Developer Workflow) pipelines with:
 * - Step-by-step execution with validation
 * - Retry logic with exponential backoff
 * - Event emission for observability
 * - Result tracking and persistence
 */

import crypto from "node:crypto";
import type {
  StepDefinition,
  StepResult,
  StepRetryConfig,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventListener,
  WorkflowRun,
  WorkflowStepLog,
} from "./types.js";

const DEFAULT_RETRY_CONFIG: Required<StepRetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: 0.1,
  isRetryable: () => true,
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
  stepConfig?: StepRetryConfig,
): Required<StepRetryConfig> {
  return {
    maxAttempts:
      stepConfig?.maxAttempts ?? defaultConfig?.maxAttempts ?? DEFAULT_RETRY_CONFIG.maxAttempts,
    initialDelayMs:
      stepConfig?.initialDelayMs ??
      defaultConfig?.initialDelayMs ??
      DEFAULT_RETRY_CONFIG.initialDelayMs,
    maxDelayMs:
      stepConfig?.maxDelayMs ?? defaultConfig?.maxDelayMs ?? DEFAULT_RETRY_CONFIG.maxDelayMs,
    jitter: stepConfig?.jitter ?? defaultConfig?.jitter ?? DEFAULT_RETRY_CONFIG.jitter,
    isRetryable:
      stepConfig?.isRetryable ?? defaultConfig?.isRetryable ?? DEFAULT_RETRY_CONFIG.isRetryable,
  };
}

export type WorkflowRunnerOptions = {
  /** Event listeners for workflow events */
  listeners?: WorkflowEventListener[];

  /** Abort signal to cancel execution */
  abortSignal?: AbortSignal;

  /** Custom run ID (auto-generated if not provided) */
  runId?: string;

  /** Additional metadata to attach to the run */
  metadata?: Record<string, unknown>;
};

export class WorkflowRunner<TInput = unknown, TOutput = unknown, TContext = unknown> {
  private workflow: WorkflowDefinition<TInput, TOutput, TContext>;
  private listeners: WorkflowEventListener[] = [];

  constructor(workflow: WorkflowDefinition<TInput, TOutput, TContext>) {
    this.workflow = workflow;
  }

  /**
   * Add an event listener
   */
  addEventListener(listener: WorkflowEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: WorkflowEventListener): void {
    const index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Emit an event to all listeners
   */
  private async emit(event: WorkflowEvent): Promise<void> {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (err) {
        // Don't let listener errors break the workflow
        console.error(`Workflow event listener error: ${String(err)}`);
      }
    }
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStep<TStepInput, TStepOutput>(
    step: StepDefinition<TStepInput, TStepOutput, TContext>,
    input: TStepInput,
    context: TContext,
    runId: string,
    abortSignal?: AbortSignal,
  ): Promise<StepResult<TStepOutput>> {
    const retryConfig = mergeRetryConfig(this.workflow.defaultRetry, step.retry);
    const startTime = Date.now();
    let lastError: unknown;
    let attempts = 0;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      if (abortSignal?.aborted) {
        return {
          status: "error",
          error: "Workflow aborted",
          durationMs: Date.now() - startTime,
          attempts,
        };
      }

      attempts = attempt;

      try {
        // Emit step start event
        await this.emit({
          type: "step:start",
          runId,
          workflowId: this.workflow.id,
          timestamp: Date.now(),
          stepId: step.id,
          stepName: step.name,
          attempt,
          maxAttempts: retryConfig.maxAttempts,
        });

        // Run validation if provided
        if (step.validate) {
          const validationResult = await step.validate(input, context);
          if (validationResult !== true) {
            const errorMsg =
              typeof validationResult === "string" ? validationResult : "Input validation failed";
            throw new Error(errorMsg);
          }
        }

        // Execute the step with optional timeout
        let result: TStepOutput;
        if (step.timeoutMs) {
          result = await Promise.race([
            step.execute(input, context),
            new Promise<never>((_, reject) => {
              setTimeout(
                () => reject(new Error(`Step timed out after ${step.timeoutMs}ms`)),
                step.timeoutMs,
              );
            }),
          ]);
        } else {
          result = await step.execute(input, context);
        }

        // Run output validation if provided
        if (step.validateOutput) {
          const outputValidation = await step.validateOutput(result, context);
          if (outputValidation !== true) {
            const errorMsg =
              typeof outputValidation === "string" ? outputValidation : "Output validation failed";
            throw new Error(errorMsg);
          }
        }

        // Emit success event
        await this.emit({
          type: "step:complete",
          runId,
          workflowId: this.workflow.id,
          timestamp: Date.now(),
          stepId: step.id,
          stepName: step.name,
          data: result,
        });

        return {
          status: "success",
          data: result,
          durationMs: Date.now() - startTime,
          attempts,
        };
      } catch (err) {
        lastError = err;
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Check if we should retry
        const shouldRetry =
          attempt < retryConfig.maxAttempts && retryConfig.isRetryable(err, attempt);

        if (shouldRetry) {
          const delay = calculateDelay(attempt, retryConfig);

          await this.emit({
            type: "step:retry",
            runId,
            workflowId: this.workflow.id,
            timestamp: Date.now(),
            stepId: step.id,
            stepName: step.name,
            error: errorMsg,
            attempt,
            maxAttempts: retryConfig.maxAttempts,
            data: { delayMs: delay },
          });

          await sleep(delay);
        } else {
          await this.emit({
            type: "step:error",
            runId,
            workflowId: this.workflow.id,
            timestamp: Date.now(),
            stepId: step.id,
            stepName: step.name,
            error: errorMsg,
            attempt,
            maxAttempts: retryConfig.maxAttempts,
          });
        }
      }
    }

    return {
      status: "error",
      error: lastError instanceof Error ? lastError.message : String(lastError),
      cause: lastError,
      durationMs: Date.now() - startTime,
      attempts,
    };
  }

  /**
   * Execute the workflow
   */
  async run(
    input: TInput,
    options?: WorkflowRunnerOptions,
  ): Promise<WorkflowRun<TInput, TOutput, TContext>> {
    const runId = options?.runId ?? crypto.randomUUID();
    const startedAt = Date.now();

    // Add any provided listeners
    if (options?.listeners) {
      for (const listener of options.listeners) {
        this.addEventListener(listener);
      }
    }

    const run: WorkflowRun<TInput, TOutput, TContext> = {
      runId,
      workflowId: this.workflow.id,
      workflowVersion: this.workflow.version,
      status: "running",
      input,
      stepLogs: [],
      stepResults: new Map(),
      startedAt,
      metadata: options?.metadata,
    };

    try {
      // Emit workflow start
      await this.emit({
        type: "workflow:start",
        runId,
        workflowId: this.workflow.id,
        timestamp: startedAt,
        data: { input },
      });

      // Initialize context
      let context: TContext;
      if (this.workflow.initContext) {
        context = await this.workflow.initContext(input);
      } else {
        context = {} as TContext;
      }
      run.context = context;

      // Execute steps in order
      let previousOutput: unknown = input;

      for (const step of this.workflow.steps) {
        if (options?.abortSignal?.aborted) {
          run.status = "aborted";
          run.error = "Workflow aborted by signal";
          await this.emit({
            type: "workflow:abort",
            runId,
            workflowId: this.workflow.id,
            timestamp: Date.now(),
          });
          break;
        }

        const stepLog: WorkflowStepLog = {
          stepId: step.id,
          stepName: step.name,
          status: "pending",
          startedAt: Date.now(),
          attempts: 0,
        };

        // Check if step should be skipped
        if (step.shouldSkip) {
          const shouldSkip = await step.shouldSkip(context);
          if (shouldSkip) {
            stepLog.status = "skipped";
            stepLog.endedAt = Date.now();
            stepLog.durationMs = 0;
            run.stepLogs.push(stepLog);

            await this.emit({
              type: "step:skip",
              runId,
              workflowId: this.workflow.id,
              timestamp: Date.now(),
              stepId: step.id,
              stepName: step.name,
            });

            continue;
          }
        }

        stepLog.status = "running";

        // Transform input if needed
        let stepInput: unknown = previousOutput;
        if (step.transformInput) {
          stepInput = await step.transformInput(previousOutput, context);
        }

        // Execute the step
        const result = await this.executeStep(
          step as StepDefinition<unknown, unknown, TContext>,
          stepInput,
          context,
          runId,
          options?.abortSignal,
        );

        stepLog.endedAt = Date.now();
        stepLog.durationMs = result.durationMs;
        stepLog.attempts = result.attempts;
        stepLog.result = result;

        if (result.status === "success") {
          stepLog.status = "completed";
          previousOutput = result.data;
          run.stepResults.set(step.id, result);
        } else {
          stepLog.status = "failed";
          stepLog.error = result.error;
          run.stepResults.set(step.id, result);

          if (!step.continueOnError && (this.workflow.abortOnError ?? true)) {
            run.status = "failed";
            run.error = `Step "${step.name}" failed: ${result.error}`;
            run.stepLogs.push(stepLog);
            break;
          }
        }

        run.stepLogs.push(stepLog);
      }

      // Transform output if workflow completed successfully
      if (run.status === "running") {
        run.status = "completed";

        if (this.workflow.transformOutput) {
          run.output = await this.workflow.transformOutput(run.stepResults, context);
        } else {
          // Default: use last successful step's output
          const lastSuccessful = [...run.stepResults.values()]
            .filter((r) => r.status === "success")
            .pop();
          run.output = (lastSuccessful as { data: TOutput } | undefined)?.data;
        }
      }

      run.endedAt = Date.now();
      run.durationMs = run.endedAt - startedAt;

      // Emit completion/error event
      if (run.status === "completed") {
        await this.emit({
          type: "workflow:complete",
          runId,
          workflowId: this.workflow.id,
          timestamp: run.endedAt,
          data: { output: run.output, durationMs: run.durationMs },
        });
      } else if (run.status === "failed") {
        await this.emit({
          type: "workflow:error",
          runId,
          workflowId: this.workflow.id,
          timestamp: run.endedAt,
          error: run.error,
        });
      }

      return run;
    } catch (err) {
      run.status = "failed";
      run.error = err instanceof Error ? err.message : String(err);
      run.endedAt = Date.now();
      run.durationMs = run.endedAt - startedAt;

      await this.emit({
        type: "workflow:error",
        runId,
        workflowId: this.workflow.id,
        timestamp: run.endedAt,
        error: run.error,
      });

      return run;
    } finally {
      // Remove temporary listeners
      if (options?.listeners) {
        for (const listener of options.listeners) {
          this.removeEventListener(listener);
        }
      }
    }
  }
}

/**
 * Create and run a workflow in one call
 */
export async function runWorkflow<TInput, TOutput, TContext>(
  workflow: WorkflowDefinition<TInput, TOutput, TContext>,
  input: TInput,
  options?: WorkflowRunnerOptions,
): Promise<WorkflowRun<TInput, TOutput, TContext>> {
  const runner = new WorkflowRunner(workflow);
  return runner.run(input, options);
}
