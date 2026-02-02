/**
 * ADW (AI Developer Workflow) Module
 *
 * Provides deterministic orchestration of agent calls with:
 * - Structured logging for each step
 * - Validation checkpoints between steps
 * - Automatic retries with exponential backoff
 *
 * Based on TAC (Tactical Agentic Coding) principles for building
 * resilient AI developer workflows.
 */

// Types
export type {
  ADWStepStatus,
  ADWValidationResult,
  ADWStepResult,
  ADWStepLog,
  ADWWorkflowLog,
  ADWRetryConfig,
  ADWValidationConfig,
  ADWStepDefinition,
  ADWStepContext,
  ADWLogger,
  ADWWorkflowDefinition,
  ADWWorkflowHooks,
  ADWRunOptions,
  ADWWorkflowResult,
} from "./types.js";

export { DEFAULT_RETRY_CONFIG } from "./types.js";

// Retry
export {
  calculateRetryDelay,
  isRetryableError,
  sleep,
  withRetry,
  createRetryConfig,
  mergeRetryConfig,
} from "./retry.js";

export type { RetryOptions, RetryResult } from "./retry.js";

// Validation
export {
  validateStepOutput,
  validateJsonSchema,
  notEmptyValidator,
  hasFieldsValidator,
  patternValidator,
  allOfValidator,
  anyOfValidator,
  createValidationConfig,
  createSchemaValidationConfig,
} from "./validation.js";

// Logger
export {
  createADWLogger,
  createStepLogger,
  createWorkflowLog,
  createStepLog,
  completeStepLog,
  completeWorkflowLog,
  persistWorkflowLog,
  loadWorkflowLog,
  listWorkflowLogs,
  formatWorkflowLog,
  createWorkflowSummary,
} from "./logger.js";

export type { ADWLogLevel, ADWLogEntry } from "./logger.js";

// Runner
export { runADWWorkflow, createWorkflow, ADWWorkflowBuilder } from "./runner.js";
