import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock config IO module
const loadConfigMock = vi.fn();
const readConfigFileSnapshotMock = vi.fn();
vi.mock("../../config/io.js", () => ({
  loadConfig: () => loadConfigMock(),
  readConfigFileSnapshot: () => readConfigFileSnapshotMock(),
}));

// Mock config paths
vi.mock("../../config/paths.js", () => ({
  resolveConfigPath: () => "/home/user/.gimli/gimli.json",
  resolveStateDir: () => "/home/user/.gimli",
}));

import { createConfigTool } from "./config-tool.js";

describe("config tool", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    readConfigFileSnapshotMock.mockReset();
  });

  describe("action: get", () => {
    it("returns full config when no key specified", async () => {
      loadConfigMock.mockReturnValue({
        logging: { level: "info" },
        agents: { defaults: { model: "claude" } },
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-1", { action: "get" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "get",
        key: "(root)",
      });
      expect((result.details as Record<string, unknown>).value).toMatchObject({
        logging: { level: "info" },
      });
    });

    it("returns nested value by key path", async () => {
      loadConfigMock.mockReturnValue({
        logging: { level: "debug", file: "/tmp/test.log" },
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-2", {
        action: "get",
        key: "logging.level",
      });

      expect(result.details).toMatchObject({
        ok: true,
        action: "get",
        key: "logging.level",
        value: "debug",
      });
    });

    it("returns undefined for missing key paths", async () => {
      loadConfigMock.mockReturnValue({
        logging: { level: "info" },
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-3", {
        action: "get",
        key: "nonexistent.path",
      });

      expect(result.details).toMatchObject({
        ok: true,
        action: "get",
        key: "nonexistent.path",
        value: undefined,
      });
    });

    it("redacts sensitive values containing token/key/secret", async () => {
      loadConfigMock.mockReturnValue({
        gateway: {
          auth: {
            token: "supersecrettoken123",
            apiKey: "sk-12345678",
          },
          port: 8080,
        },
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-4", { action: "get" });
      const value = (result.details as Record<string, unknown>).value as Record<string, unknown>;

      expect((value.gateway as Record<string, unknown>).port).toBe(8080);
      expect(
        ((value.gateway as Record<string, unknown>).auth as Record<string, unknown>).token,
      ).toBe("[REDACTED]");
      expect(
        ((value.gateway as Record<string, unknown>).auth as Record<string, unknown>).apiKey,
      ).toBe("[REDACTED]");
    });
  });

  describe("action: get-path", () => {
    it("returns config and state directory paths", async () => {
      const tool = createConfigTool();
      const result = await tool.execute("call-5", { action: "get-path" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "get-path",
        configPath: "/home/user/.gimli/gimli.json",
        stateDir: "/home/user/.gimli",
      });
    });
  });

  describe("action: validate", () => {
    it("returns valid status for valid config", async () => {
      readConfigFileSnapshotMock.mockResolvedValue({
        valid: true,
        exists: true,
        path: "/home/user/.gimli/gimli.json",
        issues: [],
        warnings: [],
        legacyIssues: [],
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-6", { action: "validate" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "validate",
        valid: true,
        exists: true,
        path: "/home/user/.gimli/gimli.json",
      });
    });

    it("returns issues for invalid config", async () => {
      readConfigFileSnapshotMock.mockResolvedValue({
        valid: false,
        exists: true,
        path: "/home/user/.gimli/gimli.json",
        issues: [{ path: "logging.level", message: "Invalid log level" }],
        warnings: [],
        legacyIssues: [],
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-7", { action: "validate" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "validate",
        valid: false,
        issues: [{ path: "logging.level", message: "Invalid log level" }],
      });
    });
  });

  describe("action: list-keys", () => {
    it("returns top-level config keys with descriptions", async () => {
      loadConfigMock.mockReturnValue({
        logging: { level: "info" },
        agents: {},
        gateway: {},
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-8", { action: "list-keys" });

      expect(result.details).toMatchObject({
        ok: true,
        action: "list-keys",
      });

      const keys = (result.details as Record<string, unknown>).keys as Array<{
        key: string;
        description: string;
      }>;
      expect(keys.some((k) => k.key === "logging")).toBe(true);
      expect(keys.some((k) => k.key === "agents")).toBe(true);
      expect(keys.some((k) => k.key === "gateway")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("returns error for unknown action", async () => {
      const tool = createConfigTool();
      // TypeScript prevents this normally, but test runtime behavior
      const result = await tool.execute("call-err", { action: "unknown" as "get" });

      expect(result.details).toMatchObject({
        ok: false,
        error: "Unknown action: unknown",
      });
    });

    it("handles config load errors gracefully", async () => {
      loadConfigMock.mockImplementation(() => {
        throw new Error("Config parse error");
      });

      const tool = createConfigTool();
      const result = await tool.execute("call-err-2", { action: "get" });

      expect(result.details).toMatchObject({
        ok: false,
      });
      expect((result.details as Record<string, unknown>).error).toContain("Config parse error");
    });
  });
});
