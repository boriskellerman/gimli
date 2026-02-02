/**
 * Tests for Prime Commands
 *
 * Tests database, config, and logs tool access for TAC orchestrator agents.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
  getMemorySearchManager: vi.fn(),
  isRich: vi.fn(() => false),
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  resolveStateDir: vi.fn(),
  resolveSessionTranscriptsDirForAgent: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
  resolveStateDir: mocks.resolveStateDir,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../memory/search-manager.js", () => ({
  getMemorySearchManager: mocks.getMemorySearchManager,
}));

vi.mock("../config/sessions/paths.js", () => ({
  resolveSessionTranscriptsDirForAgent: mocks.resolveSessionTranscriptsDirForAgent,
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
    heading: (s: string) => s,
  },
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
    readdir: mocks.readdir,
    stat: mocks.stat,
  },
}));

import { primeCommand } from "./prime.js";

describe("prime command", () => {
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
    mocks.loadConfig.mockReturnValue({
      gateway: { mode: "local" },
      agents: { list: [] },
    });
    mocks.resolveDefaultAgentId.mockReturnValue("default");
    mocks.resolveStateDir.mockReturnValue("/home/test/.gimli");
    mocks.resolveSessionTranscriptsDirForAgent.mockReturnValue(
      "/home/test/.gimli/agents/default/sessions",
    );
    mocks.getMemorySearchManager.mockResolvedValue({ manager: mockManager });
    mockManager.search.mockResolvedValue([]);
    mockManager.status.mockReturnValue({
      files: 5,
      chunks: 20,
      dirty: false,
      workspaceDir: "/test/workspace",
      dbPath: "/test/.gimli/memory.db",
      provider: "local",
      model: "test-model",
      requestedProvider: "auto",
      sources: ["memory"],
      sourceCounts: [{ source: "memory", files: 5, chunks: 20 }],
      vector: { enabled: true, available: true },
      fts: { enabled: true, available: true },
      cache: { enabled: true, entries: 100 },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Help
  // ─────────────────────────────────────────────────────────────────────────

  describe("help", () => {
    it("shows help when no subcommand provided", async () => {
      await primeCommand({}, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Prime Commands"));
    });

    it("shows help with help subcommand", async () => {
      await primeCommand({ subcommand: "help" }, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Prime Commands"));
    });

    it("shows error for unknown subcommand", async () => {
      await primeCommand({ subcommand: "unknown" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Unknown subcommand: unknown"),
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Database Commands
  // ─────────────────────────────────────────────────────────────────────────

  describe("db subcommand", () => {
    describe("db status", () => {
      it("returns memory system status", async () => {
        await primeCommand({ subcommand: "db", action: "status", json: true }, mockRuntime);
        expect(mocks.getMemorySearchManager).toHaveBeenCalled();
        expect(mockRuntime.log).toHaveBeenCalledWith(
          expect.stringContaining('"type": "db_status"'),
        );
      });

      it("includes chunk and file counts", async () => {
        await primeCommand({ subcommand: "db", action: "status", json: true }, mockRuntime);
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.files).toBe(5);
        expect(parsed.data.chunks).toBe(20);
      });

      it("handles unavailable memory system", async () => {
        mocks.getMemorySearchManager.mockResolvedValue({
          manager: null,
          error: "Memory disabled",
        });
        await primeCommand({ subcommand: "db", action: "status", json: true }, mockRuntime);
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Memory");
      });
    });

    describe("db search", () => {
      it("requires query for search", async () => {
        await primeCommand({ subcommand: "db", action: "search", json: true }, mockRuntime);
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Query is required");
      });

      it("searches memory database", async () => {
        mockManager.search.mockResolvedValue([
          {
            path: "/test/file.md",
            startLine: 1,
            endLine: 10,
            score: 0.85,
            snippet: "Test snippet",
            source: "memory",
          },
        ]);

        await primeCommand(
          { subcommand: "db", action: "search", query: "test", json: true },
          mockRuntime,
        );

        expect(mockManager.search).toHaveBeenCalledWith("test", { maxResults: 10, minScore: 0.3 });
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.results).toHaveLength(1);
        expect(parsed.data.results[0].score).toBe(0.85);
      });

      it("respects limit option", async () => {
        mockManager.search.mockResolvedValue([]);
        await primeCommand(
          { subcommand: "db", action: "search", query: "test", limit: 5, json: true },
          mockRuntime,
        );
        expect(mockManager.search).toHaveBeenCalledWith("test", { maxResults: 5, minScore: 0.3 });
      });
    });

    describe("db sessions", () => {
      it("lists session files", async () => {
        mocks.readdir.mockResolvedValue([
          { name: "session-1.jsonl", isFile: () => true },
          { name: "session-2.jsonl", isFile: () => true },
          { name: "other.txt", isFile: () => true },
        ]);
        mocks.stat.mockResolvedValue({
          size: 1024,
          mtime: new Date("2024-01-01"),
        });

        await primeCommand({ subcommand: "db", action: "sessions", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.totalCount).toBe(2); // Only .jsonl files
        expect(parsed.data.sessions).toHaveLength(2);
      });

      it("handles missing sessions directory", async () => {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        mocks.readdir.mockRejectedValue(error);

        await primeCommand({ subcommand: "db", action: "sessions", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.totalCount).toBe(0);
      });
    });

    it("shows error for unknown db action", async () => {
      await primeCommand({ subcommand: "db", action: "unknown", json: true }, mockRuntime);
      const output = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain("Unknown db action");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Config Commands
  // ─────────────────────────────────────────────────────────────────────────

  describe("config subcommand", () => {
    describe("config get", () => {
      it("requires key for get", async () => {
        await primeCommand({ subcommand: "config", action: "get", json: true }, mockRuntime);
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Key path is required");
      });

      it("gets config value by key path", async () => {
        mocks.loadConfig.mockReturnValue({
          gateway: { mode: "local", port: 18789 },
        });

        await primeCommand(
          { subcommand: "config", action: "get", key: "gateway.mode", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.value).toBe("local");
        expect(parsed.data.exists).toBe(true);
      });

      it("handles nested key paths", async () => {
        mocks.loadConfig.mockReturnValue({
          agents: { defaults: { model: "claude-3" } },
        });

        await primeCommand(
          { subcommand: "config", action: "get", key: "agents.defaults.model", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.value).toBe("claude-3");
      });

      it("returns exists=false for missing keys", async () => {
        await primeCommand(
          { subcommand: "config", action: "get", key: "nonexistent.key", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.exists).toBe(false);
      });
    });

    describe("config list", () => {
      it("lists top-level config sections", async () => {
        mocks.loadConfig.mockReturnValue({
          gateway: { mode: "local" },
          agents: { list: [] },
          channels: {},
        });

        await primeCommand({ subcommand: "config", action: "list", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.sections).toContain("gateway");
        expect(parsed.data.sections).toContain("agents");
      });

      it("returns full config with verbose flag (redacted)", async () => {
        mocks.loadConfig.mockReturnValue({
          gateway: { mode: "local", auth: { token: "secret123" } },
        });

        await primeCommand(
          { subcommand: "config", action: "list", verbose: true, json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.config.gateway.auth.token).toBe("[REDACTED]");
      });
    });

    describe("config paths", () => {
      it("returns important config paths", async () => {
        await primeCommand({ subcommand: "config", action: "paths", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.stateDir).toBeDefined();
        expect(parsed.data.configPath).toBeDefined();
        expect(parsed.data.credentialsDir).toBeDefined();
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Logs Commands
  // ─────────────────────────────────────────────────────────────────────────

  describe("logs subcommand", () => {
    describe("logs info", () => {
      it("returns log file info", async () => {
        await primeCommand({ subcommand: "logs", action: "info", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.logFile).toContain("gimli-");
        expect(parsed.data.pattern).toBe("gimli-YYYY-MM-DD.log");
      });
    });

    describe("logs tail", () => {
      it("tails log file", async () => {
        const logContent = [
          '{"time":"2024-01-01T10:00:00Z","level":"info","subsystem":"gateway","message":"Started"}',
          '{"time":"2024-01-01T10:01:00Z","level":"error","subsystem":"agent","message":"Error"}',
        ].join("\n");
        mocks.readFile.mockResolvedValue(logContent);

        await primeCommand(
          { subcommand: "logs", action: "tail", lines: 10, json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.lines).toHaveLength(2);
      });

      it("filters by level", async () => {
        const logContent = [
          '{"time":"2024-01-01T10:00:00Z","level":"info","subsystem":"gateway","message":"Info"}',
          '{"time":"2024-01-01T10:01:00Z","level":"error","subsystem":"agent","message":"Error"}',
        ].join("\n");
        mocks.readFile.mockResolvedValue(logContent);

        await primeCommand(
          { subcommand: "logs", action: "tail", level: "error", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.lines).toHaveLength(1);
        expect(parsed.data.lines[0].parsed.level).toBe("error");
      });

      it("handles missing log file", async () => {
        const error = new Error("ENOENT") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        mocks.readFile.mockRejectedValue(error);

        await primeCommand({ subcommand: "logs", action: "tail", json: true }, mockRuntime);

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.lines).toHaveLength(0);
        expect(parsed.data.note).toContain("not found");
      });
    });

    describe("logs search", () => {
      it("requires query for search", async () => {
        await primeCommand({ subcommand: "logs", action: "search", json: true }, mockRuntime);
        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Query is required");
      });

      it("searches logs for pattern", async () => {
        const logContent = [
          '{"time":"2024-01-01T10:00:00Z","level":"info","message":"Gateway started"}',
          '{"time":"2024-01-01T10:01:00Z","level":"error","message":"Memory error"}',
          '{"time":"2024-01-01T10:02:00Z","level":"info","message":"Gateway stopped"}',
        ].join("\n");
        mocks.readFile.mockResolvedValue(logContent);

        await primeCommand(
          { subcommand: "logs", action: "search", query: "error", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.success).toBe(true);
        expect(parsed.data.totalMatches).toBe(1);
      });

      it("is case-insensitive", async () => {
        const logContent = '{"message":"ERROR occurred"}\n{"message":"error happened"}';
        mocks.readFile.mockResolvedValue(logContent);

        await primeCommand(
          { subcommand: "logs", action: "search", query: "Error", json: true },
          mockRuntime,
        );

        const output = mockRuntime.log.mock.calls[0][0];
        const parsed = JSON.parse(output);
        expect(parsed.data.totalMatches).toBe(2);
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // JSON Output
  // ─────────────────────────────────────────────────────────────────────────

  describe("JSON output", () => {
    it("outputs valid JSON for all successful operations", async () => {
      await primeCommand({ subcommand: "config", action: "paths", json: true }, mockRuntime);
      const output = mockRuntime.log.mock.calls[0][0];
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("includes success field in JSON output", async () => {
      await primeCommand({ subcommand: "config", action: "paths", json: true }, mockRuntime);
      const output = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty("success");
    });

    it("includes error field for failures", async () => {
      await primeCommand(
        { subcommand: "config", action: "get", json: true }, // Missing key
        mockRuntime,
      );
      const output = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed).toHaveProperty("error");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Agent ID Override
  // ─────────────────────────────────────────────────────────────────────────

  describe("agent ID override", () => {
    it("uses provided agent ID", async () => {
      await primeCommand(
        { subcommand: "db", action: "status", agentId: "custom-agent", json: true },
        mockRuntime,
      );

      expect(mocks.getMemorySearchManager).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "custom-agent" }),
      );
    });

    it("falls back to default agent ID", async () => {
      mocks.resolveDefaultAgentId.mockReturnValue("default-agent");

      await primeCommand({ subcommand: "db", action: "status", json: true }, mockRuntime);

      expect(mocks.getMemorySearchManager).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "default-agent" }),
      );
    });
  });
});
