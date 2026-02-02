/**
 * Tests for prime-tools.ts
 *
 * Tests the database (sessions), config, logs, and memory access tools.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GimliConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import {
  createConfigTool,
  createLogsTool,
  createMemoryTool,
  createPrimeTools,
  createSessionsTool,
} from "./prime-tools.js";

// Mock modules at the top level with factory functions
vi.mock("../../memory/search-manager.js", () => {
  const mockManager = {
    status: vi.fn(),
    search: vi.fn(),
    close: vi.fn(),
  };
  return {
    getMemorySearchManager: vi.fn().mockResolvedValue({ manager: mockManager }),
    __mockManager: mockManager,
  };
});

vi.mock("../agent-scope.js", () => ({
  resolveDefaultAgentId: () => "test-agent",
}));

// Get the mock manager from the mocked module
const { __mockManager: mockMemoryManager } =
  (await import("../../memory/search-manager.js")) as typeof import("../../memory/search-manager.js") & {
    __mockManager: {
      status: ReturnType<typeof vi.fn>;
      search: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  };

describe("createSessionsTool", () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prime-tools-test-"));
    storePath = path.join(tmpDir, "sessions.json");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeStore(store: Record<string, SessionEntry>) {
    await fs.writeFile(storePath, JSON.stringify(store), "utf-8");
  }

  it("lists sessions sorted by updatedAt", async () => {
    const config: GimliConfig = { session: { store: storePath } };
    const tool = createSessionsTool({ config });

    await writeStore({
      "session-old": { key: "session-old", updatedAt: 1000 },
      "session-new": { key: "session-new", updatedAt: 3000 },
      "session-mid": { key: "session-mid", updatedAt: 2000 },
    });

    const result = await tool.execute("test", { action: "list" });
    expect(result.details).toMatchObject({ ok: true, total: 3 });

    const sessions = (result.details as { sessions: Array<{ key: string }> }).sessions;
    expect(sessions[0].key).toBe("session-new");
    expect(sessions[1].key).toBe("session-mid");
    expect(sessions[2].key).toBe("session-old");
  });

  it("gets a single session by key", async () => {
    const config: GimliConfig = { session: { store: storePath } };
    const tool = createSessionsTool({ config });

    await writeStore({
      main: {
        key: "main",
        agentId: "agent-1",
        updatedAt: Date.now(),
        deliveryContext: { channel: "telegram", to: "123" },
      },
    });

    const result = await tool.execute("test", { action: "get", key: "main" });
    expect(result.details).toMatchObject({
      ok: true,
      session: {
        key: "main",
        agentId: "agent-1",
      },
    });
  });

  it("returns error for missing session", async () => {
    const config: GimliConfig = { session: { store: storePath } };
    const tool = createSessionsTool({ config });

    await writeStore({});

    const result = await tool.execute("test", { action: "get", key: "nonexistent" });
    expect(result.details).toMatchObject({
      ok: false,
      error: "Session not found: nonexistent",
    });
  });

  it("searches sessions by pattern", async () => {
    const config: GimliConfig = { session: { store: storePath } };
    const tool = createSessionsTool({ config });

    await writeStore({
      "telegram:user1": { key: "telegram:user1", updatedAt: 1000 },
      "discord:user2": { key: "discord:user2", updatedAt: 2000 },
      "telegram:user3": { key: "telegram:user3", updatedAt: 3000 },
    });

    const result = await tool.execute("test", { action: "search", key: "telegram" });
    expect(result.details).toMatchObject({
      ok: true,
      pattern: "telegram",
      total: 2,
    });

    const sessions = (result.details as { sessions: Array<{ key: string }> }).sessions;
    expect(sessions.every((s) => s.key.includes("telegram"))).toBe(true);
  });

  it("computes session stats", async () => {
    const now = Date.now();
    const config: GimliConfig = { session: { store: storePath } };
    const tool = createSessionsTool({ config });

    await writeStore({
      main: {
        key: "main",
        updatedAt: now,
        deliveryContext: { channel: "telegram" },
      },
      "hook:webhook-1": {
        key: "hook:webhook-1",
        updatedAt: now - 1000,
        deliveryContext: { channel: "web" },
      },
      old: {
        key: "old",
        updatedAt: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
        deliveryContext: { channel: "telegram" },
      },
    });

    const result = await tool.execute("test", { action: "stats" });
    expect(result.details).toMatchObject({
      ok: true,
      stats: {
        total: 3,
        hookSessions: 1,
        activeLast24Hours: 2,
        byChannel: { telegram: 2, web: 1 },
      },
    });
  });
});

describe("createConfigTool", () => {
  it("returns config file path", async () => {
    const tool = createConfigTool();
    const result = await tool.execute("test", { action: "path" });

    expect(result.details).toMatchObject({ ok: true });
    expect((result.details as { configPath: string }).configPath).toContain("gimli.json");
  });

  it("lists top-level config keys", async () => {
    const config: GimliConfig = {
      gateway: { port: 18789 },
      agents: {},
      session: {},
    };
    const tool = createConfigTool({ config });
    const result = await tool.execute("test", { action: "list" });

    expect(result.details).toMatchObject({
      ok: true,
      keys: ["gateway", "agents", "session"],
      count: 3,
    });
  });

  it("gets value at dot-path", async () => {
    const config: GimliConfig = {
      gateway: { port: 18789, mode: "local" },
    };
    const tool = createConfigTool({ config });
    const result = await tool.execute("test", { action: "get", configPath: "gateway.port" });

    expect(result.details).toMatchObject({
      ok: true,
      path: "gateway.port",
      value: 18789,
    });
  });

  it("redacts sensitive values by default", async () => {
    const config: GimliConfig = {
      gateway: {
        auth: { token: "secret-token-123" },
      },
    };
    const tool = createConfigTool({ config });
    // When path contains "auth", the entire value is redacted
    const result = await tool.execute("test", { action: "get", configPath: "gateway.auth" });

    expect(result.details).toMatchObject({
      ok: true,
      path: "gateway.auth",
      value: "[REDACTED]",
    });
  });

  it("redacts nested sensitive keys within objects", async () => {
    const config: GimliConfig = {
      gateway: {
        settings: { port: 18789, secretKey: "my-secret" },
      },
    };
    const tool = createConfigTool({ config });
    // Nested object: only sensitive keys are redacted
    const result = await tool.execute("test", { action: "get", configPath: "gateway.settings" });

    expect(result.details).toMatchObject({
      ok: true,
      path: "gateway.settings",
      value: { port: 18789, secretKey: "[REDACTED]" },
    });
  });

  it("returns full values when redact is false", async () => {
    const config: GimliConfig = {
      gateway: {
        auth: { token: "secret-token-123" },
      },
    };
    const tool = createConfigTool({ config });
    const result = await tool.execute("test", {
      action: "get",
      configPath: "gateway.auth",
      redact: false,
    });

    expect(result.details).toMatchObject({
      ok: true,
      path: "gateway.auth",
      value: { token: "secret-token-123" },
    });
  });

  it("returns error for invalid path", async () => {
    const config: GimliConfig = { gateway: { port: 18789 } };
    const tool = createConfigTool({ config });
    const result = await tool.execute("test", { action: "get", configPath: "nonexistent.path" });

    expect(result.details).toMatchObject({
      ok: false,
      error: "Path not found: nonexistent.path",
    });
  });
});

describe("createLogsTool", () => {
  let tmpDir: string;
  let logFile: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "prime-tools-logs-"));
    logFile = path.join(tmpDir, "gimli.log");
    originalEnv = { ...process.env };
    // Use env var to control log file location
    process.env.GIMLI_LOG_FILE = logFile;
    process.env.GIMLI_LOG_DIR = tmpDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns log path info", async () => {
    const tool = createLogsTool();
    const result = await tool.execute("test", { action: "path" });

    expect(result.details).toMatchObject({ ok: true });
    expect((result.details as { logFile: string }).logFile).toBeTruthy();
  });

  it("reads tail lines from log file", async () => {
    const logLines = [
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Test message 1",
        time: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "ERROR" },
        0: "Test error",
        time: "2024-01-01T00:00:01Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Test message 2",
        time: "2024-01-01T00:00:02Z",
      }),
    ];
    // Write to the actual log file path returned by the tool
    const tool = createLogsTool();
    const pathResult = await tool.execute("test", { action: "path" });
    const actualLogFile = (pathResult.details as { logFile: string }).logFile;
    await fs.mkdir(path.dirname(actualLogFile), { recursive: true });
    await fs.writeFile(actualLogFile, logLines.join("\n") + "\n", "utf-8");

    const result = await tool.execute("test", { action: "tail", lines: 10 });

    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { count: number; lines: Array<{ message: string }> };
    expect(details.count).toBe(3);
    expect(details.lines[0].message).toBe("Test message 1");
  });

  it("searches logs by level", async () => {
    const logLines = [
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Info message",
        time: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "ERROR" },
        0: "Error message",
        time: "2024-01-01T00:00:01Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Another info",
        time: "2024-01-01T00:00:02Z",
      }),
    ];
    const tool = createLogsTool();
    const pathResult = await tool.execute("test", { action: "path" });
    const actualLogFile = (pathResult.details as { logFile: string }).logFile;
    await fs.mkdir(path.dirname(actualLogFile), { recursive: true });
    await fs.writeFile(actualLogFile, logLines.join("\n") + "\n", "utf-8");

    const result = await tool.execute("test", { action: "search", level: "error" });

    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { count: number; lines: Array<{ level: string }> };
    expect(details.count).toBe(1);
    expect(details.lines[0].level).toBe("error");
  });

  it("searches logs by text content", async () => {
    const logLines = [
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Gateway started",
        time: "2024-01-01T00:00:00Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Session created",
        time: "2024-01-01T00:00:01Z",
      }),
      JSON.stringify({
        _meta: { logLevelName: "INFO" },
        0: "Gateway restarted",
        time: "2024-01-01T00:00:02Z",
      }),
    ];
    const tool = createLogsTool();
    const pathResult = await tool.execute("test", { action: "path" });
    const actualLogFile = (pathResult.details as { logFile: string }).logFile;
    await fs.mkdir(path.dirname(actualLogFile), { recursive: true });
    await fs.writeFile(actualLogFile, logLines.join("\n") + "\n", "utf-8");

    const result = await tool.execute("test", { action: "search", contains: "gateway" });

    expect(result.details).toMatchObject({ ok: true });
    const details = result.details as { count: number; totalMatches: number };
    expect(details.totalMatches).toBe(2);
  });
});

describe("createMemoryTool", () => {
  beforeEach(() => {
    vi.mocked(mockMemoryManager.status).mockReset();
    vi.mocked(mockMemoryManager.search).mockReset();
    vi.mocked(mockMemoryManager.close).mockReset();
  });

  it("returns memory status", async () => {
    vi.mocked(mockMemoryManager.status).mockReturnValue({
      files: 10,
      chunks: 50,
      dirty: false,
      provider: "anthropic",
      model: "claude-3-haiku-20240307",
      workspaceDir: "/home/test/workspace",
      dbPath: "/home/test/.gimli/agents/test-agent/memory/index.db",
      sources: ["memory"],
      sourceCounts: [{ source: "memory", files: 10, chunks: 50 }],
      vector: { enabled: true, available: true, dims: 1536 },
      fts: { enabled: true, available: true },
    });

    const tool = createMemoryTool();
    const result = await tool.execute("test", { action: "status" });

    expect(result.details).toMatchObject({
      ok: true,
      agentId: "test-agent",
      status: {
        files: 10,
        chunks: 50,
        provider: "anthropic",
      },
    });
    expect(mockMemoryManager.close).toHaveBeenCalled();
  });

  it("searches memory semantically", async () => {
    vi.mocked(mockMemoryManager.search).mockResolvedValue([
      {
        path: "/memory/notes.md",
        startLine: 1,
        endLine: 10,
        score: 0.85,
        source: "memory",
        snippet: "This is a test snippet about deployment.",
      },
      {
        path: "/memory/other.md",
        startLine: 5,
        endLine: 15,
        score: 0.72,
        source: "memory",
        snippet: "Another relevant snippet.",
      },
    ]);

    const tool = createMemoryTool();
    const result = await tool.execute("test", {
      action: "search",
      query: "deployment process",
      limit: 5,
    });

    expect(result.details).toMatchObject({
      ok: true,
      query: "deployment process",
      count: 2,
    });

    const results = (result.details as { results: Array<{ path: string; score: number }> }).results;
    expect(results[0].path).toBe("/memory/notes.md");
    expect(results[0].score).toBe(0.85);

    expect(mockMemoryManager.search).toHaveBeenCalledWith("deployment process", {
      maxResults: 5,
      minScore: 0.3,
    });
    expect(mockMemoryManager.close).toHaveBeenCalled();
  });

  it("requires query for search action", async () => {
    const tool = createMemoryTool();

    await expect(tool.execute("test", { action: "search" })).rejects.toThrow(/query required/i);
  });
});

describe("createPrimeTools", () => {
  it("creates all four prime tools", () => {
    const tools = createPrimeTools();

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "prime_config",
      "prime_logs",
      "prime_memory",
      "prime_sessions",
    ]);
  });

  it("passes options to tools", () => {
    const config: GimliConfig = { gateway: { port: 12345 } };
    const tools = createPrimeTools({ config });

    // Verify tools were created with the config
    expect(tools).toHaveLength(4);
    const configTool = tools.find((t) => t.name === "prime_config");
    expect(configTool).toBeDefined();
  });
});
