import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the memory index manager
const getMock = vi.fn();
const searchMock = vi.fn();
const statusMock = vi.fn();
const syncMock = vi.fn();

vi.mock("../../memory/manager.js", () => ({
  MemoryIndexManager: {
    get: (params: unknown) => getMock(params),
  },
}));

// Mock config IO
const loadConfigMock = vi.fn();
vi.mock("../../config/io.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

import { createDatabaseTool } from "./database-tool.js";

describe("database tool", () => {
  beforeEach(() => {
    getMock.mockReset();
    searchMock.mockReset();
    statusMock.mockReset();
    syncMock.mockReset();
    loadConfigMock.mockReset();
    loadConfigMock.mockReturnValue({});
  });

  describe("action: search", () => {
    it("requires query parameter", async () => {
      const tool = createDatabaseTool();

      await expect(tool.execute("call-1", { action: "search" })).rejects.toThrow(/query required/);
    });

    it("returns error when memory not configured", async () => {
      getMock.mockResolvedValue(null);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-2", {
        action: "search",
        query: "test query",
      });

      expect(result.details).toMatchObject({
        ok: false,
        error: "Memory search not configured for this agent",
      });
    });

    it("searches memory with default params", async () => {
      const mockManager = {
        search: searchMock.mockResolvedValue([
          {
            path: "test.md",
            startLine: 1,
            endLine: 5,
            score: 0.85,
            source: "memory",
            snippet: "Test snippet content",
          },
        ]),
      };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool({ agentSessionKey: "agent:default:main" });
      const result = await tool.execute("call-3", {
        action: "search",
        query: "test query",
      });

      expect(searchMock).toHaveBeenCalledWith("test query", {
        maxResults: 10,
        minScore: 0.5,
        sessionKey: "agent:default:main",
      });

      expect(result.details).toMatchObject({
        ok: true,
        action: "search",
        query: "test query",
        resultCount: 1,
      });

      const results = (result.details as Record<string, unknown>).results as unknown[];
      expect(results[0]).toMatchObject({
        path: "test.md",
        score: 0.85,
        source: "memory",
      });
    });

    it("respects custom maxResults and minScore", async () => {
      const mockManager = {
        search: searchMock.mockResolvedValue([]),
      };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool();
      await tool.execute("call-4", {
        action: "search",
        query: "test",
        maxResults: 20,
        minScore: 0.7,
      });

      expect(searchMock).toHaveBeenCalledWith("test", {
        maxResults: 20,
        minScore: 0.7,
        sessionKey: undefined,
      });
    });

    it("extracts agent ID from session key", async () => {
      const mockManager = { search: searchMock.mockResolvedValue([]) };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool({ agentSessionKey: "agent:my-agent:some-session" });
      await tool.execute("call-5", { action: "search", query: "test" });

      expect(getMock).toHaveBeenCalledWith({
        cfg: {},
        agentId: "my-agent",
      });
    });

    it("uses explicit agentId over session key", async () => {
      const mockManager = { search: searchMock.mockResolvedValue([]) };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool({ agentSessionKey: "agent:default:main" });
      await tool.execute("call-6", {
        action: "search",
        query: "test",
        agentId: "custom-agent",
      });

      expect(getMock).toHaveBeenCalledWith({
        cfg: {},
        agentId: "custom-agent",
      });
    });
  });

  describe("action: stats", () => {
    it("returns error when memory not configured", async () => {
      getMock.mockResolvedValue(null);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-7", { action: "stats" });

      expect(result.details).toMatchObject({
        ok: false,
        error: "Memory search not configured for this agent",
      });
    });

    it("returns memory index status", async () => {
      const mockManager = {
        status: statusMock.mockReturnValue({
          files: 10,
          chunks: 50,
          dirty: false,
          workspaceDir: "/home/user/workspace",
          dbPath: "/home/user/.gimli/memory.db",
          provider: "openai",
          model: "text-embedding-3-small",
          sources: ["memory", "sessions"],
          sourceCounts: [
            { source: "memory", files: 8, chunks: 40 },
            { source: "sessions", files: 2, chunks: 10 },
          ],
          cache: { enabled: true, entries: 100 },
          fts: { enabled: true, available: true },
          vector: { enabled: true, available: true, dims: 1536 },
        }),
      };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-8", { action: "stats" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "stats",
        agentId: "default",
      });

      const stats = (result.details as Record<string, unknown>).stats as Record<string, unknown>;
      expect(stats.files).toBe(10);
      expect(stats.chunks).toBe(50);
      expect(stats.provider).toBe("openai");
    });
  });

  describe("action: sync", () => {
    it("returns error when memory not configured", async () => {
      getMock.mockResolvedValue(null);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-9", { action: "sync" });

      expect(result.details).toMatchObject({
        ok: false,
        error: "Memory search not configured for this agent",
      });
    });

    it("triggers sync and returns updated stats", async () => {
      const mockManager = {
        sync: syncMock.mockResolvedValue(undefined),
        status: statusMock.mockReturnValue({
          files: 12,
          chunks: 60,
          dirty: false,
        }),
      };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-10", { action: "sync" });

      expect(syncMock).toHaveBeenCalledWith({ reason: "tool-sync" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "sync",
        synced: {
          files: 12,
          chunks: 60,
          dirty: false,
        },
      });
    });
  });

  describe("error handling", () => {
    it("returns error for unknown action", async () => {
      const tool = createDatabaseTool();
      const result = await tool.execute("call-err", { action: "unknown" as "search" });

      expect(result.details).toMatchObject({
        ok: false,
        error: "Unknown action: unknown",
      });
    });

    it("handles search errors gracefully", async () => {
      const mockManager = {
        search: searchMock.mockRejectedValue(new Error("Embedding API unavailable")),
      };
      getMock.mockResolvedValue(mockManager);

      const tool = createDatabaseTool();
      const result = await tool.execute("call-err-2", {
        action: "search",
        query: "test",
      });

      expect(result.details).toMatchObject({
        ok: false,
      });
      expect((result.details as Record<string, unknown>).error).toContain(
        "Embedding API unavailable",
      );
    });
  });
});
