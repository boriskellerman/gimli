/**
 * Tests for the Closed-Loop Prompt Pipeline
 *
 * Tests the Request → Validate → Resolve pattern.
 */

import { describe, expect, it } from "vitest";
import {
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
} from "./pipeline.js";
import {
  SkillsPromptValidator,
  HeartbeatPromptValidator,
  ExtraSystemPromptValidator,
  ContextFilesPromptValidator,
  SystemPromptValidator,
} from "./validators.js";
import type {
  SkillsPromptRequest,
  HeartbeatPromptRequest,
  ExtraSystemPromptRequest,
  ContextFilesPromptRequest,
  SystemPromptRequest,
  PromptProcessingEvent,
} from "./types.js";

// =============================================================================
// Skills Prompt Tests
// =============================================================================

describe("SkillsPromptValidator", () => {
  const validator = new SkillsPromptValidator();

  it("validates a valid skills request", () => {
    const request: SkillsPromptRequest = {
      type: "skills",
      workspaceDir: "/home/user/project",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates request with snapshot", () => {
    const request: SkillsPromptRequest = {
      type: "skills",
      workspaceDir: "/home/user/project",
      skillsSnapshot: {
        prompt: "Available skills: git, docker",
        skills: [{ name: "git" }, { name: "docker" }],
      },
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("fails when workspaceDir is missing", () => {
    const request = {
      type: "skills",
    } as SkillsPromptRequest;
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "REQUIRED_FIELD")).toBe(true);
  });

  it("fails when type is wrong", () => {
    const request = {
      type: "wrong",
      workspaceDir: "/home/user/project",
    } as unknown as SkillsPromptRequest;
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_REQUEST_TYPE")).toBe(true);
  });

  it("warns when no skills source is provided", () => {
    const request: SkillsPromptRequest = {
      type: "skills",
      workspaceDir: "/home/user/project",
    };
    const result = validator.validate(request);
    expect(result.warnings.some((w) => w.code === "NO_SKILLS_SOURCE")).toBe(true);
  });

  it("fails when skillFilter is not an array", () => {
    const request: SkillsPromptRequest = {
      type: "skills",
      workspaceDir: "/home/user/project",
      skillFilter: "git" as unknown as string[],
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_TYPE")).toBe(true);
  });
});

describe("processSkillsPrompt", () => {
  it("resolves from snapshot", () => {
    const result = processSkillsPrompt({
      workspaceDir: "/home/user/project",
      skillsSnapshot: {
        prompt: "Available skills: git, docker",
        skills: [{ name: "git" }, { name: "docker" }],
      },
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Available skills: git, docker");
    expect(result.metadata?.strategy).toBe("snapshot");
  });

  it("resolves from entries", () => {
    const result = processSkillsPrompt({
      workspaceDir: "/home/user/project",
      entries: [
        { skill: { name: "git", description: "Git operations" }, invocation: {} },
        { skill: { name: "docker", description: "Docker management" }, invocation: {} },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("git: Git operations");
    expect(result.prompt).toContain("docker: Docker management");
    expect(result.metadata?.strategy).toBe("entries");
  });

  it("filters out disabled skills", () => {
    const result = processSkillsPrompt({
      workspaceDir: "/home/user/project",
      entries: [
        { skill: { name: "git" }, invocation: { disableModelInvocation: true } },
        { skill: { name: "docker" }, invocation: {} },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.prompt).not.toContain("git");
    expect(result.prompt).toContain("docker");
  });

  it("returns empty when no skills available", () => {
    const result = processSkillsPrompt({
      workspaceDir: "/home/user/project",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("");
    expect(result.metadata?.strategy).toBe("empty");
  });
});

// =============================================================================
// Heartbeat Prompt Tests
// =============================================================================

describe("HeartbeatPromptValidator", () => {
  const validator = new HeartbeatPromptValidator();

  it("validates a valid heartbeat request", () => {
    const request: HeartbeatPromptRequest = {
      type: "heartbeat",
      rawPrompt: "Check HEARTBEAT.md",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("validates request without rawPrompt", () => {
    const request: HeartbeatPromptRequest = {
      type: "heartbeat",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("warns about potentially confusing heartbeat prompt", () => {
    const request: HeartbeatPromptRequest = {
      type: "heartbeat",
      rawPrompt: "HEARTBEAT_OK is the token",
    };
    const result = validator.validate(request);
    expect(result.warnings.some((w) => w.code === "CONFUSING_HEARTBEAT")).toBe(true);
  });
});

describe("processHeartbeatPrompt", () => {
  it("uses rawPrompt when provided", () => {
    const result = processHeartbeatPrompt({
      rawPrompt: "Custom heartbeat prompt",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Custom heartbeat prompt");
    expect(result.metadata?.strategy).toBe("config");
  });

  it("uses default when rawPrompt is empty", () => {
    const result = processHeartbeatPrompt({
      rawPrompt: "",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("HEARTBEAT.md");
    expect(result.metadata?.strategy).toBe("default");
  });

  it("uses custom default when provided", () => {
    const result = processHeartbeatPrompt({
      defaultPrompt: "Custom default",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Custom default");
  });
});

// =============================================================================
// Extra System Prompt Tests
// =============================================================================

describe("ExtraSystemPromptValidator", () => {
  const validator = new ExtraSystemPromptValidator();

  it("validates a valid extra system request", () => {
    const request: ExtraSystemPromptRequest = {
      type: "extra_system",
      groupIntro: "Welcome to the group",
      groupSystemPrompt: "Group rules...",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("validates subagent request", () => {
    const request: ExtraSystemPromptRequest = {
      type: "extra_system",
      isSubagent: true,
      subagentContext: "You are a sub-agent",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("warns when subagent but no context", () => {
    const request: ExtraSystemPromptRequest = {
      type: "extra_system",
      isSubagent: true,
    };
    const result = validator.validate(request);
    expect(result.warnings.some((w) => w.code === "SUBAGENT_NO_CONTEXT")).toBe(true);
  });
});

describe("processExtraSystemPrompt", () => {
  it("combines group intro and system prompt", () => {
    const result = processExtraSystemPrompt({
      groupIntro: "Welcome",
      groupSystemPrompt: "Rules apply",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("Welcome");
    expect(result.prompt).toContain("Rules apply");
  });

  it("uses subagent context for subagents", () => {
    const result = processExtraSystemPrompt({
      isSubagent: true,
      subagentContext: "Sub-agent context",
      groupIntro: "Should be ignored",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("Sub-agent context");
    expect(result.prompt).not.toContain("ignored");
  });

  it("returns empty when no context provided", () => {
    const result = processExtraSystemPrompt({});
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("");
  });
});

// =============================================================================
// Context Files Prompt Tests
// =============================================================================

describe("ContextFilesPromptValidator", () => {
  const validator = new ContextFilesPromptValidator();

  it("validates valid context files request", () => {
    const request: ContextFilesPromptRequest = {
      type: "context_files",
      files: [
        { path: "README.md", content: "# Project" },
        { path: "CLAUDE.md", content: "Instructions" },
      ],
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("fails when files is missing", () => {
    const request = {
      type: "context_files",
    } as ContextFilesPromptRequest;
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "REQUIRED_FIELD")).toBe(true);
  });

  it("fails when file is missing path", () => {
    const request: ContextFilesPromptRequest = {
      type: "context_files",
      files: [{ path: "", content: "Content" }],
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "EMPTY_STRING")).toBe(true);
  });

  it("warns when context is too large", () => {
    const request: ContextFilesPromptRequest = {
      type: "context_files",
      files: [{ path: "big.txt", content: "x".repeat(600_000) }],
      maxTotalChars: 500_000,
    };
    const result = validator.validate(request);
    expect(result.warnings.some((w) => w.code === "CONTEXT_TOO_LARGE")).toBe(true);
  });
});

describe("processContextFilesPrompt", () => {
  it("formats context files", () => {
    const result = processContextFilesPrompt({
      files: [
        { path: "README.md", content: "# Hello" },
        { path: "docs/guide.md", content: "Guide content" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("# Project Context");
    expect(result.prompt).toContain("## README.md");
    expect(result.prompt).toContain("# Hello");
  });

  it("adds SOUL.md guidance when present", () => {
    const result = processContextFilesPrompt({
      files: [
        { path: "SOUL.md", content: "Be friendly" },
        { path: "README.md", content: "# Project" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("SOUL.md");
    expect(result.prompt).toContain("embody its persona");
  });

  it("returns empty for no files", () => {
    const result = processContextFilesPrompt({ files: [] });
    expect(result.success).toBe(true);
    expect(result.prompt).toBe("");
  });
});

// =============================================================================
// System Prompt Tests
// =============================================================================

describe("SystemPromptValidator", () => {
  const validator = new SystemPromptValidator();

  it("validates valid system request", () => {
    const request: SystemPromptRequest = {
      type: "system",
      workspaceDir: "/home/user/project",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(true);
  });

  it("fails when workspaceDir is missing", () => {
    const request = {
      type: "system",
    } as SystemPromptRequest;
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
  });

  it("fails when promptMode is invalid", () => {
    const request: SystemPromptRequest = {
      type: "system",
      workspaceDir: "/home/user/project",
      promptMode: "invalid" as "full",
    };
    const result = validator.validate(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_PROMPT_MODE")).toBe(true);
  });
});

describe("processSystemPrompt", () => {
  it("returns basic prompt without build function", () => {
    const result = processSystemPrompt({
      workspaceDir: "/home/user/project",
    });
    expect(result.success).toBe(true);
    expect(result.prompt).toContain("Gimli");
    expect(result.metadata?.strategy).toBe("basic");
  });
});

// =============================================================================
// Batch Processing Tests
// =============================================================================

describe("processBatch", () => {
  it("processes multiple requests", () => {
    const result = processBatch([
      { type: "heartbeat", rawPrompt: "Check status" },
      { type: "extra_system", groupIntro: "Welcome" },
    ]);
    expect(result.allSucceeded).toBe(true);
    expect(result.results.size).toBe(2);
    expect(result.results.get("heartbeat")?.success).toBe(true);
    expect(result.results.get("extra_system")?.success).toBe(true);
  });

  it("calculates total token estimate", () => {
    const result = processBatch([
      { type: "heartbeat", rawPrompt: "Short prompt" },
      { type: "extra_system", groupIntro: "Another prompt" },
    ]);
    expect(result.totalTokenEstimate).toBeGreaterThan(0);
  });

  it("reports errors for failed requests", () => {
    const result = processBatch([
      { type: "heartbeat", rawPrompt: "Valid" },
      { type: "context_files" } as ContextFilesPromptRequest, // Missing files
    ]);
    expect(result.allSucceeded).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].type).toBe("context_files");
  });
});

// =============================================================================
// Self-Correction Tests
// =============================================================================

describe("generateCorrectionSuggestions", () => {
  it("suggests corrections for invalid prompt mode", () => {
    const validation = {
      valid: false,
      errors: [
        {
          code: "INVALID_PROMPT_MODE",
          message: "Invalid mode",
          path: "promptMode",
          value: "bad",
          suggestion: "Use full, minimal, or none",
        },
      ],
      warnings: [],
    };
    const suggestions = generateCorrectionSuggestions(validation);
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].path).toBe("promptMode");
    expect(suggestions[0].suggestedValue).toBe("full");
  });

  it("returns empty for valid validation", () => {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
    };
    const suggestions = generateCorrectionSuggestions(validation);
    expect(suggestions).toHaveLength(0);
  });
});

describe("attemptAutoCorrection", () => {
  it("corrects invalid promptMode", () => {
    const request: SystemPromptRequest = {
      type: "system",
      workspaceDir: "/home/user/project",
      promptMode: "bad" as "full",
    };
    const validation = {
      valid: false,
      errors: [
        {
          code: "INVALID_PROMPT_MODE",
          message: "Invalid mode",
          path: "promptMode",
          value: "bad",
        },
      ],
      warnings: [],
    };
    const result = attemptAutoCorrection(request, validation);
    expect(result).not.toBeNull();
    expect(result?.corrected.promptMode).toBe("full");
    expect(result?.applied.length).toBe(1);
  });

  it("returns null for valid validation", () => {
    const request: SystemPromptRequest = {
      type: "system",
      workspaceDir: "/home/user/project",
    };
    const validation = { valid: true, errors: [], warnings: [] };
    const result = attemptAutoCorrection(request, validation);
    expect(result).toBeNull();
  });
});

// =============================================================================
// Event System Tests
// =============================================================================

describe("onPromptEvent", () => {
  it("emits validation events", () => {
    const events: PromptProcessingEvent[] = [];
    const unsubscribe = onPromptEvent((event) => events.push(event));

    processWithEvents({ type: "heartbeat", rawPrompt: "Test" });

    expect(events.some((e) => e.type === "validation")).toBe(true);
    expect(events.some((e) => e.type === "resolution")).toBe(true);

    unsubscribe();
  });

  it("unsubscribes correctly", () => {
    const events: PromptProcessingEvent[] = [];
    const unsubscribe = onPromptEvent((event) => events.push(event));
    unsubscribe();

    processWithEvents({ type: "heartbeat", rawPrompt: "Test" });

    expect(events).toHaveLength(0);
  });

  it("handles handler errors gracefully", () => {
    const unsubscribe = onPromptEvent(() => {
      throw new Error("Handler error");
    });

    // Should not throw
    expect(() => {
      processWithEvents({ type: "heartbeat", rawPrompt: "Test" });
    }).not.toThrow();

    unsubscribe();
  });
});

describe("processWithEvents", () => {
  it("emits events with timing info", () => {
    const events: PromptProcessingEvent[] = [];
    const unsubscribe = onPromptEvent((event) => events.push(event));

    processWithEvents({ type: "heartbeat", rawPrompt: "Test" });

    const validationEvent = events.find((e) => e.type === "validation");
    expect(validationEvent?.durationMs).toBeDefined();
    expect(validationEvent?.success).toBe(true);

    unsubscribe();
  });

  it("attempts auto-correction on failure", () => {
    const events: PromptProcessingEvent[] = [];
    const unsubscribe = onPromptEvent((event) => events.push(event));

    processWithEvents({
      type: "system",
      workspaceDir: "/test",
      promptMode: "invalid" as "full",
    });

    const correctionEvent = events.find((e) => e.type === "correction");
    expect(correctionEvent).toBeDefined();

    unsubscribe();
  });
});
