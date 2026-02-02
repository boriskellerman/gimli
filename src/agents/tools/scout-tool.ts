/**
 * Scout Tool
 *
 * Agent tool for running scout agents to research the codebase.
 */

import { Type } from "@sinclair/typebox";

import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringParam } from "./common.js";
import {
  runScout,
  getScoutResult,
  listScoutRuns,
  cancelScout,
  getScoutStats,
  type ScoutType,
  type ScoutDepth,
} from "../scout/index.js";

const ScoutTypeEnum = stringEnum([
  "architecture",
  "dependency",
  "pattern",
  "test",
  "api",
  "security",
  "feature",
  "bug",
] as const);

const ScoutDepthEnum = stringEnum(["quick", "medium", "deep"] as const);

const ScoutToolSchema = Type.Object({
  action: stringEnum(["run", "status", "list", "cancel", "stats"] as const),
  type: Type.Optional(ScoutTypeEnum),
  query: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
  depth: Type.Optional(ScoutDepthEnum),
  scoutId: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
});

/**
 * Create the scout tool for agents.
 */
export function createScoutTool(opts?: { agentSessionKey?: string }): AnyAgentTool {
  return {
    label: "Scout",
    name: "scout",
    description: `Research the codebase before building. Spawn scout agents to investigate architecture, dependencies, patterns, and tests.

Actions:
- run: Run a scout with the specified type and query
- status: Get status of a specific scout by ID
- list: List recent scout runs
- cancel: Cancel a running scout
- stats: Get scout usage statistics

Scout Types:
- architecture: Investigate code structure and patterns
- dependency: Analyze dependencies and packages
- pattern: Discover coding conventions
- test: Analyze test coverage and patterns
- api: Investigate API design
- security: Security-focused analysis
- feature: Composite scout for feature planning (runs multiple scouts)
- bug: Composite scout for bug investigation`,
    parameters: ScoutToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const requesterSessionKey = opts?.agentSessionKey || "unknown";

      switch (action) {
        case "run": {
          const type = readStringParam(params, "type", {
            required: true,
          }) as ScoutType;
          const query = readStringParam(params, "query", { required: true });
          const scope = readStringParam(params, "scope");
          const depthRaw = readStringParam(params, "depth");
          const depth = (depthRaw as ScoutDepth) || "medium";

          try {
            const result = await runScout(
              {
                type,
                query,
                scope: scope || undefined,
                depth,
              },
              requesterSessionKey,
            );

            return jsonResult({
              status: "success",
              scoutId: result.id,
              scoutType: result.type,
              scoutStatus: result.status,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              childScouts: result.childScouts,
              findings: result.findings,
              error: result.error,
            });
          } catch (err) {
            return jsonResult({
              status: "error",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        case "status": {
          const scoutId = readStringParam(params, "scoutId", { required: true });
          const result = getScoutResult(scoutId);

          if (!result) {
            return jsonResult({
              status: "not_found",
              error: `Scout ${scoutId} not found`,
            });
          }

          return jsonResult({
            status: "success",
            scout: {
              id: result.id,
              type: result.type,
              query: result.query,
              scope: result.scope,
              status: result.status,
              startedAt: result.startedAt,
              endedAt: result.endedAt,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              childScouts: result.childScouts,
              findings: result.findings,
              error: result.error,
            },
          });
        }

        case "list": {
          const typeRaw = readStringParam(params, "type");
          const limit = typeof params.limit === "number" ? Math.floor(params.limit) : 10;

          const runs = listScoutRuns({
            type: typeRaw as ScoutType | undefined,
            limit,
          });

          return jsonResult({
            status: "success",
            count: runs.length,
            scouts: runs.map((r) => ({
              id: r.id,
              type: r.type,
              query: r.query,
              status: r.status,
              startedAt: r.startedAt,
              durationMs: r.durationMs,
              costUsd: r.costUsd,
            })),
          });
        }

        case "cancel": {
          const scoutId = readStringParam(params, "scoutId", { required: true });
          const cancelled = await cancelScout(scoutId);

          return jsonResult({
            status: cancelled ? "cancelled" : "not_found",
            scoutId,
          });
        }

        case "stats": {
          const stats = getScoutStats();

          return jsonResult({
            status: "success",
            stats: {
              total: stats.total,
              byStatus: stats.byStatus,
              byType: stats.byType,
              avgDurationByType: stats.avgDurationByType,
              avgCostByType: stats.avgCostByType,
              totalCostUsd: stats.totalCostUsd,
            },
          });
        }

        default:
          return jsonResult({
            status: "error",
            error: `Unknown action: ${action}`,
          });
      }
    },
  };
}
