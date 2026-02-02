/**
 * Tests for Plan-Build ADW
 */

import { describe, it, expect } from "vitest";

import {
  createPlanBuildDefinition,
  parsePlanFromOutput,
  parseBuildResult,
  getPlanBuildResults,
  type PlanBuildInput,
} from "./adw-plan-build.js";
import type { ADWResult } from "./adw-base.js";

describe("Plan-Build ADW", () => {
  describe("createPlanBuildDefinition", () => {
    it("creates a valid workflow definition", () => {
      const definition = createPlanBuildDefinition();

      expect(definition.id).toBe("plan-build");
      expect(definition.name).toBe("Plan and Build");
      expect(definition.stages).toHaveLength(2);
      expect(definition.retryConfig).toBeDefined();
      expect(definition.totalTimeoutSeconds).toBeGreaterThan(0);
    });

    it("has planning stage as first stage", () => {
      const definition = createPlanBuildDefinition();
      const planStage = definition.stages[0];

      expect(planStage.id).toBe("plan");
      expect(planStage.name).toBe("Planning");
      expect(planStage.required).toBe(true);
      expect(planStage.agent.thinking).toBe("high");
    });

    it("has build stage depending on plan stage", () => {
      const definition = createPlanBuildDefinition();
      const buildStage = definition.stages[1];

      expect(buildStage.id).toBe("build");
      expect(buildStage.name).toBe("Implementation");
      expect(buildStage.dependsOn).toContain("plan");
    });

    it("accepts custom options", () => {
      const definition = createPlanBuildDefinition({
        totalTimeoutSeconds: 3600,
        tags: ["custom", "test"],
      });

      expect(definition.totalTimeoutSeconds).toBe(3600);
      expect(definition.tags).toContain("custom");
    });
  });

  describe("parsePlanFromOutput", () => {
    it("parses a basic plan", () => {
      const output = `
## Summary
Add a new feature for user authentication

## Tasks
1. Create auth module - Set up the basic auth structure
2. Add login endpoint - Implement login API
3. Add tests - Write unit tests

## Success Criteria
- Users can log in
- Tests pass

## Risks
- Security vulnerabilities
- Performance impact
`;

      const plan = parsePlanFromOutput(output);

      expect(plan).not.toBeNull();
      expect(plan?.summary).toContain("authentication");
      expect(plan?.tasks.length).toBeGreaterThan(0);
      expect(plan?.successCriteria.length).toBeGreaterThan(0);
      expect(plan?.risks.length).toBeGreaterThan(0);
    });

    it("extracts summary from first line if no section", () => {
      const output = "Implement user settings page with profile editing";

      const plan = parsePlanFromOutput(output);

      expect(plan).not.toBeNull();
      expect(plan?.summary).toContain("settings");
    });

    it("creates default task if none found", () => {
      const output = "Just implement the feature as described";

      const plan = parsePlanFromOutput(output);

      expect(plan).not.toBeNull();
      expect(plan?.tasks.length).toBeGreaterThan(0);
    });

    it("extracts tasks from numbered lists", () => {
      const output = `
1. First task: Do the first thing
2. Second task: Do the second thing
3. Third task: Do the third thing
`;

      const plan = parsePlanFromOutput(output);

      expect(plan).not.toBeNull();
      expect(plan?.tasks.length).toBe(3);
      expect(plan?.tasks[0].title).toContain("First task");
    });

    it("extracts tasks from bullet lists", () => {
      const output = `
- Task A: Description of A
- Task B: Description of B
`;

      const plan = parsePlanFromOutput(output);

      expect(plan).not.toBeNull();
      expect(plan?.tasks.length).toBe(2);
    });

    it("returns null for empty output", () => {
      const plan = parsePlanFromOutput("");

      // Should still return a plan with defaults
      expect(plan).not.toBeNull();
      expect(plan?.tasks.length).toBeGreaterThan(0);
    });
  });

  describe("parseBuildResult", () => {
    it("extracts modified files", () => {
      const output = `
Modified src/auth/login.ts
Created src/auth/types.ts
Updated src/index.ts
`;

      const result = parseBuildResult(output);

      expect(result.filesModified).toContain("src/auth/login.ts");
      expect(result.filesModified).toContain("src/auth/types.ts");
      expect(result.filesModified).toContain("src/index.ts");
    });

    it("extracts commit SHAs", () => {
      const output = `
Created commit: abc1234
Pushed commit: def5678
`;

      const result = parseBuildResult(output);

      expect(result.commits).toContain("abc1234");
      expect(result.commits).toContain("def5678");
    });

    it("detects test results", () => {
      const output = "Tests ran successfully. All 42 tests passed.";

      const result = parseBuildResult(output);

      expect(result.testsRun).toBe(true);
      expect(result.testsPassed).toBe(true);
    });

    it("detects test failures", () => {
      const output = "Tests ran. 3 tests failed out of 10.";

      const result = parseBuildResult(output);

      expect(result.testsRun).toBe(true);
      expect(result.testsPassed).toBe(false);
    });

    it("extracts completed tasks", () => {
      const output = `
Completed: Authentication module
Done: Login endpoint
Finished: Unit tests
`;

      const result = parseBuildResult(output);

      expect(result.completedTasks.length).toBe(3);
    });

    it("extracts issues", () => {
      const output = `
Issue: Type error in auth module
Warning: Deprecated API usage
Problem: Missing test coverage
`;

      const result = parseBuildResult(output);

      expect(result.issues).toBeDefined();
      expect(result.issues?.length).toBe(3);
    });

    it("handles output with no extractable content", () => {
      const output = "Implementation complete.";

      const result = parseBuildResult(output);

      expect(result.filesModified).toEqual([]);
      expect(result.commits).toBeUndefined();
      expect(result.completedTasks).toEqual([]);
    });
  });

  describe("getPlanBuildResults", () => {
    it("extracts results from completed workflow", () => {
      const planOutput = `
## Summary
Build auth feature

## Tasks
1. Create module
`;

      const buildOutput = `
Modified src/auth.ts
Completed: Module creation
`;

      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "plan-build",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "plan",
            stageName: "Planning",
            status: "completed",
            startedAt: Date.now() - 1000,
            endedAt: Date.now() - 500,
            durationMs: 500,
            output: planOutput,
            retryCount: 0,
          },
          {
            stageId: "build",
            stageName: "Implementation",
            status: "completed",
            startedAt: Date.now() - 500,
            endedAt: Date.now(),
            durationMs: 500,
            output: buildOutput,
            retryCount: 0,
          },
        ],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      const { plan, build } = getPlanBuildResults(mockResult);

      expect(plan).not.toBeNull();
      expect(plan?.summary).toContain("auth");
      expect(build).not.toBeNull();
      expect(build?.filesModified).toContain("src/auth.ts");
    });

    it("handles missing stage outputs", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "plan-build",
        status: "failed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "plan",
            stageName: "Planning",
            status: "failed",
            startedAt: Date.now() - 1000,
            endedAt: Date.now(),
            durationMs: 1000,
            error: "Failed to plan",
            retryCount: 0,
          },
        ],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      const { plan, build } = getPlanBuildResults(mockResult);

      expect(plan).toBeNull();
      expect(build).toBeNull();
    });
  });

  describe("PlanBuildInput type", () => {
    it("accepts minimal input", () => {
      const input: PlanBuildInput = {
        request: "Add a logout button",
      };

      expect(input.request).toBe("Add a logout button");
    });

    it("accepts full input", () => {
      const input: PlanBuildInput = {
        request: "Add authentication",
        codebaseContext: "React app with TypeScript",
        constraints: ["Use existing auth library", "No breaking changes"],
        commitPerStep: true,
        branch: "feature/auth",
        relevantFiles: ["src/App.tsx", "src/auth/index.ts"],
      };

      expect(input.constraints).toHaveLength(2);
      expect(input.relevantFiles).toHaveLength(2);
    });
  });
});
