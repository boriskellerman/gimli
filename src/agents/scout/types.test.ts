import { describe, it, expect } from "vitest";
import {
  DEFAULT_SCOUT_CONFIG,
  type ScoutType,
  type ScoutDepth,
  type ScoutStatus,
  type ScoutConfig,
  type ScoutResult,
} from "./types.js";

describe("Scout Types", () => {
  describe("DEFAULT_SCOUT_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_SCOUT_CONFIG.depth).toBe("medium");
      expect(DEFAULT_SCOUT_CONFIG.timeoutSeconds).toBe(120);
      expect(DEFAULT_SCOUT_CONFIG.parallel).toBe(true);
      expect(DEFAULT_SCOUT_CONFIG.maxConcurrent).toBe(4);
    });

    it("can be spread with overrides", () => {
      const customConfig: ScoutConfig = {
        ...DEFAULT_SCOUT_CONFIG,
        type: "architecture",
        query: "test query",
        depth: "deep",
        timeoutSeconds: 300,
      };

      expect(customConfig.type).toBe("architecture");
      expect(customConfig.query).toBe("test query");
      expect(customConfig.depth).toBe("deep");
      expect(customConfig.timeoutSeconds).toBe(300);
      expect(customConfig.parallel).toBe(true); // From defaults
    });
  });

  describe("ScoutType", () => {
    it("supports all expected scout types", () => {
      const types: ScoutType[] = [
        "architecture",
        "dependency",
        "pattern",
        "test",
        "api",
        "security",
        "feature",
        "bug",
      ];

      // Type assertion test - if these compile, the types are correct
      for (const type of types) {
        expect(typeof type).toBe("string");
      }
    });
  });

  describe("ScoutDepth", () => {
    it("supports quick, medium, and deep", () => {
      const depths: ScoutDepth[] = ["quick", "medium", "deep"];

      for (const depth of depths) {
        expect(typeof depth).toBe("string");
      }
    });
  });

  describe("ScoutStatus", () => {
    it("supports all expected statuses", () => {
      const statuses: ScoutStatus[] = [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "timeout",
      ];

      for (const status of statuses) {
        expect(typeof status).toBe("string");
      }
    });
  });

  describe("ScoutResult", () => {
    it("can create a minimal result", () => {
      const result: ScoutResult = {
        id: "scout-123",
        type: "architecture",
        query: "test query",
        status: "pending",
        startedAt: Date.now(),
      };

      expect(result.id).toBe("scout-123");
      expect(result.type).toBe("architecture");
      expect(result.status).toBe("pending");
    });

    it("can create a completed result with findings", () => {
      const result: ScoutResult = {
        id: "scout-456",
        type: "feature",
        query: "Add new feature",
        status: "completed",
        startedAt: Date.now() - 30000,
        endedAt: Date.now(),
        durationMs: 30000,
        costUsd: 0.15,
        childScouts: ["scout-child-1", "scout-child-2"],
        findings: {
          type: "feature",
          data: {
            query: "Add new feature",
            recommendations: [],
            suggestedChanges: [],
          },
        },
      };

      expect(result.status).toBe("completed");
      expect(result.durationMs).toBe(30000);
      expect(result.costUsd).toBe(0.15);
      expect(result.childScouts).toHaveLength(2);
    });

    it("can create a failed result with error", () => {
      const result: ScoutResult = {
        id: "scout-789",
        type: "security",
        query: "Check security",
        status: "failed",
        startedAt: Date.now() - 5000,
        endedAt: Date.now(),
        durationMs: 5000,
        error: "Connection timeout",
      };

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Connection timeout");
    });
  });
});
