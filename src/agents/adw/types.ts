/**
 * ADW (AI Developer Workflow) Types
 *
 * Defines the core types for AI Developer Workflows - deterministic orchestration
 * of agent calls with logging, validation, and retry capabilities.
 */

export type ADWStepStatus = "pending" | "running" | "success" | "failed" | "skipped" | "retrying";

export type ADWValidationResult = {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
};

export type ADWStepResult<T = unknown> = {
  status: "success" | "failed" | "skipped";
  output?: T;
  error?: string;
  errorCode?: string;
  validation?: ADWValidationResult;
  durationMs: number;
  attempts: number;
  retryable: boolean;
};

export type ADWStepLog = {
  stepId: string;
  stepName: string;
  status: ADWStepStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  attempt: number;
  maxAttempts: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  errorCode?: string;
  validation?: ADWValidationResult;
  metadata?: Record<string, unknown>;
};

export type ADWWorkflowLog = {
  workflowId: string;
  workflowName: string;
  status: "pending" | "running" | "success" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  steps: ADWStepLog[];
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

/**
 * Retry configuration for ADW steps.
 * Supports exponential backoff with jitter for resilient execution.
 */
export type ADWRetryConfig = {
  /** Maximum number of retry attempts (including the initial attempt) */
  maxAttempts: number;
  /** Initial delay in milliseconds before the first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds (cap for exponential backoff) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Jitter factor (0-1) to randomize delays and prevent thundering herd */
  jitterFactor: number;
  /** Error codes/patterns that should trigger a retry */
  retryableErrors?: string[];
  /** Error codes/patterns that should NOT trigger a retry */
  nonRetryableErrors?: string[];
};

/**
 * Validation configuration for ADW step outputs.
 */
export type ADWValidationConfig = {
  /** Whether validation is required (step fails if validation fails) */
  required: boolean;
  /** Custom validator function */
  validator?: (output: unknown) => ADWValidationResult | Promise<ADWValidationResult>;
  /** JSON schema for output validation */
  schema?: Record<string, unknown>;
  /** Timeout for validation in milliseconds */
  timeoutMs?: number;
};

/**
 * Step definition for an ADW workflow.
 */
export type ADWStepDefinition<TInput = unknown, TOutput = unknown> = {
  /** Unique identifier for this step */
  id: string;
  /** Human-readable name for this step */
  name: string;
  /** Description of what this step does */
  description?: string;
  /** The execution function for this step */
  execute: (input: TInput, context: ADWStepContext) => Promise<TOutput>;
  /** Retry configuration for this step */
  retry?: Partial<ADWRetryConfig>;
  /** Validation configuration for step output */
  validation?: ADWValidationConfig;
  /** Timeout for step execution in milliseconds */
  timeoutMs?: number;
  /** Whether to continue workflow on step failure */
  continueOnFailure?: boolean;
  /** Dependencies on other step IDs (must complete first) */
  dependsOn?: string[];
  /** Condition to determine if step should run */
  condition?: (context: ADWStepContext) => boolean | Promise<boolean>;
};

/**
 * Context available to step execution functions.
 */
export type ADWStepContext = {
  /** Workflow ID */
  workflowId: string;
  /** Workflow name */
  workflowName: string;
  /** Step ID */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Current attempt number (1-indexed) */
  attempt: number;
  /** Maximum attempts configured */
  maxAttempts: number;
  /** Results from previous steps (keyed by step ID) */
  previousResults: Map<string, ADWStepResult>;
  /** Shared workflow context data */
  sharedContext: Record<string, unknown>;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Logger for structured logging */
  log: ADWLogger;
};

/**
 * Logger interface for ADW structured logging.
 */
export type ADWLogger = {
  debug: (message: string, data?: Record<string, unknown>) => void;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

/**
 * Workflow definition for an ADW.
 */
export type ADWWorkflowDefinition = {
  /** Unique identifier for this workflow */
  id: string;
  /** Human-readable name for this workflow */
  name: string;
  /** Description of what this workflow does */
  description?: string;
  /** Steps in this workflow (executed in order unless dependencies specified) */
  steps: ADWStepDefinition[];
  /** Default retry configuration for all steps */
  defaultRetry?: Partial<ADWRetryConfig>;
  /** Global timeout for the entire workflow in milliseconds */
  timeoutMs?: number;
  /** Hooks for workflow lifecycle events */
  hooks?: ADWWorkflowHooks;
};

/**
 * Hooks for workflow lifecycle events.
 */
export type ADWWorkflowHooks = {
  /** Called before workflow starts */
  onWorkflowStart?: (workflowId: string, context: Record<string, unknown>) => void | Promise<void>;
  /** Called after workflow completes (success or failure) */
  onWorkflowEnd?: (log: ADWWorkflowLog) => void | Promise<void>;
  /** Called before each step starts */
  onStepStart?: (stepLog: ADWStepLog) => void | Promise<void>;
  /** Called after each step completes */
  onStepEnd?: (stepLog: ADWStepLog) => void | Promise<void>;
  /** Called before a retry attempt */
  onRetry?: (stepId: string, attempt: number, error: string) => void | Promise<void>;
  /** Called when validation fails */
  onValidationFailure?: (stepId: string, result: ADWValidationResult) => void | Promise<void>;
};

/**
 * Options for running an ADW workflow.
 */
export type ADWRunOptions = {
  /** Initial context data */
  context?: Record<string, unknown>;
  /** Override default retry configuration */
  retry?: Partial<ADWRetryConfig>;
  /** Override global timeout */
  timeoutMs?: number;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Custom logger */
  logger?: ADWLogger;
  /** Whether to persist workflow logs */
  persistLogs?: boolean;
  /** Directory for log persistence */
  logDir?: string;
};

/**
 * Result of running an ADW workflow.
 */
export type ADWWorkflowResult = {
  status: "success" | "failed" | "cancelled";
  log: ADWWorkflowLog;
  outputs: Map<string, unknown>;
  errors: Array<{ stepId: string; error: string }>;
};

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: ADWRetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  retryableErrors: ["rate_limit", "timeout", "ETIMEDOUT", "ECONNRESET", "429", "408", "503"],
  nonRetryableErrors: ["auth", "billing", "401", "402", "403"],
};
