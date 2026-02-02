import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLogger, createConsoleLogger } from "./logger.js";
import type { WorkflowEvent } from "./types.js";

describe("AdwLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("log levels", () => {
    it("logs at info level by default", () => {
      const logger = createLogger({ console: true });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Info message",
      });

      expect(console.log).toHaveBeenCalled();
    });

    it("filters debug logs when minLevel is info", () => {
      const logger = createLogger({ console: true, minLevel: "info" });

      logger.log({
        level: "debug",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Debug message",
      });

      expect(console.log).not.toHaveBeenCalled();
    });

    it("shows debug logs when minLevel is debug", () => {
      const logger = createLogger({ console: true, minLevel: "debug" });

      logger.log({
        level: "debug",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Debug message",
      });

      expect(console.log).toHaveBeenCalled();
    });

    it("uses console.warn for warnings", () => {
      const logger = createLogger({ console: true });

      logger.log({
        level: "warn",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Warning message",
      });

      expect(console.warn).toHaveBeenCalled();
    });

    it("uses console.error for errors", () => {
      const logger = createLogger({ console: true });

      logger.log({
        level: "error",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Error message",
      });

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("entry management", () => {
    it("stores logged entries", () => {
      const logger = createLogger({ console: false });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Message 1",
      });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Message 2",
      });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.message).toBe("Message 1");
      expect(entries[1]?.message).toBe("Message 2");
    });

    it("clears entries", () => {
      const logger = createLogger({ console: false });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Message",
      });

      expect(logger.getEntries()).toHaveLength(1);

      logger.clearEntries();
      expect(logger.getEntries()).toHaveLength(0);
    });

    it("adds timestamp to entries", () => {
      const logger = createLogger({ console: false });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Message",
      });

      const entry = logger.getEntries()[0];
      expect(entry?.timestamp).toBeDefined();
      expect(new Date(entry!.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("custom formatter", () => {
    it("uses custom formatter when provided", () => {
      const customFormatter = vi.fn().mockReturnValue("custom output");

      const logger = createLogger({
        console: true,
        formatter: customFormatter,
      });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Message",
      });

      expect(customFormatter).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith("custom output");
    });
  });

  describe("workflow event listener", () => {
    it("creates event listener that logs workflow events", () => {
      const logger = createLogger({ console: false });
      const listener = logger.createEventListener();

      const events: WorkflowEvent[] = [
        {
          type: "workflow:start",
          runId: "run-1",
          workflowId: "test",
          timestamp: Date.now(),
          data: { input: "test" },
        },
        {
          type: "step:start",
          runId: "run-1",
          workflowId: "test",
          timestamp: Date.now(),
          stepId: "step-1",
          stepName: "Step 1",
          attempt: 1,
          maxAttempts: 3,
        },
        {
          type: "step:complete",
          runId: "run-1",
          workflowId: "test",
          timestamp: Date.now(),
          stepId: "step-1",
          stepName: "Step 1",
          data: { result: "done" },
        },
        {
          type: "workflow:complete",
          runId: "run-1",
          workflowId: "test",
          timestamp: Date.now(),
          data: { output: "done", durationMs: 100 },
        },
      ];

      for (const event of events) {
        listener(event);
      }

      const entries = logger.getEntries();
      expect(entries).toHaveLength(4);
      expect(entries[0]?.message).toBe("Workflow started");
      expect(entries[1]?.message).toContain("Step started");
      expect(entries[2]?.message).toBe("Step completed");
      expect(entries[3]?.message).toBe("Workflow completed successfully");
    });

    it("logs retry events", () => {
      const logger = createLogger({ console: false });
      const listener = logger.createEventListener();

      listener({
        type: "step:retry",
        runId: "run-1",
        workflowId: "test",
        timestamp: Date.now(),
        stepId: "step-1",
        stepName: "Flaky Step",
        error: "Transient error",
        attempt: 1,
        maxAttempts: 3,
        data: { delayMs: 1000 },
      });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe("warn");
      expect(entries[0]?.message).toContain("Retrying step");
      expect(entries[0]?.message).toContain("1/3");
    });

    it("logs error events", () => {
      const logger = createLogger({ console: false });
      const listener = logger.createEventListener();

      listener({
        type: "step:error",
        runId: "run-1",
        workflowId: "test",
        timestamp: Date.now(),
        stepId: "step-1",
        stepName: "Failed Step",
        error: "Fatal error",
        attempt: 3,
        maxAttempts: 3,
      });

      listener({
        type: "workflow:error",
        runId: "run-1",
        workflowId: "test",
        timestamp: Date.now(),
        error: "Workflow failed",
      });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.level).toBe("error");
      expect(entries[0]?.message).toContain("Step failed");
      expect(entries[1]?.level).toBe("error");
      expect(entries[1]?.message).toContain("Workflow failed");
    });

    it("logs skip events", () => {
      const logger = createLogger({ console: false });
      const listener = logger.createEventListener();

      listener({
        type: "step:skip",
        runId: "run-1",
        workflowId: "test",
        timestamp: Date.now(),
        stepId: "step-1",
        stepName: "Skipped Step",
      });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe("info");
      expect(entries[0]?.message).toBe("Step skipped");
    });

    it("logs abort events", () => {
      const logger = createLogger({ console: false });
      const listener = logger.createEventListener();

      listener({
        type: "workflow:abort",
        runId: "run-1",
        workflowId: "test",
        timestamp: Date.now(),
      });

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.level).toBe("warn");
      expect(entries[0]?.message).toBe("Workflow aborted");
    });
  });

  describe("helper functions", () => {
    it("createConsoleLogger creates console-only logger", () => {
      const logger = createConsoleLogger("warn");

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Info",
      });

      // Info should be filtered when minLevel is warn
      expect(console.log).not.toHaveBeenCalled();

      logger.log({
        level: "warn",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Warning",
      });

      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe("duration formatting", () => {
    it("includes duration in log output", () => {
      const logger = createLogger({ console: true });

      logger.log({
        level: "info",
        workflowId: "test",
        runId: "run-1",
        event: "test",
        message: "Completed",
        durationMs: 1500,
      });

      // Check that console.log was called with something containing duration
      expect(console.log).toHaveBeenCalled();
      const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(logCall).toContain("1.50s");
    });
  });
});
