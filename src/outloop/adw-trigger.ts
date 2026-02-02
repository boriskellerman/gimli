/**
 * ADW (AI Developer Workflow) Trigger Handler.
 *
 * Implements HTTP trigger → agent execution pipeline for Phase 9.3 Grade 1.
 * This is the entry point for programmatically triggering agent workflows.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CliDeps } from "../cli/deps.js";
import { loadConfig, type GimliConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { extractHookToken, readJsonBody } from "../gateway/hooks.js";
import { resolveHookChannel, getHookChannelError } from "../gateway/hooks.js";
import { applySecurityHeaders, handleCors } from "../security/http-hardening.js";
import { classifyExternalContent } from "../security/prompt-injection.js";
import { RateLimiter } from "../security/rate-limiter.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import type {
  ADWTriggerConfig,
  ADWTriggerRequest,
  ADWTriggerResponse,
  ADWTriggerErrorResponse,
  NormalizedADWPayload,
  ADWExecutionState,
} from "./types.js";
import { executeADW } from "./adw-executor.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

const DEFAULT_ADW_PATH = "/adw";
const DEFAULT_ADW_MAX_BODY_BYTES = 512 * 1024; // 512KB for ADW payloads
const DEFAULT_ADW_TIMEOUT_SECONDS = 300; // 5 minutes default

/**
 * Resolve ADW trigger configuration from Gimli config.
 */
export function resolveADWConfig(cfg: GimliConfig): ADWTriggerConfig | null {
  const adwConfig = cfg.adw;
  if (adwConfig?.enabled !== true) return null;

  const token = adwConfig?.token?.trim();
  if (!token) {
    throw new Error("adw.enabled requires adw.token");
  }

  const rawPath = adwConfig?.path?.trim() || DEFAULT_ADW_PATH;
  const withSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  if (trimmed === "/") {
    throw new Error("adw.path may not be '/'");
  }

  const maxBodyBytes =
    adwConfig?.maxBodyBytes && adwConfig.maxBodyBytes > 0
      ? adwConfig.maxBodyBytes
      : DEFAULT_ADW_MAX_BODY_BYTES;

  const defaultTimeoutSeconds =
    adwConfig?.defaultTimeoutSeconds && adwConfig.defaultTimeoutSeconds > 0
      ? adwConfig.defaultTimeoutSeconds
      : DEFAULT_ADW_TIMEOUT_SECONDS;

  return {
    enabled: true,
    token,
    basePath: trimmed,
    maxBodyBytes,
    defaultTimeoutSeconds,
    defaultThinking: adwConfig?.defaultThinking,
    storeResults: adwConfig?.storeResults !== false,
    resultsDir: adwConfig?.resultsDir,
  };
}

/**
 * Normalize and validate an ADW trigger request payload.
 */
export function normalizeADWPayload(
  payload: Record<string, unknown>,
  config: ADWTriggerConfig,
  _gimliConfig: GimliConfig,
): { ok: true; value: NormalizedADWPayload } | { ok: false; error: string; code?: string } {
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return { ok: false, error: "message required", code: "MISSING_MESSAGE" };
  }

  const nameRaw = payload.name;
  const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : `ADW-${Date.now()}`;

  const agentIdRaw = payload.agentId;
  const agentId =
    typeof agentIdRaw === "string" && agentIdRaw.trim() ? agentIdRaw.trim() : undefined;

  const sessionKeyRaw = payload.sessionKey;
  const sessionKey =
    typeof sessionKeyRaw === "string" && sessionKeyRaw.trim()
      ? sessionKeyRaw.trim()
      : `adw:${randomUUID()}`;

  const modelRaw = payload.model;
  const model = typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
  if (modelRaw !== undefined && !model) {
    return { ok: false, error: "model must be a non-empty string", code: "INVALID_MODEL" };
  }

  const thinkingRaw = payload.thinking;
  const thinking =
    typeof thinkingRaw === "string" && thinkingRaw.trim()
      ? thinkingRaw.trim()
      : config.defaultThinking;

  const timeoutRaw = payload.timeoutSeconds;
  const timeoutSeconds =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : config.defaultTimeoutSeconds;

  const deliver = payload.deliver !== false;

  const channel = resolveHookChannel(payload.channel);
  if (!channel) {
    return { ok: false, error: getHookChannelError(), code: "INVALID_CHANNEL" };
  }

  const toRaw = payload.to;
  const to = typeof toRaw === "string" && toRaw.trim() ? toRaw.trim() : undefined;

  const wakeMode = payload.wakeMode === "next-heartbeat" ? "next-heartbeat" : "now";

  const allowUnsafeExternalContent = payload.allowUnsafeExternalContent === true;

  const metadataRaw = payload.metadata;
  const metadata =
    typeof metadataRaw === "object" && metadataRaw !== null
      ? (metadataRaw as NormalizedADWPayload["metadata"])
      : undefined;

  return {
    ok: true,
    value: {
      message,
      name,
      agentId,
      sessionKey,
      model,
      thinking,
      timeoutSeconds,
      deliver,
      channel,
      to,
      wakeMode,
      allowUnsafeExternalContent,
      metadata,
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/** In-memory store for active ADW executions (for status queries) */
const activeExecutions = new Map<string, ADWExecutionState>();

/**
 * Get the status of an ADW execution by runId.
 */
export function getADWExecutionStatus(runId: string): ADWExecutionState | undefined {
  return activeExecutions.get(runId);
}

/**
 * List active ADW executions.
 */
export function listActiveADWExecutions(): ADWExecutionState[] {
  return Array.from(activeExecutions.values());
}

export type ADWRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

/**
 * Create the ADW trigger HTTP request handler.
 *
 * This handler processes incoming ADW trigger requests, validates them,
 * and dispatches agent executions asynchronously.
 */
export function createADWRequestHandler(params: {
  deps: CliDeps;
  getADWConfig: () => ADWTriggerConfig | null;
  bindHost: string;
  port: number;
  logADW: SubsystemLogger;
  bindMode?: "loopback" | "lan" | "public";
}): ADWRequestHandler {
  const { deps, getADWConfig, bindHost, port, logADW, bindMode = "loopback" } = params;

  const rateLimiter = new RateLimiter();

  return async (req, res) => {
    const adwConfig = getADWConfig();
    if (!adwConfig) return false;

    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = adwConfig.basePath;

    // Check if this request is for the ADW endpoint
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    // Apply security headers and CORS
    applySecurityHeaders(res);
    if (!handleCors(req, res, { bindMode })) return true;

    // Rate limiting
    const clientIp = req.socket.remoteAddress ?? "unknown";
    const rateCheck = rateLimiter.checkRequest(clientIp);
    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", String(Math.ceil(rateCheck.retryAfterMs / 1000)));
      sendJson(res, 429, { ok: false, error: "Too Many Requests" });
      return true;
    }

    // Token authentication
    const { token, fromQuery } = extractHookToken(req, url);
    if (!token || token !== adwConfig.token) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" } as ADWTriggerErrorResponse);
      return true;
    }
    if (fromQuery) {
      logADW.warn(
        "ADW token provided via query parameter is deprecated for security reasons. " +
          "Use Authorization: Bearer <token> or X-Gimli-Token header instead.",
      );
    }

    // Only POST is allowed
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      sendJson(res, 405, { ok: false, error: "Method Not Allowed" } as ADWTriggerErrorResponse);
      return true;
    }

    // Parse sub-path for routing
    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");

    // Handle different endpoints
    if (subPath === "" || subPath === "trigger") {
      return await handleTriggerRequest(req, res, {
        adwConfig,
        deps,
        logADW,
      });
    }

    if (subPath === "status") {
      return await handleStatusRequest(req, res, { adwConfig, logADW });
    }

    if (subPath.startsWith("status/")) {
      const runId = subPath.slice(7);
      return handleRunStatusRequest(res, runId);
    }

    if (subPath === "list") {
      return handleListRequest(res);
    }

    sendJson(res, 404, { ok: false, error: "Not Found" } as ADWTriggerErrorResponse);
    return true;
  };
}

/**
 * Handle POST /adw/trigger - Trigger a new ADW execution.
 */
async function handleTriggerRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    adwConfig: ADWTriggerConfig;
    deps: CliDeps;
    logADW: SubsystemLogger;
  },
): Promise<boolean> {
  const { adwConfig, deps, logADW } = params;

  const body = await readJsonBody(req, adwConfig.maxBodyBytes);
  if (!body.ok) {
    const status = body.error === "payload too large" ? 413 : 400;
    sendJson(res, status, { ok: false, error: body.error } as ADWTriggerErrorResponse);
    return true;
  }

  const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
  const gimliConfig = loadConfig();

  const normalized = normalizeADWPayload(
    payload as Record<string, unknown>,
    adwConfig,
    gimliConfig,
  );
  if (!normalized.ok) {
    sendJson(res, 400, {
      ok: false,
      error: normalized.error,
      code: normalized.code,
    } as ADWTriggerErrorResponse);
    return true;
  }

  // Security: scan for prompt injection unless explicitly allowed
  if (!normalized.value.allowUnsafeExternalContent) {
    const classification = classifyExternalContent("api", normalized.value.message);
    if (!classification.processable) {
      logADW.warn(
        `ADW payload rejected: prompt injection detected (risk=${classification.riskLevel})`,
      );
      sendJson(res, 400, {
        ok: false,
        error: "payload rejected: content classified as dangerous",
        code: "PROMPT_INJECTION_DETECTED",
      } as ADWTriggerErrorResponse);
      return true;
    }
  }

  // Generate run ID and resolve agent
  const runId = randomUUID();
  const agentId = normalized.value.agentId ?? resolveDefaultAgentId(gimliConfig);
  const now = new Date();

  // Create execution state for tracking
  const executionState: ADWExecutionState = {
    runId,
    status: "pending",
    request: payload as ADWTriggerRequest,
    sessionKey: normalized.value.sessionKey,
    agentId,
    startedAt: now,
  };
  activeExecutions.set(runId, executionState);

  // Log the trigger
  logADW.info(
    `ADW triggered: runId=${runId} name=${normalized.value.name} agentId=${agentId}` +
      (normalized.value.metadata?.source ? ` source=${normalized.value.metadata.source}` : ""),
  );

  // Execute the ADW asynchronously
  void executeADW({
    runId,
    config: gimliConfig,
    adwConfig,
    payload: normalized.value,
    deps,
    logADW,
    onStatusChange: (status, result) => {
      const state = activeExecutions.get(runId);
      if (state) {
        state.status = status;
        if (result) {
          state.result = result;
          state.completedAt = new Date();
        }
      }
    },
  });

  // Return immediately with 202 Accepted
  const response: ADWTriggerResponse = {
    ok: true,
    runId,
    sessionKey: normalized.value.sessionKey,
    agentId,
    triggeredAt: now.toISOString(),
  };

  sendJson(res, 202, response);
  return true;
}

/**
 * Handle POST /adw/status - Get status of a specific run by runId in body.
 */
async function handleStatusRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    adwConfig: ADWTriggerConfig;
    logADW: SubsystemLogger;
  },
): Promise<boolean> {
  const { adwConfig } = params;

  const body = await readJsonBody(req, adwConfig.maxBodyBytes);
  if (!body.ok) {
    sendJson(res, 400, { ok: false, error: body.error } as ADWTriggerErrorResponse);
    return true;
  }

  const payload = typeof body.value === "object" && body.value !== null ? body.value : {};
  const runId = (payload as Record<string, unknown>).runId;
  if (typeof runId !== "string" || !runId.trim()) {
    sendJson(res, 400, {
      ok: false,
      error: "runId required",
      code: "MISSING_RUN_ID",
    } as ADWTriggerErrorResponse);
    return true;
  }

  return handleRunStatusRequest(res, runId.trim());
}

/**
 * Handle GET /adw/status/:runId - Get status of a specific run.
 */
function handleRunStatusRequest(res: ServerResponse, runId: string): boolean {
  const state = activeExecutions.get(runId);
  if (!state) {
    sendJson(res, 404, {
      ok: false,
      error: "Execution not found",
      code: "NOT_FOUND",
    } as ADWTriggerErrorResponse);
    return true;
  }

  const response = {
    ok: true,
    runId: state.runId,
    status: state.status,
    agentId: state.agentId,
    sessionKey: state.sessionKey,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt?.toISOString(),
    result: state.result,
  };

  sendJson(res, 200, response);
  return true;
}

/**
 * Handle POST /adw/list - List active ADW executions.
 */
function handleListRequest(res: ServerResponse): boolean {
  const executions = listActiveADWExecutions().map((state) => ({
    runId: state.runId,
    status: state.status,
    agentId: state.agentId,
    name: (state.request as ADWTriggerRequest).name,
    startedAt: state.startedAt.toISOString(),
    completedAt: state.completedAt?.toISOString(),
  }));

  sendJson(res, 200, {
    ok: true,
    count: executions.length,
    executions,
  });

  return true;
}
