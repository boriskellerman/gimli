/**
 * Programmatic Agent Execution via Claude Agent SDK patterns
 *
 * Provides a clean, async-iterable interface for running Gimli agents
 * programmatically, inspired by the Claude Agent SDK's `query()` function.
 */

import { randomUUID } from "node:crypto";
import {
  listAgentIds,
  resolveAgentDir,
  resolveAgentModelFallbacksOverride,
  resolveAgentModelPrimary,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { runWithModelFallback } from "../agents/model-fallback.js";
import { isCliProvider, resolveConfiguredModelRef } from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { buildWorkspaceSkillSnapshot } from "../agents/skills.js";
import { getSkillsSnapshotVersion } from "../agents/skills/refresh.js";
import { resolveAgentTimeoutMs } from "../agents/timeout.js";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import { loadConfig } from "../config/config.js";
import { resolveSessionFilePath } from "../config/sessions/paths.js";
import { getRemoteSkillEligibility } from "../infra/skills-remote.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type {
  AgentMessage,
  AgentQueryOptions,
  AgentQueryResult,
  AgentResultMessage,
} from "./types.js";

/**
 * Execute an agent query and stream messages as an async iterable.
 *
 * @example
 * ```typescript
 * import { query } from "gimli/plugin-sdk";
 *
 * // Simple one-shot query
 * for await (const message of query("What files are in the current directory?")) {
 *   if (message.type === "assistant_chunk") {
 *     process.stdout.write(message.text ?? "");
 *   } else if (message.type === "result") {
 *     console.log("\nDone:", message.subtype);
 *   }
 * }
 *
 * // With options
 * for await (const message of query("Fix the bug in auth.ts", {
 *   thinkingLevel: "high",
 *   timeoutMs: 120000,
 * })) {
 *   console.log(message);
 * }
 * ```
 */
export async function* query(
  prompt: string,
  options: AgentQueryOptions = {},
): AsyncGenerator<AgentMessage, void, unknown> {
  const cfg = loadConfig();
  const sessionId = options.sessionId ?? randomUUID();
  const runId = randomUUID();
  const startedAt = Date.now();

  // Resolve agent configuration - use default agent if none specified
  const agentIdRaw = options.agentId?.trim();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const agentId = agentIdRaw ? normalizeAgentId(agentIdRaw) : defaultAgentId;

  // Validate that the agent exists
  const knownAgents = listAgentIds(cfg);
  if (!knownAgents.includes(agentId)) {
    yield {
      type: "error",
      timestamp: Date.now(),
      sessionId,
      error: `Unknown agent id "${agentIdRaw ?? agentId}". Known agents: ${knownAgents.join(", ")}`,
      code: "UNKNOWN_AGENT",
    };
    return;
  }

  // Resolve workspace and agent directories
  const workspaceDirRaw = options.cwd ?? resolveAgentWorkspaceDir(cfg, agentId);
  const agentDir = resolveAgentDir(cfg, agentId);
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !cfg.agents?.defaults?.skipBootstrap,
  });
  const workspaceDir = workspace.dir;

  // Resolve model configuration
  const agentModelPrimary = resolveAgentModelPrimary(cfg, agentId);
  const cfgForModelSelection = agentModelPrimary
    ? {
        ...cfg,
        agents: {
          ...cfg.agents,
          defaults: {
            ...cfg.agents?.defaults,
            model: {
              ...(typeof cfg.agents?.defaults?.model === "object"
                ? cfg.agents.defaults.model
                : undefined),
              primary: agentModelPrimary,
            },
          },
        },
      }
    : cfg;

  const { provider: defaultProvider, model: defaultModel } = resolveConfiguredModelRef({
    cfg: cfgForModelSelection,
    defaultProvider: options.provider ?? DEFAULT_PROVIDER,
    defaultModel: options.model ?? DEFAULT_MODEL,
  });

  const provider = options.provider ?? defaultProvider;
  const model = options.model ?? defaultModel;

  // Resolve timeout
  const timeoutMs =
    options.timeoutMs ??
    resolveAgentTimeoutMs({
      cfg,
      overrideSeconds: undefined,
    });

  // Build skills snapshot
  const skillsSnapshotVersion = getSkillsSnapshotVersion(workspaceDir);
  const skillsSnapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
    config: cfg,
    eligibility: { remote: getRemoteSkillEligibility() },
    snapshotVersion: skillsSnapshotVersion,
  });

  // Resolve session file path
  const sessionFile = resolveSessionFilePath(sessionId, undefined, { agentId });

  // Message queue for async iteration
  const messageQueue: AgentMessage[] = [];
  let resolveWaiting: (() => void) | null = null;
  let finished = false;

  const pushMessage = (msg: AgentMessage) => {
    messageQueue.push(msg);
    if (typeof resolveWaiting === "function") {
      const fn: () => void = resolveWaiting;
      resolveWaiting = null;
      fn();
    }
  };

  // Run the agent in a separate async context
  const runPromise = (async () => {
    try {
      const fallbackResult = await runWithModelFallback({
        cfg,
        provider,
        model,
        agentDir,
        fallbacksOverride: resolveAgentModelFallbacksOverride(cfg, agentId),
        run: (providerOverride, modelOverride) => {
          // CLI provider mode not supported in SDK (would need different handling)
          if (isCliProvider(providerOverride, cfg)) {
            throw new Error("CLI provider mode is not supported in programmatic SDK");
          }

          return runEmbeddedPiAgent({
            sessionId,
            sessionFile,
            workspaceDir,
            config: cfg,
            skillsSnapshot,
            prompt,
            images: options.images,
            clientTools: options.customTools,
            provider: providerOverride,
            model: modelOverride,
            thinkLevel: options.thinkingLevel,
            verboseLevel: options.verboseLevel,
            timeoutMs,
            runId,
            lane: options.lane,
            abortSignal: options.abortSignal,
            extraSystemPrompt: options.systemPrompt,
            streamParams: options.streamParams,
            agentDir,
            onPartialReply: (payload) => {
              pushMessage({
                type: "assistant_chunk",
                timestamp: Date.now(),
                sessionId,
                text: payload.text,
                mediaUrls: payload.mediaUrls,
              });
            },
            onBlockReply: (payload) => {
              pushMessage({
                type: "assistant",
                timestamp: Date.now(),
                sessionId,
                text: payload.text,
                mediaUrls: payload.mediaUrls,
                audioAsVoice: payload.audioAsVoice,
              });
            },
            onReasoningStream: (payload) => {
              pushMessage({
                type: "reasoning",
                timestamp: Date.now(),
                sessionId,
                text: payload.text,
              });
            },
            onToolResult: (payload) => {
              pushMessage({
                type: "tool_result",
                timestamp: Date.now(),
                sessionId,
                toolId: "", // Tool ID not available in this callback
                text: payload.text,
                mediaUrls: payload.mediaUrls,
              });
            },
            onAgentEvent: (evt) => {
              // Track tool calls from agent events
              if (evt.stream === "tool" && evt.data?.name) {
                const toolId =
                  typeof evt.data.id === "string" ? evt.data.id : JSON.stringify(evt.data.id ?? "");
                const toolName =
                  typeof evt.data.name === "string" ? evt.data.name : JSON.stringify(evt.data.name);
                pushMessage({
                  type: "tool_call",
                  timestamp: Date.now(),
                  sessionId,
                  toolId,
                  toolName,
                  arguments: JSON.stringify(evt.data.arguments ?? {}),
                });
              }
            },
          });
        },
      });

      const result = fallbackResult.result;
      const durationMs = Date.now() - startedAt;

      // Emit final result
      const resultMessage: AgentResultMessage = {
        type: "result",
        timestamp: Date.now(),
        sessionId,
        subtype: result.meta.aborted ? "aborted" : result.meta.error ? "error" : "success",
        result: result.payloads
          ?.map((p) => p.text)
          .filter(Boolean)
          .join("\n"),
        payloads: result.payloads,
        meta: {
          durationMs,
          provider: fallbackResult.provider,
          model: fallbackResult.model,
          usage: result.meta.agentMeta?.usage,
          stopReason: result.meta.stopReason,
        },
      };
      pushMessage(resultMessage);
    } catch (err) {
      pushMessage({
        type: "error",
        timestamp: Date.now(),
        sessionId,
        error: String(err),
        code: "AGENT_ERROR",
      });
    } finally {
      finished = true;
      if (typeof resolveWaiting === "function") {
        const fn: () => void = resolveWaiting;
        resolveWaiting = null;
        fn();
      }
    }
  })();

  // Yield messages as they arrive
  while (!finished || messageQueue.length > 0) {
    if (messageQueue.length > 0) {
      yield messageQueue.shift()!;
    } else if (!finished) {
      await new Promise<void>((resolve) => {
        resolveWaiting = resolve;
      });
    }
  }

  // Ensure the run promise is awaited to catch any unhandled errors
  await runPromise;
}

/**
 * Execute an agent query and return a single result (non-streaming).
 *
 * @example
 * ```typescript
 * import { queryOnce } from "gimli/plugin-sdk";
 *
 * const result = await queryOnce("What is 2 + 2?");
 * console.log(result.result); // "4"
 * console.log(result.meta.durationMs); // e.g., 1234
 * ```
 */
export async function queryOnce(
  prompt: string,
  options: AgentQueryOptions = {},
): Promise<AgentQueryResult> {
  let finalResult: AgentResultMessage | null = null;

  for await (const message of query(prompt, options)) {
    if (message.type === "result") {
      finalResult = message;
    } else if (message.type === "error") {
      throw new Error(message.error);
    }
  }

  if (!finalResult) {
    throw new Error("Agent query completed without a result");
  }

  return {
    sessionId: finalResult.sessionId,
    result: finalResult.result,
    payloads: finalResult.payloads ?? [],
    meta: {
      durationMs: finalResult.meta.durationMs,
      provider: finalResult.meta.provider,
      model: finalResult.meta.model,
      usage: finalResult.meta.usage,
      stopReason: finalResult.meta.stopReason,
      aborted: finalResult.subtype === "aborted",
    },
  };
}

/**
 * Execute an agent query with a callback for each message.
 *
 * @example
 * ```typescript
 * import { queryWithCallback } from "gimli/plugin-sdk";
 *
 * await queryWithCallback("Explain this code", {}, (message) => {
 *   if (message.type === "assistant_chunk") {
 *     process.stdout.write(message.text ?? "");
 *   }
 * });
 * ```
 */
export async function queryWithCallback(
  prompt: string,
  options: AgentQueryOptions,
  callback: (message: AgentMessage) => void | Promise<void>,
): Promise<AgentQueryResult> {
  let finalResult: AgentResultMessage | null = null;

  for await (const message of query(prompt, options)) {
    await callback(message);
    if (message.type === "result") {
      finalResult = message;
    } else if (message.type === "error") {
      throw new Error(message.error);
    }
  }

  if (!finalResult) {
    throw new Error("Agent query completed without a result");
  }

  return {
    sessionId: finalResult.sessionId,
    result: finalResult.result,
    payloads: finalResult.payloads ?? [],
    meta: {
      durationMs: finalResult.meta.durationMs,
      provider: finalResult.meta.provider,
      model: finalResult.meta.model,
      usage: finalResult.meta.usage,
      stopReason: finalResult.meta.stopReason,
      aborted: finalResult.subtype === "aborted",
    },
  };
}
