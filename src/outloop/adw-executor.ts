/**
 * ADW (AI Developer Workflow) Executor.
 *
 * Executes agent turns triggered via the ADW HTTP endpoint.
 * This wraps the existing isolated agent execution with ADW-specific
 * logging, result storage, and state management.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CliDeps } from "../cli/deps.js";
import type { GimliConfig } from "../config/config.js";
import { resolveMainSessionKeyFromConfig } from "../config/sessions.js";
import { runCronIsolatedAgentTurn, type RunCronAgentTurnResult } from "../cron/isolated-agent.js";
import type { CronJob } from "../cron/types.js";
import { requestHeartbeatNow } from "../infra/heartbeat-wake.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { ADWTriggerConfig, NormalizedADWPayload, ADWExecutionResult } from "./types.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

const DEFAULT_RESULTS_DIR = ".gimli/adw-results";

/**
 * Execute an ADW (AI Developer Workflow).
 *
 * This function:
 * 1. Creates a CronJob structure for the isolated agent execution
 * 2. Runs the agent turn via runCronIsolatedAgentTurn
 * 3. Captures and stores the result
 * 4. Notifies the main session of completion
 */
export async function executeADW(params: {
  runId: string;
  config: GimliConfig;
  adwConfig: ADWTriggerConfig;
  payload: NormalizedADWPayload;
  deps: CliDeps;
  logADW: SubsystemLogger;
  onStatusChange: (status: ADWExecutionResult["status"], result?: ADWExecutionResult) => void;
}): Promise<ADWExecutionResult> {
  const { runId, config, adwConfig, payload, deps, logADW, onStatusChange } = params;

  const startTime = Date.now();
  onStatusChange("running");

  // Create a CronJob structure to leverage existing isolated agent execution
  const jobId = runId;
  const now = Date.now();
  const job: CronJob = {
    id: jobId,
    name: payload.name,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: { kind: "at", atMs: now },
    sessionTarget: "isolated",
    wakeMode: payload.wakeMode,
    agentId: payload.agentId,
    payload: {
      kind: "agentTurn",
      message: payload.message,
      model: payload.model,
      thinking: payload.thinking,
      timeoutSeconds: payload.timeoutSeconds,
      deliver: payload.deliver,
      channel: payload.channel,
      to: payload.to,
      allowUnsafeExternalContent: payload.allowUnsafeExternalContent,
    },
    state: { nextRunAtMs: now },
  };

  const mainSessionKey = resolveMainSessionKeyFromConfig();
  let result: ADWExecutionResult;

  try {
    logADW.info(`ADW executing: runId=${runId} agent=${payload.agentId ?? "default"}`);

    const agentResult = await runCronIsolatedAgentTurn({
      cfg: config,
      deps,
      job,
      message: payload.message,
      sessionKey: payload.sessionKey,
      agentId: payload.agentId,
      lane: "adw",
    });

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    result = buildExecutionResult(runId, agentResult, payload, startTime, endTime);

    // Log completion
    const logSummary = result.summary?.slice(0, 100) ?? result.status;
    logADW.info(
      `ADW completed: runId=${runId} status=${result.status} duration=${durationMs}ms summary=${logSummary}`,
    );

    // Enqueue system event to main session
    const eventPrefix =
      result.status === "ok" ? `ADW ${payload.name}` : `ADW ${payload.name} (${result.status})`;
    const eventSummary = result.summary?.trim() || result.error?.trim() || result.status;
    enqueueSystemEvent(`${eventPrefix}: ${eventSummary}`.trim(), {
      sessionKey: mainSessionKey,
    });

    // Wake main session if requested
    if (payload.wakeMode === "now") {
      requestHeartbeatNow({ reason: `adw:${runId}` });
    }

    // Store result if configured
    if (adwConfig.storeResults) {
      await storeADWResult(runId, result, adwConfig, logADW);
    }
  } catch (err) {
    const endTime = Date.now();
    const errorMessage = String(err);

    logADW.error(`ADW failed: runId=${runId} error=${errorMessage}`);

    result = {
      runId,
      status: "error",
      error: errorMessage,
      timing: {
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString(),
        durationMs: endTime - startTime,
      },
      agent: {
        agentId: payload.agentId ?? "default",
      },
    };

    // Enqueue error event
    enqueueSystemEvent(`ADW ${payload.name} (error): ${errorMessage}`, {
      sessionKey: mainSessionKey,
    });

    if (payload.wakeMode === "now") {
      requestHeartbeatNow({ reason: `adw:${runId}:error` });
    }

    if (adwConfig.storeResults) {
      await storeADWResult(runId, result, adwConfig, logADW);
    }
  }

  onStatusChange(result.status, result);
  return result;
}

/**
 * Build an ADWExecutionResult from a RunCronAgentTurnResult.
 */
function buildExecutionResult(
  runId: string,
  agentResult: RunCronAgentTurnResult,
  payload: NormalizedADWPayload,
  startTime: number,
  endTime: number,
): ADWExecutionResult {
  return {
    runId,
    status: agentResult.status,
    summary: agentResult.summary,
    outputText: agentResult.outputText,
    error: agentResult.error,
    timing: {
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
    },
    agent: {
      agentId: payload.agentId ?? "default",
      model: payload.model,
    },
  };
}

/**
 * Store an ADW execution result to disk.
 */
async function storeADWResult(
  runId: string,
  result: ADWExecutionResult,
  adwConfig: ADWTriggerConfig,
  logADW: SubsystemLogger,
): Promise<void> {
  try {
    const resultsDir = adwConfig.resultsDir ?? join(homedir(), DEFAULT_RESULTS_DIR);
    await mkdir(resultsDir, { recursive: true });

    const filename = `${runId}.json`;
    const filepath = join(resultsDir, filename);

    await writeFile(filepath, JSON.stringify(result, null, 2), "utf-8");
    logADW.debug(`ADW result stored: ${filepath}`);
  } catch (err) {
    logADW.warn(`Failed to store ADW result: ${String(err)}`);
  }
}

/**
 * Load a stored ADW execution result by runId.
 */
export async function loadADWResult(
  runId: string,
  adwConfig?: ADWTriggerConfig,
): Promise<ADWExecutionResult | null> {
  try {
    const resultsDir = adwConfig?.resultsDir ?? join(homedir(), DEFAULT_RESULTS_DIR);
    const filepath = join(resultsDir, `${runId}.json`);
    const content = await readFile(filepath, "utf-8");
    return JSON.parse(content) as ADWExecutionResult;
  } catch {
    return null;
  }
}

/**
 * Build a simple ADW message from template variables.
 *
 * This is a helper for creating ADW messages from external triggers
 * like GitHub issues or webhooks.
 */
export function buildADWMessage(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/**
 * Create an ADW payload from a GitHub issue webhook.
 *
 * This is an example of how external triggers can be transformed
 * into ADW payloads.
 */
export function createGitHubIssueADWPayload(issue: {
  number: number;
  title: string;
  body?: string;
  url: string;
  labels?: string[];
}): NormalizedADWPayload {
  const message = buildADWMessage(
    `A GitHub issue needs attention:\n\n` +
      `**Issue #{{number}}**: {{title}}\n\n` +
      `{{body}}\n\n` +
      `URL: {{url}}`,
    {
      number: String(issue.number),
      title: issue.title,
      body: issue.body ?? "(No description provided)",
      url: issue.url,
    },
  );

  return {
    message,
    name: `GitHub Issue #${issue.number}`,
    sessionKey: `adw:github:issue:${issue.number}`,
    deliver: false,
    channel: "last",
    wakeMode: "now",
    allowUnsafeExternalContent: false,
    metadata: {
      source: "github-issue",
      externalId: String(issue.number),
      tags: issue.labels,
    },
  };
}
