import { describe, expect, it } from "vitest";

import { applyOrchestratorPreset, ORCHESTRATOR_PRESETS } from "./orchestrator-types.js";

describe("Orchestrator Types", () => {
  describe("ORCHESTRATOR_PRESETS", () => {
    it("has minimal preset", () => {
      expect(ORCHESTRATOR_PRESETS.minimal).toBeDefined();
      expect(ORCHESTRATOR_PRESETS.minimal.role).toBe("coordinator");
      expect(ORCHESTRATOR_PRESETS.minimal.canTriggerADWs).toBe(false);
      expect(ORCHESTRATOR_PRESETS.minimal.maxConcurrentAgents).toBe(3);
    });

    it("has standard preset", () => {
      expect(ORCHESTRATOR_PRESETS.standard).toBeDefined();
      expect(ORCHESTRATOR_PRESETS.standard.role).toBe("coordinator");
      expect(ORCHESTRATOR_PRESETS.standard.canTriggerADWs).toBe(true);
      expect(ORCHESTRATOR_PRESETS.standard.maxConcurrentAgents).toBe(10);
    });

    it("has supervisor preset", () => {
      expect(ORCHESTRATOR_PRESETS.supervisor).toBeDefined();
      expect(ORCHESTRATOR_PRESETS.supervisor.role).toBe("supervisor");
      expect(ORCHESTRATOR_PRESETS.supervisor.canCreateAgents).toBe(false);
      expect(ORCHESTRATOR_PRESETS.supervisor.canDeleteAgents).toBe(true);
    });

    it("has planner preset", () => {
      expect(ORCHESTRATOR_PRESETS.planner).toBeDefined();
      expect(ORCHESTRATOR_PRESETS.planner.role).toBe("planner");
      expect(ORCHESTRATOR_PRESETS.planner.canCreateAgents).toBe(true);
    });

    it("has executor preset", () => {
      expect(ORCHESTRATOR_PRESETS.executor).toBeDefined();
      expect(ORCHESTRATOR_PRESETS.executor.role).toBe("executor");
      expect(ORCHESTRATOR_PRESETS.executor.canTriggerADWs).toBe(true);
      expect(ORCHESTRATOR_PRESETS.executor.maxConcurrentAgents).toBe(15);
    });
  });

  describe("applyOrchestratorPreset", () => {
    it("applies preset values", () => {
      const config = applyOrchestratorPreset("minimal");

      expect(config.role).toBe("coordinator");
      expect(config.canCreateAgents).toBe(true);
      expect(config.canDeleteAgents).toBe(false);
      expect(config.canTriggerADWs).toBe(false);
      expect(config.maxConcurrentAgents).toBe(3);
    });

    it("allows overrides", () => {
      const config = applyOrchestratorPreset("minimal", {
        maxConcurrentAgents: 5,
        customInstructions: "Custom rules",
      });

      expect(config.maxConcurrentAgents).toBe(5);
      expect(config.customInstructions).toBe("Custom rules");
      // Base values from preset should still apply
      expect(config.role).toBe("coordinator");
    });

    it("throws for unknown preset", () => {
      expect(() => applyOrchestratorPreset("unknown" as keyof typeof ORCHESTRATOR_PRESETS)).toThrow(
        /Unknown orchestrator preset/,
      );
    });

    it("executor preset enables ADWs", () => {
      const config = applyOrchestratorPreset("executor");

      expect(config.canTriggerADWs).toBe(true);
      expect(config.canCreateAgents).toBe(true);
      expect(config.canDeleteAgents).toBe(true);
    });
  });
});
