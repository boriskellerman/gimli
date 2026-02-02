/**
 * Prime Commands - Tool access for TAC orchestrator agents
 *
 * Prime commands provide safe, controlled access to Gimli infrastructure
 * for autonomous agents. This includes:
 * - Database access (memory system, session data)
 * - Config access (read/query configuration)
 * - Logs access (query and search logs)
 *
 * These commands are designed for programmatic use by agents, with JSON
 * output support and structured error handling.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig, resolveStateDir, type GimliConfig } from "../config/config.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getMemorySearchManager } from "../memory/search-manager.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";

const log = createSubsystemLogger("prime");

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PrimeCommandOpts {
  /** Subcommand: db, config, logs */
  subcommand?: string;

  /** Sub-subcommand for nested operations */
  action?: string;

  /** Query string for search operations */
  query?: string;

  /** Config key path (e.g., "gateway.mode") */
  key?: string;

  /** Maximum results for search (default: 10) */
  limit?: number;

  /** Output as JSON */
  json?: boolean;

  /** Agent ID override */
  agentId?: string;

  /** Include detailed/verbose output */
  verbose?: boolean;

  /** Log level filter */
  level?: string;

  /** Log subsystem filter */
  subsystem?: string;

  /** Number of log lines to tail */
  lines?: number;
}

export interface PrimeResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Database Commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle database operations
 */
async function handleDb(
  opts: PrimeCommandOpts,
  cfg: GimliConfig,
  agentId: string,
  runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const action = opts.action?.trim().toLowerCase();

  switch (action) {
    case "status":
      return await handleDbStatus(opts, cfg, agentId, runtime);
    case "search":
      return await handleDbSearch(opts, cfg, agentId, runtime);
    case "sessions":
      return await handleDbSessions(opts, cfg, agentId, runtime);
    default:
      return {
        success: false,
        error: `Unknown db action: ${action}. Available: status, search, sessions`,
      };
  }
}

/**
 * Get database/memory system status
 */
async function handleDbStatus(
  opts: PrimeCommandOpts,
  cfg: GimliConfig,
  agentId: string,
  _runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const managerResult = await getMemorySearchManager({ cfg, agentId });

  if (!managerResult.manager) {
    return {
      success: false,
      error: managerResult.error ?? "Memory system unavailable",
    };
  }

  try {
    const status = managerResult.manager.status();
    return {
      success: true,
      data: {
        type: "db_status",
        agentId,
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
        cache: status.cache,
      },
    };
  } finally {
    await managerResult.manager.close();
  }
}

/**
 * Search memory database
 */
async function handleDbSearch(
  opts: PrimeCommandOpts,
  cfg: GimliConfig,
  agentId: string,
  _runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const query = opts.query?.trim();
  if (!query) {
    return {
      success: false,
      error: "Query is required for db search",
    };
  }

  const managerResult = await getMemorySearchManager({ cfg, agentId });

  if (!managerResult.manager) {
    return {
      success: false,
      error: managerResult.error ?? "Memory system unavailable",
    };
  }

  try {
    const limit = opts.limit ?? 10;
    const results = await managerResult.manager.search(query, {
      maxResults: limit,
      minScore: 0.3,
    });

    return {
      success: true,
      data: {
        type: "db_search",
        query,
        count: results.length,
        results: results.map((r) => ({
          path: r.path,
          startLine: r.startLine,
          endLine: r.endLine,
          score: r.score,
          snippet: r.snippet,
          source: r.source,
        })),
      },
    };
  } finally {
    await managerResult.manager.close();
  }
}

/**
 * List and query session data
 */
async function handleDbSessions(
  opts: PrimeCommandOpts,
  _cfg: GimliConfig,
  agentId: string,
  _runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId);

  try {
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
    const sessionFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => entry.name);

    const limit = opts.limit ?? 20;
    const recentFiles = sessionFiles.slice(-limit);

    // Get file stats for recent sessions
    const sessions = await Promise.all(
      recentFiles.map(async (filename) => {
        const filepath = path.join(sessionsDir, filename);
        try {
          const stat = await fs.stat(filepath);
          return {
            filename,
            path: filepath,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        } catch {
          return { filename, path: filepath, error: "stat failed" };
        }
      }),
    );

    return {
      success: true,
      data: {
        type: "db_sessions",
        agentId,
        sessionsDir,
        totalCount: sessionFiles.length,
        sessions,
      },
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        success: true,
        data: {
          type: "db_sessions",
          agentId,
          sessionsDir,
          totalCount: 0,
          sessions: [],
        },
      };
    }
    return {
      success: false,
      error: `Failed to read sessions directory: ${code ?? String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle config operations
 */
async function handleConfig(
  opts: PrimeCommandOpts,
  cfg: GimliConfig,
  _agentId: string,
  _runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const action = opts.action?.trim().toLowerCase();

  switch (action) {
    case "get":
      return handleConfigGet(opts, cfg);
    case "list":
      return handleConfigList(opts, cfg);
    case "paths":
      return handleConfigPaths();
    default:
      return {
        success: false,
        error: `Unknown config action: ${action}. Available: get, list, paths`,
      };
  }
}

/**
 * Get a specific config value by key path
 */
function handleConfigGet(opts: PrimeCommandOpts, cfg: GimliConfig): PrimeResult {
  const key = opts.key?.trim();
  if (!key) {
    return {
      success: false,
      error: "Key path is required for config get (e.g., gateway.mode)",
    };
  }

  // Navigate the config object by key path
  const parts = key.split(".");
  let value: unknown = cfg;

  for (const part of parts) {
    if (value === null || value === undefined) {
      return {
        success: true,
        data: {
          type: "config_get",
          key,
          value: undefined,
          exists: false,
        },
      };
    }
    if (typeof value !== "object") {
      return {
        success: true,
        data: {
          type: "config_get",
          key,
          value: undefined,
          exists: false,
        },
      };
    }
    value = (value as Record<string, unknown>)[part];
  }

  return {
    success: true,
    data: {
      type: "config_get",
      key,
      value,
      exists: value !== undefined,
    },
  };
}

/**
 * List top-level config sections
 */
function handleConfigList(opts: PrimeCommandOpts, cfg: GimliConfig): PrimeResult {
  const verbose = Boolean(opts.verbose);

  if (verbose) {
    // Return full config (redacted for safety)
    const redactedConfig = redactSensitiveConfig(cfg);
    return {
      success: true,
      data: {
        type: "config_list",
        config: redactedConfig,
      },
    };
  }

  // Return just the top-level keys
  const sections = Object.keys(cfg).filter((key) => cfg[key as keyof GimliConfig] !== undefined);

  return {
    success: true,
    data: {
      type: "config_list",
      sections,
    },
  };
}

/**
 * Get important config/state paths
 */
function handleConfigPaths(): PrimeResult {
  const stateDir = resolveStateDir(process.env, require("node:os").homedir);
  const configPath = path.join(stateDir, "gimli.json");
  const credentialsDir = path.join(stateDir, "credentials");
  const agentsDir = path.join(stateDir, "agents");

  return {
    success: true,
    data: {
      type: "config_paths",
      stateDir,
      configPath,
      credentialsDir,
      agentsDir,
    },
  };
}

/**
 * Redact sensitive values from config for safe output
 */
function redactSensitiveConfig(cfg: GimliConfig): Record<string, unknown> {
  const REDACTED = "[REDACTED]";
  const sensitiveKeys = [
    "token",
    "secret",
    "password",
    "key",
    "apiKey",
    "authToken",
    "accessToken",
    "refreshToken",
  ];

  function redact(obj: unknown, depth = 0): unknown {
    if (depth > 10) return obj; // Prevent infinite recursion
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== "object") return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => redact(item, depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some((sensitive) =>
        lowerKey.includes(sensitive.toLowerCase()),
      );

      if (isSensitive && typeof value === "string" && value.length > 0) {
        result[key] = REDACTED;
      } else if (typeof value === "object" && value !== null) {
        result[key] = redact(value, depth + 1);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return redact(cfg) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logs Commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle logs operations
 */
async function handleLogs(
  opts: PrimeCommandOpts,
  _cfg: GimliConfig,
  _agentId: string,
  _runtime: RuntimeEnv,
): Promise<PrimeResult> {
  const action = opts.action?.trim().toLowerCase();

  switch (action) {
    case "tail":
      return await handleLogsTail(opts);
    case "search":
      return await handleLogsSearch(opts);
    case "info":
      return handleLogsInfo();
    default:
      return {
        success: false,
        error: `Unknown logs action: ${action}. Available: tail, search, info`,
      };
  }
}

/**
 * Get log file info
 */
function handleLogsInfo(): PrimeResult {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = `/tmp/gimli-${today}.log`;

  return {
    success: true,
    data: {
      type: "logs_info",
      logFile,
      logDir: "/tmp",
      pattern: "gimli-YYYY-MM-DD.log",
    },
  };
}

/**
 * Tail recent log lines
 */
async function handleLogsTail(opts: PrimeCommandOpts): Promise<PrimeResult> {
  const today = new Date().toISOString().slice(0, 10);
  const logFile = `/tmp/gimli-${today}.log`;
  const lines = opts.lines ?? 50;

  try {
    const content = await fs.readFile(logFile, "utf-8");
    const allLines = content.split("\n").filter((line) => line.trim().length > 0);
    const tailLines = allLines.slice(-lines);

    // Parse log lines
    const parsedLines = tailLines.map((line) => {
      try {
        const parsed = JSON.parse(line);
        return {
          raw: line,
          parsed: {
            time: parsed.time ?? parsed.date,
            level: parsed.level ?? parsed.severity,
            subsystem: parsed.subsystem ?? parsed.module,
            message: parsed.message ?? parsed.msg,
          },
        };
      } catch {
        return { raw: line, parsed: null };
      }
    });

    // Apply filters if specified
    let filteredLines = parsedLines;
    if (opts.level) {
      const targetLevel = opts.level.toLowerCase();
      filteredLines = filteredLines.filter((l) => l.parsed?.level?.toLowerCase() === targetLevel);
    }
    if (opts.subsystem) {
      const targetSubsystem = opts.subsystem.toLowerCase();
      filteredLines = filteredLines.filter((l) =>
        l.parsed?.subsystem?.toLowerCase().includes(targetSubsystem),
      );
    }

    return {
      success: true,
      data: {
        type: "logs_tail",
        logFile,
        totalLines: allLines.length,
        returnedLines: filteredLines.length,
        lines: filteredLines,
      },
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        success: true,
        data: {
          type: "logs_tail",
          logFile,
          totalLines: 0,
          returnedLines: 0,
          lines: [],
          note: "Log file not found (no logs for today yet)",
        },
      };
    }
    return {
      success: false,
      error: `Failed to read log file: ${code ?? String(err)}`,
    };
  }
}

/**
 * Search logs for a pattern
 */
async function handleLogsSearch(opts: PrimeCommandOpts): Promise<PrimeResult> {
  const query = opts.query?.trim();
  if (!query) {
    return {
      success: false,
      error: "Query is required for logs search",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const logFile = `/tmp/gimli-${today}.log`;
  const limit = opts.limit ?? 50;

  try {
    const content = await fs.readFile(logFile, "utf-8");
    const allLines = content.split("\n").filter((line) => line.trim().length > 0);

    // Search for query in log lines (case-insensitive)
    const queryLower = query.toLowerCase();
    const matches = allLines
      .filter((line) => line.toLowerCase().includes(queryLower))
      .slice(-limit);

    const parsedMatches = matches.map((line, index) => {
      try {
        const parsed = JSON.parse(line);
        return {
          index,
          raw: line,
          parsed: {
            time: parsed.time ?? parsed.date,
            level: parsed.level ?? parsed.severity,
            subsystem: parsed.subsystem ?? parsed.module,
            message: parsed.message ?? parsed.msg,
          },
        };
      } catch {
        return { index, raw: line, parsed: null };
      }
    });

    return {
      success: true,
      data: {
        type: "logs_search",
        query,
        logFile,
        totalMatches: matches.length,
        matches: parsedMatches,
      },
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        success: true,
        data: {
          type: "logs_search",
          query,
          logFile,
          totalMatches: 0,
          matches: [],
          note: "Log file not found (no logs for today yet)",
        },
      };
    }
    return {
      success: false,
      error: `Failed to search log file: ${code ?? String(err)}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Help & Output
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Show help for the prime command
 */
function showHelp(runtime: RuntimeEnv): void {
  const rich = isRich();
  const heading = (text: string) => (rich ? theme.heading(text) : text);
  const muted = (text: string) => (rich ? theme.muted(text) : text);

  runtime.log(heading("Prime Commands"));
  runtime.log(muted("Tool access for TAC orchestrator agents"));
  runtime.log("");
  runtime.log("Usage: gimli prime <subcommand> <action> [options]");
  runtime.log("");
  runtime.log(heading("Subcommands:"));
  runtime.log("");
  runtime.log("  db       Database and memory system access");
  runtime.log("    status   Get memory system status");
  runtime.log("    search   Search memory database");
  runtime.log("    sessions List session transcripts");
  runtime.log("");
  runtime.log("  config   Configuration access");
  runtime.log("    get      Get a config value by key path");
  runtime.log("    list     List config sections");
  runtime.log("    paths    Show important config paths");
  runtime.log("");
  runtime.log("  logs     Log file access");
  runtime.log("    tail     Tail recent log lines");
  runtime.log("    search   Search logs for a pattern");
  runtime.log("    info     Get log file info");
  runtime.log("");
  runtime.log(heading("Options:"));
  runtime.log("  --json               Output as JSON");
  runtime.log("  --query <query>      Search query");
  runtime.log("  --key <path>         Config key path (e.g., gateway.mode)");
  runtime.log("  --limit <n>          Maximum results (default: 10)");
  runtime.log("  --lines <n>          Number of log lines (default: 50)");
  runtime.log("  --level <level>      Filter logs by level");
  runtime.log("  --subsystem <name>   Filter logs by subsystem");
  runtime.log("  --agent <id>         Agent ID override");
  runtime.log("  --verbose            Include detailed output");
  runtime.log("");
  runtime.log(heading("Examples:"));
  runtime.log("  gimli prime db status --json");
  runtime.log('  gimli prime db search --query "deployment" --limit 5');
  runtime.log("  gimli prime config get --key gateway.mode");
  runtime.log("  gimli prime config list --verbose");
  runtime.log("  gimli prime logs tail --lines 100");
  runtime.log('  gimli prime logs search --query "error" --level error');
}

/**
 * Format result for display
 */
function formatResult(result: PrimeResult, opts: PrimeCommandOpts, runtime: RuntimeEnv): void {
  if (opts.json) {
    runtime.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.success) {
    runtime.error(`Error: ${result.error}`);
    return;
  }

  const data = result.data as Record<string, unknown>;
  const rich = isRich();

  // Format based on result type
  switch (data.type) {
    case "db_status":
      formatDbStatus(data, rich, runtime);
      break;
    case "db_search":
      formatDbSearch(data, rich, runtime);
      break;
    case "db_sessions":
      formatDbSessions(data, rich, runtime);
      break;
    case "config_get":
      formatConfigGet(data, rich, runtime);
      break;
    case "config_list":
      formatConfigList(data, rich, runtime);
      break;
    case "config_paths":
      formatConfigPaths(data, rich, runtime);
      break;
    case "logs_info":
      formatLogsInfo(data, rich, runtime);
      break;
    case "logs_tail":
      formatLogsTail(data, rich, runtime);
      break;
    case "logs_search":
      formatLogsSearch(data, rich, runtime);
      break;
    default:
      runtime.log(JSON.stringify(data, null, 2));
  }
}

function formatDbStatus(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const label = (text: string) => (rich ? theme.muted(`${text}:`) : `${text}:`);
  const value = (text: string) => (rich ? theme.accent(text) : text);

  runtime.log(rich ? theme.heading("Memory System Status") : "Memory System Status");
  runtime.log("");
  runtime.log(`${label("Agent")} ${value(String(data.agentId))}`);
  runtime.log(`${label("Files")} ${value(String(data.files))}`);
  runtime.log(`${label("Chunks")} ${value(String(data.chunks))}`);
  runtime.log(`${label("Dirty")} ${value(String(data.dirty))}`);
  runtime.log(`${label("Provider")} ${value(String(data.provider))}`);
  runtime.log(`${label("Model")} ${value(String(data.model))}`);
}

function formatDbSearch(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const results = data.results as Array<Record<string, unknown>>;
  const query = String(data.query);
  runtime.log(`Found ${results.length} results for "${query}"`);
  runtime.log("");
  for (const result of results) {
    const score = ((result.score as number) * 100).toFixed(1);
    const path = result.path as string;
    const startLine = String(result.startLine);
    const endLine = String(result.endLine);
    const snippet = String(result.snippet);
    const lines = `L${startLine}-${endLine}`;
    const header = rich
      ? `${theme.success(score + "%")} ${theme.accent(path)} ${theme.muted(lines)}`
      : `${score}% ${path} ${lines}`;
    runtime.log(header);
    runtime.log(rich ? theme.muted(`  ${snippet}`) : `  ${snippet}`);
    runtime.log("");
  }
}

function formatDbSessions(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const sessions = data.sessions as Array<Record<string, unknown>>;
  const agentId = String(data.agentId);
  const totalCount = String(data.totalCount);
  runtime.log(`Sessions for agent ${agentId}: ${totalCount} total`);
  runtime.log("");
  for (const session of sessions) {
    const filename = String(session.filename);
    const modified = String(session.modified);
    const line = rich
      ? `${theme.accent(filename)} ${theme.muted(modified)}`
      : `${filename} ${modified}`;
    runtime.log(line);
  }
}

function formatConfigGet(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const key = String(data.key);
  if (!data.exists) {
    runtime.log(rich ? theme.warn(`Key not found: ${key}`) : `Key not found: ${key}`);
    return;
  }
  const rawValue = data.value;
  const valueStr =
    typeof rawValue === "object" && rawValue !== null
      ? JSON.stringify(rawValue, null, 2)
      : typeof rawValue === "string"
        ? rawValue
        : JSON.stringify(rawValue);
  runtime.log(`${key} = ${valueStr}`);
}

function formatConfigList(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  if (data.config) {
    runtime.log(JSON.stringify(data.config, null, 2));
    return;
  }
  const sections = data.sections as string[];
  runtime.log(rich ? theme.heading("Config Sections") : "Config Sections");
  for (const section of sections) {
    runtime.log(`  ${section}`);
  }
}

function formatConfigPaths(
  data: Record<string, unknown>,
  rich: boolean,
  runtime: RuntimeEnv,
): void {
  const label = (text: string) => (rich ? theme.muted(`${text}:`) : `${text}:`);
  runtime.log(rich ? theme.heading("Config Paths") : "Config Paths");
  runtime.log("");
  runtime.log(`${label("State Dir")} ${String(data.stateDir)}`);
  runtime.log(`${label("Config")} ${String(data.configPath)}`);
  runtime.log(`${label("Credentials")} ${String(data.credentialsDir)}`);
  runtime.log(`${label("Agents")} ${String(data.agentsDir)}`);
}

function formatLogsInfo(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const label = (text: string) => (rich ? theme.muted(`${text}:`) : `${text}:`);
  runtime.log(rich ? theme.heading("Log Info") : "Log Info");
  runtime.log("");
  runtime.log(`${label("Log File")} ${String(data.logFile)}`);
  runtime.log(`${label("Log Dir")} ${String(data.logDir)}`);
  runtime.log(`${label("Pattern")} ${String(data.pattern)}`);
}

function formatLogsTail(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const lines = data.lines as Array<{ raw: string; parsed: Record<string, string | null> | null }>;
  const returnedLines = String(data.returnedLines);
  const totalLines = String(data.totalLines);
  runtime.log(`Log tail: ${returnedLines}/${totalLines} lines`);
  runtime.log("");
  for (const line of lines) {
    if (line.parsed) {
      const p = line.parsed;
      const time = (p.time ?? "").slice(11, 19);
      const level = (p.level ?? "").padEnd(5);
      const subsystem = p.subsystem ?? "";
      const message = p.message ?? "";
      const formatted = rich
        ? `${theme.muted(time)} ${theme.info(level)} ${theme.accent(subsystem)} ${message}`
        : `${time} ${level} ${subsystem} ${message}`;
      runtime.log(formatted);
    } else {
      runtime.log(line.raw);
    }
  }
}

function formatLogsSearch(data: Record<string, unknown>, rich: boolean, runtime: RuntimeEnv): void {
  const matches = data.matches as Array<{
    index: number;
    raw: string;
    parsed: Record<string, string | null> | null;
  }>;
  const totalMatches = String(data.totalMatches);
  const query = String(data.query);
  runtime.log(`Found ${totalMatches} matches for "${query}"`);
  runtime.log("");
  for (const match of matches) {
    if (match.parsed) {
      const p = match.parsed;
      const time = (p.time ?? "").slice(11, 19);
      const level = (p.level ?? "").padEnd(5);
      const subsystem = p.subsystem ?? "";
      const message = p.message ?? "";
      const formatted = rich
        ? `${theme.muted(time)} ${theme.info(level)} ${theme.accent(subsystem)} ${message}`
        : `${time} ${level} ${subsystem} ${message}`;
      runtime.log(formatted);
    } else {
      runtime.log(match.raw);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Command Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main prime command handler
 */
export async function primeCommand(
  opts: PrimeCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const agentId = opts.agentId?.trim() || resolveDefaultAgentId(cfg);
  const subcommand = opts.subcommand?.trim().toLowerCase();

  if (!subcommand || subcommand === "help") {
    showHelp(runtime);
    return;
  }

  let result: PrimeResult;

  try {
    switch (subcommand) {
      case "db":
      case "database":
        result = await handleDb(opts, cfg, agentId, runtime);
        break;

      case "config":
      case "cfg":
        result = await handleConfig(opts, cfg, agentId, runtime);
        break;

      case "logs":
      case "log":
        result = await handleLogs(opts, cfg, agentId, runtime);
        break;

      default:
        result = {
          success: false,
          error: `Unknown subcommand: ${subcommand}. Available: db, config, logs`,
        };
    }
  } catch (err) {
    log.error("Prime command failed", {
      error: err instanceof Error ? err.message : String(err),
      subcommand,
    });
    result = {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  formatResult(result, opts, runtime);

  if (!result.success) {
    runtime.exit(1);
  }
}
