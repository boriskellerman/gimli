/**
 * Closed-Loop Prompt System
 *
 * Implements the Request → Validate → Resolve pattern for all prompts.
 * Part of TAC Grade 4: Closed-Loop Prompts.
 *
 * This system provides:
 * - Structured prompt requests with type safety
 * - Validation before resolution with clear error messages
 * - Self-correction capabilities for agents
 * - Observability through event hooks
 *
 * Usage:
 *
 * ```typescript
 * import { processSkillsPrompt, processHeartbeatPrompt } from './prompts';
 *
 * // Process a skills prompt
 * const skillsResult = processSkillsPrompt({
 *   workspaceDir: '/path/to/workspace',
 *   skillsSnapshot: { prompt: '...', skills: [...] },
 * });
 *
 * if (skillsResult.success) {
 *   console.log(skillsResult.prompt);
 * } else {
 *   console.error(skillsResult.error);
 *   console.error(skillsResult.validation.errors);
 * }
 * ```
 */

// Types
export type {
  BasePromptRequest,
  PromptValidationResult,
  PromptValidationError,
  PromptValidationWarning,
  PromptResolutionResult,
  PromptResolutionMetadata,
  PromptValidator,
  PromptResolver,
  PromptPipeline,
  PromptRequest,
  SkillsPromptRequest,
  HeartbeatPromptRequest,
  ExtraSystemPromptRequest,
  ContextFilesPromptRequest,
  SystemPromptRequest,
} from "./types.js";

// Validators
export {
  SkillsPromptValidator,
  HeartbeatPromptValidator,
  ExtraSystemPromptValidator,
  ContextFilesPromptValidator,
  SystemPromptValidator,
  registerValidator,
  getValidator,
} from "./validators.js";

// Resolvers
export {
  SkillsPromptResolver,
  HeartbeatPromptResolver,
  ExtraSystemPromptResolver,
  ContextFilesPromptResolver,
  SystemPromptResolver,
  registerResolver,
  getResolver,
} from "./resolvers.js";

// Pipeline
export {
  createPipeline,
  processPromptRequest,
  processSkillsPrompt,
  processHeartbeatPrompt,
  processExtraSystemPrompt,
  processContextFilesPrompt,
  processSystemPrompt,
  processBatch,
  generateCorrectionSuggestions,
  attemptAutoCorrection,
  onPromptEvent,
  processWithEvents,
  type BatchPromptResult,
  type CorrectionSuggestion,
  type PromptProcessingEvent,
} from "./pipeline.js";
