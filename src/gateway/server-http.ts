import {
  createServer as createHttpServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { TlsOptions } from "node:tls";
import type { WebSocketServer } from "ws";
import { handleA2uiHttpRequest } from "../canvas-host/a2ui.js";
import type { CanvasHostHandler } from "../canvas-host/server.js";
import { loadConfig } from "../config/config.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { handleSlackHttpRequest } from "../slack/http/index.js";
import { resolveAgentAvatar } from "../agents/identity-avatar.js";
import { handleControlUiAvatarRequest, handleControlUiHttpRequest } from "./control-ui.js";
import {
  extractHookToken,
  getHookChannelError,
  type HookMessageChannel,
  type HooksConfigResolved,
  normalizeAgentPayload,
  normalizeHookHeaders,
  normalizeWakePayload,
  readJsonBodyWithRaw,
  resolveHookChannel,
  resolveHookDeliver,
} from "./hooks.js";
import { isGitHubWebhook, verifyGitHubSignature } from "../hooks/github-verify.js";
import { applyHookMappings } from "./hooks-mapping.js";
import { getHookRunStore, type HookRunStatus } from "./hooks-runs.js";
import {
  getWorkflowRunStore,
  validateWorkflowConfig,
  type WorkflowRunMetadata,
} from "./hooks-workflow.js";
import { handleOpenAiHttpRequest } from "./openai-http.js";
import { handleOpenResponsesHttpRequest } from "./openresponses-http.js";
import { handleToolsInvokeHttpRequest } from "./tools-invoke-http.js";
import { RateLimiter } from "../security/rate-limiter.js";
import { applySecurityHeaders, handleCors } from "../security/http-hardening.js";
import { classifyExternalContent } from "../security/prompt-injection.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type HookDispatchers = {
  dispatchWakeHook: (value: { text: string; mode: "now" | "next-heartbeat" }) => void;
  dispatchAgentHook: (value: {
    message: string;
    name: string;
    wakeMode: "now" | "next-heartbeat";
    sessionKey: string;
    deliver: boolean;
    channel: HookMessageChannel;
    to?: string;
    model?: string;
    thinking?: string;
    timeoutSeconds?: number;
    allowUnsafeExternalContent?: boolean;
  }) => string;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export type HooksRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

export function createHooksRequestHandler(
  opts: {
    getHooksConfig: () => HooksConfigResolved | null;
    bindHost: string;
    port: number;
    logHooks: SubsystemLogger;
  } & HookDispatchers,
): HooksRequestHandler {
  const { getHooksConfig, bindHost, port, logHooks, dispatchAgentHook, dispatchWakeHook } = opts;
  return async (req, res) => {
    const hooksConfig = getHooksConfig();
    if (!hooksConfig) return false;
    const url = new URL(req.url ?? "/", `http://${bindHost}:${port}`);
    const basePath = hooksConfig.basePath;
    if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`)) {
      return false;
    }

    const { token, fromQuery } = extractHookToken(req, url);
    if (!token || token !== hooksConfig.token) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return true;
    }
    if (fromQuery) {
      logHooks.warn(
        "Hook token provided via query parameter is deprecated for security reasons. " +
          "Tokens in URLs appear in logs, browser history, and referrer headers. " +
          "Use Authorization: Bearer <token> or X-Gimli-Token header instead.",
      );
    }

    const subPath = url.pathname.slice(basePath.length).replace(/^\/+/, "");

    // Handle GET requests for run observability endpoints
    if (req.method === "GET") {
      // GET /hooks/runs - List recent runs
      if (subPath === "runs") {
        const runStore = getHookRunStore();
        const status = url.searchParams.get("status") as HookRunStatus | null;
        const name = url.searchParams.get("name") ?? undefined;
        const limitParam = url.searchParams.get("limit");
        const offsetParam = url.searchParams.get("offset");
        const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 50), 100) : 50;
        const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

        const result = runStore.listRuns({
          status: status ?? undefined,
          name,
          limit,
          offset,
        });
        sendJson(res, 200, {
          ok: true,
          runs: result.runs,
          total: result.total,
          limit,
          offset,
        });
        return true;
      }

      // GET /hooks/runs/stats - Get run statistics
      if (subPath === "runs/stats") {
        const runStore = getHookRunStore();
        const stats = runStore.getStats();
        sendJson(res, 200, { ok: true, stats });
        return true;
      }

      // GET /hooks/runs/:runId - Get specific run
      if (subPath.startsWith("runs/")) {
        const runId = subPath.slice("runs/".length);
        if (runId && !runId.includes("/")) {
          const runStore = getHookRunStore();
          const run = runStore.getRun(runId);
          if (!run) {
            sendJson(res, 404, { ok: false, error: "run not found" });
            return true;
          }
          sendJson(res, 200, { ok: true, run });
          return true;
        }
      }

      // GET /hooks/workflows - List recent workflow runs
      if (subPath === "workflows") {
        const workflowStore = getWorkflowRunStore();
        const status = url.searchParams.get("status") as WorkflowRunMetadata["status"] | null;
        const workflowId = url.searchParams.get("workflowId") ?? undefined;
        const limitParam = url.searchParams.get("limit");
        const offsetParam = url.searchParams.get("offset");
        const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10) || 50), 100) : 50;
        const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;

        const result = workflowStore.listWorkflowRuns({
          status: status ?? undefined,
          workflowId,
          limit,
          offset,
        });
        sendJson(res, 200, {
          ok: true,
          workflows: result.workflows,
          total: result.total,
          limit,
          offset,
        });
        return true;
      }

      // GET /hooks/workflows/:workflowRunId - Get specific workflow run
      if (subPath.startsWith("workflows/")) {
        const workflowRunId = subPath.slice("workflows/".length);
        if (workflowRunId && !workflowRunId.includes("/")) {
          const workflowStore = getWorkflowRunStore();
          const workflow = workflowStore.getWorkflowRun(workflowRunId);
          if (!workflow) {
            sendJson(res, 404, { ok: false, error: "workflow run not found" });
            return true;
          }
          sendJson(res, 200, { ok: true, workflow });
          return true;
        }
      }

      // Other GET requests not allowed
      res.statusCode = 405;
      res.setHeader("Allow", "POST, GET");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST, GET");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }
    if (!subPath) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return true;
    }

    const headers = normalizeHookHeaders(req);

    // Read body with raw string for signature verification
    const body = await readJsonBodyWithRaw(req, hooksConfig.maxBodyBytes);
    if (!body.ok) {
      const status = body.error === "payload too large" ? 413 : 400;
      sendJson(res, status, { ok: false, error: body.error });
      return true;
    }

    // Verify GitHub webhook signature if configured and request looks like GitHub
    if (subPath === "github" && isGitHubWebhook(headers)) {
      if (hooksConfig.githubWebhookSecret) {
        const signature = headers["x-hub-signature-256"];
        if (!verifyGitHubSignature(body.raw, signature, hooksConfig.githubWebhookSecret)) {
          logHooks.warn("GitHub webhook signature verification failed");
          res.statusCode = 401;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Invalid signature");
          return true;
        }
      }
    }

    const payload = typeof body.value === "object" && body.value !== null ? body.value : {};

    if (subPath === "wake") {
      const normalized = normalizeWakePayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      dispatchWakeHook(normalized.value);
      sendJson(res, 200, { ok: true, mode: normalized.value.mode });
      return true;
    }

    if (subPath === "agent") {
      const normalized = normalizeAgentPayload(payload as Record<string, unknown>);
      if (!normalized.ok) {
        sendJson(res, 400, { ok: false, error: normalized.error });
        return true;
      }
      // Security: scan hook payloads for prompt injection unless explicitly opted in
      if (!normalized.value.allowUnsafeExternalContent) {
        const classification = classifyExternalContent("web", normalized.value.message);
        if (!classification.processable) {
          logHooks.warn(
            `hook agent payload rejected: prompt injection detected (risk=${classification.riskLevel})`,
          );
          sendJson(res, 400, {
            ok: false,
            error: "payload rejected: content classified as dangerous",
          });
          return true;
        }
      }
      const runId = dispatchAgentHook(normalized.value);
      sendJson(res, 202, { ok: true, runId });
      return true;
    }

    // POST /hooks/workflow - Trigger an ADW (AI Developer Workflow)
    if (subPath === "workflow") {
      const validated = validateWorkflowConfig(payload);
      if (!validated.ok) {
        sendJson(res, 400, { ok: false, error: validated.error });
        return true;
      }

      const workflowConfig = validated.config;
      const workflowStore = getWorkflowRunStore();
      const workflowRunId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Create workflow run entry
      workflowStore.createWorkflowRun({
        workflowRunId,
        workflowId: workflowConfig.id,
        workflowName: workflowConfig.name,
        stepsTotal: workflowConfig.steps.length,
      });

      // Dispatch each step as a separate agent hook (sequentially in background)
      // The actual sequential execution is handled asynchronously
      void (async () => {
        workflowStore.startWorkflowRun(workflowRunId);
        const runStore = getHookRunStore();
        const stepResults: Array<{
          stepId: string;
          stepName: string;
          status: "ok" | "error" | "skipped";
          runId?: string;
          summary?: string;
          outputText?: string;
          error?: string;
          startedAt: number;
          completedAt?: number;
        }> = [];

        let previousStepStatus: "ok" | "error" | "skipped" | null = null;

        for (let i = 0; i < workflowConfig.steps.length; i++) {
          const step = workflowConfig.steps[i];
          const stepStartedAt = Date.now();

          // Check condition
          const condition = step.condition ?? "always";
          let shouldRun = true;
          if (condition === "previous-success" && previousStepStatus !== "ok") {
            shouldRun = false;
          } else if (condition === "previous-error" && previousStepStatus !== "error") {
            shouldRun = false;
          }

          if (!shouldRun) {
            stepResults.push({
              stepId: step.id,
              stepName: step.name,
              status: "skipped",
              startedAt: stepStartedAt,
              completedAt: Date.now(),
            });
            workflowStore.updateWorkflowStep(workflowRunId, step.id, i + 1);
            continue;
          }

          // Dispatch step as agent hook
          const sessionKey =
            workflowConfig.sessionKey ?? `workflow:${workflowConfig.id}:${workflowRunId}`;
          const stepRunId = dispatchAgentHook({
            message: step.message,
            name: `${workflowConfig.name}/${step.name}`,
            wakeMode: "now",
            sessionKey: `${sessionKey}:step:${step.id}`,
            deliver: workflowConfig.deliver ?? false,
            channel: workflowConfig.channel ?? "last",
            to: workflowConfig.to,
            model: step.model ?? workflowConfig.model,
            thinking: step.thinking ?? workflowConfig.thinking,
            timeoutSeconds: step.timeoutSeconds,
          });

          // Poll for completion (with timeout)
          const timeoutMs = (step.timeoutSeconds ?? 300) * 1000;
          const pollIntervalMs = 1000;
          const maxPolls = Math.ceil(timeoutMs / pollIntervalMs);
          let run = runStore.getRun(stepRunId);
          let polls = 0;

          while (
            run &&
            (run.status === "pending" || run.status === "running") &&
            polls < maxPolls
          ) {
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            run = runStore.getRun(stepRunId);
            polls++;
          }

          const stepStatus =
            run?.status === "completed" ? "ok" : run?.status === "error" ? "error" : "error";
          previousStepStatus = stepStatus;

          stepResults.push({
            stepId: step.id,
            stepName: step.name,
            status: stepStatus,
            runId: stepRunId,
            summary: run?.summary,
            outputText: run?.outputText,
            error: run?.error,
            startedAt: stepStartedAt,
            completedAt: Date.now(),
          });

          workflowStore.updateWorkflowStep(workflowRunId, step.id, i + 1);

          // Stop on error unless continueOnError is set
          if (stepStatus === "error" && !workflowConfig.continueOnError) {
            break;
          }
        }

        // Determine overall workflow status
        const hasErrors = stepResults.some((r) => r.status === "error");
        const allComplete = stepResults.every((r) => r.status === "ok" || r.status === "skipped");
        const workflowStatus = allComplete ? "completed" : hasErrors ? "error" : "partial";

        workflowStore.completeWorkflowRun(workflowRunId, {
          workflowId: workflowConfig.id,
          workflowName: workflowConfig.name,
          status: workflowStatus,
          steps: stepResults,
          startedAt: stepResults[0]?.startedAt ?? Date.now(),
          completedAt: Date.now(),
          summary: `Workflow ${workflowConfig.name}: ${stepResults.filter((r) => r.status === "ok").length}/${stepResults.length} steps completed`,
        });
      })();

      sendJson(res, 202, { ok: true, workflowRunId });
      return true;
    }

    if (hooksConfig.mappings.length > 0) {
      try {
        const mapped = await applyHookMappings(hooksConfig.mappings, {
          payload: payload as Record<string, unknown>,
          headers,
          url,
          path: subPath,
        });
        if (mapped) {
          if (!mapped.ok) {
            sendJson(res, 400, { ok: false, error: mapped.error });
            return true;
          }
          if (mapped.action === null) {
            res.statusCode = 204;
            res.end();
            return true;
          }
          if (mapped.action.kind === "wake") {
            dispatchWakeHook({
              text: mapped.action.text,
              mode: mapped.action.mode,
            });
            sendJson(res, 200, { ok: true, mode: mapped.action.mode });
            return true;
          }
          const channel = resolveHookChannel(mapped.action.channel);
          if (!channel) {
            sendJson(res, 400, { ok: false, error: getHookChannelError() });
            return true;
          }
          const runId = dispatchAgentHook({
            message: mapped.action.message,
            name: mapped.action.name ?? "Hook",
            wakeMode: mapped.action.wakeMode,
            sessionKey: mapped.action.sessionKey ?? "",
            deliver: resolveHookDeliver(mapped.action.deliver),
            channel,
            to: mapped.action.to,
            model: mapped.action.model,
            thinking: mapped.action.thinking,
            timeoutSeconds: mapped.action.timeoutSeconds,
            allowUnsafeExternalContent: mapped.action.allowUnsafeExternalContent,
          });
          sendJson(res, 202, { ok: true, runId });
          return true;
        }
      } catch (err) {
        logHooks.warn(`hook mapping failed: ${String(err)}`);
        sendJson(res, 500, { ok: false, error: "hook mapping failed" });
        return true;
      }
    }

    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not Found");
    return true;
  };
}

export function createGatewayHttpServer(opts: {
  canvasHost: CanvasHostHandler | null;
  controlUiEnabled: boolean;
  controlUiBasePath: string;
  openAiChatCompletionsEnabled: boolean;
  openResponsesEnabled: boolean;
  openResponsesConfig?: import("../config/types.gateway.js").GatewayHttpResponsesConfig;
  handleHooksRequest: HooksRequestHandler;
  handlePluginRequest?: HooksRequestHandler;
  resolvedAuth: import("./auth.js").ResolvedGatewayAuth;
  tlsOptions?: TlsOptions;
  bindMode?: "loopback" | "lan" | "public";
}): HttpServer {
  const {
    canvasHost,
    controlUiEnabled,
    controlUiBasePath,
    openAiChatCompletionsEnabled,
    openResponsesEnabled,
    openResponsesConfig,
    handleHooksRequest,
    handlePluginRequest,
    resolvedAuth,
  } = opts;

  // Security: per-server rate limiter instance
  const rateLimiter = new RateLimiter();
  const bindMode = opts.bindMode ?? "loopback";

  const httpServer: HttpServer = opts.tlsOptions
    ? createHttpsServer(opts.tlsOptions, (req, res) => {
        void handleRequest(req, res);
      })
    : createHttpServer((req, res) => {
        void handleRequest(req, res);
      });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    // Don't interfere with WebSocket upgrades; ws handles the 'upgrade' event.
    if (String(req.headers.upgrade ?? "").toLowerCase() === "websocket") return;

    // Security: apply OWASP security headers to every response
    applySecurityHeaders(res);

    // Security: CORS enforcement
    if (!handleCors(req, res, { bindMode })) return;

    // Security: rate limiting by client IP
    const clientIp = req.socket.remoteAddress ?? "unknown";
    const rateCheck = rateLimiter.checkRequest(clientIp);
    if (!rateCheck.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", String(Math.ceil(rateCheck.retryAfterMs / 1000)));
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Too Many Requests");
      return;
    }

    try {
      const configSnapshot = loadConfig();
      const trustedProxies = configSnapshot.gateway?.trustedProxies ?? [];
      if (await handleHooksRequest(req, res)) return;
      if (
        await handleToolsInvokeHttpRequest(req, res, {
          auth: resolvedAuth,
          trustedProxies,
        })
      )
        return;
      if (await handleSlackHttpRequest(req, res)) return;
      if (handlePluginRequest && (await handlePluginRequest(req, res))) return;
      if (openResponsesEnabled) {
        if (
          await handleOpenResponsesHttpRequest(req, res, {
            auth: resolvedAuth,
            config: openResponsesConfig,
            trustedProxies,
          })
        )
          return;
      }
      if (openAiChatCompletionsEnabled) {
        if (
          await handleOpenAiHttpRequest(req, res, {
            auth: resolvedAuth,
            trustedProxies,
          })
        )
          return;
      }
      if (canvasHost) {
        if (await handleA2uiHttpRequest(req, res)) return;
        if (await canvasHost.handleHttpRequest(req, res)) return;
      }
      if (controlUiEnabled) {
        if (
          handleControlUiAvatarRequest(req, res, {
            basePath: controlUiBasePath,
            resolveAvatar: (agentId) => resolveAgentAvatar(configSnapshot, agentId),
          })
        )
          return;
        if (
          handleControlUiHttpRequest(req, res, {
            basePath: controlUiBasePath,
            config: configSnapshot,
          })
        )
          return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
    } catch {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Internal Server Error");
    }
  }

  return httpServer;
}

export function attachGatewayUpgradeHandler(opts: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  canvasHost: CanvasHostHandler | null;
}) {
  const { httpServer, wss, canvasHost } = opts;
  httpServer.on("upgrade", (req, socket, head) => {
    if (canvasHost?.handleUpgrade(req, socket, head)) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
}
