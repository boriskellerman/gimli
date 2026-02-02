/**
 * Closed-Loop Prompt Types
 *
 * Implements the Request → Validate → Resolve pattern for all prompts.
 * This is part of TAC Grade 4: Closed-Loop Prompts.
 *
 * The pattern ensures:
 * - All prompt inputs are validated before processing
 * - Invalid inputs are caught early with clear error messages
 * - Self-correction capabilities through validation feedback
 */

/**
 * Result of validating a prompt request.
 */
export interface PromptValidationResult {
  /** Whether the request is valid */
  valid: boolean;
  /** Validation errors if invalid */
  errors: PromptValidationError[];
  /** Non-fatal warnings about the request */
  warnings: PromptValidationWarning[];
  /** Sanitized/normalized version of the input (if applicable) */
  sanitized?: unknown;
}

/**
 * A validation error that prevents prompt resolution.
 */
export interface PromptValidationError {
  /** Error code for programmatic handling */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Path to the invalid field (e.g., "skills.prompt") */
  path?: string;
  /** The invalid value (for debugging) */
  value?: unknown;
  /** Suggested fix */
  suggestion?: string;
}

/**
 * A non-fatal warning about the prompt request.
 */
export interface PromptValidationWarning {
  /** Warning code */
  code: string;
  /** Human-readable warning message */
  message: string;
  /** Path to the field with the warning */
  path?: string;
}

/**
 * Base interface for all prompt requests.
 * Each prompt type extends this with specific fields.
 */
export interface BasePromptRequest {
  /** Unique request type identifier */
  readonly type: string;
  /** Source of the request (for tracing) */
  source?: string;
  /** Timestamp when the request was created */
  timestamp?: number;
}

/**
 * Result of resolving a prompt request.
 */
export interface PromptResolutionResult<T = string> {
  /** Whether resolution succeeded */
  success: boolean;
  /** The resolved prompt (if successful) */
  prompt?: T;
  /** Error message (if failed) */
  error?: string;
  /** Validation result from the request */
  validation: PromptValidationResult;
  /** Metadata about the resolution */
  metadata?: PromptResolutionMetadata;
}

/**
 * Metadata about how a prompt was resolved.
 */
export interface PromptResolutionMetadata {
  /** Which resolution strategy was used */
  strategy: string;
  /** Time taken to resolve (ms) */
  durationMs?: number;
  /** Cache hit/miss status */
  cached?: boolean;
  /** Token count estimate */
  tokenEstimate?: number;
}

/**
 * A prompt validator that checks request validity.
 */
export interface PromptValidator<T extends BasePromptRequest> {
  /** Validate a prompt request */
  validate(request: T): PromptValidationResult;
  /** Get the supported request type */
  readonly type: string;
}

/**
 * A prompt resolver that transforms validated requests into prompts.
 */
export interface PromptResolver<T extends BasePromptRequest, R = string> {
  /** Resolve a validated request into a prompt */
  resolve(request: T, validation: PromptValidationResult): PromptResolutionResult<R>;
  /** Get the supported request type */
  readonly type: string;
}

/**
 * Combined prompt pipeline that validates and resolves in one step.
 */
export interface PromptPipeline<T extends BasePromptRequest, R = string> {
  /** Process a request through validation and resolution */
  process(request: T): PromptResolutionResult<R>;
  /** Get the validator */
  readonly validator: PromptValidator<T>;
  /** Get the resolver */
  readonly resolver: PromptResolver<T, R>;
}

// =============================================================================
// Specific Prompt Request Types
// =============================================================================

/**
 * Request for resolving a skills prompt.
 */
export interface SkillsPromptRequest extends BasePromptRequest {
  readonly type: "skills";
  /** Pre-computed skills snapshot (highest priority) */
  skillsSnapshot?: {
    prompt?: string;
    skills?: Array<{ name: string; primaryEnv?: string }>;
    version?: number;
  };
  /** Skill entries to format (fallback) */
  entries?: Array<{
    skill: { name: string; description?: string };
    invocation?: { disableModelInvocation?: boolean };
  }>;
  /** Config for filtering */
  config?: unknown;
  /** Workspace directory for loading skills */
  workspaceDir: string;
  /** Optional skill filter list */
  skillFilter?: string[];
  /** Eligibility context for filtering */
  eligibility?: {
    remote?: { note?: string };
  };
}

/**
 * Request for resolving a heartbeat prompt.
 */
export interface HeartbeatPromptRequest extends BasePromptRequest {
  readonly type: "heartbeat";
  /** Raw prompt from config */
  rawPrompt?: string;
  /** Default prompt to use as fallback */
  defaultPrompt?: string;
}

/**
 * Request for resolving an extra system prompt (e.g., group chat context).
 */
export interface ExtraSystemPromptRequest extends BasePromptRequest {
  readonly type: "extra_system";
  /** Group introduction text */
  groupIntro?: string;
  /** Group system prompt from session context */
  groupSystemPrompt?: string;
  /** Subagent context (for minimal mode) */
  subagentContext?: string;
  /** Whether this is for a subagent (minimal mode) */
  isSubagent?: boolean;
}

/**
 * Request for resolving context file prompts.
 */
export interface ContextFilesPromptRequest extends BasePromptRequest {
  readonly type: "context_files";
  /** List of context files to include */
  files: Array<{
    path: string;
    content: string;
  }>;
  /** Maximum total size in characters */
  maxTotalChars?: number;
}

/**
 * Request for the full system prompt.
 */
export interface SystemPromptRequest extends BasePromptRequest {
  readonly type: "system";
  /** Workspace directory */
  workspaceDir: string;
  /** Skills prompt (already resolved) */
  skillsPrompt?: string;
  /** Heartbeat prompt (already resolved) */
  heartbeatPrompt?: string;
  /** Extra system prompt (already resolved) */
  extraSystemPrompt?: string;
  /** Context files (already resolved) */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Prompt mode (full/minimal/none) */
  promptMode?: "full" | "minimal" | "none";
  /** Tool names available */
  toolNames?: string[];
  /** Additional parameters passed to buildAgentSystemPrompt */
  buildParams?: Record<string, unknown>;
}

/**
 * Union of all prompt request types.
 */
export type PromptRequest =
  | SkillsPromptRequest
  | HeartbeatPromptRequest
  | ExtraSystemPromptRequest
  | ContextFilesPromptRequest
  | SystemPromptRequest;
