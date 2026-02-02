/**
 * ADW (AI Developer Workflow) Type Definitions
 *
 * ADWs combine deterministic code orchestration with non-deterministic
 * agent execution. These types define the structured format for storing
 * ADW execution results.
 */

/**
 * Supported ADW workflow types from TAC principles.
 */
export type ADWWorkflowType =
  | "plan-build" // Plan a feature, then build it
  | "test-fix" // Run tests, fix failures
  | "review-document" // Review code, generate docs
  | "scout-research" // Research before implementation
  | "custom"; // User-defined workflow

/**
 * ADW execution status.
 */
export type ADWStatus =
  | "pending" // Waiting to start
  | "running" // Currently executing
  | "completed" // Finished successfully
  | "failed" // Finished with error
  | "cancelled" // Manually stopped
  | "timeout"; // Exceeded time limit

/**
 * Trigger that initiated the ADW execution.
 */
export type ADWTrigger =
  | "manual" // User invoked directly
  | "webhook" // HTTP webhook trigger
  | "github-issue" // GitHub issue created/updated
  | "github-pr" // GitHub PR created/updated
  | "cron" // Scheduled execution
  | "upstream-sync" // OpenClaw sync detected changes
  | "orchestrator" // Orchestrator agent triggered this
  | "agent"; // Another agent triggered this

/**
 * Individual step within an ADW execution.
 */
export interface ADWStep {
  /** Unique step ID within the workflow */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Step execution order (0-indexed) */
  order: number;
  /** Step status */
  status: ADWStatus;
  /** When step started (epoch ms) */
  startedAt?: number;
  /** When step ended (epoch ms) */
  endedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Agent session key used for this step */
  sessionKey?: string;
  /** Sub-agent run ID if delegated */
  runId?: string;
  /** Step output (text, code, structured data) */
  output?: string;
  /** Output format hint */
  outputType?: "text" | "code" | "json" | "markdown";
  /** Error message if step failed */
  error?: string;
  /** Token usage for this step */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
  /** Quality metrics for this step */
  metrics?: {
    confidence?: number;
    completeness?: number;
    overallScore?: number;
  };
}

/**
 * Artifact produced by an ADW execution.
 */
export interface ADWArtifact {
  /** Artifact identifier */
  id: string;
  /** Artifact type */
  type: "file" | "commit" | "pr" | "issue" | "report";
  /** Human-readable name */
  name: string;
  /** Path or URL to artifact */
  path?: string;
  /** Inline content (for small artifacts) */
  content?: string;
  /** When artifact was created */
  createdAt: number;
  /** Which step produced this artifact */
  stepId?: string;
}

/**
 * Complete ADW execution record.
 */
export interface ADWRun {
  /** Unique run identifier */
  id: string;
  /** Workflow type */
  workflowType: ADWWorkflowType;
  /** Custom workflow name for type="custom" */
  workflowName?: string;
  /** What triggered this execution */
  trigger: ADWTrigger;
  /** Trigger-specific metadata (issue number, PR URL, orchestrator ID, etc.) */
  triggerMeta?: Record<string, unknown>;
  /** Overall execution status */
  status: ADWStatus;
  /** When execution was created */
  createdAt: number;
  /** When execution started */
  startedAt?: number;
  /** When execution ended */
  endedAt?: number;
  /** Total duration in milliseconds */
  durationMs?: number;
  /** Task description that initiated the workflow */
  task: string;
  /** Optional task ID from external system */
  taskId?: string;
  /** Workflow configuration parameters */
  config?: {
    maxSteps?: number;
    timeoutSeconds?: number;
    model?: string;
    thinking?: string;
  };
  /** Individual steps in execution order */
  steps: ADWStep[];
  /** Final aggregated output */
  output?: string;
  /** Error message if failed */
  error?: string;
  /** Artifacts produced */
  artifacts: ADWArtifact[];
  /** Aggregate resource usage */
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
    stepCount: number;
    successfulSteps: number;
    failedSteps: number;
  };
  /** Aggregate quality metrics */
  metrics: {
    overallScore?: number;
    confidence?: number;
    completeness?: number;
  };
  /** Optional labels for categorization */
  labels?: string[];
}

/**
 * Filter options for querying ADW runs.
 */
export interface ADWRunFilter {
  /** Filter by workflow type */
  workflowType?: ADWWorkflowType;
  /** Filter by status */
  status?: ADWStatus | ADWStatus[];
  /** Filter by trigger */
  trigger?: ADWTrigger;
  /** Filter by task ID */
  taskId?: string;
  /** Filter runs created after this time */
  createdAfter?: number;
  /** Filter runs created before this time */
  createdBefore?: number;
  /** Filter by labels (any match) */
  labels?: string[];
  /** Limit results */
  limit?: number;
  /** Skip results for pagination */
  offset?: number;
}

/**
 * Summary statistics for ADW runs.
 */
export interface ADWSummary {
  /** Total number of runs */
  totalRuns: number;
  /** Runs by status */
  byStatus: Record<ADWStatus, number>;
  /** Runs by workflow type */
  byWorkflowType: Record<ADWWorkflowType, number>;
  /** Runs by trigger */
  byTrigger: Record<ADWTrigger, number>;
  /** Aggregate usage */
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  /** Success rate (0-1) */
  successRate: number;
  /** Average duration in ms */
  avgDurationMs: number;
  /** Average score */
  avgScore: number;
}

/**
 * ADW definition for the registry - describes an available workflow.
 */
export interface ADWDefinition {
  /** Unique workflow identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this workflow does */
  description: string;
  /** The workflow type */
  type: ADWWorkflowType;
  /** Step definitions (deterministic structure) */
  steps: Array<{
    name: string;
    description: string;
    stepType: "agent" | "validation" | "transform" | "git" | "test";
    config?: Record<string, unknown>;
  }>;
  /** Input schema for validation */
  inputSchema?: {
    required?: string[];
    optional?: string[];
  };
  /** Default configuration */
  defaults?: {
    timeoutSeconds?: number;
    model?: string;
    thinking?: string;
  };
  /** Whether this ADW is enabled */
  enabled: boolean;
}

/**
 * Parameters for triggering an ADW from the orchestrator.
 */
export interface ADWTriggerParams {
  /** Which workflow to run */
  workflowId: string;
  /** Task description */
  task: string;
  /** Optional task ID from external system */
  taskId?: string;
  /** Trigger metadata */
  triggerMeta?: Record<string, unknown>;
  /** Configuration overrides */
  config?: {
    timeoutSeconds?: number;
    model?: string;
    thinking?: string;
  };
  /** Labels for categorization */
  labels?: string[];
  /** Whether to wait for completion (blocking) or return immediately */
  await?: boolean;
}

/**
 * Result of triggering an ADW.
 */
export interface ADWTriggerResult {
  /** Whether the trigger was successful */
  success: boolean;
  /** The run ID for tracking */
  runId?: string;
  /** Error message if failed */
  error?: string;
  /** The run record (if await was true and completed) */
  run?: ADWRun;
}

// ============================================================================
// Workflow Runner Types
// ============================================================================

/**
 * Configuration for retry behavior.
 */
export interface StepRetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts?: number;
  /** Initial delay between retries in ms */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms */
  maxDelayMs?: number;
  /** Jitter factor (0-1) to randomize delays */
  jitter?: number;
  /** Function to determine if an error is retryable */
  isRetryable?: (error: unknown, attempt: number) => boolean;
}

/**
 * Configuration for an agent call.
 */
export interface AgentCallConfig {
  /** Model to use */
  model?: string;
  /** Provider (anthropic, openai, etc.) */
  provider?: string;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Additional provider-specific options */
  [key: string]: unknown;
}

/**
 * Input to an agent call.
 */
export interface AgentCallInput {
  /** The prompt to send to the agent */
  prompt: string;
  /** Optional configuration */
  config?: AgentCallConfig;
  /** Optional context from previous steps */
  context?: Record<string, unknown>;
}

/**
 * Output from an agent call.
 */
export interface AgentCallOutput {
  /** The generated text response */
  text: string;
  /** Model used for generation */
  model: string;
  /** Provider used */
  provider: string;
  /** Token usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Definition of a workflow step.
 */
export interface StepDefinition<TInput = unknown, TOutput = unknown, TContext = unknown> {
  /** Unique step identifier */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Execute the step */
  execute: (input: TInput, context: TContext) => Promise<TOutput>;
  /** Optional input validation */
  validate?: (input: TInput, context: TContext) => boolean | string | Promise<boolean | string>;
  /** Optional output validation */
  validateOutput?: (
    output: TOutput,
    context: TContext,
  ) => boolean | string | Promise<boolean | string>;
  /** Optional input transformation */
  transformInput?: (input: unknown, context: TContext) => TInput | Promise<TInput>;
  /** Check if step should be skipped */
  shouldSkip?: (context: TContext) => boolean | Promise<boolean>;
  /** Retry configuration for this step */
  retry?: StepRetryConfig;
  /** Step timeout in milliseconds */
  timeoutMs?: number;
  /** Continue workflow even if this step fails */
  continueOnError?: boolean;
}

/**
 * Result of executing a step.
 */
export type StepResult<TOutput = unknown> =
  | {
      status: "success";
      data: TOutput;
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

/**
 * Complete workflow definition.
 */
export interface WorkflowDefinition<TInput = unknown, TOutput = unknown, TContext = unknown> {
  /** Unique workflow identifier */
  id: string;
  /** Human-readable workflow name */
  name: string;
  /** Optional description */
  description?: string;
  /** Workflow version */
  version?: string;
  /** Steps to execute in order */
  steps: StepDefinition<unknown, unknown, TContext>[];
  /** Initialize context from input */
  initContext?: (input: TInput) => TContext | Promise<TContext>;
  /** Transform step results to final output */
  transformOutput?: (
    stepResults: Map<string, StepResult>,
    context: TContext,
  ) => TOutput | Promise<TOutput>;
  /** Default retry configuration for all steps */
  defaultRetry?: StepRetryConfig;
  /** Global workflow timeout in milliseconds */
  timeoutMs?: number;
  /** Abort workflow on first step failure (default: true) */
  abortOnError?: boolean;
}

/**
 * Events emitted during workflow execution.
 */
export type WorkflowEvent =
  | {
      type: "workflow:start";
      runId: string;
      workflowId: string;
      timestamp: number;
      data?: unknown;
    }
  | {
      type: "workflow:complete";
      runId: string;
      workflowId: string;
      timestamp: number;
      data?: unknown;
    }
  | {
      type: "workflow:error";
      runId: string;
      workflowId: string;
      timestamp: number;
      error?: string;
    }
  | {
      type: "workflow:abort";
      runId: string;
      workflowId: string;
      timestamp: number;
    }
  | {
      type: "step:start";
      runId: string;
      workflowId: string;
      timestamp: number;
      stepId: string;
      stepName: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: "step:complete";
      runId: string;
      workflowId: string;
      timestamp: number;
      stepId: string;
      stepName: string;
      data?: unknown;
    }
  | {
      type: "step:error";
      runId: string;
      workflowId: string;
      timestamp: number;
      stepId: string;
      stepName: string;
      error?: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: "step:retry";
      runId: string;
      workflowId: string;
      timestamp: number;
      stepId: string;
      stepName: string;
      error?: string;
      attempt: number;
      maxAttempts: number;
      data?: unknown;
    }
  | {
      type: "step:skip";
      runId: string;
      workflowId: string;
      timestamp: number;
      stepId: string;
      stepName: string;
    };

/**
 * Listener for workflow events.
 */
export type WorkflowEventListener = (event: WorkflowEvent) => void | Promise<void>;

/**
 * Log entry for a workflow step execution.
 */
export interface WorkflowStepLog {
  /** Step identifier */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Step execution status */
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  /** When step started */
  startedAt: number;
  /** When step ended */
  endedAt?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Number of attempts made */
  attempts: number;
  /** Step result */
  result?: StepResult;
  /** Error message if failed */
  error?: string;
}

/**
 * A single execution of a workflow.
 */
export interface WorkflowRun<TInput = unknown, TOutput = unknown, TContext = unknown> {
  /** Unique run identifier */
  runId: string;
  /** Workflow identifier */
  workflowId: string;
  /** Workflow version */
  workflowVersion?: string;
  /** Run status */
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  /** Input provided to the workflow */
  input: TInput;
  /** Output produced by the workflow */
  output?: TOutput;
  /** Workflow context */
  context?: TContext;
  /** Step execution logs */
  stepLogs: WorkflowStepLog[];
  /** Step results by step ID */
  stepResults: Map<string, StepResult>;
  /** When run started */
  startedAt: number;
  /** When run ended */
  endedAt?: number;
  /** Total duration in milliseconds */
  durationMs?: number;
  /** Error message if failed */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}
