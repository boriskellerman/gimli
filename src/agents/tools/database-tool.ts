import { Type } from "@sinclair/typebox";

import type { GimliConfig } from "../../config/config.js";
import { loadConfig } from "../../config/io.js";
import { MemoryIndexManager } from "../../memory/manager.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam, readNumberParam } from "./common.js";

const DATABASE_ACTIONS = ["search", "stats", "sync"] as const;

// Flattened schema to avoid anyOf issues with some providers
const DatabaseToolSchema = Type.Object({
  action: stringEnum(DATABASE_ACTIONS, {
    description:
      "Action: search (semantic memory search), stats (index statistics), sync (trigger index sync)",
  }),
  // search params
  query: Type.Optional(Type.String({ description: "Search query for semantic memory search" })),
  maxResults: Type.Optional(Type.Number({ description: "Max results to return (default: 10)" })),
  minScore: Type.Optional(
    Type.Number({ description: "Min similarity score threshold (0-1, default: 0.5)" }),
  ),
  // common params
  agentId: Type.Optional(Type.String({ description: "Target agent ID (default: current agent)" })),
});

/**
 * Database tool for agent access to Gimli's memory/vector search system.
 * Provides semantic search, statistics, and sync operations.
 */
export function createDatabaseTool(opts?: {
  agentSessionKey?: string;
  config?: GimliConfig;
}): AnyAgentTool {
  return {
    label: "Database",
    name: "database",
    description:
      "Access Gimli's memory database for semantic search and statistics. Use 'search' to find relevant memories by semantic similarity, 'stats' to view index info (files, chunks, providers), 'sync' to trigger a manual index synchronization.",
    parameters: DatabaseToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = opts?.config ?? loadConfig();

      // Resolve agent ID from session key or params
      const agentIdParam = readStringParam(params, "agentId");
      let agentId = agentIdParam ?? "default";
      if (!agentIdParam && opts?.agentSessionKey) {
        // Extract agent ID from session key (format: agent:<agentId>:...)
        const match = opts.agentSessionKey.match(/^agent:([^:]+):/);
        if (match) agentId = match[1];
      }

      if (action === "search") {
        const query = readStringParam(params, "query", { required: true });
        const maxResults = readNumberParam(params, "maxResults") ?? 10;
        const minScore = readNumberParam(params, "minScore") ?? 0.5;

        const manager = await MemoryIndexManager.get({ cfg, agentId });
        if (!manager) {
          return jsonResult({
            ok: false,
            error: "Memory search not configured for this agent",
            hint: "Enable memory search in config: agents.<agentId>.memory.search.enabled=true",
          });
        }

        try {
          const results = await manager.search(query, {
            maxResults,
            minScore,
            sessionKey: opts?.agentSessionKey,
          });

          return jsonResult({
            ok: true,
            action: "search",
            query,
            resultCount: results.length,
            results: results.map((r) => ({
              path: r.path,
              startLine: r.startLine,
              endLine: r.endLine,
              score: Math.round(r.score * 1000) / 1000,
              source: r.source,
              snippet: r.snippet.slice(0, 500),
            })),
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "stats") {
        const manager = await MemoryIndexManager.get({ cfg, agentId });
        if (!manager) {
          return jsonResult({
            ok: false,
            error: "Memory search not configured for this agent",
          });
        }

        try {
          const status = manager.status();
          return jsonResult({
            ok: true,
            action: "stats",
            agentId,
            stats: {
              files: status.files,
              chunks: status.chunks,
              dirty: status.dirty,
              workspaceDir: status.workspaceDir,
              dbPath: status.dbPath,
              provider: status.provider,
              model: status.model,
              sources: status.sources,
              sourceCounts: status.sourceCounts,
              cache: status.cache,
              fts: status.fts,
              vector: status.vector,
            },
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to get stats: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "sync") {
        const manager = await MemoryIndexManager.get({ cfg, agentId });
        if (!manager) {
          return jsonResult({
            ok: false,
            error: "Memory search not configured for this agent",
          });
        }

        try {
          await manager.sync({ reason: "tool-sync" });
          const status = manager.status();
          return jsonResult({
            ok: true,
            action: "sync",
            agentId,
            synced: {
              files: status.files,
              chunks: status.chunks,
              dirty: status.dirty,
            },
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
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
