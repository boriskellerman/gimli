import { describe, expect, it } from "vitest";
import {
  buildSelfCorrectionPrompt,
  createSelfCorrectionState,
  DEFAULT_SELF_CORRECTION_PROMPT,
  getLastToolError,
  isEligibleForSelfCorrection,
  isRecoverableToolError,
  recordToolError,
  resolveSelfCorrectionConfig,
  resetSelfCorrectionState,
  startSelfCorrectionAttempt,
  completeSelfCorrectionAttempt,
  type SelfCorrectionConfig,
} from "./self-correction.js";

describe("self-correction", () => {
  describe("createSelfCorrectionState", () => {
    it("creates a fresh state with default values", () => {
      const state = createSelfCorrectionState();
      expect(state.attempts).toBe(0);
      expect(state.toolErrors).toEqual([]);
      expect(state.active).toBe(false);
      expect(state.lastPrompt).toBeUndefined();
    });
  });

  describe("resolveSelfCorrectionConfig", () => {
    it("returns defaults when no config is provided", () => {
      const config = resolveSelfCorrectionConfig(undefined);
      expect(config.enabled).toBe(true);
      expect(config.maxAttempts).toBe(2);
      expect(config.delayMs).toBe(0);
      expect(config.prompt).toBe(DEFAULT_SELF_CORRECTION_PROMPT);
      expect(config.excludeTools).toEqual([]);
      expect(config.excludeErrorPatterns).toEqual([]);
    });

    it("returns defaults when config has no selfCorrection section", () => {
      const config = resolveSelfCorrectionConfig({ agents: { defaults: {} } });
      expect(config.enabled).toBe(true);
      expect(config.maxAttempts).toBe(2);
    });

    it("merges user config with defaults", () => {
      const config = resolveSelfCorrectionConfig({
        agents: {
          defaults: {
            selfCorrection: {
              enabled: false,
              maxAttempts: 5,
            } as SelfCorrectionConfig,
          },
        },
      });
      expect(config.enabled).toBe(false);
      expect(config.maxAttempts).toBe(5);
      // Other values should remain defaults
      expect(config.delayMs).toBe(0);
      expect(config.prompt).toBe(DEFAULT_SELF_CORRECTION_PROMPT);
    });

    it("respects excludeTools configuration", () => {
      const config = resolveSelfCorrectionConfig({
        agents: {
          defaults: {
            selfCorrection: {
              excludeTools: ["external_api", "dangerous_tool"],
            } as SelfCorrectionConfig,
          },
        },
      });
      expect(config.excludeTools).toEqual(["external_api", "dangerous_tool"]);
    });

    it("respects custom prompt", () => {
      const customPrompt = "Fix the error: {error}";
      const config = resolveSelfCorrectionConfig({
        agents: {
          defaults: {
            selfCorrection: {
              prompt: customPrompt,
            } as SelfCorrectionConfig,
          },
        },
      });
      expect(config.prompt).toBe(customPrompt);
    });
  });

  describe("isRecoverableToolError", () => {
    it("identifies recoverable validation errors", () => {
      expect(isRecoverableToolError("Missing required parameter: path")).toBe(true);
      expect(isRecoverableToolError("Invalid JSON format")).toBe(true);
      expect(isRecoverableToolError("Expected string, got number")).toBe(true);
      expect(isRecoverableToolError("Path must be absolute")).toBe(true);
    });

    it("identifies recoverable file/path errors", () => {
      expect(isRecoverableToolError("File not found: /some/path")).toBe(true);
      expect(isRecoverableToolError("ENOENT: no such file or directory")).toBe(true);
      expect(isRecoverableToolError("Directory does not exist")).toBe(true);
    });

    it("identifies recoverable format errors", () => {
      expect(isRecoverableToolError("JSON parse error")).toBe(true);
      expect(isRecoverableToolError("Syntax error in input")).toBe(true);
      expect(isRecoverableToolError("Malformed request body")).toBe(true);
    });

    it("rejects non-recoverable permission errors", () => {
      expect(isRecoverableToolError("Permission denied")).toBe(false);
      expect(isRecoverableToolError("Access denied: unauthorized")).toBe(false);
      expect(isRecoverableToolError("Forbidden: insufficient privileges")).toBe(false);
    });

    it("rejects non-recoverable network errors", () => {
      expect(isRecoverableToolError("Network connection failed")).toBe(false);
      expect(isRecoverableToolError("Connection timeout")).toBe(false);
      expect(isRecoverableToolError("ETIMEDOUT")).toBe(false);
      expect(isRecoverableToolError("ECONNREFUSED")).toBe(false);
    });

    it("rejects non-recoverable rate limit errors", () => {
      expect(isRecoverableToolError("Rate limit exceeded")).toBe(false);
      expect(isRecoverableToolError("Too many requests")).toBe(false);
      expect(isRecoverableToolError("Quota exceeded")).toBe(false);
    });

    it("rejects non-recoverable resource errors", () => {
      expect(isRecoverableToolError("Disk full")).toBe(false);
      expect(isRecoverableToolError("Out of memory")).toBe(false);
    });

    it("returns false for ambiguous errors (conservative)", () => {
      expect(isRecoverableToolError("Something went wrong")).toBe(false);
      expect(isRecoverableToolError("Unknown error occurred")).toBe(false);
    });
  });

  describe("isEligibleForSelfCorrection", () => {
    const defaultConfig = resolveSelfCorrectionConfig(undefined);

    it("returns false when self-correction is disabled", () => {
      const state = createSelfCorrectionState();
      const config = { ...defaultConfig, enabled: false };
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "File not found",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("returns false when max attempts reached", () => {
      const state = createSelfCorrectionState();
      state.attempts = 2;
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "File not found",
          config: defaultConfig,
          state,
        }),
      ).toBe(false);
    });

    it("returns false for excluded tools", () => {
      const state = createSelfCorrectionState();
      const config = { ...defaultConfig, excludeTools: ["external_api"] };
      expect(
        isEligibleForSelfCorrection({
          toolName: "external_api",
          error: "Invalid parameter",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("is case-insensitive for excluded tools", () => {
      const state = createSelfCorrectionState();
      const config = { ...defaultConfig, excludeTools: ["External_API"] };
      expect(
        isEligibleForSelfCorrection({
          toolName: "external_api",
          error: "Invalid parameter",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("returns false for excluded error patterns", () => {
      const state = createSelfCorrectionState();
      const config = { ...defaultConfig, excludeErrorPatterns: ["network"] };
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "Network error occurred",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("supports regex patterns in excludeErrorPatterns", () => {
      const state = createSelfCorrectionState();
      const config = { ...defaultConfig, excludeErrorPatterns: ["^API error: \\d+"] };
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "API error: 500",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("returns false for non-recoverable errors", () => {
      const state = createSelfCorrectionState();
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "Permission denied",
          config: defaultConfig,
          state,
        }),
      ).toBe(false);
    });

    it("returns true for recoverable errors within limits", () => {
      const state = createSelfCorrectionState();
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "File not found: /wrong/path",
          config: defaultConfig,
          state,
        }),
      ).toBe(true);
    });
  });

  describe("buildSelfCorrectionPrompt", () => {
    it("replaces placeholders in the default prompt", () => {
      const config = resolveSelfCorrectionConfig(undefined);
      const prompt = buildSelfCorrectionPrompt({
        toolName: "read",
        error: "File not found",
        config,
      });
      expect(prompt).toContain('"read"');
      expect(prompt).toContain("File not found");
    });

    it("uses custom prompt template", () => {
      const config = {
        ...resolveSelfCorrectionConfig(undefined),
        prompt: "Tool {toolName} failed: {error}. Please retry.",
      };
      const prompt = buildSelfCorrectionPrompt({
        toolName: "write",
        error: "Invalid path",
        config,
      });
      expect(prompt).toBe("Tool write failed: Invalid path. Please retry.");
    });

    it("handles multiple placeholder occurrences", () => {
      const config = {
        ...resolveSelfCorrectionConfig(undefined),
        prompt: "{toolName} error: {error}. Fix {toolName}!",
      };
      const prompt = buildSelfCorrectionPrompt({
        toolName: "exec",
        error: "Command failed",
        config,
      });
      expect(prompt).toBe("exec error: Command failed. Fix exec!");
    });

    it("trims error whitespace", () => {
      const config = resolveSelfCorrectionConfig(undefined);
      const prompt = buildSelfCorrectionPrompt({
        toolName: "read",
        error: "  Error with spaces  ",
        config,
      });
      expect(prompt).toContain("Error with spaces");
      expect(prompt).not.toContain("  Error");
    });
  });

  describe("state management", () => {
    it("records tool errors", () => {
      const state = createSelfCorrectionState();
      recordToolError(state, "read", "File not found");
      expect(state.toolErrors).toHaveLength(1);
      expect(state.toolErrors[0].toolName).toBe("read");
      expect(state.toolErrors[0].error).toBe("File not found");
      expect(state.toolErrors[0].timestamp).toBeGreaterThan(0);
    });

    it("records multiple tool errors", () => {
      const state = createSelfCorrectionState();
      recordToolError(state, "read", "Error 1");
      recordToolError(state, "write", "Error 2");
      expect(state.toolErrors).toHaveLength(2);
    });

    it("gets last tool error", () => {
      const state = createSelfCorrectionState();
      expect(getLastToolError(state)).toBeUndefined();

      recordToolError(state, "read", "Error 1");
      recordToolError(state, "write", "Error 2");

      const lastError = getLastToolError(state);
      expect(lastError?.toolName).toBe("write");
      expect(lastError?.error).toBe("Error 2");
    });

    it("starts self-correction attempt", () => {
      const state = createSelfCorrectionState();
      startSelfCorrectionAttempt(state, "Fix the error");
      expect(state.attempts).toBe(1);
      expect(state.active).toBe(true);
      expect(state.lastPrompt).toBe("Fix the error");
    });

    it("completes self-correction attempt", () => {
      const state = createSelfCorrectionState();
      startSelfCorrectionAttempt(state, "Fix the error");
      completeSelfCorrectionAttempt(state);
      expect(state.active).toBe(false);
      expect(state.attempts).toBe(1); // attempts not decremented
    });

    it("resets state", () => {
      const state = createSelfCorrectionState();
      startSelfCorrectionAttempt(state, "Prompt 1");
      recordToolError(state, "read", "Error");
      state.attempts = 3;

      resetSelfCorrectionState(state);

      expect(state.attempts).toBe(0);
      expect(state.toolErrors).toEqual([]);
      expect(state.active).toBe(false);
      expect(state.lastPrompt).toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty error strings", () => {
      expect(isRecoverableToolError("")).toBe(false);
    });

    it("handles invalid regex in excludeErrorPatterns gracefully", () => {
      const state = createSelfCorrectionState();
      const config = {
        ...resolveSelfCorrectionConfig(undefined),
        excludeErrorPatterns: ["[invalid regex"],
      };
      // Should treat as substring match
      expect(
        isEligibleForSelfCorrection({
          toolName: "read",
          error: "[invalid regex match",
          config,
          state,
        }),
      ).toBe(false);
    });

    it("handles special characters in error messages", () => {
      const config = resolveSelfCorrectionConfig(undefined);
      const prompt = buildSelfCorrectionPrompt({
        toolName: "read",
        error: "Error: $special {chars} [test]",
        config,
      });
      expect(prompt).toContain("$special {chars} [test]");
    });
  });
});
