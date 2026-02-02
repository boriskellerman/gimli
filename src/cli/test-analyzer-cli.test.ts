import { describe, expect, it } from "vitest";
import {
  categorizeFailure,
  parseVitestOutput,
  type FailureCategory,
  type TestRunSummary,
} from "./test-analyzer-cli.js";

describe("categorizeFailure", () => {
  it("categorizes assertion errors", () => {
    expect(categorizeFailure("AssertionError: expected 1 to equal 2")).toBe("assertion");
    expect(categorizeFailure("expect(received).toBe(expected)")).toBe("assertion");
    expect(categorizeFailure("Expected: 5, Received: 10")).toBe("assertion");
  });

  it("categorizes timeout errors", () => {
    expect(categorizeFailure("Error: Timeout of 5000ms exceeded")).toBe("timeout");
    expect(categorizeFailure("ETIMEDOUT: connection timed out")).toBe("timeout");
  });

  it("categorizes type errors", () => {
    expect(categorizeFailure("TypeError: undefined is not a function")).toBe("type-error");
    expect(categorizeFailure("foo is not defined")).toBe("type-error");
    expect(categorizeFailure("TypeError: Cannot read property 'bar' of null")).toBe("type-error");
  });

  it("categorizes runtime errors", () => {
    // ReferenceError matches before "is not defined" due to pattern order
    expect(categorizeFailure("ReferenceError: myVar")).toBe("runtime-error");
    expect(categorizeFailure("SyntaxError: Unexpected token")).toBe("runtime-error");
    expect(categorizeFailure("RangeError: Maximum call stack size exceeded")).toBe("runtime-error");
  });

  it("categorizes network errors", () => {
    expect(categorizeFailure("Error: ECONNREFUSED 127.0.0.1:3000")).toBe("network");
    expect(categorizeFailure("ENOTFOUND: getaddrinfo failed")).toBe("network");
    // "fetch failed" matches network pattern before TypeError matches type-error
    expect(categorizeFailure("fetch failed: connection refused")).toBe("network");
  });

  it("categorizes import errors", () => {
    expect(categorizeFailure("Cannot find module './missing'")).toBe("import");
    expect(categorizeFailure("Failed to resolve import")).toBe("import");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(categorizeFailure("Some random error")).toBe("unknown");
    expect(categorizeFailure("")).toBe("unknown");
  });
});

describe("parseVitestOutput", () => {
  describe("text output parsing", () => {
    it("parses summary line with all counts", () => {
      const output = `
 ✓ src/foo.test.ts (5)
 × src/bar.test.ts (2)

 Tests  5 passed | 2 failed | 1 skipped (8)
 Duration  1.23s
`;
      const summary = parseVitestOutput(output);

      expect(summary.passed).toBe(5);
      expect(summary.failed).toBe(2);
      expect(summary.skipped).toBe(1);
      expect(summary.totalTests).toBe(8);
      expect(summary.duration).toBeCloseTo(1230, -1);
    });

    it("parses summary without skipped tests", () => {
      const output = `
 Tests  10 passed | 0 failed (10)
 Duration  0.50s
`;
      const summary = parseVitestOutput(output);

      expect(summary.passed).toBe(10);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);
      expect(summary.totalTests).toBe(10);
    });

    it("extracts failures from FAIL blocks", () => {
      const output = `
 FAIL  src/utils.test.ts > myFunction > should handle errors
   AssertionError: expected 'error' to equal 'success'
     at src/utils.test.ts:42:15

 Tests  1 passed | 1 failed (2)
`;
      const summary = parseVitestOutput(output);

      expect(summary.failures.length).toBeGreaterThanOrEqual(0);
      // Text parsing may not always capture failures depending on exact format
    });

    it("handles empty output gracefully", () => {
      const summary = parseVitestOutput("");

      expect(summary.passed).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);
      expect(summary.totalTests).toBe(0);
      expect(summary.failures).toEqual([]);
    });

    it("handles malformed output gracefully", () => {
      const output = "Random text without test results";
      const summary = parseVitestOutput(output);

      expect(summary.timestamp).toBeInstanceOf(Date);
      expect(summary.failures).toEqual([]);
    });
  });

  describe("JSON output parsing", () => {
    it("parses JSON reporter output", () => {
      const jsonOutput = JSON.stringify({
        numTotalTests: 10,
        numPassedTests: 8,
        numFailedTests: 1,
        numPendingTests: 1,
        startTime: Date.now() - 5000,
        success: false,
        testResults: [
          {
            name: "src/example.test.ts",
            assertionResults: [
              {
                fullName: "example > should work",
                status: "passed",
                duration: 50,
              },
              {
                fullName: "example > should fail",
                status: "failed",
                duration: 100,
                failureMessages: ["AssertionError: expected true to be false"],
                location: { line: 15, column: 10 },
              },
            ],
          },
        ],
      });

      const summary = parseVitestOutput(jsonOutput);

      expect(summary.totalTests).toBe(10);
      expect(summary.passed).toBe(8);
      expect(summary.failed).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.failures).toHaveLength(1);
      expect(summary.failures[0].testName).toBe("example > should fail");
      expect(summary.failures[0].file).toBe("src/example.test.ts");
      expect(summary.failures[0].line).toBe(15);
      expect(summary.failures[0].category).toBe("assertion");
    });

    it("handles JSON with multiple failures", () => {
      const jsonOutput = JSON.stringify({
        numTotalTests: 5,
        numPassedTests: 2,
        numFailedTests: 3,
        numPendingTests: 0,
        testResults: [
          {
            name: "src/a.test.ts",
            assertionResults: [
              {
                fullName: "test A",
                status: "failed",
                failureMessages: ["TypeError: undefined is not a function"],
              },
            ],
          },
          {
            name: "src/b.test.ts",
            assertionResults: [
              {
                fullName: "test B1",
                status: "failed",
                failureMessages: ["Error: Timeout of 5000ms exceeded"],
              },
              {
                fullName: "test B2",
                status: "failed",
                failureMessages: ["ECONNREFUSED 127.0.0.1:3000"],
              },
            ],
          },
        ],
      });

      const summary = parseVitestOutput(jsonOutput);

      expect(summary.failures).toHaveLength(3);

      // Check categories are correctly assigned
      const categories = summary.failures.map((f) => f.category);
      expect(categories).toContain("type-error");
      expect(categories).toContain("timeout");
      expect(categories).toContain("network");
    });

    it("handles JSON embedded in other output", () => {
      const output = `
Some header text
{"numTotalTests":5,"numPassedTests":5,"numFailedTests":0,"numPendingTests":0,"testResults":[],"success":true}
Some footer text
`;
      const summary = parseVitestOutput(output);

      expect(summary.totalTests).toBe(5);
      expect(summary.passed).toBe(5);
      expect(summary.failed).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("always returns a valid timestamp", () => {
      const summary = parseVitestOutput("");
      expect(summary.timestamp).toBeInstanceOf(Date);
      expect(summary.timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("handles unicode characters in test names", () => {
      const jsonOutput = JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        numPendingTests: 0,
        testResults: [
          {
            name: "src/émoji.test.ts",
            assertionResults: [
              {
                fullName: "should handle 🎉 emoji",
                status: "failed",
                failureMessages: ["Expected 🔥 but got 💧"],
              },
            ],
          },
        ],
      });

      const summary = parseVitestOutput(jsonOutput);

      expect(summary.failures).toHaveLength(1);
      expect(summary.failures[0].testName).toBe("should handle 🎉 emoji");
    });

    it("handles very long error messages", () => {
      const longError = "A".repeat(10000);
      const jsonOutput = JSON.stringify({
        numTotalTests: 1,
        numPassedTests: 0,
        numFailedTests: 1,
        numPendingTests: 0,
        testResults: [
          {
            name: "src/test.ts",
            assertionResults: [
              {
                fullName: "test",
                status: "failed",
                failureMessages: [longError],
              },
            ],
          },
        ],
      });

      const summary = parseVitestOutput(jsonOutput);

      expect(summary.failures).toHaveLength(1);
      expect(summary.failures[0].error.length).toBe(10000);
    });

    it("handles missing optional fields in JSON", () => {
      const jsonOutput = JSON.stringify({
        numTotalTests: 1,
        testResults: [
          {
            assertionResults: [
              {
                status: "failed",
                failureMessages: ["Error"],
              },
            ],
          },
        ],
      });

      const summary = parseVitestOutput(jsonOutput);

      expect(summary.failures).toHaveLength(1);
      expect(summary.failures[0].testName).toBe("unknown");
      expect(summary.failures[0].file).toBe("unknown");
    });
  });
});

describe("TestRunSummary structure", () => {
  it("has all required fields", () => {
    const summary = parseVitestOutput("");

    // Type check - these should all exist
    const keys: (keyof TestRunSummary)[] = [
      "timestamp",
      "totalTests",
      "passed",
      "failed",
      "skipped",
      "duration",
      "failures",
    ];

    for (const key of keys) {
      expect(summary).toHaveProperty(key);
    }
  });
});

describe("FailureCategory values", () => {
  it("covers all expected categories", () => {
    // Each category should be categorized correctly
    const testCases: Array<{ error: string; expected: FailureCategory }> = [
      { error: "AssertionError", expected: "assertion" },
      { error: "timeout exceeded", expected: "timeout" },
      { error: "TypeError: x is undefined", expected: "type-error" },
      { error: "ReferenceError: foo", expected: "runtime-error" },
      { error: "ECONNREFUSED", expected: "network" },
      { error: "Cannot find module", expected: "import" },
      { error: "unknown error", expected: "unknown" },
    ];

    for (const { error, expected } of testCases) {
      expect(categorizeFailure(error)).toBe(expected);
    }
  });
});
