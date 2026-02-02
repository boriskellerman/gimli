import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentMessage, AgentQueryOptions, AgentResultMessage } from "./types.js";

// Mock the dependencies before importing the module
vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main", "test-agent"]),
  resolveAgentDir: vi.fn(() => "/tmp/gimli-test/agents/main"),
  resolveAgentModelFallbacksOverride: vi.fn(() => undefined),
  resolveAgentModelPrimary: vi.fn(() => undefined),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/gimli-test/workspace"),
  resolveDefaultAgentId: vi.fn(() => "main"),
}));

vi.mock("../agents/defaults.js", () => ({
  DEFAULT_MODEL: "claude-3-5-sonnet-20241022",
  DEFAULT_PROVIDER: "anthropic",
}));

vi.mock("../agents/model-fallback.js", () => ({
  runWithModelFallback: vi.fn(),
}));

vi.mock("../agents/model-selection.js", () => ({
  isCliProvider: vi.fn(() => false),
  resolveConfiguredModelRef: vi.fn(() => ({
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
  })),
}));

vi.mock("../agents/pi-embedded.js", () => ({
  runEmbeddedPiAgent: vi.fn(),
}));

vi.mock("../agents/skills.js", () => ({
  buildWorkspaceSkillSnapshot: vi.fn(() => ({
    version: 1,
    skills: [],
  })),
}));

vi.mock("../agents/skills/refresh.js", () => ({
  getSkillsSnapshotVersion: vi.fn(() => 1),
}));

vi.mock("../agents/timeout.js", () => ({
  resolveAgentTimeoutMs: vi.fn(() => 120000),
}));

vi.mock("../agents/workspace.js", () => ({
  ensureAgentWorkspace: vi.fn(async ({ dir }) => ({ dir })),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: {
      defaults: {
        skipBootstrap: true,
      },
    },
  })),
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveSessionFilePath: vi.fn(() => "/tmp/gimli-test/sessions/test.json"),
}));

vi.mock("../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: vi.fn(() => ({ allowed: true })),
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: vi.fn((id) => id.toLowerCase()),
}));

describe("Agent SDK Query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("query()", () => {
    it("should yield messages from the agent execution", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        // Simulate calling the run function with callbacks
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return {
          result,
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
        };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockImplementation(async (params) => {
        // Simulate streaming callbacks (void to suppress floating promise warnings)
        void params.onPartialReply?.({ text: "Hello" });
        void params.onPartialReply?.({ text: " world" });
        void params.onBlockReply?.({ text: "Hello world" });

        return {
          payloads: [{ text: "Hello world" }],
          meta: {
            durationMs: 1000,
            agentMeta: {
              sessionId: params.sessionId,
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
              usage: { input: 10, output: 20, total: 30 },
            },
            stopReason: "end_turn",
          },
        };
      });

      const { query } = await import("./query.js");

      const messages: AgentMessage[] = [];
      for await (const message of query("Hello")) {
        messages.push(message);
      }

      // Should have assistant chunks, assistant message, and result
      expect(messages.length).toBeGreaterThanOrEqual(3);

      const chunkMessages = messages.filter((m) => m.type === "assistant_chunk");
      expect(chunkMessages.length).toBe(2);
      expect(chunkMessages[0].text).toBe("Hello");
      expect(chunkMessages[1].text).toBe(" world");

      const assistantMessages = messages.filter((m) => m.type === "assistant");
      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0].text).toBe("Hello world");

      const resultMessages = messages.filter((m) => m.type === "result");
      expect(resultMessages.length).toBe(1);
      const result = resultMessages[0] as AgentResultMessage;
      expect(result.subtype).toBe("success");
      expect(result.meta.provider).toBe("anthropic");
      expect(result.meta.model).toBe("claude-3-5-sonnet-20241022");
    });

    it("should handle unknown agent id error", async () => {
      const { listAgentIds } = await import("../agents/agent-scope.js");
      vi.mocked(listAgentIds).mockReturnValue(["main"]);

      const { query } = await import("./query.js");

      const messages: AgentMessage[] = [];
      for await (const message of query("Hello", { agentId: "unknown-agent" })) {
        messages.push(message);
      }

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("error");
      if (messages[0].type === "error") {
        expect(messages[0].error).toContain("Unknown agent id");
        expect(messages[0].code).toBe("UNKNOWN_AGENT");
      }
    });

    it("should pass options correctly to runEmbeddedPiAgent", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return { result, provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockResolvedValue({
        payloads: [{ text: "Test result" }],
        meta: { durationMs: 500, stopReason: "end_turn" },
      });

      const { query } = await import("./query.js");

      const options: AgentQueryOptions = {
        thinkingLevel: "high",
        systemPrompt: "Be helpful",
        timeoutMs: 60000,
        images: [{ type: "image", data: "base64data", mimeType: "image/png" }],
      };

      const messages: AgentMessage[] = [];
      for await (const message of query("Test prompt", options)) {
        messages.push(message);
      }

      expect(mockRunEmbeddedPiAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Test prompt",
          thinkLevel: "high",
          extraSystemPrompt: "Be helpful",
          images: [{ type: "image", data: "base64data", mimeType: "image/png" }],
        }),
      );
    });

    it("should handle errors during agent execution", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockRejectedValue(new Error("Agent execution failed"));

      const { query } = await import("./query.js");

      const messages: AgentMessage[] = [];
      for await (const message of query("Hello")) {
        messages.push(message);
      }

      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("error");
      if (messages[0].type === "error") {
        expect(messages[0].error).toContain("Agent execution failed");
      }
    });

    it("should handle tool calls via agent events", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return { result, provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockImplementation(async (params) => {
        // Simulate tool call event
        params.onAgentEvent?.({
          stream: "tool",
          data: {
            id: "tool-123",
            name: "read_file",
            arguments: { path: "/tmp/test.txt" },
          },
        });

        void params.onToolResult?.({ text: "File content here" });

        return {
          payloads: [{ text: "I read the file" }],
          meta: { durationMs: 2000, stopReason: "end_turn" },
        };
      });

      const { query } = await import("./query.js");

      const messages: AgentMessage[] = [];
      for await (const message of query("Read the file")) {
        messages.push(message);
      }

      const toolCallMessages = messages.filter((m) => m.type === "tool_call");
      expect(toolCallMessages.length).toBe(1);
      if (toolCallMessages[0].type === "tool_call") {
        expect(toolCallMessages[0].toolName).toBe("read_file");
        expect(toolCallMessages[0].toolId).toBe("tool-123");
      }

      const toolResultMessages = messages.filter((m) => m.type === "tool_result");
      expect(toolResultMessages.length).toBe(1);
      if (toolResultMessages[0].type === "tool_result") {
        expect(toolResultMessages[0].text).toBe("File content here");
      }
    });
  });

  describe("queryOnce()", () => {
    it("should return a single result object", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return { result, provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockResolvedValue({
        payloads: [{ text: "The answer is 4" }],
        meta: {
          durationMs: 500,
          agentMeta: {
            sessionId: "test-session",
            provider: "anthropic",
            model: "claude-3-5-sonnet-20241022",
            usage: { input: 5, output: 10, total: 15 },
          },
          stopReason: "end_turn",
        },
      });

      const { queryOnce } = await import("./query.js");

      const result = await queryOnce("What is 2 + 2?");

      expect(result.result).toBe("The answer is 4");
      expect(result.payloads).toHaveLength(1);
      expect(result.meta.provider).toBe("anthropic");
      expect(result.meta.model).toBe("claude-3-5-sonnet-20241022");
      expect(result.meta.usage).toEqual({ input: 5, output: 10, total: 15 });
    });

    it("should throw on error messages", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockRejectedValue(new Error("Execution error"));

      const { queryOnce } = await import("./query.js");

      await expect(queryOnce("Hello")).rejects.toThrow("Execution error");
    });
  });

  describe("queryWithCallback()", () => {
    it("should call callback for each message", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return { result, provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockImplementation(async (params) => {
        void params.onPartialReply?.({ text: "Chunk 1" });
        void params.onPartialReply?.({ text: "Chunk 2" });
        return {
          payloads: [{ text: "Final" }],
          meta: { durationMs: 100, stopReason: "end_turn" },
        };
      });

      const { queryWithCallback } = await import("./query.js");

      const receivedMessages: AgentMessage[] = [];
      const callback = vi.fn((msg: AgentMessage) => {
        receivedMessages.push(msg);
      });

      const result = await queryWithCallback("Hello", {}, callback);

      expect(callback).toHaveBeenCalled();
      expect(receivedMessages.length).toBeGreaterThanOrEqual(3); // 2 chunks + result

      const chunkMessages = receivedMessages.filter((m) => m.type === "assistant_chunk");
      expect(chunkMessages.length).toBe(2);

      expect(result.result).toBe("Final");
    });

    it("should support async callbacks", async () => {
      const { runWithModelFallback } = await import("../agents/model-fallback.js");
      const mockRunWithModelFallback = vi.mocked(runWithModelFallback);

      mockRunWithModelFallback.mockImplementation(async ({ run }) => {
        const result = await run("anthropic", "claude-3-5-sonnet-20241022");
        return { result, provider: "anthropic", model: "claude-3-5-sonnet-20241022" };
      });

      const { runEmbeddedPiAgent } = await import("../agents/pi-embedded.js");
      const mockRunEmbeddedPiAgent = vi.mocked(runEmbeddedPiAgent);

      mockRunEmbeddedPiAgent.mockResolvedValue({
        payloads: [{ text: "Done" }],
        meta: { durationMs: 100, stopReason: "end_turn" },
      });

      const { queryWithCallback } = await import("./query.js");

      const processedMessages: string[] = [];
      const asyncCallback = async (msg: AgentMessage) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        processedMessages.push(msg.type);
      };

      await queryWithCallback("Hello", {}, asyncCallback);

      expect(processedMessages).toContain("result");
    });
  });
});

describe("Agent SDK Types", () => {
  it("should have correct message type discriminators", () => {
    const assistantChunk: AgentMessage = {
      type: "assistant_chunk",
      timestamp: Date.now(),
      sessionId: "test",
      text: "Hello",
    };

    const result: AgentMessage = {
      type: "result",
      timestamp: Date.now(),
      sessionId: "test",
      subtype: "success",
      meta: { durationMs: 100 },
    };

    expect(assistantChunk.type).toBe("assistant_chunk");
    expect(result.type).toBe("result");
  });
});
