/**
 * ADW Structured Logging
 *
 * Provides structured logging for ADW workflows with support for
 * persistence, filtering, and integration with existing logging infrastructure.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  ADWLogger,
  ADWStepLog,
  ADWWorkflowLog,
  ADWStepStatus,
  ADWValidationResult,
} from "./types.js";

export type ADWLogLevel = "debug" | "info" | "warn" | "error";

export type ADWLogEntry = {
  level: ADWLogLevel;
  timestamp: number;
  message: string;
  workflowId?: string;
  workflowName?: string;
  stepId?: string;
  stepName?: string;
  attempt?: number;
  data?: Record<string, unknown>;
};

/**
 * Create an ADW logger with optional persistence.
 */
export function createADWLogger(options?: {
  workflowId?: string;
  workflowName?: string;
  stepId?: string;
  stepName?: string;
  attempt?: number;
  minLevel?: ADWLogLevel;
  onLog?: (entry: ADWLogEntry) => void;
}): ADWLogger {
  const levelOrder: Record<ADWLogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const minLevel = options?.minLevel ?? "info";

  const shouldLog = (level: ADWLogLevel): boolean => {
    return levelOrder[level] >= levelOrder[minLevel];
  };

  const createLogFn = (level: ADWLogLevel) => {
    return (message: string, data?: Record<string, unknown>): void => {
      if (!shouldLog(level)) return;

      const entry: ADWLogEntry = {
        level,
        timestamp: Date.now(),
        message,
        workflowId: options?.workflowId,
        workflowName: options?.workflowName,
        stepId: options?.stepId,
        stepName: options?.stepName,
        attempt: options?.attempt,
        data,
      };

      // Call custom handler if provided
      if (options?.onLog) {
        options.onLog(entry);
      }

      // Format and output
      const formatted = formatLogEntry(entry);
      switch (level) {
        case "debug":
        case "info":
          console.log(formatted);
          break;
        case "warn":
          console.warn(formatted);
          break;
        case "error":
          console.error(formatted);
          break;
      }
    };
  };

  return {
    debug: createLogFn("debug"),
    info: createLogFn("info"),
    warn: createLogFn("warn"),
    error: createLogFn("error"),
  };
}

/**
 * Format a log entry for output.
 */
function formatLogEntry(entry: ADWLogEntry): string {
  const timestamp = new Date(entry.timestamp).toISOString();
  const level = entry.level.toUpperCase().padEnd(5);

  const context: string[] = [];
  if (entry.workflowName) context.push(`workflow=${entry.workflowName}`);
  if (entry.stepName) context.push(`step=${entry.stepName}`);
  if (entry.attempt) context.push(`attempt=${entry.attempt}`);

  const contextStr = context.length > 0 ? ` [${context.join(" ")}]` : "";

  let dataStr = "";
  if (entry.data && Object.keys(entry.data).length > 0) {
    try {
      dataStr = ` ${JSON.stringify(entry.data)}`;
    } catch {
      dataStr = " [data serialization failed]";
    }
  }

  return `[${timestamp}] ${level}${contextStr} ${entry.message}${dataStr}`;
}

/**
 * Create a child logger for a specific step.
 */
export function createStepLogger(
  parentLogger: ADWLogger,
  stepId: string,
  stepName: string,
  attempt: number,
  _onLog?: (entry: ADWLogEntry) => void,
): ADWLogger {
  const addContext = (data?: Record<string, unknown>): Record<string, unknown> => ({
    stepId,
    stepName,
    attempt,
    ...data,
  });

  return {
    debug: (message, data) => parentLogger.debug(message, addContext(data)),
    info: (message, data) => parentLogger.info(message, addContext(data)),
    warn: (message, data) => parentLogger.warn(message, addContext(data)),
    error: (message, data) => parentLogger.error(message, addContext(data)),
  };
}

// ============================================================================
// Workflow Log Management
// ============================================================================

/**
 * Create a new workflow log.
 */
export function createWorkflowLog(
  workflowId: string,
  workflowName: string,
  context?: Record<string, unknown>,
): ADWWorkflowLog {
  return {
    workflowId,
    workflowName,
    status: "pending",
    startedAt: Date.now(),
    steps: [],
    context,
  };
}

/**
 * Create a new step log.
 */
export function createStepLog(
  stepId: string,
  stepName: string,
  attempt: number,
  maxAttempts: number,
  input?: Record<string, unknown>,
): ADWStepLog {
  return {
    stepId,
    stepName,
    status: "pending",
    startedAt: Date.now(),
    attempt,
    maxAttempts,
    input,
  };
}

/**
 * Update step log with completion details.
 */
export function completeStepLog(
  log: ADWStepLog,
  status: ADWStepStatus,
  output?: unknown,
  error?: string,
  errorCode?: string,
  validation?: ADWValidationResult,
): ADWStepLog {
  const endedAt = Date.now();
  return {
    ...log,
    status,
    endedAt,
    durationMs: endedAt - log.startedAt,
    output,
    error,
    errorCode,
    validation,
  };
}

/**
 * Update workflow log with completion details.
 */
export function completeWorkflowLog(
  log: ADWWorkflowLog,
  status: "success" | "failed" | "cancelled",
): ADWWorkflowLog {
  const endedAt = Date.now();
  return {
    ...log,
    status,
    endedAt,
    durationMs: endedAt - log.startedAt,
  };
}

// ============================================================================
// Log Persistence
// ============================================================================

/**
 * Persist a workflow log to disk.
 */
export async function persistWorkflowLog(log: ADWWorkflowLog, logDir: string): Promise<string> {
  await fs.mkdir(logDir, { recursive: true });

  const filename = `adw-${log.workflowId}-${log.startedAt}.json`;
  const filepath = path.join(logDir, filename);

  await fs.writeFile(filepath, JSON.stringify(log, null, 2), "utf-8");

  return filepath;
}

/**
 * Load a workflow log from disk.
 */
export async function loadWorkflowLog(filepath: string): Promise<ADWWorkflowLog> {
  const content = await fs.readFile(filepath, "utf-8");
  return JSON.parse(content) as ADWWorkflowLog;
}

/**
 * List workflow logs in a directory.
 */
export async function listWorkflowLogs(
  logDir: string,
  options?: {
    workflowId?: string;
    status?: ADWWorkflowLog["status"];
    limit?: number;
    newestFirst?: boolean;
  },
): Promise<string[]> {
  try {
    const files = await fs.readdir(logDir);
    let logFiles = files.filter((f) => f.startsWith("adw-") && f.endsWith(".json"));

    // Filter by workflowId if provided
    if (options?.workflowId) {
      logFiles = logFiles.filter((f) => f.includes(`adw-${options.workflowId}-`));
    }

    // Sort by timestamp (extracted from filename)
    logFiles.sort((a, b) => {
      const tsA = extractTimestamp(a);
      const tsB = extractTimestamp(b);
      return options?.newestFirst !== false ? tsB - tsA : tsA - tsB;
    });

    // Apply limit
    if (options?.limit && options.limit > 0) {
      logFiles = logFiles.slice(0, options.limit);
    }

    return logFiles.map((f) => path.join(logDir, f));
  } catch {
    return [];
  }
}

function extractTimestamp(filename: string): number {
  const match = filename.match(/adw-[^-]+-(\d+)\.json$/);
  return match ? parseInt(match[1], 10) : 0;
}

// ============================================================================
// Log Formatting & Display
// ============================================================================

/**
 * Format a workflow log for display.
 */
export function formatWorkflowLog(log: ADWWorkflowLog): string {
  const lines: string[] = [];

  const statusEmoji = getStatusEmoji(log.status);
  const duration = log.durationMs ? `${log.durationMs}ms` : "in progress";

  lines.push(`${statusEmoji} Workflow: ${log.workflowName} (${log.workflowId})`);
  lines.push(`   Status: ${log.status} | Duration: ${duration}`);
  lines.push(`   Started: ${new Date(log.startedAt).toISOString()}`);
  if (log.endedAt) {
    lines.push(`   Ended: ${new Date(log.endedAt).toISOString()}`);
  }
  lines.push("");

  if (log.steps.length > 0) {
    lines.push("   Steps:");
    for (const step of log.steps) {
      lines.push(formatStepLogLine(step));
    }
  }

  return lines.join("\n");
}

/**
 * Format a single step log line.
 */
function formatStepLogLine(log: ADWStepLog): string {
  const statusEmoji = getStatusEmoji(log.status);
  const duration = log.durationMs ? `${log.durationMs}ms` : "-";
  const attemptInfo = log.maxAttempts > 1 ? ` (attempt ${log.attempt}/${log.maxAttempts})` : "";

  let line = `   ${statusEmoji} ${log.stepName}${attemptInfo} - ${duration}`;

  if (log.error) {
    line += ` [Error: ${log.error}]`;
  }

  if (log.validation && !log.validation.valid) {
    const errorCount = log.validation.errors?.length ?? 0;
    line += ` [Validation: ${errorCount} errors]`;
  }

  return line;
}

function getStatusEmoji(status: string): string {
  switch (status) {
    case "success":
      return "✓";
    case "failed":
      return "✗";
    case "running":
    case "pending":
      return "○";
    case "skipped":
      return "−";
    case "retrying":
      return "↻";
    case "cancelled":
      return "⊘";
    default:
      return "?";
  }
}

/**
 * Create a summary of a workflow log.
 */
export function createWorkflowSummary(log: ADWWorkflowLog): {
  workflowId: string;
  workflowName: string;
  status: string;
  durationMs?: number;
  stepsTotal: number;
  stepsCompleted: number;
  stepsFailed: number;
  stepsSkipped: number;
  totalAttempts: number;
  errors: Array<{ stepId: string; stepName: string; error: string }>;
} {
  const errors: Array<{ stepId: string; stepName: string; error: string }> = [];
  let stepsCompleted = 0;
  let stepsFailed = 0;
  let stepsSkipped = 0;
  let totalAttempts = 0;

  for (const step of log.steps) {
    totalAttempts += step.attempt;

    switch (step.status) {
      case "success":
        stepsCompleted++;
        break;
      case "failed":
        stepsFailed++;
        if (step.error) {
          errors.push({
            stepId: step.stepId,
            stepName: step.stepName,
            error: step.error,
          });
        }
        break;
      case "skipped":
        stepsSkipped++;
        break;
    }
  }

  return {
    workflowId: log.workflowId,
    workflowName: log.workflowName,
    status: log.status,
    durationMs: log.durationMs,
    stepsTotal: log.steps.length,
    stepsCompleted,
    stepsFailed,
    stepsSkipped,
    totalAttempts,
    errors,
  };
}
