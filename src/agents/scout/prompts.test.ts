import { describe, it, expect } from "vitest";
import { getScoutSystemPrompt, buildScoutTaskPrompt, buildCompositeScoutTasks } from "./prompts.js";

describe("Scout Prompts", () => {
  describe("getScoutSystemPrompt", () => {
    it("returns a prompt for architecture scout", () => {
      const prompt = getScoutSystemPrompt("architecture");

      expect(prompt).toContain("Architecture Analysis");
      expect(prompt).toContain("Directory structure");
      expect(prompt).toContain("Design patterns");
    });

    it("returns a prompt for dependency scout", () => {
      const prompt = getScoutSystemPrompt("dependency");

      expect(prompt).toContain("Dependency Analysis");
      expect(prompt).toContain("package.json");
      expect(prompt).toContain("Security");
    });

    it("returns a prompt for pattern scout", () => {
      const prompt = getScoutSystemPrompt("pattern");

      expect(prompt).toContain("Pattern Discovery");
      expect(prompt).toContain("Naming conventions");
      expect(prompt).toContain("Error handling");
    });

    it("returns a prompt for test scout", () => {
      const prompt = getScoutSystemPrompt("test");

      expect(prompt).toContain("Test Analysis");
      expect(prompt).toContain("coverage");
      expect(prompt).toContain("Mocking");
    });

    it("returns a prompt for api scout", () => {
      const prompt = getScoutSystemPrompt("api");

      expect(prompt).toContain("API Analysis");
      expect(prompt).toContain("Endpoint");
      expect(prompt).toContain("Authentication");
    });

    it("returns a prompt for security scout", () => {
      const prompt = getScoutSystemPrompt("security");

      expect(prompt).toContain("Security Analysis");
      expect(prompt).toContain("vulnerabilities");
      expect(prompt).toContain("Authorization");
    });

    it("returns a prompt for feature scout", () => {
      const prompt = getScoutSystemPrompt("feature");

      expect(prompt).toContain("Feature Planning");
      expect(prompt).toContain("Spawn specialized scouts");
      expect(prompt).toContain("Recommendations");
    });

    it("returns a prompt for bug scout", () => {
      const prompt = getScoutSystemPrompt("bug");

      expect(prompt).toContain("Bug Investigation");
      expect(prompt).toContain("Root Cause Analysis");
      expect(prompt).toContain("Required Tests");
    });

    it("all prompts contain base instructions", () => {
      const types = [
        "architecture",
        "dependency",
        "pattern",
        "test",
        "api",
        "security",
        "feature",
        "bug",
      ] as const;

      for (const type of types) {
        const prompt = getScoutSystemPrompt(type);
        expect(prompt).toContain("scout agent");
        expect(prompt).toContain("structured format");
        expect(prompt).toContain("read-only research");
      }
    });
  });

  describe("buildScoutTaskPrompt", () => {
    it("builds a basic task prompt", () => {
      const prompt = buildScoutTaskPrompt({
        type: "architecture",
        query: "Analyze the auth module",
        depth: "medium",
      });

      expect(prompt).toContain("Architecture Analysis");
      expect(prompt).toContain("Analyze the auth module");
      expect(prompt).toContain("medium");
    });

    it("includes scope when provided", () => {
      const prompt = buildScoutTaskPrompt({
        type: "architecture",
        query: "Analyze structure",
        scope: "src/auth/",
        depth: "medium",
      });

      expect(prompt).toContain("src/auth/");
      expect(prompt).toContain("Scope");
    });

    it("includes depth instructions for quick", () => {
      const prompt = buildScoutTaskPrompt({
        type: "pattern",
        query: "Find patterns",
        depth: "quick",
      });

      expect(prompt).toContain("quick");
      expect(prompt).toContain("30 seconds");
    });

    it("includes depth instructions for deep", () => {
      const prompt = buildScoutTaskPrompt({
        type: "pattern",
        query: "Find patterns",
        depth: "deep",
      });

      expect(prompt).toContain("deep");
      expect(prompt).toContain("120 seconds");
    });

    it("includes additional context when provided", () => {
      const prompt = buildScoutTaskPrompt({
        type: "security",
        query: "Check auth",
        depth: "medium",
        additionalContext: "Focus on JWT handling",
      });

      expect(prompt).toContain("Focus on JWT handling");
      expect(prompt).toContain("Additional Context");
    });
  });

  describe("buildCompositeScoutTasks", () => {
    describe("for feature scout", () => {
      it("creates tasks for all relevant scout types", () => {
        const tasks = buildCompositeScoutTasks({
          type: "feature",
          query: "Add OAuth2",
          depth: "medium",
        });

        expect(tasks.length).toBe(4);

        const types = tasks.map((t) => t.type);
        expect(types).toContain("architecture");
        expect(types).toContain("pattern");
        expect(types).toContain("dependency");
        expect(types).toContain("test");
      });

      it("includes query in all child tasks", () => {
        const tasks = buildCompositeScoutTasks({
          type: "feature",
          query: "Add user notifications",
          depth: "medium",
        });

        for (const task of tasks) {
          expect(task.task).toContain("user notifications");
        }
      });

      it("assigns unique labels to each task", () => {
        const tasks = buildCompositeScoutTasks({
          type: "feature",
          query: "Test feature",
          depth: "medium",
        });

        const labels = new Set(tasks.map((t) => t.label));
        expect(labels.size).toBe(tasks.length);
      });
    });

    describe("for bug scout", () => {
      it("creates tasks for bug investigation", () => {
        const tasks = buildCompositeScoutTasks({
          type: "bug",
          query: "Login fails in Safari",
          depth: "medium",
        });

        expect(tasks.length).toBe(3);

        const types = tasks.map((t) => t.type);
        expect(types).toContain("pattern");
        expect(types).toContain("test");
        expect(types).toContain("architecture");
      });

      it("includes bug-specific context", () => {
        const tasks = buildCompositeScoutTasks({
          type: "bug",
          query: "Memory leak in sessions",
          depth: "medium",
        });

        // Pattern scout should focus on error handling
        const patternTask = tasks.find((t) => t.type === "pattern");
        expect(patternTask?.task).toContain("error handling");

        // Test scout should focus on gaps
        const testTask = tasks.find((t) => t.type === "test");
        expect(testTask?.task).toContain("coverage gaps");
      });
    });
  });
});
