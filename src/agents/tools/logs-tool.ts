import fs from "node:fs";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { GimliConfig } from "../../config/config.js";
import { DEFAULT_LOG_DIR } from "../../logging/logger.js";
import { parseLogLine } from "../../logging/parse-log-line.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";

const LOGS_ACTIONS = ["tail", "search", "list-files", "stats"] as const;

const LEVEL_FILTER = ["all", "error", "warn", "info", "debug"] as const;

// Flattened schema to avoid anyOf issues with some providers
const LogsToolSchema = Type.Object({
  action: stringEnum(LOGS_ACTIONS, {
    description:
      "Action: tail (read recent logs), search (find logs by pattern), list-files (show available log files), stats (log file statistics)",
  }),
  // tail/search params
  lines: Type.Optional(
    Type.Number({ description: "Number of lines to return (default: 50, max: 500)" }),
  ),
  level: Type.Optional(
    stringEnum(LEVEL_FILTER, { description: "Filter by log level (default: all)" }),
  ),
  subsystem: Type.Optional(Type.String({ description: "Filter by subsystem name" })),
  // search params
  pattern: Type.Optional(
    Type.String({ description: "Search pattern (case-insensitive substring match)" }),
  ),
  // list-files/stats params
  logDir: Type.Optional(Type.String({ description: "Log directory path (default: /tmp/gimli)" })),
});

const LOG_PREFIX = "gimli";
const LOG_SUFFIX = ".log";
const MAX_LINES = 500;

/**
 * Get the current day's log file path.
 */
function getCurrentLogPath(): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(DEFAULT_LOG_DIR, `${LOG_PREFIX}-${today}${LOG_SUFFIX}`);
}

/**
 * Read the last N lines from a file.
 */
function tailFile(filePath: string, maxLines: number): string[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.slice(-maxLines);
}

/**
 * Parse and filter log lines.
 */
function parseAndFilterLogs(
  rawLines: string[],
  filters: {
    level?: string;
    subsystem?: string;
    pattern?: string;
  },
): Array<{
  time?: string;
  level?: string;
  subsystem?: string;
  message: string;
}> {
  const results: Array<{
    time?: string;
    level?: string;
    subsystem?: string;
    message: string;
  }> = [];

  const levelRank: Record<string, number> = {
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
  };

  for (const raw of rawLines) {
    const parsed = parseLogLine(raw);
    if (!parsed) {
      // Include unparseable lines if no filters
      if (!filters.level && !filters.subsystem && !filters.pattern) {
        results.push({ message: raw.slice(0, 500) });
      }
      continue;
    }

    // Level filter
    if (filters.level && filters.level !== "all") {
      const entryLevel = parsed.level ?? "info";
      const filterRank = levelRank[filters.level] ?? 3;
      const entryRank = levelRank[entryLevel] ?? 3;
      if (entryRank > filterRank) continue;
    }

    // Subsystem filter
    if (filters.subsystem) {
      const sub = parsed.subsystem ?? parsed.module ?? "";
      if (!sub.toLowerCase().includes(filters.subsystem.toLowerCase())) continue;
    }

    // Pattern filter
    if (filters.pattern) {
      const searchText = [parsed.message, parsed.subsystem, parsed.module, raw]
        .join(" ")
        .toLowerCase();
      if (!searchText.includes(filters.pattern.toLowerCase())) continue;
    }

    results.push({
      time: parsed.time,
      level: parsed.level,
      subsystem: parsed.subsystem ?? parsed.module,
      message: parsed.message.slice(0, 500),
    });
  }

  return results;
}

/**
 * List available log files in a directory.
 */
function listLogFiles(logDir: string): Array<{
  name: string;
  path: string;
  size: number;
  mtime: string;
}> {
  if (!fs.existsSync(logDir)) {
    return [];
  }

  const entries = fs.readdirSync(logDir, { withFileTypes: true });
  const logFiles: Array<{
    name: string;
    path: string;
    size: number;
    mtime: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(LOG_PREFIX) || !entry.name.endsWith(LOG_SUFFIX)) continue;

    const fullPath = path.join(logDir, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      logFiles.push({
        name: entry.name,
        path: fullPath,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch {
      // Skip files we can't stat
    }
  }

  // Sort by modification time, newest first
  logFiles.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return logFiles;
}

/**
 * Logs tool for agent access to Gimli's log files.
 * Provides read-only access to logs for debugging and monitoring.
 */
export function createLogsTool(_opts?: {
  agentSessionKey?: string;
  config?: GimliConfig;
}): AnyAgentTool {
  return {
    label: "Logs",
    name: "logs",
    description:
      "Read-only access to Gimli's log files. Use 'tail' to read recent logs (with optional level/subsystem filters), 'search' to find logs matching a pattern, 'list-files' to see available log files, 'stats' to get log statistics.",
    parameters: LogsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "tail") {
        const lines = Math.min(readNumberParam(params, "lines") ?? 50, MAX_LINES);
        const level = readStringParam(params, "level") ?? "all";
        const subsystem = readStringParam(params, "subsystem");

        try {
          const logPath = getCurrentLogPath();
          if (!fs.existsSync(logPath)) {
            return jsonResult({
              ok: true,
              action: "tail",
              logPath,
              lines: [],
              message: "No log file for today yet",
            });
          }

          const rawLines = tailFile(logPath, lines * 2); // Get extra to account for filtering
          const filtered = parseAndFilterLogs(rawLines, { level, subsystem });
          const result = filtered.slice(-lines);

          return jsonResult({
            ok: true,
            action: "tail",
            logPath,
            requestedLines: lines,
            returnedLines: result.length,
            filters: {
              level: level !== "all" ? level : undefined,
              subsystem,
            },
            logs: result,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to read logs: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "search") {
        const pattern = readStringParam(params, "pattern", { required: true });
        const lines = Math.min(readNumberParam(params, "lines") ?? 100, MAX_LINES);
        const level = readStringParam(params, "level") ?? "all";
        const subsystem = readStringParam(params, "subsystem");

        try {
          const logPath = getCurrentLogPath();
          if (!fs.existsSync(logPath)) {
            return jsonResult({
              ok: true,
              action: "search",
              pattern,
              logPath,
              matches: [],
              message: "No log file for today yet",
            });
          }

          // Read more lines for search since we're filtering
          const rawLines = tailFile(logPath, lines * 5);
          const filtered = parseAndFilterLogs(rawLines, { level, subsystem, pattern });
          const result = filtered.slice(-lines);

          return jsonResult({
            ok: true,
            action: "search",
            pattern,
            logPath,
            matchCount: result.length,
            filters: {
              level: level !== "all" ? level : undefined,
              subsystem,
            },
            matches: result,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to search logs: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "list-files") {
        const logDir = readStringParam(params, "logDir") ?? DEFAULT_LOG_DIR;

        try {
          const files = listLogFiles(logDir);

          return jsonResult({
            ok: true,
            action: "list-files",
            logDir,
            fileCount: files.length,
            files,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to list log files: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "stats") {
        const logDir = readStringParam(params, "logDir") ?? DEFAULT_LOG_DIR;

        try {
          const files = listLogFiles(logDir);
          const currentLogPath = getCurrentLogPath();
          const currentLogExists = fs.existsSync(currentLogPath);

          let todayStats: {
            path: string;
            size: number;
            lineCount: number;
            levelCounts: Record<string, number>;
          } | null = null;

          if (currentLogExists) {
            const rawLines = tailFile(currentLogPath, 10000);
            const levelCounts: Record<string, number> = {
              error: 0,
              warn: 0,
              info: 0,
              debug: 0,
              other: 0,
            };

            for (const raw of rawLines) {
              const parsed = parseLogLine(raw);
              const level = parsed?.level ?? "other";
              if (level in levelCounts) {
                levelCounts[level]++;
              } else {
                levelCounts.other++;
              }
            }

            const stat = fs.statSync(currentLogPath);
            todayStats = {
              path: currentLogPath,
              size: stat.size,
              lineCount: rawLines.length,
              levelCounts,
            };
          }

          const totalSize = files.reduce((sum, f) => sum + f.size, 0);

          return jsonResult({
            ok: true,
            action: "stats",
            logDir,
            fileCount: files.length,
            totalSize,
            totalSizeFormatted: `${(totalSize / 1024).toFixed(1)} KB`,
            oldestFile: files.length > 0 ? files[files.length - 1].name : null,
            newestFile: files.length > 0 ? files[0].name : null,
            todayStats,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to get log stats: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      return jsonResult({
        ok: false,
        error: `Unknown action: ${action}`,
      });
    },
  };
}
