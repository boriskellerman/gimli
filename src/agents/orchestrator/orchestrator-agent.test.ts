import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  createOrchestratorConfig,
  getOrchestratorConfig,
  listOrchestrators,
  shutdownOrchestrator,
  orchestratorListADWs,
} from "./orchestrator-agent.js";

// Mock the gateway and other dependencies
vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: vi.fn(() => Promise.resolve({ runId: "mock-run-id" })),
}));

vi.mock("../agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => "main"),
}));

vi.mock("../subagent-registry.js", () => ({
  registerSubagentRun: vi.fn(),
}));

vi.mock("../../adw/connector.js", () => ({
  triggerADW: vi.fn(() => Promise.resolve({ success: true, runId: "adw-run-123" })),
  getADWRunStatus: vi.fn(() => ({ status: "completed" })),
  listAvailableADWs: vi.fn(() => [
    { id: "plan-build", name: "Plan & Build", type: "plan-build", enabled: true },
    { id: "test-fix", name: "Test & Fix", type: "test-fix", enabled: true },
  ]),
  cancelADWRun: vi.fn(() => true),
}));

describe("Orchestrator Agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any orchestrators created during tests
    for (const orch of listOrchestrators()) {
      shutdownOrchestrator(orch.id);
    }
  });

  describe("createOrchestratorConfig", () => {
    it("creates config with defaults", () => {
      const config = createOrchestratorConfig("test-orch-1");

      expect(config.id).toBe("test-orch-1");
      expect(config.name).toBe("Orchestrator-test-orch-1");
      expect(config.role).toBe("coordinator");
      expect(config.managedAgents).toEqual(["*"]);
      expect(config.canCreateAgents).toBe(true);
      expect(config.canDeleteAgents).toBe(true);
      expect(config.canTriggerADWs).toBe(true);
    });

    it("creates config with minimal preset", () => {
      const config = createOrchestratorConfig("test-orch-2", { preset: "minimal" });

      expect(config.canTriggerADWs).toBe(false);
      expect(config.maxConcurrentAgents).toBe(3);
    });

    it("creates config with executor preset", () => {
      const config = createOrchestratorConfig("test-orch-3", { preset: "executor" });

      expect(config.role).toBe("executor");
      expect(config.canTriggerADWs).toBe(true);
      expect(config.maxConcurrentAgents).toBe(15);
    });

    it("allows custom overrides", () => {
      const config = createOrchestratorConfig("test-orch-4", {
        name: "My Custom Orchestrator",
        managedAgents: ["agent-a", "agent-b"],
        maxConcurrentAgents: 5,
        customInstructions: "Special rules",
      });

      expect(config.name).toBe("My Custom Orchestrator");
      expect(config.managedAgents).toEqual(["agent-a", "agent-b"]);
      expect(config.maxConcurrentAgents).toBe(5);
      expect(config.customInstructions).toBe("Special rules");
    });

    it("creates config with workspace directory", () => {
      const config = createOrchestratorConfig("test-orch-5", {
        workspaceDir: "/custom/workspace",
      });

      expect(config.workspaceDir).toBe("/custom/workspace");
    });

    it("creates config with available ADWs restriction", () => {
      const config = createOrchestratorConfig("test-orch-6", {
        canTriggerADWs: true,
        availableADWs: ["plan-build", "test-fix"],
      });

      expect(config.availableADWs).toEqual(["plan-build", "test-fix"]);
    });
  });

  describe("orchestratorListADWs", () => {
    it("returns empty when orchestrator not found", () => {
      const adws = orchestratorListADWs("non-existent");
      expect(adws).toEqual([]);
    });
  });

  describe("listOrchestrators", () => {
    it("returns empty array when no orchestrators", () => {
      const orchestrators = listOrchestrators();
      expect(orchestrators).toEqual([]);
    });
  });

  describe("getOrchestratorConfig", () => {
    it("returns null for non-existent orchestrator", () => {
      const config = getOrchestratorConfig("non-existent");
      expect(config).toBeNull();
    });
  });

  describe("shutdownOrchestrator", () => {
    it("returns false for non-existent orchestrator", () => {
      const result = shutdownOrchestrator("non-existent");
      expect(result).toBe(false);
    });
  });
});
