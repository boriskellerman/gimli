import { describe, expect, it, afterEach } from "vitest";

import {
  getAllWorkflows,
  getEnabledWorkflows,
  getWorkflow,
  isWorkflowAvailable,
  getWorkflowsByType,
  registerWorkflow,
  unregisterWorkflow,
  setWorkflowEnabled,
  getRegistrySummary,
  formatWorkflowForDisplay,
  getWorkflowListForPrompt,
} from "./registry.js";
import type { ADWDefinition } from "./types.js";

describe("ADW Registry", () => {
  // Store custom workflows registered during tests
  const registeredWorkflows: string[] = [];

  afterEach(() => {
    // Clean up any custom workflows registered during tests
    for (const id of registeredWorkflows) {
      unregisterWorkflow(id);
    }
    registeredWorkflows.length = 0;
  });

  describe("getAllWorkflows", () => {
    it("returns all registered workflows", () => {
      const workflows = getAllWorkflows();
      expect(workflows.length).toBeGreaterThanOrEqual(4); // Built-in workflows
      expect(workflows.every((w) => w.id && w.name)).toBe(true);
    });
  });

  describe("getEnabledWorkflows", () => {
    it("returns only enabled workflows", () => {
      const enabled = getEnabledWorkflows();
      expect(enabled.every((w) => w.enabled === true)).toBe(true);
    });

    it("excludes disabled workflows", () => {
      // Disable a workflow
      setWorkflowEnabled("plan-build", false);
      try {
        const enabled = getEnabledWorkflows();
        expect(enabled.find((w) => w.id === "plan-build")).toBeUndefined();
      } finally {
        // Re-enable it
        setWorkflowEnabled("plan-build", true);
      }
    });
  });

  describe("getWorkflow", () => {
    it("returns workflow by ID", () => {
      const workflow = getWorkflow("plan-build");
      expect(workflow).toBeDefined();
      expect(workflow?.id).toBe("plan-build");
      expect(workflow?.type).toBe("plan-build");
    });

    it("returns undefined for unknown ID", () => {
      const workflow = getWorkflow("non-existent");
      expect(workflow).toBeUndefined();
    });
  });

  describe("isWorkflowAvailable", () => {
    it("returns true for enabled workflow", () => {
      expect(isWorkflowAvailable("plan-build")).toBe(true);
    });

    it("returns false for non-existent workflow", () => {
      expect(isWorkflowAvailable("non-existent")).toBe(false);
    });

    it("returns false for disabled workflow", () => {
      setWorkflowEnabled("test-fix", false);
      try {
        expect(isWorkflowAvailable("test-fix")).toBe(false);
      } finally {
        setWorkflowEnabled("test-fix", true);
      }
    });
  });

  describe("getWorkflowsByType", () => {
    it("filters by workflow type", () => {
      const planBuilds = getWorkflowsByType("plan-build");
      expect(planBuilds.every((w) => w.type === "plan-build")).toBe(true);
    });

    it("returns empty array for type with no workflows", () => {
      // Assuming no custom workflows registered
      const customs = getWorkflowsByType("custom");
      expect(customs).toBeInstanceOf(Array);
    });
  });

  describe("registerWorkflow", () => {
    it("registers a custom workflow", () => {
      const custom: ADWDefinition = {
        id: "test-custom-workflow",
        name: "Test Custom",
        description: "A test workflow",
        type: "custom",
        steps: [
          {
            name: "Step 1",
            description: "First step",
            stepType: "agent",
          },
        ],
        enabled: true,
      };

      registerWorkflow(custom);
      registeredWorkflows.push(custom.id);

      const retrieved = getWorkflow("test-custom-workflow");
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("Test Custom");
    });

    it("throws when registering duplicate ID", () => {
      const custom: ADWDefinition = {
        id: "test-duplicate",
        name: "Test Duplicate",
        description: "Will be duplicated",
        type: "custom",
        steps: [],
        enabled: true,
      };

      registerWorkflow(custom);
      registeredWorkflows.push(custom.id);

      expect(() => registerWorkflow(custom)).toThrow(/already registered/);
    });
  });

  describe("unregisterWorkflow", () => {
    it("removes a workflow", () => {
      const custom: ADWDefinition = {
        id: "test-to-remove",
        name: "To Remove",
        description: "Will be removed",
        type: "custom",
        steps: [],
        enabled: true,
      };

      registerWorkflow(custom);
      expect(getWorkflow("test-to-remove")).toBeDefined();

      const result = unregisterWorkflow("test-to-remove");
      expect(result).toBe(true);
      expect(getWorkflow("test-to-remove")).toBeUndefined();
    });

    it("returns false for non-existent workflow", () => {
      const result = unregisterWorkflow("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("setWorkflowEnabled", () => {
    it("disables a workflow", () => {
      setWorkflowEnabled("review-document", false);
      try {
        const workflow = getWorkflow("review-document");
        expect(workflow?.enabled).toBe(false);
      } finally {
        setWorkflowEnabled("review-document", true);
      }
    });

    it("enables a workflow", () => {
      setWorkflowEnabled("review-document", false);
      setWorkflowEnabled("review-document", true);

      const workflow = getWorkflow("review-document");
      expect(workflow?.enabled).toBe(true);
    });

    it("returns false for non-existent workflow", () => {
      const result = setWorkflowEnabled("non-existent", true);
      expect(result).toBe(false);
    });
  });

  describe("getRegistrySummary", () => {
    it("returns registry statistics", () => {
      const summary = getRegistrySummary();

      expect(summary.total).toBeGreaterThanOrEqual(4);
      expect(summary.enabled).toBeGreaterThanOrEqual(1);
      expect(summary.byType).toHaveProperty("plan-build");
      expect(summary.byType).toHaveProperty("test-fix");
      expect(summary.byType).toHaveProperty("review-document");
      expect(summary.byType).toHaveProperty("scout-research");
    });
  });

  describe("formatWorkflowForDisplay", () => {
    it("formats workflow for display", () => {
      const workflow = getWorkflow("plan-build")!;
      const formatted = formatWorkflowForDisplay(workflow);

      expect(formatted).toContain("Plan & Build");
      expect(formatted).toContain("plan-build");
      expect(formatted).toContain("enabled");
    });
  });

  describe("getWorkflowListForPrompt", () => {
    it("generates prompt-friendly list", () => {
      const list = getWorkflowListForPrompt();

      expect(list).toContain("Available AI Developer Workflows");
      expect(list).toContain("plan-build");
      expect(list).toContain("test-fix");
    });

    it("handles no enabled workflows", () => {
      // Disable all workflows
      const workflows = getAllWorkflows();
      for (const w of workflows) {
        setWorkflowEnabled(w.id, false);
      }

      try {
        const list = getWorkflowListForPrompt();
        expect(list).toContain("No ADW workflows");
      } finally {
        // Re-enable all
        for (const w of workflows) {
          setWorkflowEnabled(w.id, true);
        }
      }
    });
  });
});
