/**
 * Prime CLI - Tool access for TAC orchestrator agents
 *
 * Registers the `gimli prime` command with subcommands for:
 * - db: Database and memory system access
 * - config: Configuration access
 * - logs: Log file access
 */

import type { Command } from "commander";

import { primeCommand, type PrimeCommandOpts } from "../commands/prime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";

export function registerPrimeCli(program: Command) {
  const prime = program
    .command("prime")
    .description("Tool access for TAC orchestrator agents (database, config, logs)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/prime", "docs.gimli.bot/cli/prime")}\n`,
    );

  // ─────────────────────────────────────────────────────────────────────────
  // DB Subcommand
  // ─────────────────────────────────────────────────────────────────────────

  const db = prime
    .command("db")
    .description("Database and memory system access")
    .addHelpText(
      "after",
      () => `
Actions:
  status     Get memory system status
  search     Search memory database
  sessions   List session transcripts

Examples:
  gimli prime db status
  gimli prime db search "deployment"
  gimli prime db sessions --limit 10
`,
    );

  db.command("status")
    .description("Get memory system status")
    .option("--agent <id>", "Agent ID override")
    .option("--json", "Output as JSON")
    .action(async (opts: { agent?: string; json?: boolean }) => {
      await primeCommand({
        subcommand: "db",
        action: "status",
        agentId: opts.agent,
        json: opts.json,
      });
    });

  db.command("search")
    .description("Search memory database")
    .argument("[query]", "Search query")
    .option("--query <query>", "Search query (alternative)")
    .option("--limit <n>", "Maximum results", (v) => Number.parseInt(v, 10))
    .option("--agent <id>", "Agent ID override")
    .option("--json", "Output as JSON")
    .action(
      async (
        queryArg: string | undefined,
        opts: Omit<PrimeCommandOpts, "subcommand" | "action">,
      ) => {
        await primeCommand({
          subcommand: "db",
          action: "search",
          query: queryArg || opts.query,
          limit: opts.limit,
          agentId: opts.agentId,
          json: opts.json,
        });
      },
    );

  db.command("sessions")
    .description("List session transcripts")
    .option("--limit <n>", "Maximum sessions to list", (v) => Number.parseInt(v, 10))
    .option("--agent <id>", "Agent ID override")
    .option("--json", "Output as JSON")
    .action(async (opts: { limit?: number; agent?: string; json?: boolean }) => {
      await primeCommand({
        subcommand: "db",
        action: "sessions",
        limit: opts.limit,
        agentId: opts.agent,
        json: opts.json,
      });
    });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Subcommand
  // ─────────────────────────────────────────────────────────────────────────

  const config = prime
    .command("config")
    .description("Configuration access")
    .addHelpText(
      "after",
      () => `
Actions:
  get      Get a config value by key path
  list     List config sections
  paths    Show important config paths

Examples:
  gimli prime config get gateway.mode
  gimli prime config list
  gimli prime config list --verbose
  gimli prime config paths
`,
    );

  config
    .command("get")
    .description("Get a config value by key path")
    .argument("[key]", "Config key path (e.g., gateway.mode)")
    .option("--key <path>", "Config key path (alternative)")
    .option("--json", "Output as JSON")
    .action(async (keyArg: string | undefined, opts: { key?: string; json?: boolean }) => {
      await primeCommand({
        subcommand: "config",
        action: "get",
        key: keyArg || opts.key,
        json: opts.json,
      });
    });

  config
    .command("list")
    .description("List config sections")
    .option("--verbose", "Include full config (redacted)")
    .option("--json", "Output as JSON")
    .action(async (opts: { verbose?: boolean; json?: boolean }) => {
      await primeCommand({
        subcommand: "config",
        action: "list",
        verbose: opts.verbose,
        json: opts.json,
      });
    });

  config
    .command("paths")
    .description("Show important config paths")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await primeCommand({
        subcommand: "config",
        action: "paths",
        json: opts.json,
      });
    });

  // ─────────────────────────────────────────────────────────────────────────
  // Logs Subcommand
  // ─────────────────────────────────────────────────────────────────────────

  const logs = prime
    .command("logs")
    .description("Log file access")
    .addHelpText(
      "after",
      () => `
Actions:
  tail     Tail recent log lines
  search   Search logs for a pattern
  info     Get log file info

Examples:
  gimli prime logs tail
  gimli prime logs tail --lines 100 --level error
  gimli prime logs search "memory"
  gimli prime logs info
`,
    );

  logs
    .command("tail")
    .description("Tail recent log lines")
    .option("--lines <n>", "Number of lines", (v) => Number.parseInt(v, 10))
    .option("--level <level>", "Filter by log level")
    .option("--subsystem <name>", "Filter by subsystem")
    .option("--json", "Output as JSON")
    .action(
      async (opts: { lines?: number; level?: string; subsystem?: string; json?: boolean }) => {
        await primeCommand({
          subcommand: "logs",
          action: "tail",
          lines: opts.lines,
          level: opts.level,
          subsystem: opts.subsystem,
          json: opts.json,
        });
      },
    );

  logs
    .command("search")
    .description("Search logs for a pattern")
    .argument("[query]", "Search query")
    .option("--query <query>", "Search query (alternative)")
    .option("--limit <n>", "Maximum results", (v) => Number.parseInt(v, 10))
    .option("--json", "Output as JSON")
    .action(
      async (
        queryArg: string | undefined,
        opts: { query?: string; limit?: number; json?: boolean },
      ) => {
        await primeCommand({
          subcommand: "logs",
          action: "search",
          query: queryArg || opts.query,
          limit: opts.limit,
          json: opts.json,
        });
      },
    );

  logs
    .command("info")
    .description("Get log file info")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      await primeCommand({
        subcommand: "logs",
        action: "info",
        json: opts.json,
      });
    });
}
