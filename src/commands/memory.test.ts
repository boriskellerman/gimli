import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryCommandOpts } from "./memory.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
  getMemorySearchManager: vi.fn(),
  isRich: vi.fn(() => false),
  writeFile: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../memory/search-manager.js", () => ({
  getMemorySearchManager: mocks.getMemorySearchManager,
}));

vi.mock("../terminal/theme.js", () => ({
  isRich: mocks.isRich,
  theme: {
    error: (s: string) => s,
    warn: (s: string) => s,
    success: (s: string) => s,
    info: (s: string) => s,
    muted: (s: string) => s,
    accent: (s: string) => s,
  },
}));

vi.mock("../globals.js", () => ({
  info: (s: string) => s,
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: mocks.writeFile,
  },
}));

import { memoryCommand } from "./memory.js";

describe("memory command", () => {
  const mockRuntime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as (code: number) => never,
  };

  const mockManager = {
    search: vi.fn(),
    status: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveDefaultAgentId.mockReturnValue("default");
    mocks.getMemorySearchManager.mockResolvedValue({ manager: mockManager });
    mockManager.search.mockResolvedValue([]);
    mockManager.status.mockReturnValue({
      files: 0,
      chunks: 0,
      dirty: false,
      workspaceDir: "/test/workspace",
      dbPath: "/test/.gimli/memory.db",
      provider: "local",
      model: "test-model",
      requestedProvider: "auto",
      sources: ["memory"],
      sourceCounts: [{ source: "memory", files: 0, chunks: 0 }],
    });
    mocks.writeFile.mockResolvedValue(undefined);
  });

  describe("help", () => {
    it("shows help when no subcommand provided", async () => {
      await memoryCommand({}, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });

    it("shows help with help subcommand", async () => {
      await memoryCommand({ subcommand: "help" }, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });
  });

  describe("search subcommand", () => {
    it("requires query", async () => {
      await memoryCommand({ subcommand: "search" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Query is required"));
    });

    it("searches memories with query", async () => {
      mockManager.search.mockResolvedValue([
        {
          path: "MEMORY.md",
          startLine: 1,
          endLine: 5,
          score: 0.85,
          snippet: "Test memory content",
          source: "memory",
        },
      ]);

      await memoryCommand({ subcommand: "search", query: "test query" }, mockRuntime);

      expect(mockManager.search).toHaveBeenCalledWith("test query", {
        maxResults: 10,
        minScore: 0.3,
      });
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Found 1 memories"));
    });

    it("shows empty message when no results", async () => {
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "search", query: "nonexistent" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("No memories found"));
    });

    it("respects limit option", async () => {
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "search", query: "test", limit: 5 }, mockRuntime);

      expect(mockManager.search).toHaveBeenCalledWith("test", {
        maxResults: 5,
        minScore: 0.3,
      });
    });

    it("respects minScore option", async () => {
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "search", query: "test", minScore: 0.5 }, mockRuntime);

      expect(mockManager.search).toHaveBeenCalledWith("test", {
        maxResults: 10,
        minScore: 0.5,
      });
    });

    it("outputs JSON when --json flag is set", async () => {
      mockManager.search.mockResolvedValue([
        {
          path: "MEMORY.md",
          startLine: 1,
          endLine: 5,
          score: 0.85,
          snippet: "Test memory content",
          source: "memory",
        },
      ]);

      await memoryCommand({ subcommand: "search", query: "test", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"query"'));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"results"'));
    });

    it("handles manager unavailable", async () => {
      mocks.getMemorySearchManager.mockResolvedValue({
        manager: null,
        error: "Memory not configured",
      });

      await memoryCommand({ subcommand: "search", query: "test" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Memory system unavailable"),
      );
    });

    it("accepts find alias", async () => {
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "find", query: "test" }, mockRuntime);

      expect(mockManager.search).toHaveBeenCalled();
    });

    it("accepts query alias", async () => {
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "query", query: "test" }, mockRuntime);

      expect(mockManager.search).toHaveBeenCalled();
    });
  });

  describe("forget subcommand", () => {
    it("requires ID", async () => {
      await memoryCommand({ subcommand: "forget" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("ID is required"));
    });

    it("shows not implemented message", async () => {
      await memoryCommand({ subcommand: "forget", id: "test-id" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
    });

    it("accepts delete alias", async () => {
      await memoryCommand({ subcommand: "delete", id: "test-id" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
    });

    it("accepts remove alias", async () => {
      await memoryCommand({ subcommand: "remove", id: "test-id" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
    });

    it("accepts rm alias", async () => {
      await memoryCommand({ subcommand: "rm", id: "test-id" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("not yet supported"));
    });
  });

  describe("export subcommand", () => {
    it("exports memories to file", async () => {
      mockManager.status.mockReturnValue({
        files: 2,
        chunks: 10,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [{ source: "memory", files: 2, chunks: 10 }],
      });
      mockManager.search.mockResolvedValue([]);

      await memoryCommand({ subcommand: "export" }, mockRuntime);

      expect(mocks.writeFile).toHaveBeenCalled();
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Memories exported"));
    });

    it("uses custom output path", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
      });

      await memoryCommand({ subcommand: "export", output: "custom-output.json" }, mockRuntime);

      expect(mocks.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("custom-output.json"),
        expect.any(String),
        "utf-8",
      );
    });

    it("outputs JSON when --json flag is set", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
      });

      await memoryCommand({ subcommand: "export", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"success"'));
    });

    it("handles write error", async () => {
      mocks.writeFile.mockRejectedValue(new Error("Permission denied"));
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
      });

      await memoryCommand({ subcommand: "export" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write export file"),
      );
    });

    it("accepts backup alias", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
      });

      await memoryCommand({ subcommand: "backup" }, mockRuntime);

      expect(mocks.writeFile).toHaveBeenCalled();
    });

    it("handles manager unavailable", async () => {
      mocks.getMemorySearchManager.mockResolvedValue({
        manager: null,
        error: "Memory not configured",
      });

      await memoryCommand({ subcommand: "export" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Memory system unavailable"),
      );
    });
  });

  describe("status subcommand", () => {
    it("shows memory status", async () => {
      mockManager.status.mockReturnValue({
        files: 5,
        chunks: 20,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "openai",
        model: "text-embedding-3-small",
        requestedProvider: "auto",
        sources: ["memory", "sessions"],
        sourceCounts: [
          { source: "memory", files: 3, chunks: 12 },
          { source: "sessions", files: 2, chunks: 8 },
        ],
        vector: { enabled: true, available: true, dims: 1536 },
        fts: { enabled: true, available: true },
        cache: { enabled: true, entries: 100, maxEntries: 1000 },
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Memory system status"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("5"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("20"));
    });

    it("outputs JSON when --json flag is set", async () => {
      await memoryCommand({ subcommand: "status", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"files"'));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"chunks"'));
    });

    it("handles manager unavailable", async () => {
      mocks.getMemorySearchManager.mockResolvedValue({
        manager: null,
        error: "Memory not configured",
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Memory system unavailable"),
      );
    });

    it("accepts info alias", async () => {
      await memoryCommand({ subcommand: "info" }, mockRuntime);

      expect(mockManager.status).toHaveBeenCalled();
    });

    it("shows vector store info when available", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
        vector: { enabled: true, available: true, dims: 768 },
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Vector store"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("768"));
    });

    it("shows vector error when present", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
        vector: { enabled: true, available: false, loadError: "Extension not found" },
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Extension not found"));
    });

    it("shows FTS info when available", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
        fts: { enabled: true, available: true },
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Full-text search"));
    });

    it("shows cache info when available", async () => {
      mockManager.status.mockReturnValue({
        files: 0,
        chunks: 0,
        dirty: false,
        workspaceDir: "/test/workspace",
        dbPath: "/test/.gimli/memory.db",
        provider: "local",
        model: "test-model",
        requestedProvider: "auto",
        sources: ["memory"],
        sourceCounts: [],
        cache: { enabled: true, entries: 50, maxEntries: 500 },
      });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Embedding cache"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("50"));
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      await memoryCommand({ subcommand: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand"));
    });
  });

  describe("manager cleanup", () => {
    it("closes manager on success", async () => {
      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mockManager.close).toHaveBeenCalled();
    });

    it("closes manager on error", async () => {
      await memoryCommand({ subcommand: "search" }, mockRuntime);

      expect(mockManager.close).toHaveBeenCalled();
    });

    it("handles manager being null gracefully", async () => {
      mocks.getMemorySearchManager.mockResolvedValue({ manager: null });

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      // Should not throw
      expect(mockRuntime.error).toHaveBeenCalled();
    });
  });

  describe("agent ID override", () => {
    it("uses provided agent ID", async () => {
      await memoryCommand({ subcommand: "status", agentId: "custom-agent" }, mockRuntime);

      expect(mocks.getMemorySearchManager).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "custom-agent" }),
      );
    });

    it("falls back to default agent ID", async () => {
      mocks.resolveDefaultAgentId.mockReturnValue("default-agent");

      await memoryCommand({ subcommand: "status" }, mockRuntime);

      expect(mocks.getMemorySearchManager).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "default-agent" }),
      );
    });
  });
});
