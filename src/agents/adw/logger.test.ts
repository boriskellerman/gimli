import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createADWLogger,
  createStepLogger,
  createWorkflowLog,
  createStepLog,
  completeStepLog,
  completeWorkflowLog,
  persistWorkflowLog,
  loadWorkflowLog,
  listWorkflowLogs,
  formatWorkflowLog,
  createWorkflowSummary,
} from "./logger.js";

describe("createADWLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a logger with all methods", () => {
    const logger = createADWLogger();

    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
  });

  it("logs info messages", () => {
    const logger = createADWLogger({ minLevel: "info" });
    logger.info("Test message");

    expect(console.log).toHaveBeenCalled();
    const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall).toContain("INFO");
    expect(logCall).toContain("Test message");
  });

  it("logs with context", () => {
    const logger = createADWLogger({
      workflowName: "TestWorkflow",
      stepName: "Step1",
      attempt: 2,
      minLevel: "info",
    });
    logger.info("Test message");

    const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall).toContain("workflow=TestWorkflow");
    expect(logCall).toContain("step=Step1");
    expect(logCall).toContain("attempt=2");
  });

  it("logs with data", () => {
    const logger = createADWLogger({ minLevel: "info" });
    logger.info("Test message", { key: "value" });

    const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall).toContain('"key":"value"');
  });

  it("respects minimum log level", () => {
    const logger = createADWLogger({ minLevel: "warn" });

    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");

    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("calls onLog callback", () => {
    const onLog = vi.fn();
    const logger = createADWLogger({ onLog, minLevel: "info" });

    logger.info("Test message");

    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toMatchObject({
      level: "info",
      message: "Test message",
    });
  });
});

describe("createStepLogger", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds step context to parent logger", () => {
    const parent = createADWLogger({ minLevel: "info" });
    const stepLogger = createStepLogger(parent, "step-1", "Step 1", 2);

    stepLogger.info("Step message");

    const logCall = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logCall).toContain("Step message");
  });
});

describe("workflow log management", () => {
  describe("createWorkflowLog", () => {
    it("creates a workflow log with defaults", () => {
      const log = createWorkflowLog("wf-123", "Test Workflow");

      expect(log.workflowId).toBe("wf-123");
      expect(log.workflowName).toBe("Test Workflow");
      expect(log.status).toBe("pending");
      expect(log.startedAt).toBeDefined();
      expect(log.steps).toEqual([]);
    });

    it("includes context if provided", () => {
      const log = createWorkflowLog("wf-123", "Test Workflow", { key: "value" });

      expect(log.context).toEqual({ key: "value" });
    });
  });

  describe("createStepLog", () => {
    it("creates a step log", () => {
      const log = createStepLog("step-1", "Step 1", 1, 3);

      expect(log.stepId).toBe("step-1");
      expect(log.stepName).toBe("Step 1");
      expect(log.status).toBe("pending");
      expect(log.attempt).toBe(1);
      expect(log.maxAttempts).toBe(3);
      expect(log.startedAt).toBeDefined();
    });

    it("includes input if provided", () => {
      const log = createStepLog("step-1", "Step 1", 1, 3, { input: "data" });

      expect(log.input).toEqual({ input: "data" });
    });
  });

  describe("completeStepLog", () => {
    it("completes a step log with success", () => {
      const log = createStepLog("step-1", "Step 1", 1, 3);
      const completed = completeStepLog(log, "success", "result");

      expect(completed.status).toBe("success");
      expect(completed.output).toBe("result");
      expect(completed.endedAt).toBeDefined();
      expect(completed.durationMs).toBeDefined();
      expect(completed.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("completes a step log with failure", () => {
      const log = createStepLog("step-1", "Step 1", 1, 3);
      const completed = completeStepLog(log, "failed", undefined, "Error message", "ERR_CODE");

      expect(completed.status).toBe("failed");
      expect(completed.error).toBe("Error message");
      expect(completed.errorCode).toBe("ERR_CODE");
    });

    it("includes validation result if provided", () => {
      const log = createStepLog("step-1", "Step 1", 1, 3);
      const validation = { valid: false, errors: ["Error 1"] };
      const completed = completeStepLog(
        log,
        "failed",
        undefined,
        "Validation failed",
        undefined,
        validation,
      );

      expect(completed.validation).toEqual(validation);
    });
  });

  describe("completeWorkflowLog", () => {
    it("completes a workflow log", () => {
      const log = createWorkflowLog("wf-123", "Test Workflow");
      const completed = completeWorkflowLog(log, "success");

      expect(completed.status).toBe("success");
      expect(completed.endedAt).toBeDefined();
      expect(completed.durationMs).toBeDefined();
    });
  });
});

describe("log persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "adw-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("persistWorkflowLog", () => {
    it("saves workflow log to disk", async () => {
      const log = createWorkflowLog("wf-123", "Test Workflow");
      log.steps.push(createStepLog("step-1", "Step 1", 1, 1));

      const filepath = await persistWorkflowLog(log, tempDir);

      expect(filepath).toContain("adw-wf-123");
      expect(filepath).toContain(".json");

      const content = await fs.readFile(filepath, "utf-8");
      const loaded = JSON.parse(content);
      expect(loaded.workflowId).toBe("wf-123");
    });

    it("creates directory if it does not exist", async () => {
      const log = createWorkflowLog("wf-123", "Test Workflow");
      const nestedDir = path.join(tempDir, "nested", "logs");

      const filepath = await persistWorkflowLog(log, nestedDir);

      expect(filepath).toContain(nestedDir);
      const stats = await fs.stat(nestedDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("loadWorkflowLog", () => {
    it("loads workflow log from disk", async () => {
      const log = createWorkflowLog("wf-456", "Test Workflow");
      const filepath = await persistWorkflowLog(log, tempDir);

      const loaded = await loadWorkflowLog(filepath);

      expect(loaded.workflowId).toBe("wf-456");
      expect(loaded.workflowName).toBe("Test Workflow");
    });
  });

  describe("listWorkflowLogs", () => {
    it("lists workflow logs in directory", async () => {
      await persistWorkflowLog(createWorkflowLog("wf-1", "Workflow 1"), tempDir);
      await persistWorkflowLog(createWorkflowLog("wf-2", "Workflow 2"), tempDir);

      const logs = await listWorkflowLogs(tempDir);

      expect(logs.length).toBe(2);
    });

    it("filters by workflowId", async () => {
      await persistWorkflowLog(createWorkflowLog("wf-1", "Workflow 1"), tempDir);
      await persistWorkflowLog(createWorkflowLog("wf-2", "Workflow 2"), tempDir);

      const logs = await listWorkflowLogs(tempDir, { workflowId: "wf-1" });

      expect(logs.length).toBe(1);
      expect(logs[0]).toContain("wf-1");
    });

    it("limits results", async () => {
      await persistWorkflowLog(createWorkflowLog("wf-1", "Workflow 1"), tempDir);
      await persistWorkflowLog(createWorkflowLog("wf-2", "Workflow 2"), tempDir);
      await persistWorkflowLog(createWorkflowLog("wf-3", "Workflow 3"), tempDir);

      const logs = await listWorkflowLogs(tempDir, { limit: 2 });

      expect(logs.length).toBe(2);
    });

    it("returns empty array for non-existent directory", async () => {
      const logs = await listWorkflowLogs("/non/existent/path");
      expect(logs).toEqual([]);
    });
  });
});

describe("formatWorkflowLog", () => {
  it("formats a completed workflow log", () => {
    const log = createWorkflowLog("wf-123", "Test Workflow");
    log.steps.push(completeStepLog(createStepLog("step-1", "Step 1", 1, 1), "success", "result"));
    const completed = completeWorkflowLog(log, "success");

    const formatted = formatWorkflowLog(completed);

    expect(formatted).toContain("Test Workflow");
    expect(formatted).toContain("wf-123");
    expect(formatted).toContain("success");
    expect(formatted).toContain("Step 1");
    expect(formatted).toContain("✓");
  });

  it("shows failure indicator for failed steps", () => {
    const log = createWorkflowLog("wf-123", "Test Workflow");
    log.steps.push(
      completeStepLog(createStepLog("step-1", "Step 1", 1, 1), "failed", undefined, "Error"),
    );
    const completed = completeWorkflowLog(log, "failed");

    const formatted = formatWorkflowLog(completed);

    expect(formatted).toContain("✗");
    expect(formatted).toContain("Error");
  });
});

describe("createWorkflowSummary", () => {
  it("creates a summary of the workflow", () => {
    const log = createWorkflowLog("wf-123", "Test Workflow");
    log.steps.push(completeStepLog(createStepLog("step-1", "Step 1", 1, 3), "success"));
    log.steps.push(
      completeStepLog(createStepLog("step-2", "Step 2", 2, 3), "failed", undefined, "Error"),
    );
    log.steps.push(completeStepLog(createStepLog("step-3", "Step 3", 1, 3), "skipped"));
    const completed = completeWorkflowLog(log, "failed");

    const summary = createWorkflowSummary(completed);

    expect(summary.workflowId).toBe("wf-123");
    expect(summary.stepsTotal).toBe(3);
    expect(summary.stepsCompleted).toBe(1);
    expect(summary.stepsFailed).toBe(1);
    expect(summary.stepsSkipped).toBe(1);
    expect(summary.totalAttempts).toBe(4); // 1 + 2 + 1
    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0].stepId).toBe("step-2");
  });
});
