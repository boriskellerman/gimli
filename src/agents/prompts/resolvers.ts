/**
 * Prompt Resolvers
 *
 * Implements resolution logic for each prompt request type.
 * Part of the Request → Validate → Resolve pattern.
 *
 * Each resolver transforms a validated request into a final prompt string.
 */

import type {
  ContextFilesPromptRequest,
  ExtraSystemPromptRequest,
  HeartbeatPromptRequest,
  PromptResolutionResult,
  PromptResolver,
  PromptValidationResult,
  SkillsPromptRequest,
  SystemPromptRequest,
} from "./types.js";

// =============================================================================
// Resolution Helpers
// =============================================================================

function createSuccessResult<T>(
  prompt: T,
  validation: PromptValidationResult,
  metadata?: { strategy: string; durationMs?: number; cached?: boolean; tokenEstimate?: number },
): PromptResolutionResult<T> {
  return {
    success: true,
    prompt,
    validation,
    metadata: metadata ?? { strategy: "default" },
  };
}

function createFailureResult(
  error: string,
  validation: PromptValidationResult,
): PromptResolutionResult<string> {
  return {
    success: false,
    error,
    validation,
    metadata: { strategy: "failed" },
  };
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

// =============================================================================
// Skills Prompt Resolver
// =============================================================================

export class SkillsPromptResolver implements PromptResolver<SkillsPromptRequest, string> {
  readonly type = "skills";

  resolve(
    request: SkillsPromptRequest,
    validation: PromptValidationResult,
  ): PromptResolutionResult<string> {
    const startTime = Date.now();

    if (!validation.valid) {
      return createFailureResult(
        `Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        validation,
      );
    }

    // Priority 1: Use skillsSnapshot.prompt if available
    const snapshotPrompt = request.skillsSnapshot?.prompt?.trim();
    if (snapshotPrompt) {
      return createSuccessResult(snapshotPrompt, validation, {
        strategy: "snapshot",
        durationMs: Date.now() - startTime,
        cached: true,
        tokenEstimate: estimateTokens(snapshotPrompt),
      });
    }

    // Priority 2: Build from entries if available
    if (request.entries && request.entries.length > 0) {
      const eligibleEntries = request.entries.filter(
        (entry) => entry.invocation?.disableModelInvocation !== true,
      );

      if (eligibleEntries.length === 0) {
        return createSuccessResult("", validation, {
          strategy: "entries_empty",
          durationMs: Date.now() - startTime,
          tokenEstimate: 0,
        });
      }

      // Build a simple skills prompt from entries
      const remoteNote = request.eligibility?.remote?.note?.trim();
      const skillLines = eligibleEntries.map((entry) => {
        const name = entry.skill.name;
        const desc = entry.skill.description?.trim();
        return desc ? `- ${name}: ${desc}` : `- ${name}`;
      });
      const prompt = [remoteNote, "Available skills:", ...skillLines].filter(Boolean).join("\n");

      return createSuccessResult(prompt, validation, {
        strategy: "entries",
        durationMs: Date.now() - startTime,
        tokenEstimate: estimateTokens(prompt),
      });
    }

    // Priority 3: Return empty (caller should load from workspace if needed)
    return createSuccessResult("", validation, {
      strategy: "empty",
      durationMs: Date.now() - startTime,
      tokenEstimate: 0,
    });
  }
}

// =============================================================================
// Heartbeat Prompt Resolver
// =============================================================================

const DEFAULT_HEARTBEAT_PROMPT =
  "Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.";

export class HeartbeatPromptResolver implements PromptResolver<HeartbeatPromptRequest, string> {
  readonly type = "heartbeat";

  resolve(
    request: HeartbeatPromptRequest,
    validation: PromptValidationResult,
  ): PromptResolutionResult<string> {
    const startTime = Date.now();

    if (!validation.valid) {
      return createFailureResult(
        `Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        validation,
      );
    }

    // Use rawPrompt if provided and non-empty, otherwise fall back to default
    const trimmed = typeof request.rawPrompt === "string" ? request.rawPrompt.trim() : "";
    const prompt = trimmed || request.defaultPrompt || DEFAULT_HEARTBEAT_PROMPT;

    return createSuccessResult(prompt, validation, {
      strategy: trimmed ? "config" : "default",
      durationMs: Date.now() - startTime,
      tokenEstimate: estimateTokens(prompt),
    });
  }
}

// =============================================================================
// Extra System Prompt Resolver
// =============================================================================

export class ExtraSystemPromptResolver implements PromptResolver<ExtraSystemPromptRequest, string> {
  readonly type = "extra_system";

  resolve(
    request: ExtraSystemPromptRequest,
    validation: PromptValidationResult,
  ): PromptResolutionResult<string> {
    const startTime = Date.now();

    if (!validation.valid) {
      return createFailureResult(
        `Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        validation,
      );
    }

    const parts: string[] = [];

    // For subagents, use subagent context
    if (request.isSubagent) {
      if (request.subagentContext?.trim()) {
        parts.push(request.subagentContext.trim());
      }
    } else {
      // For main agents, use group intro and system prompt
      if (request.groupIntro?.trim()) {
        parts.push(request.groupIntro.trim());
      }
      if (request.groupSystemPrompt?.trim()) {
        parts.push(request.groupSystemPrompt.trim());
      }
    }

    const prompt = parts.join("\n\n");
    const strategy = request.isSubagent ? "subagent" : parts.length > 0 ? "group_context" : "empty";

    return createSuccessResult(prompt, validation, {
      strategy,
      durationMs: Date.now() - startTime,
      tokenEstimate: estimateTokens(prompt),
    });
  }
}

// =============================================================================
// Context Files Prompt Resolver
// =============================================================================

export class ContextFilesPromptResolver implements PromptResolver<
  ContextFilesPromptRequest,
  string
> {
  readonly type = "context_files";

  resolve(
    request: ContextFilesPromptRequest,
    validation: PromptValidationResult,
  ): PromptResolutionResult<string> {
    const startTime = Date.now();

    if (!validation.valid) {
      return createFailureResult(
        `Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        validation,
      );
    }

    if (!request.files || request.files.length === 0) {
      return createSuccessResult("", validation, {
        strategy: "empty",
        durationMs: Date.now() - startTime,
        tokenEstimate: 0,
      });
    }

    // Build context files section
    const lines: string[] = [];
    lines.push("# Project Context", "");
    lines.push("The following project context files have been loaded:");

    // Check for SOUL.md
    const hasSoulFile = request.files.some((file) => {
      const normalizedPath = file.path.trim().replace(/\\/g, "/");
      const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
      return baseName.toLowerCase() === "soul.md";
    });

    if (hasSoulFile) {
      lines.push(
        "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
      );
    }
    lines.push("");

    for (const file of request.files) {
      lines.push(`## ${file.path}`, "", file.content, "");
    }

    const prompt = lines.join("\n");

    return createSuccessResult(prompt, validation, {
      strategy: "files",
      durationMs: Date.now() - startTime,
      tokenEstimate: estimateTokens(prompt),
    });
  }
}

// =============================================================================
// System Prompt Resolver
// =============================================================================

/**
 * System prompt resolver that builds the full agent system prompt.
 * This is a thin wrapper that delegates to buildAgentSystemPrompt
 * after validating the request.
 */
export class SystemPromptResolver implements PromptResolver<SystemPromptRequest, string> {
  readonly type = "system";

  private buildFn?: (params: Record<string, unknown>) => string;

  /**
   * Set the build function for the system prompt.
   * This allows injecting the actual buildAgentSystemPrompt function.
   */
  setBuildFunction(fn: (params: Record<string, unknown>) => string): void {
    this.buildFn = fn;
  }

  resolve(
    request: SystemPromptRequest,
    validation: PromptValidationResult,
  ): PromptResolutionResult<string> {
    const startTime = Date.now();

    if (!validation.valid) {
      return createFailureResult(
        `Validation failed: ${validation.errors.map((e) => e.message).join("; ")}`,
        validation,
      );
    }

    // If no build function set, return a basic prompt
    if (!this.buildFn) {
      const basicPrompt = "You are a personal assistant running inside Gimli.";
      return createSuccessResult(basicPrompt, validation, {
        strategy: "basic",
        durationMs: Date.now() - startTime,
        tokenEstimate: estimateTokens(basicPrompt),
      });
    }

    // Build the full system prompt
    const buildParams: Record<string, unknown> = {
      workspaceDir: request.workspaceDir,
      skillsPrompt: request.skillsPrompt,
      heartbeatPrompt: request.heartbeatPrompt,
      extraSystemPrompt: request.extraSystemPrompt,
      contextFiles: request.contextFiles,
      promptMode: request.promptMode ?? "full",
      toolNames: request.toolNames,
      ...request.buildParams,
    };

    try {
      const prompt = this.buildFn(buildParams);
      return createSuccessResult(prompt, validation, {
        strategy: "full",
        durationMs: Date.now() - startTime,
        tokenEstimate: estimateTokens(prompt),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return createFailureResult(`Build failed: ${message}`, validation);
    }
  }
}

// =============================================================================
// Resolver Registry
// =============================================================================

const resolverRegistry = new Map<string, PromptResolver<any, any>>();

export function registerResolver<T extends { type: string }, R>(
  resolver: PromptResolver<T, R>,
): void {
  resolverRegistry.set(resolver.type, resolver);
}

export function getResolver<T extends { type: string }, R = string>(
  type: string,
): PromptResolver<T, R> | undefined {
  return resolverRegistry.get(type);
}

// Register default resolvers
registerResolver(new SkillsPromptResolver());
registerResolver(new HeartbeatPromptResolver());
registerResolver(new ExtraSystemPromptResolver());
registerResolver(new ContextFilesPromptResolver());
registerResolver(new SystemPromptResolver());
