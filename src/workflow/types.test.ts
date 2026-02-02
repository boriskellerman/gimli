import { describe, expect, it } from "vitest";
import {
  generateStepId,
  generateWorkflowId,
  getNextStage,
  getPreviousStage,
  isValidStage,
  WORKFLOW_STAGES,
} from "./types.js";

describe("workflow types", () => {
  describe("WORKFLOW_STAGES", () => {
    it("contains all five stages in order", () => {
      expect(WORKFLOW_STAGES).toEqual(["plan", "build", "test", "review", "document"]);
    });

    it("is readonly at compile time", () => {
      // TypeScript's `as const` creates a readonly array type
      // which provides compile-time immutability
      expect(Array.isArray(WORKFLOW_STAGES)).toBe(true);
      expect(WORKFLOW_STAGES.length).toBe(5);
    });
  });

  describe("getNextStage", () => {
    it("returns build after plan", () => {
      expect(getNextStage("plan")).toBe("build");
    });

    it("returns test after build", () => {
      expect(getNextStage("build")).toBe("test");
    });

    it("returns review after test", () => {
      expect(getNextStage("test")).toBe("review");
    });

    it("returns document after review", () => {
      expect(getNextStage("review")).toBe("document");
    });

    it("returns null after document (final stage)", () => {
      expect(getNextStage("document")).toBeNull();
    });

    it("returns null for invalid stage", () => {
      expect(getNextStage("invalid" as "plan")).toBeNull();
    });
  });

  describe("getPreviousStage", () => {
    it("returns null for plan (first stage)", () => {
      expect(getPreviousStage("plan")).toBeNull();
    });

    it("returns plan before build", () => {
      expect(getPreviousStage("build")).toBe("plan");
    });

    it("returns build before test", () => {
      expect(getPreviousStage("test")).toBe("build");
    });

    it("returns test before review", () => {
      expect(getPreviousStage("review")).toBe("test");
    });

    it("returns review before document", () => {
      expect(getPreviousStage("document")).toBe("review");
    });
  });

  describe("isValidStage", () => {
    it("returns true for valid stages", () => {
      expect(isValidStage("plan")).toBe(true);
      expect(isValidStage("build")).toBe(true);
      expect(isValidStage("test")).toBe(true);
      expect(isValidStage("review")).toBe(true);
      expect(isValidStage("document")).toBe(true);
    });

    it("returns false for invalid stages", () => {
      expect(isValidStage("invalid")).toBe(false);
      expect(isValidStage("")).toBe(false);
      expect(isValidStage("PLAN")).toBe(false);
      expect(isValidStage("planning")).toBe(false);
    });
  });

  describe("generateWorkflowId", () => {
    it("generates unique IDs", () => {
      const id1 = generateWorkflowId();
      const id2 = generateWorkflowId();
      expect(id1).not.toBe(id2);
    });

    it("starts with wf- prefix", () => {
      const id = generateWorkflowId();
      expect(id.startsWith("wf-")).toBe(true);
    });

    it("has reasonable length", () => {
      const id = generateWorkflowId();
      expect(id.length).toBeGreaterThan(10);
      expect(id.length).toBeLessThan(30);
    });
  });

  describe("generateStepId", () => {
    it("generates unique IDs", () => {
      const id1 = generateStepId();
      const id2 = generateStepId();
      expect(id1).not.toBe(id2);
    });

    it("starts with step- prefix", () => {
      const id = generateStepId();
      expect(id.startsWith("step-")).toBe(true);
    });

    it("has reasonable length", () => {
      const id = generateStepId();
      expect(id.length).toBeGreaterThan(8);
      expect(id.length).toBeLessThan(25);
    });
  });
});
