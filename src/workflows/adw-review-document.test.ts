/**
 * Tests for Review-Document ADW
 */

import { describe, it, expect } from "vitest";

import {
  createReviewDocumentDefinition,
  parseCodeReview,
  parseDocumentationResult,
  getReviewDocumentResults,
  formatReviewAsMarkdown,
  formatLearningsAsYaml,
  type ReviewDocumentInput,
  type CodeReview,
  type ExtractedLearning,
} from "./adw-review-document.js";
import type { ADWResult } from "./adw-base.js";

describe("Review-Document ADW", () => {
  describe("createReviewDocumentDefinition", () => {
    it("creates a valid workflow definition", () => {
      const definition = createReviewDocumentDefinition();

      expect(definition.id).toBe("review-document");
      expect(definition.name).toBe("Review and Document");
      expect(definition.stages).toHaveLength(2);
    });

    it("has review stage as required", () => {
      const definition = createReviewDocumentDefinition();
      const reviewStage = definition.stages[0];

      expect(reviewStage.id).toBe("review");
      expect(reviewStage.required).toBe(true);
      expect(reviewStage.agent.thinking).toBe("high");
    });

    it("has document stage as optional", () => {
      const definition = createReviewDocumentDefinition();
      const documentStage = definition.stages[1];

      expect(documentStage.id).toBe("document");
      expect(documentStage.required).toBe(false);
      expect(documentStage.dependsOn).toContain("review");
    });

    it("accepts custom options", () => {
      const definition = createReviewDocumentDefinition({
        tags: ["custom-review"],
      });

      expect(definition.tags).toContain("custom-review");
    });
  });

  describe("parseCodeReview", () => {
    it("parses a complete code review", () => {
      const output = `
## Summary
Overall good code quality with a few minor issues.

## Assessment
Approve

## Findings
- Critical: SQL injection vulnerability in query builder
- Major: Missing error handling in API endpoint
- Minor: Unused import in utils.ts
- Suggestion: Consider using async/await instead of callbacks

## Strengths
- Good test coverage
- Clear function names
- Positive: Well-organized code structure

## Patterns
Good pattern: Consistent error handling approach
Bad pattern: Mixing callbacks and promises

## Quality Score: 75
`;

      const review = parseCodeReview(output);

      expect(review).not.toBeNull();
      expect(review?.summary).toContain("good code quality");
      expect(review?.assessment).toBe("approve");
      expect(review?.findings.length).toBeGreaterThan(0);
      expect(review?.strengths.length).toBeGreaterThan(0);
      expect(review?.patterns.length).toBeGreaterThan(0);
      expect(review?.qualityScore).toBe(75);
    });

    it("determines assessment correctly", () => {
      const approveOutput = "This looks good. Approve the changes.";
      const changesOutput = "Request changes: needs more tests";
      const commentOutput = "Some feedback for consideration";

      expect(parseCodeReview(approveOutput)?.assessment).toBe("approve");
      expect(parseCodeReview(changesOutput)?.assessment).toBe("request_changes");
      expect(parseCodeReview(commentOutput)?.assessment).toBe("comment");
    });

    it("extracts findings by severity", () => {
      const output = `
Critical issue: Security vulnerability
Major problem: Performance bottleneck
Minor thing: Style inconsistency
Suggestion: Add comments
`;

      const review = parseCodeReview(output);
      const severities = review?.findings.map((f) => f.severity);

      expect(severities).toContain("critical");
      expect(severities).toContain("major");
      expect(severities).toContain("minor");
      expect(severities).toContain("suggestion");
    });

    it("extracts quality score", () => {
      const output85 = "Quality score: 85";
      const output60 = "Score: 60 out of 100";

      expect(parseCodeReview(output85)?.qualityScore).toBe(85);
      expect(parseCodeReview(output60)?.qualityScore).toBe(60);
    });

    it("identifies good and bad patterns", () => {
      const output = `
Good pattern: Using dependency injection
Anti-pattern: God object in UserService
Bad pattern: Magic numbers without constants
`;

      const review = parseCodeReview(output);
      const goodPatterns = review?.patterns.filter((p) => p.type === "good");
      const badPatterns = review?.patterns.filter((p) => p.type === "bad");

      expect(goodPatterns?.length).toBeGreaterThan(0);
      expect(badPatterns?.length).toBeGreaterThan(0);
    });

    it("handles minimal output", () => {
      const output = "Code looks fine.";

      const review = parseCodeReview(output);

      expect(review).not.toBeNull();
      expect(review?.assessment).toBe("comment");
      expect(review?.qualityScore).toBe(70); // Default
    });
  });

  describe("parseDocumentationResult", () => {
    it("parses documentation updates", () => {
      const output = `
## Documentation Updates
Update: docs/architecture.md - Add section on authentication flow
Add to: docs/patterns.md - Document the new validation pattern

## Learnings
Learning: Always validate input at API boundaries
Pattern: Use guard clauses for early returns
Best practice: Keep functions under 20 lines
`;

      const result = parseDocumentationResult(output);

      expect(result).not.toBeNull();
      expect(result?.updates.length).toBeGreaterThan(0);
      expect(result?.learnings.length).toBeGreaterThan(0);
    });

    it("extracts learning categories", () => {
      const output = `
Pattern: Consistent error handling
Best practice: Validate early, fail fast
Decision: Use TypeScript strict mode
`;

      const result = parseDocumentationResult(output);
      const categories = result?.learnings.map((l) => l.category);

      expect(categories).toContain("pattern");
    });

    it("generates summary when not explicit", () => {
      const output = `
Learning 1
Learning 2
`;

      const result = parseDocumentationResult(output);

      expect(result?.summary).toContain("learnings");
    });
  });

  describe("getReviewDocumentResults", () => {
    it("extracts both stage results", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "review-document",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "review",
            stageName: "Code Review",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "Summary: Good code\nApprove\nQuality: 80",
            retryCount: 0,
          },
          {
            stageId: "document",
            stageName: "Extract Learnings",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "Learning: Use TypeScript strict mode",
            retryCount: 0,
          },
        ],
        trigger: { type: "github_pr" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      const { review, documentation } = getReviewDocumentResults(mockResult);

      expect(review).not.toBeNull();
      expect(documentation).not.toBeNull();
    });

    it("handles missing documentation stage", () => {
      const mockResult: ADWResult = {
        executionId: "test-123",
        workflowId: "review-document",
        status: "completed",
        startedAt: Date.now() - 1000,
        endedAt: Date.now(),
        durationMs: 1000,
        stageResults: [
          {
            stageId: "review",
            stageName: "Code Review",
            status: "completed",
            startedAt: Date.now(),
            endedAt: Date.now(),
            durationMs: 100,
            output: "Summary: Good code",
            retryCount: 0,
          },
        ],
        trigger: { type: "github_pr" },
        totalUsage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        retryCount: 0,
      };

      const { review, documentation } = getReviewDocumentResults(mockResult);

      expect(review).not.toBeNull();
      expect(documentation).toBeNull();
    });
  });

  describe("formatReviewAsMarkdown", () => {
    const mockReview: CodeReview = {
      summary: "Good code quality overall",
      assessment: "approve",
      findings: [
        {
          id: "f1",
          severity: "major",
          category: "security",
          description: "Input not validated",
          suggestion: "Add validation",
        },
        {
          id: "f2",
          severity: "minor",
          category: "style",
          description: "Inconsistent naming",
        },
      ],
      strengths: ["Good test coverage", "Clear documentation"],
      patterns: [
        { pattern: "DI", type: "good", description: "Dependency injection" },
        { pattern: "God object", type: "bad", description: "Too many responsibilities" },
      ],
      qualityScore: 75,
      confidence: 0.8,
    };

    it("includes assessment", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("APPROVE");
    });

    it("includes quality score", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("75/100");
    });

    it("includes summary", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("Good code quality");
    });

    it("groups findings by severity", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("Major");
      expect(markdown).toContain("Minor");
    });

    it("includes suggestions when present", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("Add validation");
    });

    it("includes strengths", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("Good test coverage");
    });

    it("includes patterns with icons", () => {
      const markdown = formatReviewAsMarkdown(mockReview);
      expect(markdown).toContain("✅");
      expect(markdown).toContain("⚠️");
    });
  });

  describe("formatLearningsAsYaml", () => {
    const mockLearnings: ExtractedLearning[] = [
      {
        category: "pattern",
        title: "Error Handling",
        description: "Always use try-catch for async operations",
        relatedTo: ["src/api/handlers.ts"],
        confidence: "high",
        shouldPersist: true,
      },
      {
        category: "best-practice",
        title: "Validation",
        description: "Validate input at boundaries",
        relatedTo: [],
        confidence: "medium",
        shouldPersist: true,
      },
      {
        category: "context",
        title: "Temporary Note",
        description: "This is just for now",
        relatedTo: [],
        confidence: "low",
        shouldPersist: false,
      },
    ];

    it("generates valid YAML format", () => {
      const yaml = formatLearningsAsYaml(mockLearnings);

      expect(yaml).toContain("learnings:");
      expect(yaml).toContain("category:");
      expect(yaml).toContain("title:");
      expect(yaml).toContain("description:");
    });

    it("filters out non-persistent learnings", () => {
      const yaml = formatLearningsAsYaml(mockLearnings);

      expect(yaml).toContain("Error Handling");
      expect(yaml).toContain("Validation");
      expect(yaml).not.toContain("Temporary Note");
    });

    it("includes related files", () => {
      const yaml = formatLearningsAsYaml(mockLearnings);
      expect(yaml).toContain("related_to:");
      expect(yaml).toContain("src/api/handlers.ts");
    });

    it("includes confidence levels", () => {
      const yaml = formatLearningsAsYaml(mockLearnings);
      expect(yaml).toContain("confidence: high");
      expect(yaml).toContain("confidence: medium");
    });

    it("handles empty learnings", () => {
      const yaml = formatLearningsAsYaml([]);
      expect(yaml).toContain("No learnings to persist");
    });

    it("handles all non-persistent learnings", () => {
      const nonPersistent: ExtractedLearning[] = [
        {
          category: "context",
          title: "Note",
          description: "Don't save this",
          relatedTo: [],
          confidence: "low",
          shouldPersist: false,
        },
      ];

      const yaml = formatLearningsAsYaml(nonPersistent);
      expect(yaml).toContain("No learnings to persist");
    });

    it("escapes quotes in titles", () => {
      const learnings: ExtractedLearning[] = [
        {
          category: "pattern",
          title: 'Use "strict" mode',
          description: "Always use strict",
          relatedTo: [],
          confidence: "high",
          shouldPersist: true,
        },
      ];

      const yaml = formatLearningsAsYaml(learnings);
      expect(yaml).toContain('\\"strict\\"');
    });
  });

  describe("ReviewDocumentInput type", () => {
    it("accepts minimal input", () => {
      const input: ReviewDocumentInput = {
        reviewType: "pr",
        changes: "diff content here",
      };

      expect(input.reviewType).toBe("pr");
      expect(input.changes).toBe("diff content here");
    });

    it("accepts full input", () => {
      const input: ReviewDocumentInput = {
        reviewType: "pr",
        changes: "diff content",
        prNumber: 123,
        title: "Add feature",
        description: "This PR adds a new feature",
        filesChanged: ["src/feature.ts", "src/feature.test.ts"],
        focusAreas: ["security", "performance"],
        generateDocs: true,
        docsPath: "docs/",
        expertisePath: ".claude/experts/",
      };

      expect(input.prNumber).toBe(123);
      expect(input.filesChanged).toHaveLength(2);
      expect(input.focusAreas).toContain("security");
      expect(input.generateDocs).toBe(true);
    });

    it("supports all review types", () => {
      const types: ReviewDocumentInput["reviewType"][] = ["pr", "commit", "diff", "codebase"];

      for (const type of types) {
        const input: ReviewDocumentInput = {
          reviewType: type,
          changes: "content",
        };
        expect(input.reviewType).toBe(type);
      }
    });

    it("supports all focus areas", () => {
      const areas: NonNullable<ReviewDocumentInput["focusAreas"]> = [
        "security",
        "performance",
        "maintainability",
        "testing",
        "documentation",
      ];

      const input: ReviewDocumentInput = {
        reviewType: "pr",
        changes: "content",
        focusAreas: areas,
      };

      expect(input.focusAreas).toHaveLength(5);
    });
  });
});
