/**
 * CLI command for multi-agent observability.
 * Shows all agents, their context, and their work in real-time.
 */

import { loadConfig } from "../config/config.js";
import {
  getMultiAgentObservabilitySnapshot,
  type AgentRunSnapshot,
} from "../agents/agent-activity.js";
import { listAgentsForGateway } from "../gateway/session-utils.js";
import { getAgentLocalStatuses } from "./status-all/agents.js";
import type { RuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { renderTable, type TableColumn } from "../terminal/table.js";

export type AgentsObserveOptions = {
  json?: boolean;
  active?: boolean;
  agent?: string;
  limit?: number;
  window?: number;
  watch?: boolean;
};

type AgentObserveSummary = {
  ts: number;
  agents: Array<{
    id: string;
    name?: string;
    isDefault: boolean;
    sessionsCount: number;
    lastActiveAgeMs?: number | null;
    activeRuns: number;
    completedRuns: number;
    failedRuns: number;
    runs: AgentRunSnapshot[];
  }>;
  totalActiveRuns: number;
  totalAgents: number;
};

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatAgeMs(ageMs: number | null | undefined): string {
  if (ageMs === null || ageMs === undefined) return "never";
  return formatDuration(ageMs) + " ago";
}

function formatStatus(status: string): string {
  switch (status) {
    case "running":
      return theme.info("running");
    case "pending":
      return theme.warn("pending");
    case "completed":
      return theme.success("completed");
    case "failed":
      return theme.error("failed");
    case "aborted":
      return theme.warn("aborted");
    default:
      return status;
  }
}

function formatRunRow(run: AgentRunSnapshot): Record<string, string> {
  const now = Date.now();
  const duration = run.status === "running" ? now - run.startedAt : run.durationMs;
  return {
    runId: run.runId.slice(0, 8),
    status: formatStatus(run.status),
    duration: formatDuration(duration),
    task: run.task ?? run.inputPreview ?? "-",
    tool: run.currentTool ?? "-",
    model: run.model ?? "-",
    events: String(run.eventCount),
    tools: String(run.toolCallCount),
  };
}

async function buildObserveSummary(opts: AgentsObserveOptions): Promise<AgentObserveSummary> {
  const cfg = loadConfig();
  const now = Date.now();

  // Get configured agents.
  const gatewayAgents = listAgentsForGateway(cfg);
  const localStatuses = await getAgentLocalStatuses(cfg);

  // Get activity snapshot.
  const activitySnapshot = getMultiAgentObservabilitySnapshot({
    agentIds: opts.agent ? [opts.agent] : undefined,
    activeOnly: opts.active,
    windowMinutes: opts.window ?? 30,
    limitPerAgent: opts.limit ?? 10,
    includeSubagents: true,
  });

  // Map activity by agent ID.
  const activityByAgent = new Map(activitySnapshot.agents.map((a) => [a.agentId, a]));

  // Build summary merging config + local status + activity.
  const agents = gatewayAgents.agents
    .filter((a) => !opts.agent || a.id === opts.agent)
    .map((agent) => {
      const local = localStatuses.agents.find((l) => l.id === agent.id);
      const activity = activityByAgent.get(agent.id);

      return {
        id: agent.id,
        name: agent.name ?? agent.identity?.name,
        isDefault: agent.id === gatewayAgents.defaultId,
        sessionsCount: local?.sessionsCount ?? 0,
        lastActiveAgeMs: local?.lastActiveAgeMs ?? null,
        activeRuns: activity?.activeRuns ?? 0,
        completedRuns: activity?.completedRuns ?? 0,
        failedRuns: activity?.failedRuns ?? 0,
        runs: activity?.runs ?? [],
      };
    });

  // Sort by activity (active runs first, then by last activity).
  agents.sort((a, b) => {
    if (a.activeRuns !== b.activeRuns) return b.activeRuns - a.activeRuns;
    const aAge = a.lastActiveAgeMs ?? Number.MAX_SAFE_INTEGER;
    const bAge = b.lastActiveAgeMs ?? Number.MAX_SAFE_INTEGER;
    return aAge - bAge;
  });

  return {
    ts: now,
    agents,
    totalActiveRuns: activitySnapshot.totalActiveRuns,
    totalAgents: agents.length,
  };
}

function renderTextOutput(summary: AgentObserveSummary, _opts: AgentsObserveOptions): string {
  const lines: string[] = [];

  // Header.
  lines.push(theme.heading("Agent Observability"));
  lines.push("");
  lines.push(
    `${theme.accent("Active Runs:")} ${summary.totalActiveRuns}  ${theme.accent("Agents:")} ${summary.totalAgents}`,
  );
  lines.push("");

  if (summary.agents.length === 0) {
    lines.push(theme.muted("No agents configured."));
    return lines.join("\n");
  }

  // Agent summary table.
  const agentColumns: TableColumn[] = [
    { key: "agent", header: "Agent", minWidth: 12, flex: true },
    { key: "status", header: "Status", minWidth: 10 },
    { key: "sessions", header: "Sessions", align: "right", minWidth: 8 },
    { key: "active", header: "Active", align: "right", minWidth: 6 },
    { key: "completed", header: "Done", align: "right", minWidth: 6 },
    { key: "failed", header: "Failed", align: "right", minWidth: 6 },
    { key: "lastActive", header: "Last Active", minWidth: 12 },
  ];

  const agentRows = summary.agents.map((agent) => ({
    agent: agent.isDefault ? `${agent.id} ${theme.muted("(default)")}` : agent.id,
    status:
      agent.activeRuns > 0 ? theme.info(`${agent.activeRuns} running`) : theme.success("idle"),
    sessions: String(agent.sessionsCount),
    active: String(agent.activeRuns),
    completed: String(agent.completedRuns),
    failed: agent.failedRuns > 0 ? theme.error(String(agent.failedRuns)) : "0",
    lastActive: formatAgeMs(agent.lastActiveAgeMs),
  }));

  lines.push(renderTable({ columns: agentColumns, rows: agentRows, border: "unicode" }));
  lines.push("");

  // Per-agent run details (if any active or recent runs).
  for (const agent of summary.agents) {
    if (agent.runs.length === 0) continue;

    lines.push(theme.heading(`Runs for ${agent.id}`));

    const runColumns: TableColumn[] = [
      { key: "runId", header: "Run ID", minWidth: 8 },
      { key: "status", header: "Status", minWidth: 10 },
      { key: "duration", header: "Duration", align: "right", minWidth: 8 },
      { key: "task", header: "Task", minWidth: 20, flex: true, maxWidth: 40 },
      { key: "tool", header: "Current Tool", minWidth: 12 },
      { key: "events", header: "Events", align: "right", minWidth: 6 },
      { key: "tools", header: "Tools", align: "right", minWidth: 6 },
    ];

    const runRows = agent.runs.map(formatRunRow);
    lines.push(renderTable({ columns: runColumns, rows: runRows, border: "unicode" }));
    lines.push("");
  }

  // If no runs displayed, show a message.
  const hasRuns = summary.agents.some((a) => a.runs.length > 0);
  if (!hasRuns) {
    lines.push(theme.muted("No recent runs in the observation window."));
  }

  return lines.join("\n");
}

export async function agentsObserveCommand(
  opts: AgentsObserveOptions,
  runtime: RuntimeEnv,
): Promise<void> {
  const summary = await buildObserveSummary(opts);

  if (opts.json) {
    runtime.log(JSON.stringify(summary, null, 2));
    return;
  }

  const output = renderTextOutput(summary, opts);
  runtime.log(output);
}

/**
 * Get raw observability data for programmatic use.
 */
export async function getAgentsObserveData(
  opts?: AgentsObserveOptions,
): Promise<AgentObserveSummary> {
  return buildObserveSummary(opts ?? {});
}
