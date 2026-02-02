/**
 * Prompt Validators
 *
 * Implements validation logic for each prompt request type.
 * Part of the Request → Validate → Resolve pattern.
 */

import type {
  ContextFilesPromptRequest,
  ExtraSystemPromptRequest,
  HeartbeatPromptRequest,
  PromptValidationError,
  PromptValidationResult,
  PromptValidationWarning,
  PromptValidator,
  SkillsPromptRequest,
  SystemPromptRequest,
} from "./types.js";

// =============================================================================
// Validation Helpers
// =============================================================================

function createValidResult(
  sanitized?: unknown,
  warnings: PromptValidationWarning[] = [],
): PromptValidationResult {
  return {
    valid: true,
    errors: [],
    warnings,
    sanitized,
  };
}

function createInvalidResult(
  errors: PromptValidationError[],
  warnings: PromptValidationWarning[] = [],
): PromptValidationResult {
  return {
    valid: false,
    errors,
    warnings,
  };
}

function validateStringField(
  value: unknown,
  fieldPath: string,
  opts: {
    required?: boolean;
    maxLength?: number;
    minLength?: number;
    pattern?: RegExp;
    patternDescription?: string;
  } = {},
): { errors: PromptValidationError[]; warnings: PromptValidationWarning[]; sanitized?: string } {
  const errors: PromptValidationError[] = [];
  const warnings: PromptValidationWarning[] = [];

  if (value === undefined || value === null) {
    if (opts.required) {
      errors.push({
        code: "REQUIRED_FIELD",
        message: `${fieldPath} is required`,
        path: fieldPath,
      });
    }
    return { errors, warnings };
  }

  if (typeof value !== "string") {
    errors.push({
      code: "INVALID_TYPE",
      message: `${fieldPath} must be a string`,
      path: fieldPath,
      value,
    });
    return { errors, warnings };
  }

  const trimmed = value.trim();

  if (opts.required && !trimmed) {
    errors.push({
      code: "EMPTY_STRING",
      message: `${fieldPath} cannot be empty`,
      path: fieldPath,
    });
    return { errors, warnings, sanitized: trimmed };
  }

  if (opts.minLength !== undefined && trimmed.length < opts.minLength) {
    errors.push({
      code: "TOO_SHORT",
      message: `${fieldPath} must be at least ${opts.minLength} characters`,
      path: fieldPath,
      value: trimmed,
    });
  }

  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    warnings.push({
      code: "TOO_LONG",
      message: `${fieldPath} exceeds recommended length of ${opts.maxLength} characters`,
      path: fieldPath,
    });
  }

  if (opts.pattern && !opts.pattern.test(trimmed)) {
    errors.push({
      code: "PATTERN_MISMATCH",
      message: opts.patternDescription || `${fieldPath} does not match required pattern`,
      path: fieldPath,
      value: trimmed,
    });
  }

  return { errors, warnings, sanitized: trimmed };
}

// =============================================================================
// Skills Prompt Validator
// =============================================================================

export class SkillsPromptValidator implements PromptValidator<SkillsPromptRequest> {
  readonly type = "skills";

  validate(request: SkillsPromptRequest): PromptValidationResult {
    const errors: PromptValidationError[] = [];
    const warnings: PromptValidationWarning[] = [];

    // Check request type (cast to string for error message since TS narrows to never)
    const requestType = request.type as string;
    if (requestType !== "skills") {
      errors.push({
        code: "INVALID_REQUEST_TYPE",
        message: `Expected request type 'skills', got '${requestType}'`,
        path: "type",
        value: requestType,
      });
    }

    // Validate workspaceDir (required)
    const workspaceDirResult = validateStringField(request.workspaceDir, "workspaceDir", {
      required: true,
    });
    errors.push(...workspaceDirResult.errors);
    warnings.push(...workspaceDirResult.warnings);

    // Validate skillsSnapshot if provided
    if (request.skillsSnapshot) {
      if (request.skillsSnapshot.prompt !== undefined) {
        const promptResult = validateStringField(
          request.skillsSnapshot.prompt,
          "skillsSnapshot.prompt",
          {
            maxLength: 100_000, // Skills prompts can be large
          },
        );
        errors.push(...promptResult.errors);
        warnings.push(...promptResult.warnings);
      }

      if (request.skillsSnapshot.skills) {
        if (!Array.isArray(request.skillsSnapshot.skills)) {
          errors.push({
            code: "INVALID_TYPE",
            message: "skillsSnapshot.skills must be an array",
            path: "skillsSnapshot.skills",
            value: request.skillsSnapshot.skills,
          });
        } else {
          for (let i = 0; i < request.skillsSnapshot.skills.length; i++) {
            const skill = request.skillsSnapshot.skills[i];
            if (!skill?.name || typeof skill.name !== "string") {
              errors.push({
                code: "INVALID_SKILL",
                message: `Skill at index ${i} must have a name`,
                path: `skillsSnapshot.skills[${i}].name`,
                value: skill,
              });
            }
          }
        }
      }
    }

    // Validate entries if provided
    if (request.entries) {
      if (!Array.isArray(request.entries)) {
        errors.push({
          code: "INVALID_TYPE",
          message: "entries must be an array",
          path: "entries",
          value: request.entries,
        });
      }
    }

    // Validate skillFilter if provided
    if (request.skillFilter !== undefined) {
      if (!Array.isArray(request.skillFilter)) {
        errors.push({
          code: "INVALID_TYPE",
          message: "skillFilter must be an array of strings",
          path: "skillFilter",
          value: request.skillFilter,
        });
      } else {
        for (let i = 0; i < request.skillFilter.length; i++) {
          if (typeof request.skillFilter[i] !== "string") {
            errors.push({
              code: "INVALID_SKILL_FILTER",
              message: `skillFilter[${i}] must be a string`,
              path: `skillFilter[${i}]`,
              value: request.skillFilter[i],
            });
          }
        }
      }
    }

    // Warning if no source is provided
    if (!request.skillsSnapshot && !request.entries) {
      warnings.push({
        code: "NO_SKILLS_SOURCE",
        message: "No skillsSnapshot or entries provided; skills will be loaded from workspace",
        path: "skillsSnapshot|entries",
      });
    }

    if (errors.length > 0) {
      return createInvalidResult(errors, warnings);
    }

    return createValidResult(request, warnings);
  }
}

// =============================================================================
// Heartbeat Prompt Validator
// =============================================================================

export class HeartbeatPromptValidator implements PromptValidator<HeartbeatPromptRequest> {
  readonly type = "heartbeat";

  validate(request: HeartbeatPromptRequest): PromptValidationResult {
    const errors: PromptValidationError[] = [];
    const warnings: PromptValidationWarning[] = [];

    // Check request type (cast to string for error message since TS narrows to never)
    const requestType = request.type as string;
    if (requestType !== "heartbeat") {
      errors.push({
        code: "INVALID_REQUEST_TYPE",
        message: `Expected request type 'heartbeat', got '${requestType}'`,
        path: "type",
        value: requestType,
      });
    }

    // Validate rawPrompt if provided
    if (request.rawPrompt !== undefined) {
      const promptResult = validateStringField(request.rawPrompt, "rawPrompt", {
        maxLength: 2000, // Heartbeat prompts should be concise
      });
      errors.push(...promptResult.errors);
      warnings.push(...promptResult.warnings);

      // Check for potentially confusing content
      if (typeof request.rawPrompt === "string") {
        const normalized = request.rawPrompt.toLowerCase();
        if (normalized.includes("heartbeat_ok") && !normalized.includes("reply")) {
          warnings.push({
            code: "CONFUSING_HEARTBEAT",
            message: "Heartbeat prompt contains HEARTBEAT_OK but may not explain when to use it",
            path: "rawPrompt",
          });
        }
      }
    }

    if (errors.length > 0) {
      return createInvalidResult(errors, warnings);
    }

    return createValidResult(request, warnings);
  }
}

// =============================================================================
// Extra System Prompt Validator
// =============================================================================

export class ExtraSystemPromptValidator implements PromptValidator<ExtraSystemPromptRequest> {
  readonly type = "extra_system";

  validate(request: ExtraSystemPromptRequest): PromptValidationResult {
    const errors: PromptValidationError[] = [];
    const warnings: PromptValidationWarning[] = [];

    // Check request type (cast to string for error message since TS narrows to never)
    const requestType = request.type as string;
    if (requestType !== "extra_system") {
      errors.push({
        code: "INVALID_REQUEST_TYPE",
        message: `Expected request type 'extra_system', got '${requestType}'`,
        path: "type",
        value: requestType,
      });
    }

    // Validate groupIntro if provided
    if (request.groupIntro !== undefined) {
      const introResult = validateStringField(request.groupIntro, "groupIntro", {
        maxLength: 5000,
      });
      errors.push(...introResult.errors);
      warnings.push(...introResult.warnings);
    }

    // Validate groupSystemPrompt if provided
    if (request.groupSystemPrompt !== undefined) {
      const sysPromptResult = validateStringField(request.groupSystemPrompt, "groupSystemPrompt", {
        maxLength: 50_000, // Group system prompts can be substantial
      });
      errors.push(...sysPromptResult.errors);
      warnings.push(...sysPromptResult.warnings);
    }

    // Validate subagentContext if provided
    if (request.subagentContext !== undefined) {
      const ctxResult = validateStringField(request.subagentContext, "subagentContext", {
        maxLength: 10_000,
      });
      errors.push(...ctxResult.errors);
      warnings.push(...ctxResult.warnings);
    }

    // Warning if subagent but no context
    if (request.isSubagent && !request.subagentContext) {
      warnings.push({
        code: "SUBAGENT_NO_CONTEXT",
        message: "Subagent mode enabled but no subagentContext provided",
        path: "subagentContext",
      });
    }

    if (errors.length > 0) {
      return createInvalidResult(errors, warnings);
    }

    return createValidResult(request, warnings);
  }
}

// =============================================================================
// Context Files Prompt Validator
// =============================================================================

export class ContextFilesPromptValidator implements PromptValidator<ContextFilesPromptRequest> {
  readonly type = "context_files";

  validate(request: ContextFilesPromptRequest): PromptValidationResult {
    const errors: PromptValidationError[] = [];
    const warnings: PromptValidationWarning[] = [];

    // Check request type (cast to string for error message since TS narrows to never)
    const requestType = request.type as string;
    if (requestType !== "context_files") {
      errors.push({
        code: "INVALID_REQUEST_TYPE",
        message: `Expected request type 'context_files', got '${requestType}'`,
        path: "type",
        value: requestType,
      });
    }

    // Validate files array (required)
    if (!request.files) {
      errors.push({
        code: "REQUIRED_FIELD",
        message: "files is required",
        path: "files",
      });
    } else if (!Array.isArray(request.files)) {
      errors.push({
        code: "INVALID_TYPE",
        message: "files must be an array",
        path: "files",
        value: request.files,
      });
    } else {
      let totalChars = 0;
      for (let i = 0; i < request.files.length; i++) {
        const file = request.files[i];
        if (!file || typeof file !== "object") {
          errors.push({
            code: "INVALID_FILE",
            message: `files[${i}] must be an object with path and content`,
            path: `files[${i}]`,
            value: file,
          });
          continue;
        }

        // Validate path
        const pathResult = validateStringField(file.path, `files[${i}].path`, {
          required: true,
        });
        errors.push(...pathResult.errors);

        // Validate content
        const contentResult = validateStringField(file.content, `files[${i}].content`, {
          required: true,
        });
        errors.push(...contentResult.errors);

        if (typeof file.content === "string") {
          totalChars += file.content.length;
        }
      }

      // Check total size
      const maxChars = request.maxTotalChars ?? 500_000;
      if (totalChars > maxChars) {
        warnings.push({
          code: "CONTEXT_TOO_LARGE",
          message: `Total context files size (${totalChars} chars) exceeds recommended limit (${maxChars} chars)`,
          path: "files",
        });
      }
    }

    if (errors.length > 0) {
      return createInvalidResult(errors, warnings);
    }

    return createValidResult(request, warnings);
  }
}

// =============================================================================
// System Prompt Validator
// =============================================================================

export class SystemPromptValidator implements PromptValidator<SystemPromptRequest> {
  readonly type = "system";

  validate(request: SystemPromptRequest): PromptValidationResult {
    const errors: PromptValidationError[] = [];
    const warnings: PromptValidationWarning[] = [];

    // Check request type (cast to string for error message since TS narrows to never)
    const requestType = request.type as string;
    if (requestType !== "system") {
      errors.push({
        code: "INVALID_REQUEST_TYPE",
        message: `Expected request type 'system', got '${requestType}'`,
        path: "type",
        value: requestType,
      });
    }

    // Validate workspaceDir (required)
    const workspaceDirResult = validateStringField(request.workspaceDir, "workspaceDir", {
      required: true,
    });
    errors.push(...workspaceDirResult.errors);
    warnings.push(...workspaceDirResult.warnings);

    // Validate promptMode if provided
    if (request.promptMode !== undefined) {
      const validModes = ["full", "minimal", "none"];
      if (!validModes.includes(request.promptMode)) {
        errors.push({
          code: "INVALID_PROMPT_MODE",
          message: `promptMode must be one of: ${validModes.join(", ")}`,
          path: "promptMode",
          value: request.promptMode,
          suggestion:
            "Use 'full' for main agents, 'minimal' for subagents, 'none' for basic identity",
        });
      }
    }

    // Validate toolNames if provided
    if (request.toolNames !== undefined) {
      if (!Array.isArray(request.toolNames)) {
        errors.push({
          code: "INVALID_TYPE",
          message: "toolNames must be an array of strings",
          path: "toolNames",
          value: request.toolNames,
        });
      }
    }

    // Validate contextFiles if provided
    if (request.contextFiles !== undefined) {
      if (!Array.isArray(request.contextFiles)) {
        errors.push({
          code: "INVALID_TYPE",
          message: "contextFiles must be an array",
          path: "contextFiles",
          value: request.contextFiles,
        });
      }
    }

    if (errors.length > 0) {
      return createInvalidResult(errors, warnings);
    }

    return createValidResult(request, warnings);
  }
}

// =============================================================================
// Validator Registry
// =============================================================================

const validatorRegistry = new Map<string, PromptValidator<any>>();

export function registerValidator<T extends { type: string }>(validator: PromptValidator<T>): void {
  validatorRegistry.set(validator.type, validator);
}

export function getValidator<T extends { type: string }>(
  type: string,
): PromptValidator<T> | undefined {
  return validatorRegistry.get(type);
}

// Register default validators
registerValidator(new SkillsPromptValidator());
registerValidator(new HeartbeatPromptValidator());
registerValidator(new ExtraSystemPromptValidator());
registerValidator(new ContextFilesPromptValidator());
registerValidator(new SystemPromptValidator());
