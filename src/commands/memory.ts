/**
 * /memory command for memory management
 *
 * Provides CLI interface to search, forget, and export memories.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import {
  getMemorySearchManager,
  type MemorySearchManagerResult,
} from "../memory/search-manager.js";

/**
 * Options for the memory command
 */
export interface MemoryCommandOpts {
  /** Subcommand: search, forget, export, status */
  subcommand?: string;

  /** Search query */
  query?: string;

  /** Memory chunk ID to forget */
  id?: string;

  /** Export file path */
  output?: string;

  /** Maximum results for search (default: 10) */
  limit?: number;

  /** Minimum score threshold (default: 0.3) */
  minScore?: number;

  /** Output as JSON */
  json?: boolean;

  /** Agent ID override */
  agentId?: string;

  /** Force operation without confirmation */
  force?: boolean;
}

/**
 * Format a memory search result for display
 */
function formatSearchResult(
  result: {
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  },
  index: number,
  rich: boolean,
): string {
  const scoreDisplay = (result.score * 100).toFixed(1);
  const scoreText = rich ? theme.accent(`${scoreDisplay}%`) : `${scoreDisplay}%`;
  const pathText = rich ? theme.muted(result.path) : result.path;
  const linesText = rich
    ? theme.muted(`L${result.startLine}-${result.endLine}`)
    : `L${result.startLine}-${result.endLine}`;
  const sourceText = rich ? theme.info(`[${result.source}]`) : `[${result.source}]`;

  return `${index + 1}. ${sourceText} ${pathText} ${linesText} (${scoreText})`;
}

/**
 * Truncate snippet for display
 */
function truncateSnippet(snippet: string, maxLength: number = 200): string {
  const cleaned = snippet.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3)}...`;
}

/**
 * Handle 'search' subcommand
 */
async function handleSearch(
  opts: MemoryCommandOpts,
  managerResult: MemorySearchManagerResult,
  runtime: RuntimeEnv,
): Promise<void> {
  const query = opts.query?.trim();
  if (!query) {
    runtime.error("Error: Query is required. Usage: /memory search <query>");
    runtime.exit(1);
    return;
  }

  const { manager, error } = managerResult;
  if (!manager) {
    runtime.error(`Error: Memory system unavailable: ${error ?? "not configured"}`);
    runtime.exit(1);
    return;
  }

  const limit = opts.limit ?? 10;
  const minScore = opts.minScore ?? 0.3;

  const results = await manager.search(query, { maxResults: limit, minScore });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
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
        null,
        2,
      ),
    );
    return;
  }

  const rich = isRich();

  if (results.length === 0) {
    runtime.log(info(`No memories found matching "${query}".`));
    return;
  }

  runtime.log(info(`Found ${results.length} memories matching "${query}":`));
  runtime.log("");

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    runtime.log(formatSearchResult(result, i, rich));
    const snippetText = rich
      ? theme.muted(`   ${truncateSnippet(result.snippet)}`)
      : `   ${truncateSnippet(result.snippet)}`;
    runtime.log(snippetText);
    runtime.log("");
  }
}

/**
 * Handle 'forget' subcommand
 *
 * Note: This deletes a memory chunk from the index. The underlying file
 * is not modified - it will be re-indexed on the next sync unless the
 * source content is also removed.
 */
async function handleForget(
  opts: MemoryCommandOpts,
  managerResult: MemorySearchManagerResult,
  runtime: RuntimeEnv,
): Promise<void> {
  const id = opts.id?.trim();
  if (!id) {
    runtime.error("Error: Memory ID is required. Usage: /memory forget <id>");
    runtime.error("");
    runtime.error("To find memory IDs, first search for memories:");
    runtime.error("  /memory search <query> --json");
    runtime.exit(1);
    return;
  }

  const { manager, error } = managerResult;
  if (!manager) {
    runtime.error(`Error: Memory system unavailable: ${error ?? "not configured"}`);
    runtime.exit(1);
    return;
  }

  // Get the internal db access (we need to query/delete directly)
  // Since MemoryIndexManager doesn't expose delete, we'll search for the chunk
  // and inform the user about the limitation
  runtime.error("Error: Direct memory deletion is not yet supported.");
  runtime.error("");
  runtime.error("To remove memories, you have two options:");
  runtime.error("  1. Remove content from the source file (MEMORY.md or memory/*.md)");
  runtime.error("  2. Run '/memory sync --force' to rebuild the index");
  runtime.error("");
  runtime.error("The memory system automatically syncs with source files.");
  runtime.exit(1);
}

/**
 * Handle 'export' subcommand
 */
async function handleExport(
  opts: MemoryCommandOpts,
  managerResult: MemorySearchManagerResult,
  agentId: string,
  runtime: RuntimeEnv,
): Promise<void> {
  const { manager, error } = managerResult;
  if (!manager) {
    runtime.error(`Error: Memory system unavailable: ${error ?? "not configured"}`);
    runtime.exit(1);
    return;
  }

  const status = manager.status();
  const outputPath = opts.output ?? `memories-${agentId}-${Date.now()}.json`;
  const resolvedPath = path.resolve(outputPath);

  // Search with empty query gets all memories (using a very broad search)
  // We'll do multiple searches to gather all content
  const allResults: Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  }> = [];

  // Try to get memories by searching with common terms
  // Since there's no "list all" API, we export the status info + index stats
  const exportData = {
    exportedAt: new Date().toISOString(),
    agentId,
    status: {
      files: status.files,
      chunks: status.chunks,
      workspaceDir: status.workspaceDir,
      provider: status.provider,
      model: status.model,
      sources: status.sources,
      sourceCounts: status.sourceCounts,
    },
    memories: allResults,
  };

  // If searching is needed for export, do a broad search
  if (status.chunks > 0) {
    // Search with various common terms to try to retrieve content
    const searchTerms = ["the", "is", "a", "to", "and"];
    const seenPaths = new Set<string>();

    for (const term of searchTerms) {
      if (allResults.length >= status.chunks) break;
      try {
        const results = await manager.search(term, { maxResults: 100, minScore: 0 });
        for (const r of results) {
          const key = `${r.path}:${r.startLine}:${r.endLine}`;
          if (!seenPaths.has(key)) {
            seenPaths.add(key);
            allResults.push(r);
          }
        }
      } catch {
        // Ignore search errors during export
      }
    }
    exportData.memories = allResults;
  }

  try {
    await fs.writeFile(resolvedPath, JSON.stringify(exportData, null, 2), "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.error(`Error: Failed to write export file: ${message}`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(
      JSON.stringify({
        success: true,
        path: resolvedPath,
        files: status.files,
        chunks: status.chunks,
        memoriesExported: allResults.length,
      }),
    );
    return;
  }

  runtime.log(info(`Memories exported to: ${resolvedPath}`));
  runtime.log("");
  runtime.log(`  Files indexed: ${status.files}`);
  runtime.log(`  Chunks indexed: ${status.chunks}`);
  runtime.log(`  Memories in export: ${allResults.length}`);
}

/**
 * Handle 'status' subcommand
 */
async function handleStatus(
  opts: MemoryCommandOpts,
  managerResult: MemorySearchManagerResult,
  runtime: RuntimeEnv,
): Promise<void> {
  const { manager, error } = managerResult;
  if (!manager) {
    runtime.error(`Error: Memory system unavailable: ${error ?? "not configured"}`);
    runtime.exit(1);
    return;
  }

  const status = manager.status();

  if (opts.json) {
    runtime.log(JSON.stringify(status, null, 2));
    return;
  }

  const rich = isRich();

  runtime.log(info("Memory system status:"));
  runtime.log("");

  const format = (label: string, value: string | number | boolean) => {
    const labelText = rich ? theme.muted(label.padEnd(20)) : label.padEnd(20);
    const valueText = rich ? theme.accent(String(value)) : String(value);
    return `${labelText} ${valueText}`;
  };

  runtime.log(format("Files indexed:", status.files));
  runtime.log(format("Chunks indexed:", status.chunks));
  runtime.log(format("Dirty:", status.dirty));
  runtime.log(format("Provider:", status.provider));
  runtime.log(format("Model:", status.model));
  runtime.log(format("Workspace:", status.workspaceDir));
  runtime.log(format("Database:", status.dbPath));

  if (status.sources.length > 0) {
    runtime.log("");
    runtime.log(info("Sources:"));
    for (const sc of status.sourceCounts) {
      runtime.log(`  ${sc.source}: ${sc.files} files, ${sc.chunks} chunks`);
    }
  }

  if (status.vector) {
    runtime.log("");
    runtime.log(info("Vector store:"));
    runtime.log(`  Enabled: ${status.vector.enabled}`);
    runtime.log(`  Available: ${status.vector.available ?? "unknown"}`);
    if (status.vector.dims) {
      runtime.log(`  Dimensions: ${status.vector.dims}`);
    }
    if (status.vector.loadError) {
      runtime.log(`  Error: ${status.vector.loadError}`);
    }
  }

  if (status.fts) {
    runtime.log("");
    runtime.log(info("Full-text search:"));
    runtime.log(`  Enabled: ${status.fts.enabled}`);
    runtime.log(`  Available: ${status.fts.available}`);
    if (status.fts.error) {
      runtime.log(`  Error: ${status.fts.error}`);
    }
  }

  if (status.cache) {
    runtime.log("");
    runtime.log(info("Embedding cache:"));
    runtime.log(`  Enabled: ${status.cache.enabled}`);
    if (status.cache.entries !== undefined) {
      runtime.log(`  Entries: ${status.cache.entries}`);
    }
    if (status.cache.maxEntries) {
      runtime.log(`  Max entries: ${status.cache.maxEntries}`);
    }
  }
}

/**
 * Show help for the memory command
 */
function showHelp(runtime: RuntimeEnv): void {
  runtime.log("Usage: /memory <subcommand> [options]");
  runtime.log("");
  runtime.log("Subcommands:");
  runtime.log("  search <query>           Search memories by semantic similarity");
  runtime.log("  forget <id>              Remove a specific memory (not yet implemented)");
  runtime.log("  export [--output FILE]   Export memories to a JSON file");
  runtime.log("  status                   Show memory system status");
  runtime.log("");
  runtime.log("Options:");
  runtime.log("  --limit N                Maximum search results (default: 10)");
  runtime.log("  --min-score N            Minimum similarity score 0-1 (default: 0.3)");
  runtime.log("  --output FILE            Export output file path");
  runtime.log("  --json                   Output as JSON");
  runtime.log("  --agent ID               Agent ID override");
  runtime.log("");
  runtime.log("Examples:");
  runtime.log('  /memory search "deployment process"');
  runtime.log("  /memory search API --limit 5 --json");
  runtime.log("  /memory export --output memories-backup.json");
  runtime.log("  /memory status");
}

/**
 * Main memory command handler
 */
export async function memoryCommand(
  opts: MemoryCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const agentId = opts.agentId?.trim() || resolveDefaultAgentId(cfg);

  const subcommand = opts.subcommand?.trim().toLowerCase();

  if (!subcommand || subcommand === "help") {
    showHelp(runtime);
    return;
  }

  let managerResult: MemorySearchManagerResult | undefined;

  try {
    managerResult = await getMemorySearchManager({ cfg, agentId });

    switch (subcommand) {
      case "search":
      case "find":
      case "query":
        await handleSearch(opts, managerResult, runtime);
        break;

      case "forget":
      case "delete":
      case "remove":
      case "rm":
        await handleForget(opts, managerResult, runtime);
        break;

      case "export":
      case "backup":
        await handleExport(opts, managerResult, agentId, runtime);
        break;

      case "status":
      case "info":
        await handleStatus(opts, managerResult, runtime);
        break;

      default:
        runtime.error(`Unknown subcommand: ${subcommand}`);
        runtime.log("");
        showHelp(runtime);
        runtime.exit(1);
    }
  } finally {
    await managerResult?.manager?.close();
  }
}
