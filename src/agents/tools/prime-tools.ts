/**
 * Prime Tools - Agent tools for database, config, and logs access
 *
 * These tools enable agents to access core Gimli systems:
 * - Database: Sessions and memory (SQLite-backed)
 * - Config: Read/list configuration values
 * - Logs: Read and search log entries
 *
 * Designed for TAC (Tactical Agentic Coding) Grade 3 - custom tools with
 * tool access for agent orchestration and self-improvement workflows.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { Type } from "@sinclair/typebox";

import type { GimliConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/io.js";
import { resolveStateDir } from "../../config/paths.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { getResolvedLoggerSettings } from "../../logging.js";
import { parseLogLine, type ParsedLogLine } from "../../logging/parse-log-line.js";
import { getMemorySearchManager } from "../../memory/search-manager.js";
import { resolveDefaultAgentId } from "../agent-scope.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readNumberParam, readStringParam } from "./common.js";

// =============================================================================
// Sessions Database Tool
// =============================================================================

const SESSIONS_ACTIONS = ["list", "get", "search", "stats"] as const;

const SessionsToolSchema = Type.Object({
  action: stringEnum(SESSIONS_ACTIONS, {
    description:
      "Action to perform: list (all sessions), get (single session), search (by key pattern), stats (summary)",
  }),
  // get, search
  key: Type.Optional(Type.String({ description: "Session key for 'get' or pattern for 'search'" })),
  // list, search
  limit: Type.Optional(Type.Number({ description: "Maximum results to return (default: 50)" })),
  // list
  includeExpired: Type.Optional(
    Type.Boolean({ description: "Include expired hook sessions (default: false)" }),
  ),
});

export function createSessionsTool(opts?: { config?: GimliConfig }): AnyAgentTool {
  return {
    label: "Sessions",
    name: "prime_sessions",
    description:
      "Access the sessions database. Actions: list (all sessions with metadata), get (single session by key), search (find sessions matching pattern), stats (session counts and summary).",
    parameters: SessionsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = opts?.config ?? loadConfig();
      const storePath = resolveStorePath(cfg.session?.store);

      if (action === "list") {
        const limit = readNumberParam(params, "limit", { integer: true }) ?? 50;
        const includeExpired = params.includeExpired === true;
        const store = loadSessionStore(storePath);
        const entries = Object.entries(store);

        // Filter and sort
        let filtered = entries;
        if (!includeExpired) {
          const now = Date.now();
          const maxAge = 48 * 60 * 60 * 1000; // 48 hours for hook sessions
          filtered = entries.filter(([key, entry]) => {
            if (!key.startsWith("hook:")) return true;
            return now - (entry?.updatedAt ?? 0) <= maxAge;
          });
        }

        // Sort by updatedAt descending (most recent first)
        filtered.sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0));
        const limited = filtered.slice(0, Math.max(1, limit));

        return jsonResult({
          ok: true,
          total: entries.length,
          returned: limited.length,
          sessions: limited.map(([key, entry]) => summarizeSession(key, entry)),
        });
      }

      if (action === "get") {
        const key = readStringParam(params, "key", { required: true });
        const store = loadSessionStore(storePath);
        const entry = store[key];
        if (!entry) {
          return jsonResult({ ok: false, error: `Session not found: ${key}` });
        }
        return jsonResult({ ok: true, session: { key, ...entry } });
      }

      if (action === "search") {
        const pattern = readStringParam(params, "key") ?? "";
        const limit = readNumberParam(params, "limit", { integer: true }) ?? 50;
        const store = loadSessionStore(storePath);
        const entries = Object.entries(store);

        // Simple pattern matching (case-insensitive substring)
        const lowerPattern = pattern.toLowerCase();
        const matches = entries.filter(([key]) => key.toLowerCase().includes(lowerPattern));
        matches.sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0));
        const limited = matches.slice(0, Math.max(1, limit));

        return jsonResult({
          ok: true,
          pattern,
          total: matches.length,
          returned: limited.length,
          sessions: limited.map(([key, entry]) => summarizeSession(key, entry)),
        });
      }

      if (action === "stats") {
        const store = loadSessionStore(storePath);
        const entries = Object.entries(store);
        const now = Date.now();

        // Categorize sessions
        let hookCount = 0;
        let activeCount = 0;
        let recentCount = 0; // last 24 hours
        const channels = new Map<string, number>();

        for (const [key, entry] of entries) {
          if (key.startsWith("hook:")) hookCount++;
          if (entry?.deliveryContext?.channel) {
            const ch = entry.deliveryContext.channel;
            channels.set(ch, (channels.get(ch) ?? 0) + 1);
          }
          const updated = entry?.updatedAt ?? 0;
          if (now - updated <= 24 * 60 * 60 * 1000) recentCount++;
          if (now - updated <= 7 * 24 * 60 * 60 * 1000) activeCount++;
        }

        return jsonResult({
          ok: true,
          stats: {
            total: entries.length,
            hookSessions: hookCount,
            activeLast7Days: activeCount,
            activeLast24Hours: recentCount,
            byChannel: Object.fromEntries(channels),
          },
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}

function summarizeSession(key: string, entry: SessionEntry | undefined): Record<string, unknown> {
  if (!entry) return { key, exists: false };
  return {
    key,
    agentId: entry.agentId,
    channel: entry.deliveryContext?.channel ?? entry.lastChannel,
    to: entry.deliveryContext?.to ?? entry.lastTo,
    updatedAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : undefined,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
    groupChannel: entry.groupChannel,
    displayName: entry.displayName,
    lastUserMessage: entry.lastUserMessage?.slice(0, 100),
  };
}

// =============================================================================
// Config Tool
// =============================================================================

const CONFIG_ACTIONS = ["get", "list", "snapshot", "path"] as const;

const ConfigToolSchema = Type.Object({
  action: stringEnum(CONFIG_ACTIONS, {
    description:
      "Action: get (value at path), list (top-level keys), snapshot (full config with metadata), path (config file path)",
  }),
  // get
  configPath: Type.Optional(
    Type.String({
      description: "Dot-separated path to config value (e.g., 'gateway.port', 'agents.defaults')",
    }),
  ),
  // list, get
  redact: Type.Optional(
    Type.Boolean({ description: "Redact sensitive values like tokens/keys (default: true)" }),
  ),
});

export function createConfigTool(opts?: { config?: GimliConfig }): AnyAgentTool {
  return {
    label: "Config",
    name: "prime_config",
    description:
      "Read Gimli configuration. Actions: get (value at dot-path), list (top-level keys), snapshot (full config with validation status), path (config file location). Sensitive values are redacted by default.",
    parameters: ConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const redact = params.redact !== false; // default true

      if (action === "path") {
        const stateDir = resolveStateDir();
        return jsonResult({
          ok: true,
          configPath: `${stateDir}/gimli.json`,
          stateDir,
        });
      }

      if (action === "snapshot") {
        const snapshot = await readConfigFileSnapshot();
        const config = redact ? redactConfig(snapshot.config) : snapshot.config;
        return jsonResult({
          ok: true,
          path: snapshot.path,
          exists: snapshot.exists,
          valid: snapshot.valid,
          hash: snapshot.hash,
          issues: snapshot.issues,
          warnings: snapshot.warnings,
          config,
        });
      }

      const cfg = opts?.config ?? loadConfig();

      if (action === "list") {
        const keys = Object.keys(cfg);
        return jsonResult({
          ok: true,
          keys,
          count: keys.length,
        });
      }

      if (action === "get") {
        const configPath = readStringParam(params, "configPath");
        if (!configPath) {
          // Return full config
          const config = redact ? redactConfig(cfg) : cfg;
          return jsonResult({ ok: true, config });
        }

        // Navigate to path
        const parts = configPath.split(".");
        let value: unknown = cfg;
        for (const part of parts) {
          if (value == null || typeof value !== "object") {
            return jsonResult({ ok: false, error: `Path not found: ${configPath}` });
          }
          value = (value as Record<string, unknown>)[part];
        }

        if (redact && shouldRedactPath(configPath)) {
          value = "[REDACTED]";
        } else if (redact && typeof value === "object" && value !== null) {
          value = redactConfig(value as GimliConfig);
        }

        return jsonResult({ ok: true, path: configPath, value });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}

const SENSITIVE_KEYS = new Set([
  "token",
  "apiKey",
  "secret",
  "password",
  "key",
  "credential",
  "auth",
]);

function shouldRedactPath(path: string): boolean {
  const lower = path.toLowerCase();
  return Array.from(SENSITIVE_KEYS).some((key) => lower.includes(key.toLowerCase()));
}

function redactConfig(cfg: GimliConfig | Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cfg)) {
    const lowerKey = key.toLowerCase();
    if (Array.from(SENSITIVE_KEYS).some((s) => lowerKey.includes(s.toLowerCase()))) {
      result[key] = value ? "[REDACTED]" : value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactConfig(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// =============================================================================
// Logs Tool
// =============================================================================

const LOGS_ACTIONS = ["tail", "search", "stats", "path"] as const;

const LogsToolSchema = Type.Object({
  action: stringEnum(LOGS_ACTIONS, {
    description:
      "Action: tail (recent lines), search (filter by level/subsystem/text), stats (log file info), path (log file location)",
  }),
  // tail, search
  lines: Type.Optional(
    Type.Number({ description: "Number of lines to read (default: 100, max: 1000)" }),
  ),
  // search
  level: Type.Optional(
    Type.String({ description: "Filter by log level (error, warn, info, debug)" }),
  ),
  subsystem: Type.Optional(
    Type.String({ description: "Filter by subsystem (e.g., 'gateway', 'channels')" }),
  ),
  contains: Type.Optional(
    Type.String({ description: "Filter lines containing this text (case-insensitive)" }),
  ),
});

const MAX_LOG_BYTES = 2_000_000; // 2MB max read
const DEFAULT_LOG_LINES = 100;
const MAX_LOG_LINES = 1000;

export function createLogsTool(): AnyAgentTool {
  return {
    label: "Logs",
    name: "prime_logs",
    description:
      "Read Gimli gateway logs. Actions: tail (recent log lines), search (filter by level/subsystem/text), stats (file size and line count), path (log file location).",
    parameters: LogsToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const logSettings = getResolvedLoggerSettings();
      const logFile = logSettings.file;

      if (action === "path") {
        return jsonResult({
          ok: true,
          logFile,
          logDir: path.dirname(logFile),
          logLevel: logSettings.level,
        });
      }

      if (action === "stats") {
        try {
          const stat = await fs.stat(logFile);
          const rawLines = await readLogTail(logFile, 10000);
          return jsonResult({
            ok: true,
            path: logFile,
            sizeBytes: stat.size,
            sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
            modifiedAt: stat.mtime.toISOString(),
            approximateLines: rawLines.length,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ ok: false, error: `Cannot read log file: ${message}` });
        }
      }

      const requestedLines =
        readNumberParam(params, "lines", { integer: true }) ?? DEFAULT_LOG_LINES;
      const limit = Math.min(Math.max(1, requestedLines), MAX_LOG_LINES);

      if (action === "tail") {
        const rawLines = await readLogTail(logFile, limit * 2);
        const parsed = rawLines
          .map(parseLogLine)
          .filter((line): line is ParsedLogLine => Boolean(line));
        const lines = parsed.slice(-limit);

        return jsonResult({
          ok: true,
          path: logFile,
          count: lines.length,
          lines: lines.map(formatLogLine),
        });
      }

      if (action === "search") {
        const levelFilter = readStringParam(params, "level")?.toLowerCase();
        const subsystemFilter = readStringParam(params, "subsystem")?.toLowerCase();
        const containsFilter = readStringParam(params, "contains")?.toLowerCase();

        // Read more lines since we're filtering
        const rawLines = await readLogTail(logFile, limit * 10);
        const parsed = rawLines
          .map(parseLogLine)
          .filter((line): line is ParsedLogLine => Boolean(line));

        const filtered = parsed.filter((line) => {
          if (levelFilter && line.level?.toLowerCase() !== levelFilter) return false;
          if (subsystemFilter && !line.subsystem?.toLowerCase().includes(subsystemFilter))
            return false;
          if (containsFilter && !line.message.toLowerCase().includes(containsFilter)) return false;
          return true;
        });

        const lines = filtered.slice(-limit);

        return jsonResult({
          ok: true,
          path: logFile,
          filters: { level: levelFilter, subsystem: subsystemFilter, contains: containsFilter },
          totalMatches: filtered.length,
          count: lines.length,
          lines: lines.map(formatLogLine),
        });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}

async function readLogTail(file: string, maxLines: number): Promise<string[]> {
  try {
    const stat = await fs.stat(file);
    const size = stat.size;
    const start = Math.max(0, size - MAX_LOG_BYTES);
    const handle = await fs.open(file, "r");

    try {
      const length = Math.max(0, size - start);
      if (length === 0) return [];

      const buffer = Buffer.alloc(length);
      const readResult = await handle.read(buffer, 0, length, start);
      const text = buffer.toString("utf8", 0, readResult.bytesRead);

      let lines = text.split("\n");
      // If we started mid-file, drop the first partial line
      if (start > 0) lines = lines.slice(1);
      // Drop trailing empty line
      if (lines.length && lines[lines.length - 1] === "") {
        lines = lines.slice(0, -1);
      }
      // Keep only last N lines
      if (lines.length > maxLines) {
        lines = lines.slice(lines.length - maxLines);
      }
      return lines;
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}

function formatLogLine(line: ParsedLogLine): Record<string, unknown> {
  return {
    time: line.time,
    level: line.level,
    subsystem: line.subsystem,
    module: line.module,
    message: line.message,
  };
}

// =============================================================================
// Memory Tool
// =============================================================================

const MEMORY_ACTIONS = ["search", "status"] as const;

const MemoryToolSchema = Type.Object({
  action: stringEnum(MEMORY_ACTIONS, {
    description: "Action: search (semantic search in memory), status (memory system status)",
  }),
  // search
  query: Type.Optional(Type.String({ description: "Search query for semantic memory search" })),
  limit: Type.Optional(Type.Number({ description: "Maximum results (default: 10)" })),
  minScore: Type.Optional(
    Type.Number({ description: "Minimum similarity score 0-1 (default: 0.3)" }),
  ),
  // Both
  agentId: Type.Optional(Type.String({ description: "Agent ID (uses default if not specified)" })),
});

export function createMemoryTool(opts?: { config?: GimliConfig }): AnyAgentTool {
  return {
    label: "Memory",
    name: "prime_memory",
    description:
      "Access the memory system (SQLite-backed vector search). Actions: search (semantic similarity search), status (memory index statistics).",
    parameters: MemoryToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = opts?.config ?? loadConfig();
      const agentId = readStringParam(params, "agentId") ?? resolveDefaultAgentId(cfg);

      const managerResult = await getMemorySearchManager({ cfg, agentId });

      if (!managerResult.manager) {
        return jsonResult({
          ok: false,
          error: `Memory system unavailable: ${managerResult.error ?? "not configured"}`,
        });
      }

      try {
        if (action === "status") {
          const status = managerResult.manager.status();
          return jsonResult({
            ok: true,
            agentId,
            status: {
              files: status.files,
              chunks: status.chunks,
              dirty: status.dirty,
              provider: status.provider,
              model: status.model,
              workspaceDir: status.workspaceDir,
              dbPath: status.dbPath,
              sources: status.sources,
              sourceCounts: status.sourceCounts,
              vector: status.vector,
              fts: status.fts,
            },
          });
        }

        if (action === "search") {
          const query = readStringParam(params, "query", { required: true });
          const limit = readNumberParam(params, "limit", { integer: true }) ?? 10;
          const minScore = readNumberParam(params, "minScore") ?? 0.3;

          const results = await managerResult.manager.search(query, {
            maxResults: limit,
            minScore,
          });

          return jsonResult({
            ok: true,
            agentId,
            query,
            count: results.length,
            results: results.map((r) => ({
              path: r.path,
              startLine: r.startLine,
              endLine: r.endLine,
              score: r.score,
              source: r.source,
              snippet: r.snippet.slice(0, 500),
            })),
          });
        }

        throw new Error(`Unknown action: ${action}`);
      } finally {
        await managerResult.manager.close();
      }
    },
  };
}

// =============================================================================
// Export all prime tools
// =============================================================================

export type PrimeToolsOptions = {
  config?: GimliConfig;
  agentSessionKey?: string;
};

/**
 * Create all prime tools for agent access to core Gimli systems.
 *
 * Prime tools provide agents with structured access to:
 * - Sessions database (list, get, search, stats)
 * - Config (get, list, snapshot, path)
 * - Logs (tail, search, stats, path)
 * - Memory (search, status)
 */
export function createPrimeTools(opts?: PrimeToolsOptions): AnyAgentTool[] {
  return [
    createSessionsTool(opts),
    createConfigTool(opts),
    createLogsTool(),
    createMemoryTool(opts),
  ];
}
