/**
 * Prompt Pipeline
 *
 * Unified Request → Validate → Resolve pipeline for all prompt types.
 * This is the main entry point for the closed-loop prompt pattern.
 */

import type {
  BasePromptRequest,
  PromptPipeline,
  PromptResolutionResult,
  PromptResolver,
  PromptValidationResult,
  PromptValidator,
  PromptRequest,
  SkillsPromptRequest,
  HeartbeatPromptRequest,
  ExtraSystemPromptRequest,
  ContextFilesPromptRequest,
  SystemPromptRequest,
} from "./types.js";
import { getValidator } from "./validators.js";
import { getResolver } from "./resolvers.js";

// =============================================================================
// Generic Pipeline
// =============================================================================

/**
 * Creates a pipeline for a specific prompt type.
 */
export function createPipeline<T extends BasePromptRequest, R = string>(
  validator: PromptValidator<T>,
  resolver: PromptResolver<T, R>,
): PromptPipeline<T, R> {
  return {
    validator,
    resolver,
    process(request: T): PromptResolutionResult<R> {
      const validation = validator.validate(request);
      return resolver.resolve(request, validation);
    },
  };
}

/**
 * Process any prompt request through the appropriate pipeline.
 * Auto-selects the correct validator and resolver based on request type.
 */
export function processPromptRequest<T extends PromptRequest>(
  request: T,
): PromptResolutionResult<string> {
  const validator = getValidator<T>(request.type);
  const resolver = getResolver<T, string>(request.type);

  if (!validator) {
    return {
      success: false,
      error: `No validator registered for request type: ${request.type}`,
      validation: {
        valid: false,
        errors: [
          {
            code: "UNKNOWN_TYPE",
            message: `Unknown request type: ${request.type}`,
            path: "type",
            value: request.type,
          },
        ],
        warnings: [],
      },
      metadata: { strategy: "error" },
    };
  }

  if (!resolver) {
    return {
      success: false,
      error: `No resolver registered for request type: ${request.type}`,
      validation: {
        valid: false,
        errors: [
          {
            code: "NO_RESOLVER",
            message: `No resolver for request type: ${request.type}`,
            path: "type",
            value: request.type,
          },
        ],
        warnings: [],
      },
      metadata: { strategy: "error" },
    };
  }

  const validation = validator.validate(request);
  return resolver.resolve(request, validation);
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Process a skills prompt request.
 */
export function processSkillsPrompt(
  request: Omit<SkillsPromptRequest, "type">,
): PromptResolutionResult<string> {
  return processPromptRequest({
    type: "skills",
    timestamp: Date.now(),
    ...request,
  });
}

/**
 * Process a heartbeat prompt request.
 */
export function processHeartbeatPrompt(
  request: Omit<HeartbeatPromptRequest, "type">,
): PromptResolutionResult<string> {
  return processPromptRequest({
    type: "heartbeat",
    timestamp: Date.now(),
    ...request,
  });
}

/**
 * Process an extra system prompt request.
 */
export function processExtraSystemPrompt(
  request: Omit<ExtraSystemPromptRequest, "type">,
): PromptResolutionResult<string> {
  return processPromptRequest({
    type: "extra_system",
    timestamp: Date.now(),
    ...request,
  });
}

/**
 * Process a context files prompt request.
 */
export function processContextFilesPrompt(
  request: Omit<ContextFilesPromptRequest, "type">,
): PromptResolutionResult<string> {
  return processPromptRequest({
    type: "context_files",
    timestamp: Date.now(),
    ...request,
  });
}

/**
 * Process a system prompt request.
 */
export function processSystemPrompt(
  request: Omit<SystemPromptRequest, "type">,
): PromptResolutionResult<string> {
  return processPromptRequest({
    type: "system",
    timestamp: Date.now(),
    ...request,
  });
}

// =============================================================================
// Batch Processing
// =============================================================================

export interface BatchPromptResult {
  /** Results for each request, keyed by request type */
  results: Map<string, PromptResolutionResult<string>>;
  /** Whether all requests succeeded */
  allSucceeded: boolean;
  /** Total token estimate across all prompts */
  totalTokenEstimate: number;
  /** Any errors encountered */
  errors: Array<{ type: string; error: string }>;
}

/**
 * Process multiple prompt requests in batch.
 * Useful for building a complete system prompt from components.
 */
export function processBatch(requests: PromptRequest[]): BatchPromptResult {
  const results = new Map<string, PromptResolutionResult<string>>();
  const errors: Array<{ type: string; error: string }> = [];
  let totalTokenEstimate = 0;
  let allSucceeded = true;

  for (const request of requests) {
    const result = processPromptRequest(request);
    results.set(request.type, result);

    if (!result.success) {
      allSucceeded = false;
      errors.push({
        type: request.type,
        error: result.error ?? "Unknown error",
      });
    } else {
      totalTokenEstimate += result.metadata?.tokenEstimate ?? 0;
    }
  }

  return {
    results,
    allSucceeded,
    totalTokenEstimate,
    errors,
  };
}

// =============================================================================
// Self-Correction Support
// =============================================================================

export interface CorrectionSuggestion {
  /** The field that needs correction */
  path: string;
  /** The original value */
  originalValue: unknown;
  /** Suggested corrected value */
  suggestedValue: unknown;
  /** Reason for the correction */
  reason: string;
}

/**
 * Analyze validation errors and generate correction suggestions.
 * This enables self-correction capabilities for agents.
 */
export function generateCorrectionSuggestions(
  validation: PromptValidationResult,
): CorrectionSuggestion[] {
  const suggestions: CorrectionSuggestion[] = [];

  for (const error of validation.errors) {
    switch (error.code) {
      case "EMPTY_STRING":
        suggestions.push({
          path: error.path ?? "unknown",
          originalValue: error.value,
          suggestedValue: undefined, // Remove the field
          reason: error.suggestion ?? "Remove empty string or provide a valid value",
        });
        break;

      case "TOO_SHORT":
        suggestions.push({
          path: error.path ?? "unknown",
          originalValue: error.value,
          suggestedValue: undefined,
          reason: error.suggestion ?? "Provide a longer value",
        });
        break;

      case "INVALID_TYPE":
        if (error.path?.includes("[]")) {
          suggestions.push({
            path: error.path,
            originalValue: error.value,
            suggestedValue: [],
            reason: error.suggestion ?? "Convert to an array",
          });
        } else if (error.message?.includes("string")) {
          // Safely convert unknown value to string
          const valueStr =
            typeof error.value === "string"
              ? error.value
              : typeof error.value === "number" || typeof error.value === "boolean"
                ? String(error.value)
                : "";
          suggestions.push({
            path: error.path ?? "unknown",
            originalValue: error.value,
            suggestedValue: valueStr,
            reason: error.suggestion ?? "Convert to a string",
          });
        }
        break;

      case "INVALID_PROMPT_MODE":
        suggestions.push({
          path: error.path ?? "promptMode",
          originalValue: error.value,
          suggestedValue: "full",
          reason: error.suggestion ?? "Use one of: full, minimal, none",
        });
        break;

      default:
        if (error.suggestion) {
          suggestions.push({
            path: error.path ?? "unknown",
            originalValue: error.value,
            suggestedValue: undefined,
            reason: error.suggestion,
          });
        }
    }
  }

  return suggestions;
}

/**
 * Attempt to auto-correct a request based on validation errors.
 * Returns a new corrected request if corrections were possible.
 */
export function attemptAutoCorrection<T extends PromptRequest>(
  request: T,
  validation: PromptValidationResult,
): { corrected: T; applied: CorrectionSuggestion[] } | null {
  if (validation.valid) {
    return null; // No corrections needed
  }

  const suggestions = generateCorrectionSuggestions(validation);
  if (suggestions.length === 0) {
    return null; // No correctable errors
  }

  // Create a shallow copy of the request
  const corrected = { ...request } as T;
  const applied: CorrectionSuggestion[] = [];

  for (const suggestion of suggestions) {
    // Simple path resolution (handles top-level fields only)
    const path = suggestion.path;
    if (!path || path === "unknown" || path.includes("[")) {
      continue; // Skip complex paths for now
    }

    if (path in corrected) {
      if (suggestion.suggestedValue === undefined) {
        // Remove the field
        delete (corrected as unknown as Record<string, unknown>)[path];
      } else {
        (corrected as unknown as Record<string, unknown>)[path] = suggestion.suggestedValue;
      }
      applied.push(suggestion);
    }
  }

  if (applied.length === 0) {
    return null;
  }

  return { corrected, applied };
}

// =============================================================================
// Logging & Observability
// =============================================================================

export interface PromptProcessingEvent {
  type: "validation" | "resolution" | "error" | "correction";
  requestType: string;
  timestamp: number;
  durationMs?: number;
  success: boolean;
  details?: Record<string, unknown>;
}

type EventHandler = (event: PromptProcessingEvent) => void;

const eventHandlers: EventHandler[] = [];

/**
 * Register an event handler for prompt processing events.
 */
export function onPromptEvent(handler: EventHandler): () => void {
  eventHandlers.push(handler);
  return () => {
    const index = eventHandlers.indexOf(handler);
    if (index !== -1) {
      eventHandlers.splice(index, 1);
    }
  };
}

function emitEvent(event: PromptProcessingEvent): void {
  for (const handler of eventHandlers) {
    try {
      handler(event);
    } catch {
      // Ignore handler errors
    }
  }
}

/**
 * Process a request with event emission for observability.
 */
export function processWithEvents<T extends PromptRequest>(
  request: T,
): PromptResolutionResult<string> {
  const validator = getValidator<T>(request.type);
  if (!validator) {
    emitEvent({
      type: "error",
      requestType: request.type,
      timestamp: Date.now(),
      success: false,
      details: { error: "No validator registered" },
    });
    return processPromptRequest(request);
  }

  // Validate
  const validationStart = Date.now();
  const validation = validator.validate(request);
  emitEvent({
    type: "validation",
    requestType: request.type,
    timestamp: validationStart,
    durationMs: Date.now() - validationStart,
    success: validation.valid,
    details: {
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
    },
  });

  // Attempt correction if needed
  if (!validation.valid) {
    const correction = attemptAutoCorrection(request, validation);
    if (correction) {
      emitEvent({
        type: "correction",
        requestType: request.type,
        timestamp: Date.now(),
        success: true,
        details: {
          correctionsApplied: correction.applied.length,
        },
      });
      // Retry with corrected request
      return processWithEvents(correction.corrected);
    }
  }

  // Resolve
  const resolver = getResolver<T, string>(request.type);
  if (!resolver) {
    emitEvent({
      type: "error",
      requestType: request.type,
      timestamp: Date.now(),
      success: false,
      details: { error: "No resolver registered" },
    });
    return processPromptRequest(request);
  }

  const resolutionStart = Date.now();
  const result = resolver.resolve(request, validation);
  emitEvent({
    type: "resolution",
    requestType: request.type,
    timestamp: resolutionStart,
    durationMs: Date.now() - resolutionStart,
    success: result.success,
    details: {
      strategy: result.metadata?.strategy,
      tokenEstimate: result.metadata?.tokenEstimate,
    },
  });

  return result;
}
