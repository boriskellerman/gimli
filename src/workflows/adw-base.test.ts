/**
 * Tests for ADW Base Framework
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  generateExecutionId,
  calculateRetryDelay,
  isRetryableError,
  createConsoleLogger,
  formatResultAsMarkdown,
  DEFAULT_RETRY_CONFIG,
  type ADWResult,
  type RetryConfig,
} from "./adw-base.js";

describe("ADW Base Framework", () => {
  describe("generateExecutionId", () => {
    it("generates unique IDs", () => {
      const id1 = generateExecutionId();
      const id2 = generateExecutionId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^adw-[a-z0-9]+-[a-z0-9]+$/);
      expect(id2).toMatch(/^adw-[a-z0-9]+-[a-z0-9]+$/);
    });

    it("IDs start with adw prefix", () => {
      const id = generateExecutionId();
      expect(id.startsWith("adw-")).toBe(true);
    });
  });

  describe("calculateRetryDelay", () => {
    const config: RetryConfig = {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffFactor: 2,
    };

    it("calculates exponential backoff", () => {
      expect(calculateRetryDelay(0, config)).toBe(1000); // 1000 * 2^0
      expect(calculateRetryDelay(1, config)).toBe(2000); // 1000 * 2^1
      expect(calculateRetryDelay(2, config)).toBe(4000); // 1000 * 2^2
      expect(calculateRetryDelay(3, config)).toBe(8000); // 1000 * 2^3
    });

    it("caps at maxDelayMs", () => {
      expect(calculateRetryDelay(5, config)).toBe(10000); // Would be 32000, capped at 10000
      expect(calculateRetryDelay(10, config)).toBe(10000);
    });

    it("handles zero initial delay", () => {
      const zeroConfig = { ...config, initialDelayMs: 0 };
      expect(calculateRetryDelay(0, zeroConfig)).toBe(0);
    });
  });

  describe("isRetryableError", () => {
    it("returns true for retryable errors", () => {
      expect(isRetryableError("timeout error occurred", DEFAULT_RETRY_CONFIG)).toBe(true);
      expect(isRetryableError("rate_limit exceeded", DEFAULT_RETRY_CONFIG)).toBe(true);
      expect(isRetryableError("connection_error occurred", DEFAULT_RETRY_CONFIG)).toBe(true);
      expect(isRetryableError("server_error 500", DEFAULT_RETRY_CONFIG)).toBe(true);
    });

    it("returns false for non-retryable errors", () => {
      expect(isRetryableError("invalid syntax", DEFAULT_RETRY_CONFIG)).toBe(false);
      expect(isRetryableError("permission denied", DEFAULT_RETRY_CONFIG)).toBe(false);
      expect(isRetryableError("file not found", DEFAULT_RETRY_CONFIG)).toBe(false);
    });

    it("is case insensitive", () => {
      expect(isRetryableError("TIMEOUT error", DEFAULT_RETRY_CONFIG)).toBe(true);
      expect(isRetryableError("RATE_LIMIT exceeded", DEFAULT_RETRY_CONFIG)).toBe(true);
    });

    it("returns true when no retryable errors specified", () => {
      const config = { ...DEFAULT_RETRY_CONFIG, retryableErrors: undefined };
      expect(isRetryableError("any error", config)).toBe(true);
    });
  });

  describe("createConsoleLogger", () => {
    beforeEach(() => {
      vi.spyOn(console, "debug").mockImplementation(() => {});
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("creates a logger with all methods", () => {
      const logger = createConsoleLogger("test");

      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it("includes prefix in log messages", () => {
      const logger = createConsoleLogger("my-prefix");
      logger.info("test message");

      expect(console.info).toHaveBeenCalledWith(expect.stringContaining("[my-prefix]"), "");
    });

    it("includes log level in messages", () => {
      const logger = createConsoleLogger("test");
      logger.error("error message");

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[ERROR]"), "");
    });

    it("includes timestamp in messages", () => {
      const logger = createConsoleLogger("test");
      logger.info("test message");

      expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T/), "");
    });

    it("passes data to console methods", () => {
      const logger = createConsoleLogger("test");
      const data = { key: "value" };
      logger.info("test message", data);

      expect(console.info).toHaveBeenCalledWith(expect.any(String), data);
    });
  });

  describe("formatResultAsMarkdown", () => {
    const baseResult: ADWResult = {
      executionId: "adw-test-123",
      workflowId: "test-workflow",
      status: "completed",
      startedAt: Date.now() - 10000,
      endedAt: Date.now(),
      durationMs: 10000,
      stageResults: [
        {
          stageId: "stage1",
          stageName: "First Stage",
          status: "completed",
          startedAt: Date.now() - 8000,
          endedAt: Date.now() - 5000,
          durationMs: 3000,
          retryCount: 0,
        },
        {
          stageId: "stage2",
          stageName: "Second Stage",
          status: "completed",
          startedAt: Date.now() - 5000,
          endedAt: Date.now(),
          durationMs: 5000,
          retryCount: 0,
        },
      ],
      trigger: { type: "manual" },
      totalUsage: {
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.05,
      },
      retryCount: 0,
    };

    it("includes execution ID", () => {
      const markdown = formatResultAsMarkdown(baseResult);
      expect(markdown).toContain("adw-test-123");
    });

    it("includes status", () => {
      const markdown = formatResultAsMarkdown(baseResult);
      expect(markdown).toContain("COMPLETED");
    });

    it("includes duration", () => {
      const markdown = formatResultAsMarkdown(baseResult);
      expect(markdown).toContain("10.0s");
    });

    it("includes stage results table", () => {
      const markdown = formatResultAsMarkdown(baseResult);
      expect(markdown).toContain("First Stage");
      expect(markdown).toContain("Second Stage");
      expect(markdown).toContain("✅");
    });

    it("includes resource usage", () => {
      const markdown = formatResultAsMarkdown(baseResult);
      expect(markdown).toContain("1,000");
      expect(markdown).toContain("500");
      expect(markdown).toContain("$0.0500");
    });

    it("shows error for failed results", () => {
      const failedResult: ADWResult = {
        ...baseResult,
        status: "failed",
        error: "Something went wrong",
      };

      const markdown = formatResultAsMarkdown(failedResult);
      expect(markdown).toContain("Error");
      expect(markdown).toContain("Something went wrong");
    });

    it("shows skipped stages with icon", () => {
      const skippedResult: ADWResult = {
        ...baseResult,
        stageResults: [
          {
            stageId: "stage1",
            stageName: "Skipped Stage",
            status: "skipped",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 0,
            retryCount: 0,
          },
        ],
      };

      const markdown = formatResultAsMarkdown(skippedResult);
      expect(markdown).toContain("⏭️");
      expect(markdown).toContain("skipped");
    });

    it("shows failed stages with icon", () => {
      const failedStageResult: ADWResult = {
        ...baseResult,
        stageResults: [
          {
            stageId: "stage1",
            stageName: "Failed Stage",
            status: "failed",
            startedAt: Date.now() - 1000,
            endedAt: Date.now(),
            durationMs: 1000,
            error: "Stage error",
            retryCount: 0,
          },
        ],
      };

      const markdown = formatResultAsMarkdown(failedStageResult);
      expect(markdown).toContain("❌");
      expect(markdown).toContain("failed");
    });
  });

  describe("DEFAULT_RETRY_CONFIG", () => {
    it("has reasonable defaults", () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBeGreaterThan(0);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBeGreaterThan(DEFAULT_RETRY_CONFIG.initialDelayMs);
      expect(DEFAULT_RETRY_CONFIG.backoffFactor).toBeGreaterThan(1);
    });

    it("includes common retryable errors", () => {
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain("timeout");
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain("rate_limit");
      expect(DEFAULT_RETRY_CONFIG.retryableErrors).toContain("connection_error");
    });
  });
});
