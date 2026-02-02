/**
 * ADW Logger - Structured logging for AI Developer Workflows
 *
 * Provides consistent logging format for workflow execution with:
 * - Step-by-step progress tracking
 * - Error logging with context
 * - Timing and performance metrics
 * - Optional persistence to file
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkflowEvent } from "./types.js";

/** Synchronous workflow event listener type for logging */
export type SyncWorkflowEventListener = (event: WorkflowEvent) => void;

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  workflowId: string;
  runId: string;
  event: string;
  stepId?: string;
  stepName?: string;
  message: string;
  data?: unknown;
  durationMs?: number;
};

export type LoggerOptions = {
  /** Minimum log level to output */
  minLevel?: LogLevel;

  /** Whether to output to console */
  console?: boolean;

  /** File path for log persistence */
  filePath?: string;

  /** Custom formatter for console output */
  formatter?: (entry: LogEntry) => string;

  /** Whether to include timestamps in console output */
  timestamps?: boolean;

  /** ANSI colors enabled */
  colors?: boolean;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

function defaultFormatter(entry: LogEntry, options: LoggerOptions): string {
  const colors = options.colors ?? true;
  const c = colors
    ? COLORS
    : {
        reset: "",
        dim: "",
        bold: "",
        green: "",
        yellow: "",
        red: "",
        blue: "",
        cyan: "",
        magenta: "",
      };

  const levelColors: Record<LogLevel, string> = {
    debug: c.dim,
    info: c.blue,
    warn: c.yellow,
    error: c.red,
  };

  const parts: string[] = [];

  if (options.timestamps ?? true) {
    parts.push(`${c.dim}[${entry.timestamp}]${c.reset}`);
  }

  parts.push(`${levelColors[entry.level]}${entry.level.toUpperCase().padEnd(5)}${c.reset}`);
  parts.push(`${c.cyan}[${entry.workflowId}]${c.reset}`);

  if (entry.stepName) {
    parts.push(`${c.magenta}${entry.stepName}${c.reset}`);
  }

  parts.push(entry.message);

  if (entry.durationMs !== undefined) {
    parts.push(`${c.dim}(${formatDuration(entry.durationMs)})${c.reset}`);
  }

  return parts.join(" ");
}

export class AdwLogger {
  private options: LoggerOptions;
  private fileHandle?: fs.WriteStream;
  private entries: LogEntry[] = [];

  constructor(options: LoggerOptions = {}) {
    this.options = {
      minLevel: "info",
      console: true,
      timestamps: true,
      colors: true,
      ...options,
    };

    if (options.filePath) {
      const dir = path.dirname(options.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.fileHandle = fs.createWriteStream(options.filePath, { flags: "a" });
    }
  }

  /**
   * Get all logged entries
   */
  getEntries(): readonly LogEntry[] {
    return this.entries;
  }

  /**
   * Clear logged entries
   */
  clearEntries(): void {
    this.entries = [];
  }

  /**
   * Log an entry
   */
  log(entry: Omit<LogEntry, "timestamp">): void {
    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    this.entries.push(fullEntry);

    if (LOG_LEVELS[entry.level] < LOG_LEVELS[this.options.minLevel ?? "info"]) {
      return;
    }

    if (this.options.console) {
      const formatted = this.options.formatter
        ? this.options.formatter(fullEntry)
        : defaultFormatter(fullEntry, this.options);

      if (entry.level === "error") {
        console.error(formatted);
      } else if (entry.level === "warn") {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }

    if (this.fileHandle) {
      this.fileHandle.write(JSON.stringify(fullEntry) + "\n");
    }
  }

  /**
   * Close the logger and flush any pending writes
   */
  async close(): Promise<void> {
    if (this.fileHandle) {
      await new Promise<void>((resolve) => {
        this.fileHandle!.end(() => resolve());
      });
    }
  }

  /**
   * Create an event listener for workflow events.
   * Returns a synchronous listener function that can be used as a WorkflowEventListener.
   */
  createEventListener(): SyncWorkflowEventListener {
    return (event: WorkflowEvent) => {
      const baseEntry = {
        workflowId: event.workflowId,
        runId: event.runId,
        stepId: "stepId" in event ? event.stepId : undefined,
        stepName: "stepName" in event ? event.stepName : undefined,
      };

      switch (event.type) {
        case "workflow:start":
          this.log({
            ...baseEntry,
            level: "info",
            event: event.type,
            message: "Workflow started",
            data: event.data,
          });
          break;

        case "workflow:complete":
          this.log({
            ...baseEntry,
            level: "info",
            event: event.type,
            message: "Workflow completed successfully",
            data: event.data,
            durationMs: (event.data as { durationMs?: number })?.durationMs,
          });
          break;

        case "workflow:error":
          this.log({
            ...baseEntry,
            level: "error",
            event: event.type,
            message: `Workflow failed: ${event.error}`,
          });
          break;

        case "workflow:abort":
          this.log({
            ...baseEntry,
            level: "warn",
            event: event.type,
            message: "Workflow aborted",
          });
          break;

        case "step:start":
          this.log({
            ...baseEntry,
            level: "debug",
            event: event.type,
            message: `Step started (attempt ${event.attempt}/${event.maxAttempts})`,
          });
          break;

        case "step:complete":
          this.log({
            ...baseEntry,
            level: "info",
            event: event.type,
            message: "Step completed",
            data: event.data,
          });
          break;

        case "step:error":
          this.log({
            ...baseEntry,
            level: "error",
            event: event.type,
            message: `Step failed: ${event.error}`,
          });
          break;

        case "step:retry":
          this.log({
            ...baseEntry,
            level: "warn",
            event: event.type,
            message: `Retrying step (attempt ${event.attempt}/${event.maxAttempts}): ${event.error}`,
            data: event.data,
          });
          break;

        case "step:skip":
          this.log({
            ...baseEntry,
            level: "info",
            event: event.type,
            message: "Step skipped",
          });
          break;
      }
    };
  }
}

/**
 * Create a logger instance
 */
export function createLogger(options?: LoggerOptions): AdwLogger {
  return new AdwLogger(options);
}

/**
 * Create a simple console logger
 */
export function createConsoleLogger(minLevel: LogLevel = "info"): AdwLogger {
  return new AdwLogger({ minLevel, console: true });
}

/**
 * Create a file logger
 */
export function createFileLogger(filePath: string, minLevel: LogLevel = "info"): AdwLogger {
  return new AdwLogger({ minLevel, console: false, filePath });
}

/**
 * Create a dual logger (console + file)
 */
export function createDualLogger(filePath: string, minLevel: LogLevel = "info"): AdwLogger {
  return new AdwLogger({ minLevel, console: true, filePath });
}
