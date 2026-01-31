import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Comprehensive tests for agent-to-agent (A2A) session tool behavior.
 *
 * These tests verify that sessions_list, sessions_history, and sessions_send
 * correctly handle cross-agent access control based on:
 * - tools.agentToAgent.enabled setting
 * - tools.agentToAgent.allow patterns
 * - sandbox session visibility restrictions
 */

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

// Mock config with A2A enabled and allow patterns
let mockConfig: Record<string, unknown> = {
  session: { scope: "per-sender", mainKey: "main" },
  tools: {
    agentToAgent: {
      enabled: true,
      allow: ["*"],
    },
  },
  agents: {
    defaults: {
      sandbox: {
        sessionToolsVisibility: "spawned",
      },
    },
  },
};

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => mockConfig as never,
    resolveGatewayPort: () => 18789,
  };
});

import { createSessionsListTool } from "./sessions-list-tool.js";
import { createSessionsHistoryTool } from "./sessions-history-tool.js";
import { createSessionsSendTool } from "./sessions-send-tool.js";

describe("Agent-to-Agent Session Tools Integration", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
    // Reset to default A2A-enabled config
    mockConfig = {
      session: { scope: "per-sender", mainKey: "main" },
      tools: {
        agentToAgent: {
          enabled: true,
          allow: ["*"],
        },
      },
      agents: {
        defaults: {
          sandbox: {
            sessionToolsVisibility: "spawned",
          },
        },
      },
    };
  });

  describe("sessions_list with A2A enabled", () => {
    it("includes sessions from other agents when A2A is enabled with wildcard allow", async () => {
      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "agent:other:main", kind: "direct" },
          { key: "agent:third:discord:group:123", kind: "group" },
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call1", {});
      const details = result.details as { count: number; sessions: Array<{ key: string }> };

      expect(details.count).toBe(3);
      expect(details.sessions.map((s) => s.key)).toContain("agent:main:main");
      expect(details.sessions.map((s) => s.key)).toContain("agent:other:main");
      expect(details.sessions.map((s) => s.key)).toContain("agent:third:discord:group:123");
    });

    it("filters sessions by allow patterns when restrictive patterns are set", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: true,
            allow: ["main", "helper"],
          },
        },
      };

      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "agent:helper:main", kind: "direct" },
          { key: "agent:restricted:main", kind: "direct" },
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call2", {});
      const details = result.details as { count: number; sessions: Array<{ key: string }> };

      expect(details.count).toBe(2);
      expect(details.sessions.map((s) => s.key)).toContain("agent:main:main");
      expect(details.sessions.map((s) => s.key)).toContain("agent:helper:main");
      expect(details.sessions.map((s) => s.key)).not.toContain("agent:restricted:main");
    });

    it("includes same-agent sessions even when requester not in allow list", async () => {
      // A2A policy requires BOTH requester AND target to match allow patterns for cross-agent access.
      // Same-agent sessions are always visible (requester === target agentId).
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: true,
            allow: ["other"], // "main" is NOT in allow list
          },
        },
      };

      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "agent:main:discord:group:dev", kind: "group" },
          { key: "agent:other:main", kind: "direct" },
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call3", {});
      const details = result.details as { count: number; sessions: Array<{ key: string }> };

      // Same-agent sessions (agent:main:*) are visible even when "main" not in allow list
      expect(details.sessions.map((s) => s.key)).toContain("agent:main:main");
      expect(details.sessions.map((s) => s.key)).toContain("agent:main:discord:group:dev");
      // Cross-agent session NOT visible because "main" not in allow list (both must match)
      expect(details.sessions.map((s) => s.key)).not.toContain("agent:other:main");
    });

    it("excludes all cross-agent sessions when A2A is disabled", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: false,
          },
        },
      };

      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "agent:other:main", kind: "direct" },
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call4", {});
      const details = result.details as { count: number; sessions: Array<{ key: string }> };

      expect(details.count).toBe(1);
      expect(details.sessions[0].key).toBe("agent:main:main");
    });

    it("correctly classifies session kinds", async () => {
      // Session kinds are classified by key patterns:
      // - "main" alias matches → "main"
      // - "cron:" prefix → "cron"
      // - "hook:" prefix → "hook"
      // - "node:" or "node-" prefix → "node"
      // - ":group:" or ":channel:" in key, or gatewayKind="group" → "group"
      // - everything else → "other"
      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "agent:main:discord:group:123", kind: "group" },
          { key: "cron:daily-report", kind: "direct" },
          { key: "hook:webhook-123", kind: "direct" },
          { key: "node:worker-1", kind: "direct" },
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "agent:main:main" });

      // Filter by kind: group
      const groupsResult = await tool.execute("call5", { kinds: ["group"] });
      const groupsDetails = groupsResult.details as {
        count: number;
        sessions: Array<{ kind: string }>;
      };
      expect(groupsDetails.count).toBe(1);
      expect(groupsDetails.sessions[0].kind).toBe("group");

      // Filter by kind: cron (key starts with "cron:")
      callGatewayMock.mockClear();
      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "agent:main:main", kind: "direct" },
          { key: "cron:daily-report", kind: "direct" },
        ],
      });
      const cronResult = await tool.execute("call6", { kinds: ["cron"] });
      const cronDetails = cronResult.details as {
        count: number;
        sessions: Array<{ kind: string }>;
      };
      expect(cronDetails.count).toBe(1);
      expect(cronDetails.sessions[0].kind).toBe("cron");
    });
  });

  describe("sessions_history with A2A enabled", () => {
    it("allows cross-agent history access when A2A is enabled and allowed", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "sessions.resolve") {
          return { key: "agent:other:main" };
        }
        if (request.method === "chat.history") {
          return {
            messages: [
              { role: "user", content: [{ type: "text", text: "hello" }] },
              { role: "assistant", content: [{ type: "text", text: "hi there" }] },
            ],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call1", { sessionKey: "agent:other:main" });
      const details = result.details as {
        sessionKey?: string;
        messages?: Array<{ role: string }>;
      };

      expect(details.sessionKey).toBe("agent:other:main");
      expect(details.messages).toHaveLength(2);
    });

    it("blocks cross-agent history when A2A is disabled", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: false,
          },
        },
      };

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.resolve") {
          return { key: "agent:other:main" };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call2", { sessionKey: "agent:other:main" });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("forbidden");
      expect(details.error).toContain("Agent-to-agent history is disabled");
    });

    it("blocks cross-agent history when agent not in allow list", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: true,
            allow: ["helper"],
          },
        },
      };

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.resolve") {
          return { key: "agent:restricted:main" };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call3", { sessionKey: "agent:restricted:main" });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("forbidden");
      expect(details.error).toContain("Agent-to-agent history denied");
    });

    it("allows same-agent history access without A2A", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: false,
          },
        },
      };

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "chat.history") {
          return {
            messages: [{ role: "assistant", content: [{ type: "text", text: "response" }] }],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call4", { sessionKey: "agent:main:discord:group:123" });
      const details = result.details as {
        sessionKey?: string;
        messages?: Array<{ role: string }>;
      };

      expect(details.messages).toHaveLength(1);
    });

    it("filters tool messages by default", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "chat.history") {
          return {
            messages: [
              { role: "user", content: [{ type: "text", text: "search for X" }] },
              { role: "assistant", content: [{ type: "toolUse", name: "search" }] },
              { role: "toolResult", content: [{ type: "text", text: "results" }] },
              { role: "assistant", content: [{ type: "text", text: "Found X" }] },
            ],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call5", { sessionKey: "main" });
      const details = result.details as { messages?: Array<{ role: string }> };

      // toolResult should be filtered out
      expect(details.messages).toHaveLength(3);
      expect(details.messages?.some((m) => m.role === "toolResult")).toBe(false);
    });

    it("includes tool messages when includeTools is true", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "chat.history") {
          return {
            messages: [
              { role: "user", content: [{ type: "text", text: "search" }] },
              { role: "toolResult", content: [{ type: "text", text: "results" }] },
              { role: "assistant", content: [{ type: "text", text: "done" }] },
            ],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call6", { sessionKey: "main", includeTools: true });
      const details = result.details as { messages?: Array<{ role: string }> };

      expect(details.messages).toHaveLength(3);
      expect(details.messages?.some((m) => m.role === "toolResult")).toBe(true);
    });

    it("handles session not found error", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.resolve") {
          throw new Error("No session found");
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      // Use a UUID-like sessionId that triggers sessions.resolve lookup
      const result = await tool.execute("call7", {
        sessionKey: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("error");
      // Error message comes from the thrown error or is formatted by resolveSessionKeyFromSessionId
      expect(details.error).toMatch(/No session found|Session not found/);
    });
  });

  describe("sessions_send with A2A enabled", () => {
    it("allows cross-agent send when A2A is enabled", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "agent") {
          return { runId: "run-1", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return {
            messages: [
              { role: "assistant", content: [{ type: "text", text: "response from other agent" }] },
            ],
          };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      });

      const result = await tool.execute("call1", {
        sessionKey: "agent:other:main",
        message: "hello other agent",
        timeoutSeconds: 1,
      });
      const details = result.details as {
        status?: string;
        reply?: string;
        sessionKey?: string;
      };

      expect(details.status).toBe("ok");
      expect(details.reply).toBe("response from other agent");
    });

    it("blocks cross-agent send when agent not in allow list", async () => {
      mockConfig = {
        ...mockConfig,
        tools: {
          agentToAgent: {
            enabled: true,
            allow: ["helper"],
          },
        },
      };

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      });

      const result = await tool.execute("call2", {
        sessionKey: "agent:restricted:main",
        message: "hello",
        timeoutSeconds: 0,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("forbidden");
      expect(details.error).toContain("Agent-to-agent messaging denied");
    });

    it("returns accepted status for fire-and-forget mode", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "agent") {
          return { runId: "run-fire", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return { messages: [] };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      });

      const result = await tool.execute("call3", {
        sessionKey: "main",
        message: "quick message",
        timeoutSeconds: 0,
      });
      const details = result.details as {
        status?: string;
        runId?: string;
        sessionKey?: string;
      };

      expect(details.status).toBe("accepted");
      expect(details.runId).toBe("run-fire");
    });

    it("returns timeout status when agent.wait times out", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "agent") {
          return { runId: "run-timeout", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "timeout", error: "Agent did not respond in time" };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "telegram",
      });

      const result = await tool.execute("call4", {
        sessionKey: "main",
        message: "slow message",
        timeoutSeconds: 1,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("timeout");
    });

    it("requires either sessionKey or label", async () => {
      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      });

      const result = await tool.execute("call5", {
        message: "no target specified",
        timeoutSeconds: 0,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("error");
      expect(details.error).toContain("Either sessionKey or label is required");
    });

    it("rejects both sessionKey and label", async () => {
      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      });

      const result = await tool.execute("call6", {
        sessionKey: "main",
        label: "worker",
        message: "conflicting targets",
        timeoutSeconds: 0,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("error");
      expect(details.error).toContain("Provide either sessionKey or label");
    });

    it("uses nested lane for agent invocation", async () => {
      const capturedCalls: Array<{ method?: string; params?: Record<string, unknown> }> = [];
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        capturedCalls.push(request);
        if (request.method === "agent") {
          return { runId: "run-lane", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      });

      await tool.execute("call7", {
        sessionKey: "main",
        message: "lane test",
        timeoutSeconds: 1,
      });

      const agentCall = capturedCalls.find((c) => c.method === "agent");
      expect(agentCall?.params?.lane).toBe("nested");
    });

    it("includes agent-to-agent context in extraSystemPrompt", async () => {
      const capturedCalls: Array<{ method?: string; params?: Record<string, unknown> }> = [];
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        capturedCalls.push(request);
        if (request.method === "agent") {
          return { runId: "run-ctx", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return { messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }] };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "discord:group:requester",
        agentChannel: "discord",
      });

      await tool.execute("call8", {
        sessionKey: "whatsapp:group:target",
        message: "cross-channel",
        timeoutSeconds: 1,
      });

      const agentCall = capturedCalls.find((c) => c.method === "agent");
      expect(agentCall?.params?.extraSystemPrompt).toContain("Agent-to-agent message context");
    });
  });

  describe("sandbox visibility restrictions", () => {
    it("sessions_list restricts to spawned sessions when sandboxed", async () => {
      const requesterKey = "agent:main:subagent-session";
      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [{ key: "agent:main:spawned-child", kind: "direct" }],
      });

      const tool = createSessionsListTool({
        agentSessionKey: requesterKey,
        sandboxed: true,
      });

      await tool.execute("call1", {});

      // Verify spawnedBy filter was passed
      expect(callGatewayMock).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "sessions.list",
          params: expect.objectContaining({
            spawnedBy: expect.stringContaining("agent:main"),
          }),
        }),
      );
    });

    it("sessions_history returns forbidden for non-spawned sessions when sandboxed", async () => {
      mockConfig = {
        ...mockConfig,
        agents: {
          defaults: {
            sandbox: {
              sessionToolsVisibility: "spawned",
            },
          },
        },
      };

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return { sessions: [] }; // No spawned sessions
        }
        return {};
      });

      const tool = createSessionsHistoryTool({
        agentSessionKey: "agent:main:sandbox-session",
        sandboxed: true,
      });

      const result = await tool.execute("call2", { sessionKey: "agent:main:other-session" });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("forbidden");
      expect(details.error).toContain("not visible from this sandboxed agent session");
    });

    it("sessions_send returns forbidden for non-spawned sessions when sandboxed", async () => {
      mockConfig = {
        ...mockConfig,
        agents: {
          defaults: {
            sandbox: {
              sessionToolsVisibility: "spawned",
            },
          },
        },
      };

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return { sessions: [] }; // No spawned sessions
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:sandbox-session",
        agentChannel: "whatsapp",
        sandboxed: true,
      });

      const result = await tool.execute("call3", {
        sessionKey: "agent:main:restricted-session",
        message: "blocked",
        timeoutSeconds: 0,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("forbidden");
      expect(details.error).toContain("not visible from this sandboxed agent session");
    });
  });

  describe("session reference resolution", () => {
    it("sessions_history resolves sessionId to sessionKey", async () => {
      const sessionId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
      const targetKey = "agent:main:discord:channel:123";
      let resolveCallCount = 0;

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "sessions.resolve") {
          resolveCallCount++;
          // First call is key-based resolution (returns empty to fall through)
          // Second call is sessionId-based resolution
          if (resolveCallCount === 1 && request.params?.key) {
            return { key: "" }; // No match by key
          }
          return { key: targetKey };
        }
        if (request.method === "chat.history") {
          return {
            messages: [{ role: "assistant", content: [{ type: "text", text: "resolved" }] }],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call1", { sessionKey: sessionId });
      const details = result.details as { sessionKey?: string; messages?: unknown[] };

      expect(details.messages).toHaveLength(1);
    });

    it("sessions_send resolves sessionId to sessionKey", async () => {
      const sessionId = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
      const targetKey = "agent:main:telegram:group:456";

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "sessions.resolve") {
          return { key: targetKey };
        }
        if (request.method === "agent") {
          expect(request.params?.sessionKey).toBe(targetKey);
          return { runId: "run-resolved", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return { messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] }] };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "telegram",
      });

      const result = await tool.execute("call2", {
        sessionKey: sessionId,
        message: "send to resolved",
        timeoutSeconds: 1,
      });
      const details = result.details as { status?: string };

      expect(details.status).toBe("ok");
    });

    it("sessions_send resolves label to sessionKey", async () => {
      const targetKey = "agent:main:labeled-session";

      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "sessions.resolve") {
          expect(request.params?.label).toBe("my-worker");
          return { key: targetKey };
        }
        if (request.method === "agent") {
          expect(request.params?.sessionKey).toBe(targetKey);
          return { runId: "run-label", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return {
            messages: [{ role: "assistant", content: [{ type: "text", text: "labeled" }] }],
          };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "discord",
      });

      const result = await tool.execute("call3", {
        label: "my-worker",
        message: "send to label",
        timeoutSeconds: 1,
      });
      const details = result.details as { status?: string; sessionKey?: string };

      expect(details.status).toBe("ok");
    });

    it("sessions_send returns error when label not found", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.resolve") {
          throw new Error("Label not found");
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "slack",
      });

      const result = await tool.execute("call4", {
        label: "nonexistent",
        message: "should fail",
        timeoutSeconds: 0,
      });
      const details = result.details as { status?: string; error?: string };

      expect(details.status).toBe("error");
      // Error can be the thrown message or the fallback "No session found with label" message
      expect(details.error).toMatch(/Label not found|No session found with label/);
    });
  });

  describe("main session alias handling", () => {
    it("sessions_list returns display key for main alias", async () => {
      // The alias is derived from config: session.mainKey (default "main")
      // When key matches the alias, resolveDisplaySessionKey returns "main"
      // But since gateway returns "agent:main:main", it only becomes "main" display if alias matches
      callGatewayMock.mockResolvedValue({
        path: "/tmp/sessions.json",
        sessions: [
          { key: "main", kind: "direct" }, // Raw "main" key from gateway
        ],
      });

      const tool = createSessionsListTool({ agentSessionKey: "main" });
      const result = await tool.execute("call1", {});
      const details = result.details as { sessions: Array<{ key: string }> };

      // When key === alias, resolveDisplaySessionKey returns "main"
      expect(details.sessions[0].key).toBe("main");
    });

    it("sessions_history handles main alias input", async () => {
      // When input is "main" and it looks like a session key (not sessionId),
      // resolveInternalSessionKey converts it to the alias
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "chat.history") {
          // "main" input resolves to alias "main" (since config.session.mainKey = "main")
          expect(request.params?.sessionKey).toBe("main");
          return {
            messages: [{ role: "assistant", content: [{ type: "text", text: "main session" }] }],
          };
        }
        return {};
      });

      const tool = createSessionsHistoryTool({ agentSessionKey: "agent:main:main" });
      const result = await tool.execute("call2", { sessionKey: "main" });
      const details = result.details as { sessionKey?: string };

      // Display key is "main" since key matches alias
      expect(details.sessionKey).toBe("main");
    });

    it("sessions_send handles main alias input", async () => {
      callGatewayMock.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string; params?: Record<string, unknown> };
        if (request.method === "agent") {
          // "main" input resolves to alias "main"
          expect(request.params?.sessionKey).toBe("main");
          return { runId: "run-main", acceptedAt: Date.now() };
        }
        if (request.method === "agent.wait") {
          return { status: "ok" };
        }
        if (request.method === "chat.history") {
          return { messages: [{ role: "assistant", content: [{ type: "text", text: "reply" }] }] };
        }
        return {};
      });

      const tool = createSessionsSendTool({
        agentSessionKey: "agent:main:main",
        agentChannel: "whatsapp",
      });

      const result = await tool.execute("call3", {
        sessionKey: "main",
        message: "to main",
        timeoutSeconds: 1,
      });
      const details = result.details as { sessionKey?: string };

      expect(details.sessionKey).toBe("main");
    });
  });
});
