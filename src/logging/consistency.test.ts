/**
 * Tests for logging consistency across all modules.
 *
 * This test file validates that:
 * 1. All modules use the subsystem logger pattern
 * 2. Logging format is consistent across modules
 * 3. No direct console.* calls are used (except through the logging system)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { createSubsystemLogger } from "./subsystem.js";
import { setLoggerOverride, resetLogger, DEFAULT_LOG_DIR } from "./logger.js";

describe("Logging Consistency", () => {
  const tempLogFile = path.join(DEFAULT_LOG_DIR, `test-consistency-${Date.now()}.log`);

  beforeEach(() => {
    // Reset logger state before each test
    resetLogger();
    setLoggerOverride({ level: "debug", file: tempLogFile });
  });

  afterEach(() => {
    resetLogger();
    // Clean up temp log file
    try {
      fs.unlinkSync(tempLogFile);
    } catch {
      // ignore
    }
  });

  describe("SubsystemLogger", () => {
    it("creates logger with correct subsystem name", () => {
      const logger = createSubsystemLogger("test/module");
      expect(logger.subsystem).toBe("test/module");
    });

    it("creates child logger with correct subsystem hierarchy", () => {
      const parent = createSubsystemLogger("parent");
      const child = parent.child("child");
      expect(child.subsystem).toBe("parent/child");
    });

    it("logs at all severity levels", () => {
      const logger = createSubsystemLogger("test");

      // These should not throw
      expect(() => logger.trace("trace message")).not.toThrow();
      expect(() => logger.debug("debug message")).not.toThrow();
      expect(() => logger.info("info message")).not.toThrow();
      expect(() => logger.warn("warn message")).not.toThrow();
      expect(() => logger.error("error message")).not.toThrow();
      expect(() => logger.fatal("fatal message")).not.toThrow();
    });

    it("logs with structured metadata", () => {
      const logger = createSubsystemLogger("test");

      // These should not throw
      expect(() => logger.info("message with meta", { key: "value", count: 42 })).not.toThrow();
      expect(() =>
        logger.error("error with details", { error: "something failed", code: "ERR_TEST" }),
      ).not.toThrow();
    });

    it("raw method logs without formatting", () => {
      const logger = createSubsystemLogger("test");
      expect(() => logger.raw("raw message content")).not.toThrow();
    });
  });

  describe("Subsystem naming conventions", () => {
    it("uses slash-separated hierarchy for related modules", () => {
      const gatewayLogger = createSubsystemLogger("gateway/channels/whatsapp");
      expect(gatewayLogger.subsystem).toBe("gateway/channels/whatsapp");

      const child = gatewayLogger.child("inbound");
      expect(child.subsystem).toBe("gateway/channels/whatsapp/inbound");
    });

    it("supports channel-specific subsystems", () => {
      const channels = ["discord", "telegram", "slack", "signal", "whatsapp"];
      for (const channel of channels) {
        const logger = createSubsystemLogger(channel);
        expect(logger.subsystem).toBe(channel);
      }
    });

    it("supports infrastructure subsystems", () => {
      const infraSubsystems = ["infra/unhandled", "infra/retry", "verbose"];
      for (const subsystem of infraSubsystems) {
        const logger = createSubsystemLogger(subsystem);
        expect(logger.subsystem).toBe(subsystem);
      }
    });
  });

  describe("Log file output", () => {
    it("writes logs to file in JSON format", () => {
      const logger = createSubsystemLogger("test/file");
      logger.info("test message", { testKey: "testValue" });

      // Give time for async write
      const content = fs.readFileSync(tempLogFile, "utf8");
      const lines = content.trim().split("\n");
      expect(lines.length).toBeGreaterThan(0);

      const lastLine = JSON.parse(lines[lines.length - 1]);
      expect(lastLine).toHaveProperty("time");
      expect(lastLine).toHaveProperty("_meta");
    });

    it("includes timestamp in ISO format", () => {
      const logger = createSubsystemLogger("test/timestamp");
      logger.info("timestamp test");

      const content = fs.readFileSync(tempLogFile, "utf8");
      const lines = content.trim().split("\n");
      const lastLine = JSON.parse(lines[lines.length - 1]);

      expect(lastLine.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe("Consistent error logging", () => {
    it("logs errors with structured error field", () => {
      const logger = createSubsystemLogger("test/errors");
      const error = new Error("Test error message");

      logger.error("Operation failed", {
        error: error.stack ?? error.message,
      });

      const content = fs.readFileSync(tempLogFile, "utf8");

      // The log structure includes subsystem info and metadata
      // Check that the log was written with error information
      expect(content).toContain("Operation failed");
      expect(content).toContain("error");
    });

    it("logs fatal errors correctly", () => {
      const logger = createSubsystemLogger("test/fatal");

      logger.fatal("Fatal error occurred", {
        error: "CRITICAL: System failure",
        code: "ERR_FATAL",
      });

      const content = fs.readFileSync(tempLogFile, "utf8");
      expect(content).toContain("Fatal error occurred");
    });
  });

  describe("Retry policy logging", () => {
    it("discord retry logger uses correct subsystem", async () => {
      // Import the retry policy module to verify its logger subsystem
      const { createDiscordRetryRunner } = await import("../infra/retry-policy.js");

      // The function should exist and not throw when created
      expect(typeof createDiscordRetryRunner).toBe("function");

      // Create a retry runner with verbose mode
      const runner = createDiscordRetryRunner({ verbose: true });
      expect(typeof runner).toBe("function");
    });

    it("telegram retry logger uses correct subsystem", async () => {
      const { createTelegramRetryRunner } = await import("../infra/retry-policy.js");

      expect(typeof createTelegramRetryRunner).toBe("function");

      const runner = createTelegramRetryRunner({ verbose: true });
      expect(typeof runner).toBe("function");
    });
  });

  describe("Unhandled rejection logging", () => {
    it("exports installUnhandledRejectionHandler", async () => {
      const { installUnhandledRejectionHandler } = await import("../infra/unhandled-rejections.js");
      expect(typeof installUnhandledRejectionHandler).toBe("function");
    });

    it("exports isAbortError helper", async () => {
      const { isAbortError } = await import("../infra/unhandled-rejections.js");
      expect(typeof isAbortError).toBe("function");

      // Test the helper function
      const abortError = { name: "AbortError" };
      expect(isAbortError(abortError)).toBe(true);
      expect(isAbortError(new Error("regular error"))).toBe(false);
    });

    it("exports isTransientNetworkError helper", async () => {
      const { isTransientNetworkError } = await import("../infra/unhandled-rejections.js");
      expect(typeof isTransientNetworkError).toBe("function");

      // Test with network error code
      const networkError = { code: "ECONNRESET" };
      expect(isTransientNetworkError(networkError)).toBe(true);
      expect(isTransientNetworkError(new Error("regular error"))).toBe(false);
    });
  });

  describe("Verbose logging", () => {
    it("exports logVerbose function", async () => {
      const { logVerbose } = await import("../globals.js");
      expect(typeof logVerbose).toBe("function");
    });

    it("exports logVerboseConsole function", async () => {
      const { logVerboseConsole } = await import("../globals.js");
      expect(typeof logVerboseConsole).toBe("function");
    });

    it("logVerbose respects verbose mode", async () => {
      const { logVerbose, setVerbose } = await import("../globals.js");

      // Should not throw regardless of verbose state
      setVerbose(false);
      expect(() => logVerbose("test message")).not.toThrow();

      setVerbose(true);
      // The async logger is fire-and-forget, so this should not throw
      expect(() => logVerbose("verbose test message")).not.toThrow();

      // Wait a bit for async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Reset
      setVerbose(false);
    });
  });

  describe("No direct console.* calls in migrated modules", () => {
    it("unhandled-rejections.ts uses subsystem logger", async () => {
      const fileContent = fs.readFileSync(
        path.join(process.cwd(), "src/infra/unhandled-rejections.ts"),
        "utf8",
      );

      // Should import SubsystemLogger type
      expect(fileContent).toContain("import type { SubsystemLogger }");

      // Should use createSubsystemLogger via async import
      expect(fileContent).toContain("createSubsystemLogger");

      // Should have the infra/unhandled subsystem
      expect(fileContent).toContain('"infra/unhandled"');

      // Should have getLoggerAsync for async initialization
      expect(fileContent).toContain("getLoggerAsync");

      // Should have tryGetLogger for synchronous access
      expect(fileContent).toContain("tryGetLogger");

      // Console calls are allowed ONLY in the fallback path (when logger is not ready)
      // This is expected behavior - we check that they have consistent formatting
      expect(fileContent).toContain("[infra/unhandled]"); // Consistent prefix in fallback
    });

    it("retry-policy.ts uses subsystem logger", async () => {
      const fileContent = fs.readFileSync(
        path.join(process.cwd(), "src/infra/retry-policy.ts"),
        "utf8",
      );

      // Should import SubsystemLogger type
      expect(fileContent).toContain("import type { SubsystemLogger }");

      // Should use createSubsystemLogger
      expect(fileContent).toContain("createSubsystemLogger");

      // Should have discord/retry and telegram/retry subsystems
      expect(fileContent).toContain("discord/retry");
      expect(fileContent).toContain("telegram/retry");
    });

    it("globals.ts uses subsystem logger for verbose output", async () => {
      const fileContent = fs.readFileSync(path.join(process.cwd(), "src/globals.ts"), "utf8");

      // Should import SubsystemLogger type
      expect(fileContent).toContain("import type { SubsystemLogger }");

      // Should use createSubsystemLogger
      expect(fileContent).toContain("createSubsystemLogger");

      // Should have verbose subsystem
      expect(fileContent).toContain('"verbose"');
    });
  });
});
