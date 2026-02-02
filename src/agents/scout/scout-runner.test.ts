import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the external dependencies
vi.mock("../../config/paths.js", () => ({
  STATE_DIR: "/tmp/gimli-test-state",
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

vi.mock("../../infra/json-file.js", () => ({
  loadJsonFile: vi.fn(),
  saveJsonFile: vi.fn(),
}));

import { callGateway } from "../../gateway/call.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import {
  runScout,
  getScoutResult,
  listScoutRuns,
  cancelScout,
  getScoutStats,
} from "./scout-runner.js";
import type { ScoutStore } from "./types.js";

const mockCallGateway = callGateway as ReturnType<typeof vi.fn>;
const mockLoadJsonFile = loadJsonFile as ReturnType<typeof vi.fn>;
const mockSaveJsonFile = saveJsonFile as ReturnType<typeof vi.fn>;

describe("Scout Runner", () => {
  const emptyStore: ScoutStore = {
    runs: {},
    stats: {
      total: 0,
      byStatus: {},
      byType: {},
      avgDurationByType: {},
      avgCostByType: {},
      totalCostUsd: 0,
    },
    lastUpdated: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadJsonFile.mockReturnValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("runScout", () => {
    it("runs a single architecture scout", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "## Summary\nArchitecture analysis complete.",
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      const result = await runScout(
        {
          type: "architecture",
          query: "Analyze src/auth/",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.type).toBe("architecture");
      expect(result.query).toBe("Analyze src/auth/");
      expect(result.status).toBe("completed");
      expect(result.id).toMatch(/^scout-/);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);

      // Verify gateway was called
      expect(mockCallGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "agent",
          params: expect.objectContaining({
            message: expect.stringContaining("Architecture Analysis"),
            extraSystemPrompt: expect.stringContaining("Architecture"),
          }),
        }),
      );

      // Verify store was saved
      expect(mockSaveJsonFile).toHaveBeenCalled();
    });

    it("runs a single pattern scout", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "## Summary\nPattern analysis complete.",
      });

      const result = await runScout(
        {
          type: "pattern",
          query: "Find error handling patterns",
          depth: "quick",
        },
        "test-session",
      );

      expect(result.type).toBe("pattern");
      expect(result.status).toBe("completed");
    });

    it("handles scout timeout", async () => {
      mockCallGateway.mockResolvedValue({
        status: "timeout",
      });

      const result = await runScout(
        {
          type: "dependency",
          query: "Analyze deps",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.status).toBe("timeout");
      expect(result.error).toContain("time limit");
    });

    it("handles scout error", async () => {
      mockCallGateway.mockResolvedValue({
        status: "error",
        error: "Gateway connection failed",
      });

      const result = await runScout(
        {
          type: "test",
          query: "Analyze tests",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Gateway connection failed");
    });

    it("handles gateway exception", async () => {
      mockCallGateway.mockRejectedValue(new Error("Network error"));

      const result = await runScout(
        {
          type: "api",
          query: "Analyze API",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Network error");
    });

    it("calculates cost from token usage", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "Analysis complete",
        usage: { inputTokens: 10000, outputTokens: 5000 },
      });

      const result = await runScout(
        {
          type: "security",
          query: "Security check",
          depth: "deep",
        },
        "test-session",
      );

      expect(result.costUsd).toBeDefined();
      expect(result.costUsd).toBeGreaterThan(0);
    });
  });

  describe("composite scouts", () => {
    it("runs feature scout with multiple child scouts", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "Scout findings",
      });

      const result = await runScout(
        {
          type: "feature",
          query: "Add OAuth2 authentication",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.type).toBe("feature");
      expect(result.status).toBe("completed");
      expect(result.childScouts).toBeDefined();
      expect(result.childScouts!.length).toBeGreaterThan(0);

      // Should have called gateway multiple times (once per child scout)
      expect(mockCallGateway).toHaveBeenCalledTimes(4);
    });

    it("runs bug scout with investigation scouts", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "Bug investigation findings",
      });

      const result = await runScout(
        {
          type: "bug",
          query: "Login fails in Safari",
          depth: "medium",
        },
        "test-session",
      );

      expect(result.type).toBe("bug");
      expect(result.status).toBe("completed");
      expect(result.childScouts).toBeDefined();

      // Bug scouts spawn 3 child scouts (pattern, test, architecture)
      expect(mockCallGateway).toHaveBeenCalledTimes(3);
    });

    it("aggregates cost from child scouts", async () => {
      mockCallGateway.mockResolvedValue({
        status: "ok",
        reply: "Findings",
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      const result = await runScout(
        {
          type: "feature",
          query: "New feature",
          depth: "quick",
        },
        "test-session",
      );

      expect(result.costUsd).toBeDefined();
      // Cost should be sum of 4 child scouts
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it("continues on partial child failure for bug scouts", async () => {
      let callCount = 0;
      mockCallGateway.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ status: "error", error: "Failed" });
        }
        return Promise.resolve({ status: "ok", reply: "Success" });
      });

      const result = await runScout(
        {
          type: "bug",
          query: "Debug issue",
          depth: "medium",
        },
        "test-session",
      );

      // Should still be completed (partial success)
      expect(result.status).toBe("completed");
    });
  });

  describe("getScoutResult", () => {
    it("returns undefined for non-existent scout", () => {
      mockLoadJsonFile.mockReturnValue(emptyStore);

      const result = getScoutResult("scout-nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns stored scout result", () => {
      const storedResult = {
        id: "scout-123",
        type: "architecture",
        query: "test",
        status: "completed",
        startedAt: Date.now(),
      };

      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: { "scout-123": storedResult },
      });

      const result = getScoutResult("scout-123");
      expect(result).toEqual(storedResult);
    });
  });

  describe("listScoutRuns", () => {
    it("returns empty array when no runs exist", () => {
      mockLoadJsonFile.mockReturnValue(emptyStore);

      const runs = listScoutRuns();
      expect(runs).toEqual([]);
    });

    it("returns runs sorted by startedAt descending", () => {
      const now = Date.now();
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-1": { id: "scout-1", startedAt: now - 2000, type: "pattern", status: "completed" },
          "scout-2": { id: "scout-2", startedAt: now - 1000, type: "test", status: "completed" },
          "scout-3": { id: "scout-3", startedAt: now, type: "api", status: "completed" },
        },
      });

      const runs = listScoutRuns();
      expect(runs[0].id).toBe("scout-3");
      expect(runs[1].id).toBe("scout-2");
      expect(runs[2].id).toBe("scout-1");
    });

    it("filters by type", () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-1": { id: "scout-1", startedAt: Date.now(), type: "pattern", status: "completed" },
          "scout-2": { id: "scout-2", startedAt: Date.now(), type: "test", status: "completed" },
        },
      });

      const runs = listScoutRuns({ type: "pattern" });
      expect(runs.length).toBe(1);
      expect(runs[0].type).toBe("pattern");
    });

    it("filters by status", () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-1": { id: "scout-1", startedAt: Date.now(), type: "pattern", status: "completed" },
          "scout-2": { id: "scout-2", startedAt: Date.now(), type: "test", status: "failed" },
        },
      });

      const runs = listScoutRuns({ status: "failed" });
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe("failed");
    });

    it("respects limit", () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-1": {
            id: "scout-1",
            startedAt: Date.now() - 3000,
            type: "pattern",
            status: "completed",
          },
          "scout-2": {
            id: "scout-2",
            startedAt: Date.now() - 2000,
            type: "test",
            status: "completed",
          },
          "scout-3": {
            id: "scout-3",
            startedAt: Date.now() - 1000,
            type: "api",
            status: "completed",
          },
        },
      });

      const runs = listScoutRuns({ limit: 2 });
      expect(runs.length).toBe(2);
    });
  });

  describe("cancelScout", () => {
    it("returns false for non-existent scout", async () => {
      mockLoadJsonFile.mockReturnValue(emptyStore);

      const cancelled = await cancelScout("scout-nonexistent");
      expect(cancelled).toBe(false);
    });

    it("returns false for already completed scout", async () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-123": {
            id: "scout-123",
            type: "architecture",
            status: "completed",
            startedAt: Date.now(),
          },
        },
      });

      const cancelled = await cancelScout("scout-123");
      expect(cancelled).toBe(false);
    });

    it("cancels running scout and updates store", async () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        runs: {
          "scout-123": {
            id: "scout-123",
            type: "architecture",
            status: "running",
            startedAt: Date.now(),
            sessionKey: "scout:scout-123",
          },
        },
      });
      mockCallGateway.mockResolvedValue({});

      const cancelled = await cancelScout("scout-123");
      expect(cancelled).toBe(true);

      // Should have tried to delete the session
      expect(mockCallGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "sessions.delete",
          params: expect.objectContaining({
            key: "scout:scout-123",
          }),
        }),
      );

      // Should have saved the updated store
      expect(mockSaveJsonFile).toHaveBeenCalled();
    });
  });

  describe("getScoutStats", () => {
    it("returns empty stats when no runs", () => {
      mockLoadJsonFile.mockReturnValue(emptyStore);

      const stats = getScoutStats();
      expect(stats.total).toBe(0);
      expect(stats.totalCostUsd).toBe(0);
    });

    it("returns stored stats", () => {
      mockLoadJsonFile.mockReturnValue({
        ...emptyStore,
        stats: {
          total: 10,
          byStatus: { completed: 8, failed: 2 },
          byType: { architecture: 5, pattern: 5 },
          avgDurationByType: { architecture: 30000, pattern: 20000 },
          avgCostByType: { architecture: 0.1, pattern: 0.05 },
          totalCostUsd: 0.75,
        },
      });

      const stats = getScoutStats();
      expect(stats.total).toBe(10);
      expect(stats.byStatus.completed).toBe(8);
      expect(stats.totalCostUsd).toBe(0.75);
    });
  });
});
