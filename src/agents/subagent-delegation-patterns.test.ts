/**
 * Comprehensive tests for sub-agent delegation patterns.
 *
 * These tests cover:
 * - Delegation chain prevention (sub-agents cannot spawn sub-agents)
 * - Run lifecycle management (registration, lifecycle events, cleanup)
 * - Timeout and error outcome handling
 * - Label/task propagation
 * - Archive sweeper behavior
 * - Requester session key resolution
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

let configOverride: ReturnType<(typeof import("../config/config.js"))["loadConfig"]> = {
  session: {
    mainKey: "main",
    scope: "per-sender",
  },
};

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => configOverride,
    resolveGatewayPort: () => 18789,
  };
});

import { emitAgentEvent } from "../infra/agent-events.js";
import "./test-helpers/fast-core-tools.js";
import { createGimliTools } from "./gimli-tools.js";
import {
  addSubagentRunForTests,
  listSubagentRunsForRequester,
  registerSubagentRun,
  releaseSubagentRun,
  resetSubagentRegistryForTests,
} from "./subagent-registry.js";

describe("subagent delegation patterns", () => {
  beforeEach(() => {
    resetSubagentRegistryForTests();
    callGatewayMock.mockReset();
    configOverride = {
      session: {
        mainKey: "main",
        scope: "per-sender",
      },
    };
  });

  describe("delegation chain prevention", () => {
    it("forbids sessions_spawn from sub-agent sessions", async () => {
      // Sub-agent session keys follow the pattern: agent:<agentId>:subagent:<uuid>
      const subagentSessionKey = "agent:main:subagent:abc123-def456";

      const tool = createGimliTools({
        agentSessionKey: subagentSessionKey,
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      const result = await tool.execute("call-chain-prevention", {
        task: "nested delegation attempt",
      });

      expect(result.details).toMatchObject({
        status: "forbidden",
        error: expect.stringContaining("not allowed from sub-agent sessions"),
      });
      expect(callGatewayMock).not.toHaveBeenCalled();
    });

    it("allows sessions_spawn from main agent sessions", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "agent") {
          return { runId: "run-allowed", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      const result = await tool.execute("call-from-main", {
        task: "valid delegation",
      });

      expect(result.details).toMatchObject({
        status: "accepted",
      });
    });

    it("allows sessions_spawn from channel-based sessions", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "agent") {
          return { runId: "run-channel", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "discord:guild:channel",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      const result = await tool.execute("call-from-channel", {
        task: "valid channel delegation",
      });

      expect(result.details).toMatchObject({
        status: "accepted",
      });
    });
  });

  describe("run lifecycle management", () => {
    it("registers run and tracks in registry", async () => {
      let capturedSessionKey: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { sessionKey?: string } };
        if (request.method === "agent") {
          capturedSessionKey = request.params?.sessionKey;
          return { runId: "run-lifecycle", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-register", {
        task: "lifecycle test task",
        label: "Test Label",
      });

      const runs = listSubagentRunsForRequester("agent:main:main");
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        runId: "run-lifecycle",
        task: "lifecycle test task",
        label: "Test Label",
        requesterSessionKey: "agent:main:main",
      });
      expect(runs[0]?.childSessionKey).toBe(capturedSessionKey);
    });

    it("handles lifecycle start event", async () => {
      let childRunId: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { lane?: string } };
        if (request.method === "agent") {
          if (request.params?.lane === "subagent") {
            childRunId = "run-start-event";
          }
          return { runId: childRunId ?? "run-main", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-start", { task: "start event test" });

      if (!childRunId) throw new Error("missing child runId");

      const startTime = 1700000000000;
      emitAgentEvent({
        runId: childRunId,
        stream: "lifecycle",
        data: {
          phase: "start",
          startedAt: startTime,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const runs = listSubagentRunsForRequester("agent:main:main");
      expect(runs[0]?.startedAt).toBe(startTime);
    });

    it("handles lifecycle end event and triggers cleanup", async () => {
      let childRunId: string | undefined;
      const calls: Array<{ method?: string; params?: unknown }> = [];

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        calls.push(request);
        if (request.method === "agent") {
          const params = request.params as { lane?: string } | undefined;
          if (params?.lane === "subagent") {
            childRunId = "run-end-event";
            return { runId: childRunId, status: "accepted", acceptedAt: Date.now() };
          }
          return { runId: "run-announce", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "ok", startedAt: 1000, endedAt: 2000 };
        }
        if (request.method === "sessions.delete") {
          return { ok: true };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-end", {
        task: "end event test",
        cleanup: "delete",
      });

      if (!childRunId) throw new Error("missing child runId");

      emitAgentEvent({
        runId: childRunId,
        stream: "lifecycle",
        data: {
          phase: "end",
          startedAt: 1000,
          endedAt: 2000,
        },
      });

      // Allow async cleanup to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify announce was called
      const announceCalls = calls.filter(
        (c) =>
          c.method === "agent" &&
          (c.params as { sessionKey?: string })?.sessionKey === "agent:main:main",
      );
      expect(announceCalls.length).toBeGreaterThan(0);
    });

    it("handles lifecycle error event", async () => {
      let childRunId: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        if (request.method === "agent") {
          const params = request.params as { lane?: string } | undefined;
          if (params?.lane === "subagent") {
            childRunId = "run-error-event";
            return { runId: childRunId, status: "accepted", acceptedAt: Date.now() };
          }
          return { runId: "run-announce", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "error", error: "task failed" };
        }
        if (request.method === "sessions.delete") {
          return { ok: true };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-error", {
        task: "error event test",
        cleanup: "keep",
      });

      if (!childRunId) throw new Error("missing child runId");

      emitAgentEvent({
        runId: childRunId,
        stream: "lifecycle",
        data: {
          phase: "error",
          startedAt: 1000,
          endedAt: 2000,
          error: "something went wrong",
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const runs = listSubagentRunsForRequester("agent:main:main");
      expect(runs[0]?.outcome).toMatchObject({
        status: "error",
      });
    });
  });

  describe("cleanup strategies", () => {
    it("deletes session when cleanup is delete", async () => {
      let childRunId: string | undefined;
      let childSessionKey: string | undefined;
      let deletedKey: string | undefined;

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        if (request.method === "agent") {
          const params = request.params as { lane?: string; sessionKey?: string } | undefined;
          if (params?.lane === "subagent") {
            childRunId = "run-delete-cleanup";
            childSessionKey = params.sessionKey;
            return { runId: childRunId, status: "accepted", acceptedAt: Date.now() };
          }
          return { runId: "run-announce", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "ok", startedAt: 1000, endedAt: 2000 };
        }
        if (request.method === "sessions.delete") {
          const params = request.params as { key?: string } | undefined;
          deletedKey = params?.key;
          return { ok: true };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-delete-cleanup", {
        task: "delete cleanup test",
        cleanup: "delete",
      });

      if (!childRunId) throw new Error("missing child runId");

      emitAgentEvent({
        runId: childRunId,
        stream: "lifecycle",
        data: { phase: "end", startedAt: 1000, endedAt: 2000 },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(deletedKey).toBe(childSessionKey);
    });

    it("preserves session when cleanup is keep", async () => {
      let childRunId: string | undefined;
      const deleteCalls: string[] = [];

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        if (request.method === "agent") {
          const params = request.params as { lane?: string } | undefined;
          if (params?.lane === "subagent") {
            childRunId = "run-keep-cleanup";
            return { runId: childRunId, status: "accepted", acceptedAt: Date.now() };
          }
          return { runId: "run-announce", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "ok", startedAt: 1000, endedAt: 2000 };
        }
        if (request.method === "sessions.delete") {
          const params = request.params as { key?: string } | undefined;
          if (params?.key) deleteCalls.push(params.key);
          return { ok: true };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-keep-cleanup", {
        task: "keep cleanup test",
        cleanup: "keep",
      });

      if (!childRunId) throw new Error("missing child runId");

      emitAgentEvent({
        runId: childRunId,
        stream: "lifecycle",
        data: { phase: "end", startedAt: 1000, endedAt: 2000 },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // No session deletion calls should have been made for the subagent session
      const subagentDeletes = deleteCalls.filter((key) => key.includes("subagent:"));
      expect(subagentDeletes).toHaveLength(0);
    });
  });

  describe("timeout handling", () => {
    it("passes runTimeoutSeconds to agent call", async () => {
      const calls: Array<{ method?: string; params?: unknown }> = [];
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        calls.push(request);
        if (request.method === "agent") {
          return { runId: "run-timeout", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-timeout", {
        task: "timeout test",
        runTimeoutSeconds: 30,
      });

      const agentCall = calls.find(
        (c) =>
          c.method === "agent" && (c.params as { lane?: string } | undefined)?.lane === "subagent",
      );
      expect(agentCall?.params).toMatchObject({
        timeout: 30,
      });
    });

    it("supports legacy timeoutSeconds parameter", async () => {
      const calls: Array<{ method?: string; params?: unknown }> = [];
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        calls.push(request);
        if (request.method === "agent") {
          return { runId: "run-legacy-timeout", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-legacy-timeout", {
        task: "legacy timeout test",
        timeoutSeconds: 45,
      });

      const agentCall = calls.find(
        (c) =>
          c.method === "agent" && (c.params as { lane?: string } | undefined)?.lane === "subagent",
      );
      expect(agentCall?.params).toMatchObject({
        timeout: 45,
      });
    });

    it("prefers runTimeoutSeconds over timeoutSeconds", async () => {
      const calls: Array<{ method?: string; params?: unknown }> = [];
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: unknown };
        calls.push(request);
        if (request.method === "agent") {
          return { runId: "run-prefer", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-prefer-new", {
        task: "prefer test",
        runTimeoutSeconds: 60,
        timeoutSeconds: 30,
      });

      const agentCall = calls.find(
        (c) =>
          c.method === "agent" && (c.params as { lane?: string } | undefined)?.lane === "subagent",
      );
      expect(agentCall?.params).toMatchObject({
        timeout: 60,
      });
    });
  });

  describe("registry operations", () => {
    it("lists runs for specific requester only", () => {
      addSubagentRunForTests({
        runId: "run-a",
        childSessionKey: "agent:main:subagent:a",
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        task: "task a",
        cleanup: "keep",
        createdAt: 1000,
      });

      addSubagentRunForTests({
        runId: "run-b",
        childSessionKey: "agent:main:subagent:b",
        requesterSessionKey: "agent:other:main",
        requesterDisplayKey: "other",
        task: "task b",
        cleanup: "keep",
        createdAt: 2000,
      });

      const mainRuns = listSubagentRunsForRequester("agent:main:main");
      expect(mainRuns).toHaveLength(1);
      expect(mainRuns[0]?.runId).toBe("run-a");

      const otherRuns = listSubagentRunsForRequester("agent:other:main");
      expect(otherRuns).toHaveLength(1);
      expect(otherRuns[0]?.runId).toBe("run-b");
    });

    it("releases runs from registry", () => {
      addSubagentRunForTests({
        runId: "run-release",
        childSessionKey: "agent:main:subagent:release",
        requesterSessionKey: "agent:main:main",
        requesterDisplayKey: "main",
        task: "release test",
        cleanup: "keep",
        createdAt: 1000,
      });

      expect(listSubagentRunsForRequester("agent:main:main")).toHaveLength(1);

      releaseSubagentRun("run-release");

      expect(listSubagentRunsForRequester("agent:main:main")).toHaveLength(0);
    });

    it("handles release of non-existent run gracefully", () => {
      expect(() => releaseSubagentRun("non-existent-run")).not.toThrow();
    });
  });

  describe("requester origin propagation", () => {
    it("captures requester origin from agent context", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "agent") {
          return { runId: "run-origin", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "telegram",
        agentAccountId: "user123",
        agentTo: "+15551234567",
        agentThreadId: "thread-42",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-origin", { task: "origin test" });

      const runs = listSubagentRunsForRequester("agent:main:main");
      expect(runs[0]?.requesterOrigin).toMatchObject({
        channel: "telegram",
        accountId: "user123",
        to: "+15551234567",
        threadId: "thread-42",
      });
    });

    it("normalizes whitespace in requester origin fields", () => {
      registerSubagentRun({
        runId: "run-normalize",
        childSessionKey: "agent:main:subagent:normalize",
        requesterSessionKey: "agent:main:main",
        requesterOrigin: {
          channel: " whatsapp ",
          accountId: " user-456 ",
          to: " +15559999999 ",
        },
        requesterDisplayKey: "main",
        task: "normalize test",
        cleanup: "keep",
      });

      const runs = listSubagentRunsForRequester("agent:main:main");
      expect(runs[0]?.requesterOrigin).toMatchObject({
        channel: "whatsapp",
        accountId: "user-456",
        to: "+15559999999",
      });
    });
  });

  describe("system prompt generation", () => {
    it("includes task in subagent system prompt", async () => {
      let capturedPrompt: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { extraSystemPrompt?: string } };
        if (request.method === "agent") {
          if (request.params?.extraSystemPrompt) {
            capturedPrompt = request.params.extraSystemPrompt;
          }
          return { runId: "run-prompt", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-prompt", {
        task: "analyze the data",
        label: "Data Analyzer",
      });

      expect(capturedPrompt).toContain("analyze the data");
      expect(capturedPrompt).toContain("Subagent Context");
      expect(capturedPrompt).toContain("Data Analyzer");
    });

    it("includes requester session context in prompt", async () => {
      let capturedPrompt: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { extraSystemPrompt?: string } };
        if (request.method === "agent") {
          if (request.params?.extraSystemPrompt) {
            capturedPrompt = request.params.extraSystemPrompt;
          }
          return { runId: "run-context", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "telegram",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-context", { task: "context test" });

      expect(capturedPrompt).toContain("agent:main:main");
      expect(capturedPrompt).toContain("telegram");
    });
  });

  describe("lane assignment", () => {
    it("spawns sub-agents on the subagent lane", async () => {
      let capturedLane: string | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { lane?: string } };
        if (request.method === "agent") {
          capturedLane = request.params?.lane;
          return { runId: "run-lane", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-lane", { task: "lane test" });

      expect(capturedLane).toBe("subagent");
    });
  });

  describe("deliver flag", () => {
    it("sets deliver to false for sub-agent runs", async () => {
      let capturedDeliver: boolean | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: { deliver?: boolean; lane?: string } };
        if (request.method === "agent" && request.params?.lane === "subagent") {
          capturedDeliver = request.params?.deliver;
          return { runId: "run-deliver", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent") {
          return { runId: "run-other", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-deliver", { task: "deliver test" });

      expect(capturedDeliver).toBe(false);
    });
  });

  describe("group context propagation", () => {
    it("forwards group context to sub-agent", async () => {
      let capturedParams: Record<string, unknown> | undefined;
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "agent" && request.params?.lane === "subagent") {
          capturedParams = request.params;
          return { runId: "run-group", status: "accepted", acceptedAt: Date.now() };
        }
        if (request.method === "agent") {
          return { runId: "run-other", status: "ok" };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout" };
        }
        return {};
      });

      const tool = createGimliTools({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
        agentGroupId: "guild-123",
        agentGroupChannel: "channel-456",
        agentGroupSpace: "space-789",
      }).find((candidate) => candidate.name === "sessions_spawn");
      if (!tool) throw new Error("missing sessions_spawn tool");

      await tool.execute("call-group", { task: "group context test" });

      expect(capturedParams?.groupId).toBe("guild-123");
      expect(capturedParams?.groupChannel).toBe("channel-456");
      expect(capturedParams?.groupSpace).toBe("space-789");
    });
  });
});

describe("subagent registry persistence", () => {
  const previousStateDir = process.env.GIMLI_STATE_DIR;
  let tempStateDir: string | null = null;

  afterEach(async () => {
    vi.resetModules();
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.GIMLI_STATE_DIR;
    } else {
      process.env.GIMLI_STATE_DIR = previousStateDir;
    }
  });

  it("generates unique child session keys per spawn", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-subagent-unique-"));
    process.env.GIMLI_STATE_DIR = tempStateDir;

    const childSessionKeys: string[] = [];
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: { sessionKey?: string; lane?: string } };
      if (request.method === "agent" && request.params?.lane === "subagent") {
        if (request.params.sessionKey) {
          childSessionKeys.push(request.params.sessionKey);
        }
        return {
          runId: `run-${childSessionKeys.length}`,
          status: "accepted",
          acceptedAt: Date.now(),
        };
      }
      if (request.method === "agent") {
        return { runId: "run-other", status: "ok" };
      }
      if (request.method === "agent.wait") {
        return { status: "timeout" };
      }
      return {};
    });

    const tool = createGimliTools({
      agentSessionKey: "agent:main:main",
      agentChannel: "discord",
    }).find((candidate) => candidate.name === "sessions_spawn");
    if (!tool) throw new Error("missing sessions_spawn tool");

    await tool.execute("call-1", { task: "first spawn" });
    await tool.execute("call-2", { task: "second spawn" });
    await tool.execute("call-3", { task: "third spawn" });

    expect(childSessionKeys).toHaveLength(3);
    const uniqueKeys = new Set(childSessionKeys);
    expect(uniqueKeys.size).toBe(3);

    for (const key of childSessionKeys) {
      expect(key).toMatch(/^agent:main:subagent:[a-f0-9-]{36}$/);
    }
  });
});
