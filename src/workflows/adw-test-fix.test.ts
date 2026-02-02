/**
 * Tests for Test-Fix ADW
 */

import { describe, it, expect } from "vitest";

import {
  createTestFixDefinition,
  parseAnalysis,
  parseFixResult,
  parseVerificationResult,
  getTestFixResults,
  wasFixSuccessful,
  type TestFixInput,
} from "./adw-test-fix.js";
import type { ADWResult } from "./adw-base.js";

describe("Test-Fix ADW", () => {
  describe("createTestFixDefinition", () => {
    it("creates a valid workflow definition", () => {
      const definition = createTestFixDefinition();

      expect(definition.id).toBe("test-fix");
      expect(definition.name).toBe("Test and Fix");
      expect(definition.stages).toHaveLength(3);
    });

    it("has analysis stage first", () => {
      const definition = createTestFixDefinition();
      const analyzeStage = definition.stages[0];

      expect(analyzeStage.id).toBe("analyze");
      expect(analyzeStage.name).toBe("Root Cause Analysis");
      expect(analyzeStage.required).toBe(true);
      expect(analyzeStage.agent.thinking).toBe("high");
    });

    it("has fix stage depending on analyze", () => {
      const definition = createTestFixDefinition();
      const fixStage = definition.stages[1];

      expect(fixStage.id).toBe("fix");
      expect(fixStage.dependsOn).toContain("analyze");
    });

    it("has verify stage depending on fix", () => {
      const definition = createTestFixDefinition();
      const verifyStage = definition.stages[2];

      expect(verifyStage.id).toBe("verify");
      expect(verifyStage.dependsOn).toContain("fix");
    });

    it("accepts custom options", () => {
      const definition = createTestFixDefinition({
        totalTimeoutSeconds: 7200,
      });

      expect(definition.totalTimeoutSeconds).toBe(7200);
    });
  });

  describe("parseAnalysis", () => {
    it("parses root cause analysis", () => {
      const output = `
## Summary
Test failure in auth module due to undefined user object

## Root Cause
The user object is not being initialized before accessing properties.
This is a high confidence finding.

## Affected Files
- src/auth/login.ts
- src/auth/session.ts

## Proposed Fixes
Fix 1: Add null check before accessing user properties
Fix 2: Initialize user object with defaults
Fix 3: Use optional chaining
`;

      const analysis = parseAnalysis(output);

      expect(analysis).not.toBeNull();
      expect(analysis?.summary).toContain("auth");
      expect(analysis?.rootCause).toContain("user object");
      expect(analysis?.confidence).toBe("high");
      expect(analysis?.affectedFiles.length).toBeGreaterThan(0);
      expect(analysis?.proposedFixes.length).toBe(3);
    });

    it("extracts confidence levels", () => {
      const highOutput = "Root cause identified with high confidence";
      const lowOutput = "Possible cause with low confidence";

      expect(parseAnalysis(highOutput)?.confidence).toBe("high");
      expect(parseAnalysis(lowOutput)?.confidence).toBe("low");
    });

    it("extracts file paths from analysis", () => {
      const output = `
Affected file: src/components/Button.tsx
The file: src/utils/helpers.ts is also involved
`;

      const analysis = parseAnalysis(output);

      expect(analysis?.affectedFiles).toContain("src/components/Button.tsx");
      expect(analysis?.affectedFiles).toContain("src/utils/helpers.ts");
    });

    it("handles minimal output", () => {
      const output = "The test is failing because of a null reference error";

      const analysis = parseAnalysis(output);

      expect(analysis).not.toBeNull();
      expect(analysis?.proposedFixes.length).toBeGreaterThan(0);
    });
  });

  describe("parseFixResult", () => {
    it("extracts modified files", () => {
      const output = `
Modified src/auth/login.ts to add null check
Changed src/auth/types.ts for type safety
`;

      const result = parseFixResult(output);

      expect(result).not.toBeNull();
      expect(result?.filesModified).toContain("src/auth/login.ts");
      expect(result?.filesModified).toContain("src/auth/types.ts");
    });

    it("extracts commit information", () => {
      const output = `
Changes committed.
Commit: abc123def456
`;

      const result = parseFixResult(output);

      expect(result?.committed).toBe(true);
      expect(result?.commitSha).toBe("abc123def456");
    });

    it("extracts changes description", () => {
      const output = `
Fix: Added null check in login handler
Changes: Updated validation logic
`;

      const result = parseFixResult(output);

      expect(result?.changes).toContain("null check");
    });

    it("handles output without commit", () => {
      const output = "Modified src/test.ts";

      const result = parseFixResult(output);

      expect(result?.committed).toBe(false);
      expect(result?.commitSha).toBeUndefined();
    });
  });

  describe("parseVerificationResult", () => {
    it("parses test results", () => {
      const output = `
Test Results:
42 tests passed
0 tests failed
3 tests skipped

Target test now passes!
`;

      const result = parseVerificationResult(output);

      expect(result).not.toBeNull();
      expect(result?.testResults.passed).toBe(42);
      expect(result?.testResults.failed).toBe(0);
      expect(result?.testResults.skipped).toBe(3);
      expect(result?.targetTestPassed).toBe(true);
      expect(result?.passed).toBe(true);
    });

    it("detects failing tests", () => {
      const output = `
40 passed
2 failed
`;

      const result = parseVerificationResult(output);

      expect(result?.testResults.failed).toBe(2);
      expect(result?.passed).toBe(false);
    });

    it("detects new failures", () => {
      const output = `
All original tests pass.
New failure: test/other.test.ts
New failure: test/edge.test.ts
`;

      const result = parseVerificationResult(output);

      expect(result?.newFailures).toBeDefined();
      expect(result?.newFailures?.length).toBe(2);
    });

    it("determines target test status", () => {
      const passOutput = "The originally failing test now passes";
      const failOutput = "Target test still fails";

      expect(parseVerificationResult(passOutput)?.targetTestPassed).toBe(true);
      // Without explicit pass statement and with failures, should be false
      expect(parseVerificationResult(failOutput + "\n5 failed")?.targetTestPassed).toBe(false);
    });

    it("handles minimal output", () => {
      const output = "10 passed";

      const result = parseVerificationResult(output);

      expect(result?.testResults.passed).toBe(10);
      expect(result?.testResults.failed).toBe(0);
    });
  });

  describe("getTestFixResults", () => {
    it("extracts all stage results", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "test-fix",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "analyze",
            stageName: "Root Cause Analysis",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "Summary: Null check issue\nRoot cause: Missing validation",
            retryCount: 0,
          },
          {
            stageId: "fix",
            stageName: "Implement Fix",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "Modified src/test.ts",
            retryCount: 0,
          },
          {
            stageId: "verify",
            stageName: "Verify Fix",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "10 passed, 0 failed. Target test passes!",
            retryCount: 0,
          },
        ],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      const { analysis, fix, verification } = getTestFixResults(mockResult);

      expect(analysis).not.toBeNull();
      expect(fix).not.toBeNull();
      expect(verification).not.toBeNull();
    });
  });

  describe("wasFixSuccessful", () => {
    it("returns true for successful fix", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "test-fix",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "verify",
            stageName: "Verify Fix",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "10 passed, 0 failed. Target test now passes!",
            retryCount: 0,
          },
        ],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      expect(wasFixSuccessful(mockResult)).toBe(true);
    });

    it("returns false for failed workflow", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "test-fix",
        status: "failed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
        error: "Stage failed",
      };

      expect(wasFixSuccessful(mockResult)).toBe(false);
    });

    it("returns false when tests still fail", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "test-fix",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "verify",
            stageName: "Verify Fix",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "8 passed, 2 failed",
            retryCount: 0,
          },
        ],
        trigger: { type: "manual" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      expect(wasFixSuccessful(mockResult)).toBe(false);
    });
  });

  describe("TestFixInput type", () => {
    it("accepts minimal input", () => {
      const input: TestFixInput = {
        issue: "Test failing with null error",
        issueType: "test_failure",
      };

      expect(input.issue).toBe("Test failing with null error");
      expect(input.issueType).toBe("test_failure");
    });

    it("accepts full input", () => {
      const input: TestFixInput = {
        issue: "Login test failing",
        issueType: "test_failure",
        testFiles: ["src/auth/login.test.ts"],
        sourceFiles: ["src/auth/login.ts"],
        stackTrace: "Error: Cannot read property of undefined\n  at login.ts:42",
        expectedBehavior: "Should return user object",
        actualBehavior: "Returns undefined",
        context: "After recent refactor",
        maxAttempts: 3,
      };

      expect(input.testFiles).toHaveLength(1);
      expect(input.sourceFiles).toHaveLength(1);
      expect(input.maxAttempts).toBe(3);
    });
  });
});
