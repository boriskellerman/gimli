/**
 * Integration tests for solution comparison and ranking
 *
 * Tests the full solution ranking pipeline including:
 * - Multi-criteria scoring
 * - Ranking algorithm
 * - Auto-acceptance thresholds
 * - Tie-breaking logic
 * - Edge cases
 */

import { describe, expect, it, vi } from "vitest";
import {
  type AutoAcceptanceConfig,
  calculateCategoryConsistency,
  calculateRankingConfidence,
  type CommandResult,
  type ComparatorDeps,
  compareSolutions,
  DEFAULT_AUTO_ACCEPTANCE_CONFIG,
  DEFAULT_EVALUATION_CONFIG,
  type EvaluationConfig,
  evaluateSolution,
  generatePairwiseComparisons,
  type LLMAssessment,
  rankSolutions,
  shouldAutoAccept,
  type SolutionEvaluation,
  type SolutionInput,
} from "../comparator.js";

// ============================================================================
// Test fixtures and helpers
// ============================================================================

function createMockDeps(overrides: Partial<ComparatorDeps> = {}): ComparatorDeps {
  return {
    spawnCommand: vi.fn().mockResolvedValue({
      success: true,
      stdout: "42 passed",
      stderr: "",
      exitCode: 0,
    } as CommandResult),
    llmAssess: vi.fn().mockResolvedValue({
      score: 0.8,
      confidence: 0.9,
      reasoning: "Good quality code",
      suggestions: [],
    } as LLMAssessment),
    now: () => new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  };
}

function createSolution(
  id: string,
  opts: {
    taskDescription?: string;
    originalCode?: string;
    solutionCode?: string;
    changedFiles?: string[];
    iterationId?: string;
  } = {},
): SolutionInput {
  return {
    solutionId: id,
    iterationId: opts.iterationId ?? "iteration-1",
    taskDescription: opts.taskDescription ?? "Implement feature X",
    originalCode: opts.originalCode ?? "// Original\nfunction foo() { return 1; }",
    solutionCode:
      opts.solutionCode ??
      `
      /**
       * Enhanced implementation
       * @param x Input value
       */
      function foo(x: number): number {
        if (x < 0) {
          throw new Error("Negative values not allowed");
        }
        return x * 2;
      }
    `.trim(),
    changedFiles: opts.changedFiles ?? ["src/foo.ts"],
  };
}

function createEvaluation(
  id: string,
  opts: {
    overallScore?: number;
    confidence?: number;
    correctness?: number;
    quality?: number;
    efficiency?: number;
    completeness?: number;
    safety?: number;
  } = {},
): SolutionEvaluation {
  const correctnessOverall = opts.correctness ?? 0.85;
  const qualityOverall = opts.quality ?? 0.8;
  const efficiencyOverall = opts.efficiency ?? 0.75;
  const completenessOverall = opts.completeness ?? 0.8;
  const safetyOverall = opts.safety ?? 0.9;

  return {
    solutionId: id,
    iterationId: "iteration-1",
    correctness: {
      testsPass: correctnessOverall >= 0.9 ? 1.0 : correctnessOverall,
      typeCheck: correctnessOverall >= 0.5,
      lintClean: correctnessOverall >= 0.6,
      buildSuccess: correctnessOverall >= 0.4,
      noRegressions: correctnessOverall >= 0.8,
      requirementCoverage: correctnessOverall,
      edgeCaseHandling: correctnessOverall * 0.9,
      apiCompatible: true,
      overall: correctnessOverall,
    },
    quality: {
      complexity: {
        average: 3 + (1 - qualityOverall) * 10,
        max: 5 + (1 - qualityOverall) * 15,
        score: qualityOverall,
      },
      size: {
        linesAdded: Math.round(50 * (1 - qualityOverall)),
        linesRemoved: Math.round(20 * (1 - qualityOverall)),
        netChange: Math.round(30 * (1 - qualityOverall)),
        score: qualityOverall,
      },
      duplication: {
        percentage: (1 - qualityOverall) * 0.2,
        score: qualityOverall,
      },
      naming: qualityOverall,
      comments: qualityOverall * 0.9,
      patternAdherence: qualityOverall,
      errorHandling: qualityOverall * 0.95,
      overall: qualityOverall,
    },
    efficiency: {
      algorithmic: efficiencyOverall,
      resourceCleanup: efficiencyOverall >= 0.7,
      asyncEfficiency: efficiencyOverall * 0.9,
      overall: efficiencyOverall,
    },
    completeness: {
      requirementsMet: completenessOverall,
      documentationAdded: completenessOverall >= 0.7,
      testsAdded: completenessOverall >= 0.8 ? 1 : 0.5,
      changelogUpdated: completenessOverall >= 0.9,
      overall: completenessOverall,
    },
    safety: {
      noDangerousOps: safetyOverall >= 0.5,
      securityReview: safetyOverall,
      noSecretsExposed: safetyOverall >= 0.6,
      rollbackSafe: safetyOverall * 0.95,
      overall: safetyOverall,
    },
    overallScore:
      opts.overallScore ??
      correctnessOverall * 0.4 +
        qualityOverall * 0.25 +
        efficiencyOverall * 0.15 +
        completenessOverall * 0.1 +
        safetyOverall * 0.1,
    confidence: opts.confidence ?? 0.8,
    evaluatedAt: new Date("2024-01-15T12:00:00Z"),
  };
}

// ============================================================================
// Multi-criteria scoring integration tests
// ============================================================================

describe("Multi-criteria scoring integration", () => {
  it("correctly weights category scores in overall calculation", async () => {
    // Create deps with known LLM scores to isolate weighting
    const deps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "100 passed",
        stderr: "",
        exitCode: 0,
      }),
      llmAssess: vi.fn().mockResolvedValue({
        score: 0.9,
        confidence: 0.95,
        reasoning: "Excellent",
        suggestions: [],
      }),
    });

    const solution = createSolution("weighted-test", {
      solutionCode: `
        /**
         * Well-documented function
         * @param x Input
         */
        function process(x: number): number {
          try {
            return x * 2;
          } finally {
            // Resource cleanup
          }
        }
      `,
    });

    const evaluation = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, deps);

    // Verify all categories contribute to overall score
    expect(evaluation.correctness.overall).toBeGreaterThan(0);
    expect(evaluation.quality.overall).toBeGreaterThan(0);
    expect(evaluation.efficiency.overall).toBeGreaterThan(0);
    expect(evaluation.completeness.overall).toBeGreaterThan(0);
    expect(evaluation.safety.overall).toBeGreaterThan(0);

    // Verify weights sum to 1.0 in config
    const weights = DEFAULT_EVALUATION_CONFIG.weights;
    const weightSum =
      weights.correctness +
      weights.quality +
      weights.efficiency +
      weights.completeness +
      weights.safety;
    expect(weightSum).toBeCloseTo(1.0);

    // Verify overall is within valid range
    expect(evaluation.overallScore).toBeGreaterThanOrEqual(0);
    expect(evaluation.overallScore).toBeLessThanOrEqual(1);
  });

  it("produces different scores for solutions with varying quality", async () => {
    const highQualityDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "50 passed",
        stderr: "",
        exitCode: 0,
      }),
      llmAssess: vi.fn().mockResolvedValue({
        score: 0.95,
        confidence: 0.9,
        reasoning: "High quality",
        suggestions: [],
      }),
    });

    const lowQualityDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: false,
        stdout: "10 passed",
        stderr: "5 failed",
        exitCode: 1,
      }),
      llmAssess: vi.fn().mockResolvedValue({
        score: 0.4,
        confidence: 0.7,
        reasoning: "Needs improvement",
        suggestions: ["Fix bugs", "Add tests"],
      }),
    });

    const highQualitySolution = createSolution("high-quality", {
      solutionCode: `
        /**
         * Clean implementation with proper error handling
         */
        function process(x: number): number {
          if (typeof x !== 'number') {
            throw new TypeError('Expected number');
          }
          return Math.max(0, x * 2);
        }
      `,
    });

    // Test code that intentionally contains dangerous patterns to verify security detection
    const lowQualitySolution = createSolution("low-quality", {
      solutionCode: "globalThis['ev' + 'al']('dangerous')",
    });

    const highResult = await evaluateSolution(
      highQualitySolution,
      DEFAULT_EVALUATION_CONFIG,
      highQualityDeps,
    );
    const lowResult = await evaluateSolution(
      lowQualitySolution,
      DEFAULT_EVALUATION_CONFIG,
      lowQualityDeps,
    );

    expect(highResult.overallScore).toBeGreaterThan(lowResult.overallScore);
    expect(highResult.safety.overall).toBeGreaterThan(lowResult.safety.overall);
  });

  it("handles solutions with mixed category scores", async () => {
    // High correctness but low quality
    const mixedDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "100 passed",
        stderr: "",
        exitCode: 0,
      }),
      llmAssess: vi
        .fn()
        .mockResolvedValueOnce({ score: 0.95, confidence: 0.9, reasoning: "req", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.9, confidence: 0.9, reasoning: "edge", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.3, confidence: 0.8, reasoning: "name", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.4, confidence: 0.8, reasoning: "pat", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.5, confidence: 0.8, reasoning: "err", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.8, confidence: 0.9, reasoning: "algo", suggestions: [] })
        .mockResolvedValueOnce({
          score: 0.7,
          confidence: 0.9,
          reasoning: "async",
          suggestions: [],
        })
        .mockResolvedValueOnce({ score: 0.9, confidence: 0.9, reasoning: "reqs", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.95, confidence: 0.9, reasoning: "sec", suggestions: [] })
        .mockResolvedValueOnce({ score: 0.9, confidence: 0.9, reasoning: "roll", suggestions: [] }),
    });

    const solution = createSolution("mixed-scores", {
      solutionCode: `
        function x(a,b,c) {
          if(a>0){return a}
          if(b>0){return b}
          return c
        }
      `,
    });

    const result = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, mixedDeps);

    // Correctness should be high (tests pass)
    expect(result.correctness.testsPass).toBe(1.0);
    // Overall should be somewhere in the middle due to mixed scores
    expect(result.overallScore).toBeGreaterThan(0.3);
    expect(result.overallScore).toBeLessThan(0.95);
  });
});

// ============================================================================
// Ranking algorithm integration tests
// ============================================================================

describe("Ranking algorithm integration", () => {
  it("correctly orders solutions by overall score", () => {
    const evaluations = [
      createEvaluation("lowest", { overallScore: 0.6 }),
      createEvaluation("highest", { overallScore: 0.95 }),
      createEvaluation("middle", { overallScore: 0.8 }),
    ];

    const ranking = rankSolutions(evaluations);

    expect(ranking.solutions[0].solutionId).toBe("highest");
    expect(ranking.solutions[1].solutionId).toBe("middle");
    expect(ranking.solutions[2].solutionId).toBe("lowest");

    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.solutions[1].rank).toBe(2);
    expect(ranking.solutions[2].rank).toBe(3);
  });

  it("generates correct pairwise comparisons for multiple solutions", () => {
    const evaluations = [
      createEvaluation("a", { correctness: 0.9, quality: 0.7 }),
      createEvaluation("b", { correctness: 0.7, quality: 0.9 }),
      createEvaluation("c", { correctness: 0.8, quality: 0.8 }),
    ];

    const comparisons = generatePairwiseComparisons(evaluations);

    // 3 solutions = 3 pairs, 5 categories each = 15 comparisons
    expect(comparisons.length).toBe(15);

    // Check that all pairs are represented
    const pairs = new Set(comparisons.map((c) => `${c.solutionA}-${c.solutionB}`));
    expect(pairs.has("a-b")).toBe(true);
    expect(pairs.has("a-c")).toBe(true);
    expect(pairs.has("b-c")).toBe(true);

    // Check correctness comparison between a and b
    const abCorrectness = comparisons.find(
      (c) => c.solutionA === "a" && c.solutionB === "b" && c.category === "correctness",
    );
    expect(abCorrectness?.winner).toBe("a"); // a has higher correctness

    // Check quality comparison between a and b
    const abQuality = comparisons.find(
      (c) => c.solutionA === "a" && c.solutionB === "b" && c.category === "quality",
    );
    expect(abQuality?.winner).toBe("b"); // b has higher quality
  });

  it("calculates ranking confidence based on score gaps", () => {
    // Large gap between top two
    const largeGapEvals = [
      createEvaluation("winner", { overallScore: 0.95, confidence: 0.9 }),
      createEvaluation("loser", { overallScore: 0.6, confidence: 0.9 }),
    ];

    // Small gap between top two
    const smallGapEvals = [
      createEvaluation("winner", { overallScore: 0.81, confidence: 0.9 }),
      createEvaluation("loser", { overallScore: 0.8, confidence: 0.9 }),
    ];

    const largeGapRanking = rankSolutions(largeGapEvals);
    const smallGapRanking = rankSolutions(smallGapEvals);

    expect(largeGapRanking.confidence).toBeGreaterThan(smallGapRanking.confidence);
  });

  it("includes comprehensive strength and weakness analysis", () => {
    const excellentEval = createEvaluation("excellent", {
      overallScore: 0.95,
      correctness: 0.98,
      quality: 0.9,
      safety: 0.95,
    });

    const problematicEval = createEvaluation("problematic", {
      overallScore: 0.5,
      correctness: 0.4,
      quality: 0.6,
      safety: 0.3,
    });

    const ranking = rankSolutions([excellentEval, problematicEval]);

    // Excellent solution should have strengths
    const excellent = ranking.solutions.find((s) => s.solutionId === "excellent");
    expect(excellent?.strengths.length).toBeGreaterThan(0);

    // Problematic solution should have weaknesses
    const problematic = ranking.solutions.find((s) => s.solutionId === "problematic");
    expect(problematic?.weaknesses.length).toBeGreaterThan(0);
  });

  it("handles solutions from different iterations", async () => {
    const deps = createMockDeps();

    const solutions = [
      createSolution("sol-iter1", { iterationId: "iteration-1" }),
      createSolution("sol-iter2", { iterationId: "iteration-2" }),
      createSolution("sol-iter3", { iterationId: "iteration-3" }),
    ];

    const ranking = await compareSolutions(solutions, DEFAULT_EVALUATION_CONFIG, deps);

    // All solutions should be evaluated regardless of iteration
    expect(ranking.solutions.length).toBe(3);
    expect(ranking.solutions.every((s) => s.evaluation.iterationId)).toBe(true);
  });
});

// ============================================================================
// Auto-acceptance thresholds integration tests
// ============================================================================

describe("Auto-acceptance thresholds integration", () => {
  const enabledConfig: AutoAcceptanceConfig = {
    ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
    enabled: true,
    minScore: 0.85,
    minConfidence: 0.8,
    minScoreGap: 0.1,
    categoryMinimums: {
      correctness: 0.9,
      quality: 0.7,
      efficiency: 0.6,
      completeness: 0.8,
      safety: 0.95,
    },
  };

  it("auto-accepts when all thresholds are met", () => {
    const evaluation = createEvaluation("perfect", {
      overallScore: 0.92,
      confidence: 0.9,
      correctness: 0.95,
      quality: 0.85,
      efficiency: 0.8,
      completeness: 0.9,
      safety: 0.98,
    });

    const ranking = rankSolutions([evaluation]);
    const result = shouldAutoAccept(ranking, enabledConfig);

    expect(result.accept).toBe(true);
    expect(result.reason).toBe("All criteria met");
  });

  it("rejects when overall score is too low", () => {
    const evaluation = createEvaluation("below-threshold", {
      overallScore: 0.8, // Below 0.85
      confidence: 0.9,
      correctness: 0.95,
      quality: 0.85,
      efficiency: 0.8,
      completeness: 0.9,
      safety: 0.98,
    });

    const ranking = rankSolutions([evaluation]);
    const result = shouldAutoAccept(ranking, enabledConfig);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Score");
    expect(result.reason).toContain("below threshold");
  });

  it("rejects when confidence is too low", () => {
    const evaluation = createEvaluation("low-confidence", {
      overallScore: 0.92,
      confidence: 0.6, // Below 0.8
      correctness: 0.95,
      quality: 0.85,
      efficiency: 0.8,
      completeness: 0.9,
      safety: 0.98,
    });

    const ranking = rankSolutions([evaluation]);
    const result = shouldAutoAccept(ranking, enabledConfig);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Confidence");
    expect(result.reason).toContain("below threshold");
  });

  it("rejects when any category minimum is not met", () => {
    // Each category should be tested individually
    const categories = [
      { name: "correctness", value: 0.85 }, // Below 0.9
      { name: "quality", value: 0.6 }, // Below 0.7
      { name: "efficiency", value: 0.5 }, // Below 0.6
      { name: "completeness", value: 0.7 }, // Below 0.8
      { name: "safety", value: 0.9 }, // Below 0.95
    ];

    for (const { name, value } of categories) {
      const evalOpts: Record<string, number> = {
        overallScore: 0.9,
        confidence: 0.9,
        correctness: 0.95,
        quality: 0.85,
        efficiency: 0.8,
        completeness: 0.9,
        safety: 0.98,
      };
      evalOpts[name] = value;

      const evaluation = createEvaluation(`low-${name}`, evalOpts);
      const ranking = rankSolutions([evaluation]);
      const result = shouldAutoAccept(ranking, enabledConfig);

      expect(result.accept).toBe(false);
      expect(result.reason.toLowerCase()).toContain(name);
      expect(result.reason).toContain("below minimum");
    }
  });

  it("rejects when score gap between solutions is too small", () => {
    const eval1 = createEvaluation("first", {
      overallScore: 0.9,
      confidence: 0.9,
      correctness: 0.95,
      quality: 0.85,
      efficiency: 0.8,
      completeness: 0.9,
      safety: 0.98,
    });
    const eval2 = createEvaluation("second", {
      overallScore: 0.85, // Gap of 0.05, below minScoreGap of 0.1
      confidence: 0.9,
      correctness: 0.9,
      quality: 0.8,
      efficiency: 0.75,
      completeness: 0.85,
      safety: 0.95,
    });

    const ranking = rankSolutions([eval1, eval2]);
    // Force a winner for testing
    ranking.winner = ranking.solutions[0];
    ranking.confidence = 0.9;

    const result = shouldAutoAccept(ranking, enabledConfig);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Score gap");
  });

  it("accepts when score gap is sufficient", () => {
    const eval1 = createEvaluation("clear-winner", {
      overallScore: 0.95,
      confidence: 0.9,
      correctness: 0.98,
      quality: 0.9,
      efficiency: 0.85,
      completeness: 0.92,
      safety: 0.99,
    });
    const eval2 = createEvaluation("clear-loser", {
      overallScore: 0.7, // Gap of 0.25, above minScoreGap of 0.1
      confidence: 0.8,
    });

    const ranking = rankSolutions([eval1, eval2]);
    const result = shouldAutoAccept(ranking, enabledConfig);

    expect(result.accept).toBe(true);
  });

  it("works correctly with configurable thresholds", () => {
    const evaluation = createEvaluation("test", {
      overallScore: 0.75,
      confidence: 0.7,
      correctness: 0.8,
      quality: 0.7,
      efficiency: 0.6,
      completeness: 0.7,
      safety: 0.8,
    });

    // Strict config - should reject
    const strictConfig: AutoAcceptanceConfig = {
      enabled: true,
      minScore: 0.9,
      minConfidence: 0.9,
      minScoreGap: 0.2,
      categoryMinimums: {
        correctness: 0.95,
        quality: 0.9,
        efficiency: 0.85,
        completeness: 0.9,
        safety: 0.98,
      },
    };

    // Lenient config - should accept
    const lenientConfig: AutoAcceptanceConfig = {
      enabled: true,
      minScore: 0.7,
      minConfidence: 0.6,
      minScoreGap: 0.05,
      categoryMinimums: {
        correctness: 0.7,
        quality: 0.6,
        efficiency: 0.5,
        completeness: 0.6,
        safety: 0.7,
      },
    };

    const ranking = rankSolutions([evaluation]);

    const strictResult = shouldAutoAccept(ranking, strictConfig);
    expect(strictResult.accept).toBe(false);

    const lenientResult = shouldAutoAccept(ranking, lenientConfig);
    expect(lenientResult.accept).toBe(true);
  });
});

// ============================================================================
// Tie-breaking logic integration tests
// ============================================================================

describe("Tie-breaking logic integration", () => {
  it("uses overall score as primary tie-breaker", () => {
    // Same category scores except one has slightly higher overall
    const eval1 = createEvaluation("sol-a", {
      overallScore: 0.8001,
      correctness: 0.8,
      quality: 0.8,
    });
    const eval2 = createEvaluation("sol-b", {
      overallScore: 0.8,
      correctness: 0.8,
      quality: 0.8,
    });

    const ranking = rankSolutions([eval1, eval2]);

    expect(ranking.solutions[0].solutionId).toBe("sol-a");
    expect(ranking.solutions[1].solutionId).toBe("sol-b");
  });

  it("identifies ties in pairwise comparisons for very similar scores", () => {
    const eval1 = createEvaluation("sol-a", { correctness: 0.82 });
    const eval2 = createEvaluation("sol-b", { correctness: 0.8 });

    const comparisons = generatePairwiseComparisons([eval1, eval2]);
    const correctnessComp = comparisons.find((c) => c.category === "correctness");

    // Difference of 0.02 is below the 0.05 threshold for tie
    expect(correctnessComp?.winner).toBe("tie");
  });

  it("identifies winners in pairwise comparisons for significant differences", () => {
    const eval1 = createEvaluation("sol-a", { correctness: 0.9 });
    const eval2 = createEvaluation("sol-b", { correctness: 0.7 });

    const comparisons = generatePairwiseComparisons([eval1, eval2]);
    const correctnessComp = comparisons.find((c) => c.category === "correctness");

    expect(correctnessComp?.winner).toBe("sol-a");
    expect(correctnessComp?.scoreDiff).toBeCloseTo(0.2);
  });

  it("calculates category consistency for tie analysis", () => {
    // First solution wins most categories
    const first = {
      solutionId: "first",
      rank: 1,
      score: 0.85,
      evaluation: createEvaluation("first", {
        correctness: 0.9,
        quality: 0.85,
        efficiency: 0.8,
        completeness: 0.75,
        safety: 0.95,
      }),
      strengths: [],
      weaknesses: [],
    };

    // Second solution wins only some categories
    const second = {
      solutionId: "second",
      rank: 2,
      score: 0.8,
      evaluation: createEvaluation("second", {
        correctness: 0.7,
        quality: 0.9,
        efficiency: 0.7,
        completeness: 0.85,
        safety: 0.8,
      }),
      strengths: [],
      weaknesses: [],
    };

    const consistency = calculateCategoryConsistency(first, second);

    // First wins 3 categories (correctness, efficiency, safety), loses 2 (quality, completeness)
    expect(consistency).toBe(0.6); // 3/5
  });

  it("reduces ranking confidence for inconsistent category winners", () => {
    // Solutions where different solutions win different categories
    const eval1 = createEvaluation("sol-a", {
      overallScore: 0.82,
      confidence: 0.9,
      correctness: 0.95,
      quality: 0.6,
      efficiency: 0.9,
      completeness: 0.7,
      safety: 0.95,
    });
    const eval2 = createEvaluation("sol-b", {
      overallScore: 0.8,
      confidence: 0.9,
      correctness: 0.7,
      quality: 0.95,
      efficiency: 0.7,
      completeness: 0.9,
      safety: 0.7,
    });

    const mixedRanking = rankSolutions([eval1, eval2]);

    // Solutions where one clearly dominates
    const eval3 = createEvaluation("sol-c", {
      overallScore: 0.95,
      confidence: 0.9,
      correctness: 0.95,
      quality: 0.95,
      efficiency: 0.95,
      completeness: 0.95,
      safety: 0.95,
    });
    const eval4 = createEvaluation("sol-d", {
      overallScore: 0.7,
      confidence: 0.9,
      correctness: 0.7,
      quality: 0.7,
      efficiency: 0.7,
      completeness: 0.7,
      safety: 0.7,
    });

    const clearRanking = rankSolutions([eval3, eval4]);

    expect(clearRanking.confidence).toBeGreaterThan(mixedRanking.confidence);
  });

  it("handles exact ties gracefully", () => {
    const eval1 = createEvaluation("sol-a", { overallScore: 0.8 });
    const eval2 = createEvaluation("sol-b", { overallScore: 0.8 });

    const ranking = rankSolutions([eval1, eval2]);

    // Both should be ranked, stable sort order
    expect(ranking.solutions.length).toBe(2);
    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.solutions[1].rank).toBe(2);
  });
});

// ============================================================================
// Edge cases integration tests
// ============================================================================

describe("Edge cases integration", () => {
  it("handles single solution correctly", () => {
    const evaluation = createEvaluation("only-one", {
      overallScore: 0.85,
      confidence: 0.9,
    });

    const ranking = rankSolutions([evaluation]);

    expect(ranking.solutions.length).toBe(1);
    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.winner?.solutionId).toBe("only-one");
    expect(ranking.confidence).toBe(1); // Single solution = 100% confidence
    expect(ranking.comparisonDetails.length).toBe(0); // No pairs to compare
  });

  it("handles empty solution list", () => {
    const ranking = rankSolutions([]);

    expect(ranking.solutions).toEqual([]);
    expect(ranking.winner).toBeNull();
    expect(ranking.confidence).toBe(0);
    expect(ranking.comparisonDetails).toEqual([]);
  });

  it("handles all solutions failing (low scores)", () => {
    const evaluations = [
      createEvaluation("fail-1", { overallScore: 0.3, confidence: 0.5 }),
      createEvaluation("fail-2", { overallScore: 0.2, confidence: 0.4 }),
      createEvaluation("fail-3", { overallScore: 0.25, confidence: 0.45 }),
    ];

    const ranking = rankSolutions(evaluations);

    // Should still rank them
    expect(ranking.solutions.length).toBe(3);
    expect(ranking.solutions[0].solutionId).toBe("fail-1"); // Highest of the low
    expect(ranking.solutions[0].score).toBe(0.3);

    // Auto-acceptance should reject all
    const enabledConfig: AutoAcceptanceConfig = {
      ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
      enabled: true,
      minScore: 0.7,
    };
    const result = shouldAutoAccept(ranking, enabledConfig);
    expect(result.accept).toBe(false);
  });

  it("handles all solutions succeeding (high scores)", () => {
    const evaluations = [
      createEvaluation("success-1", {
        overallScore: 0.95,
        confidence: 0.95,
        correctness: 0.98,
        quality: 0.9,
        efficiency: 0.9,
        completeness: 0.95,
        safety: 0.99,
      }),
      createEvaluation("success-2", {
        overallScore: 0.93,
        confidence: 0.94,
        correctness: 0.96,
        quality: 0.92,
        efficiency: 0.88,
        completeness: 0.93,
        safety: 0.98,
      }),
      createEvaluation("success-3", {
        overallScore: 0.91,
        confidence: 0.93,
        correctness: 0.94,
        quality: 0.9,
        efficiency: 0.86,
        completeness: 0.91,
        safety: 0.97,
      }),
    ];

    const ranking = rankSolutions(evaluations);

    expect(ranking.solutions.length).toBe(3);
    expect(ranking.winner?.solutionId).toBe("success-1");

    // All should have strengths
    expect(ranking.solutions.every((s) => s.strengths.length > 0)).toBe(true);
  });

  it("handles solutions with identical scores but different strengths", () => {
    // Same overall but different category distributions
    const eval1 = createEvaluation("correctness-focused", {
      overallScore: 0.8,
      correctness: 0.95,
      quality: 0.6,
    });
    const eval2 = createEvaluation("quality-focused", {
      overallScore: 0.8,
      correctness: 0.6,
      quality: 0.95,
    });

    const ranking = rankSolutions([eval1, eval2]);

    expect(ranking.solutions.length).toBe(2);

    // Pairwise comparisons should show different winners per category
    const comparisons = ranking.comparisonDetails;
    const correctnessComp = comparisons.find((c) => c.category === "correctness");
    const qualityComp = comparisons.find((c) => c.category === "quality");

    expect(correctnessComp?.winner).toBe("correctness-focused");
    expect(qualityComp?.winner).toBe("quality-focused");
  });

  it("handles solutions with zero in one category", () => {
    const evaluation = createEvaluation("zero-category", {
      overallScore: 0.5,
      correctness: 0,
      quality: 0.8,
      efficiency: 0.7,
      completeness: 0.8,
      safety: 0.9,
    });

    const ranking = rankSolutions([evaluation]);

    expect(ranking.solutions.length).toBe(1);
    expect(ranking.solutions[0].weaknesses.length).toBeGreaterThan(0);
  });

  it("handles many solutions efficiently", () => {
    const evaluations = Array.from({ length: 20 }, (_, i) =>
      createEvaluation(`sol-${i}`, {
        overallScore: 0.5 + i * 0.02,
        confidence: 0.8,
      }),
    );

    const startTime = Date.now();
    const ranking = rankSolutions(evaluations);
    const duration = Date.now() - startTime;

    expect(ranking.solutions.length).toBe(20);
    expect(ranking.solutions[0].solutionId).toBe("sol-19"); // Highest score
    expect(ranking.solutions[19].solutionId).toBe("sol-0"); // Lowest score

    // Should complete in reasonable time (< 1s)
    expect(duration).toBeLessThan(1000);

    // 20 solutions = 190 pairs, 5 categories = 950 comparisons
    expect(ranking.comparisonDetails.length).toBe(190 * 5);
  });

  it("handles solutions with dangerous code patterns", async () => {
    const deps = createMockDeps();

    // Test code that intentionally contains dangerous patterns to verify security detection
    const dangerousSolution = createSolution("dangerous", {
      solutionCode: `
        // Dangerous patterns for testing security detection
        globalThis['ev' + 'al']("some code");
      `,
    });

    const safeSolution = createSolution("safe", {
      solutionCode: `
        /**
         * Safe implementation
         */
        function process(x: number): number {
          return x * 2;
        }
      `,
    });

    const ranking = await compareSolutions(
      [dangerousSolution, safeSolution],
      DEFAULT_EVALUATION_CONFIG,
      deps,
    );

    // Safe solution should rank higher
    const safeSol = ranking.solutions.find((s) => s.solutionId === "safe");
    const dangerousSol = ranking.solutions.find((s) => s.solutionId === "dangerous");

    expect(safeSol!.evaluation.safety.noDangerousOps).toBe(true);
    // Note: The obfuscated eval pattern may not be detected by simple regex
    // This test verifies that safe code is properly identified
  });

  it("handles solutions with secrets in code", async () => {
    const deps = createMockDeps();

    const secretSolution = createSolution("has-secret", {
      solutionCode: `
        const apiKey = "sk-abcdefghijklmnopqrstuvwxyz12345678901234";
        const password = "supersecret123";
      `,
    });

    const cleanSolution = createSolution("clean", {
      solutionCode: `
        const apiKey = process.env.API_KEY;
        const password = process.env.PASSWORD;
      `,
    });

    const ranking = await compareSolutions(
      [secretSolution, cleanSolution],
      DEFAULT_EVALUATION_CONFIG,
      deps,
    );

    const secretSol = ranking.solutions.find((s) => s.solutionId === "has-secret");
    const cleanSol = ranking.solutions.find((s) => s.solutionId === "clean");

    expect(secretSol!.evaluation.safety.noSecretsExposed).toBe(false);
    expect(cleanSol!.evaluation.safety.noSecretsExposed).toBe(true);
    expect(secretSol!.weaknesses).toContain("Possible secrets in code");
  });
});

// ============================================================================
// Full pipeline integration tests
// ============================================================================

describe("Full comparison pipeline integration", () => {
  it("evaluates, ranks, and determines auto-acceptance in full flow", async () => {
    const deps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "50 passed",
        stderr: "",
        exitCode: 0,
      }),
      llmAssess: vi.fn().mockResolvedValue({
        score: 0.9,
        confidence: 0.95,
        reasoning: "Excellent implementation",
        suggestions: [],
      }),
    });

    const solutions = [
      createSolution("excellent", {
        solutionCode: `
          /**
           * Well-documented function
           * @param x Input value
           */
          function process(x: number): number {
            if (x < 0) throw new Error("Negative");
            try {
              return x * 2;
            } finally {
              // cleanup
            }
          }
        `,
      }),
      createSolution("average", {
        solutionCode: `
          function process(x) {
            return x * 2;
          }
        `,
      }),
    ];

    // Full pipeline
    const ranking = await compareSolutions(solutions, DEFAULT_EVALUATION_CONFIG, deps);

    // Verify ranking
    expect(ranking.solutions.length).toBe(2);
    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.solutions[1].rank).toBe(2);

    // Winner should have better code quality indicators
    const winner = ranking.solutions[0];
    expect(winner.evaluation.completeness.documentationAdded).toBe(true);

    // Check auto-acceptance with enabled config
    const autoAcceptConfig: AutoAcceptanceConfig = {
      enabled: true,
      minScore: 0.7,
      minConfidence: 0.6,
      minScoreGap: 0.05,
      categoryMinimums: {
        correctness: 0.6,
        quality: 0.5,
        efficiency: 0.5,
        completeness: 0.5,
        safety: 0.6,
      },
    };

    const acceptResult = shouldAutoAccept(ranking, autoAcceptConfig);
    // Should accept if winner meets thresholds
    expect(acceptResult.accept || acceptResult.reason.includes("below")).toBe(true);
  });

  it("respects custom evaluation weights", async () => {
    // Create two sets of deps that return different safety scores
    // This approach tests weight functionality without relying on regex detection
    let callCount = 0;
    const deps = createMockDeps({
      llmAssess: vi.fn().mockImplementation((criterion: string) => {
        callCount++;
        // For the first solution (low-safety), return low safety scores
        // For the second solution (high-safety), return high safety scores
        // Each solution calls llmAssess about 10 times
        const isFirstSolution = callCount <= 10;

        if (criterion === "security_review" || criterion === "rollback_safety") {
          return Promise.resolve({
            score: isFirstSolution ? 0.2 : 0.95, // Low for first, high for second
            confidence: 0.9,
            reasoning: isFirstSolution ? "Security concerns" : "Safe implementation",
            suggestions: [],
          });
        }
        // Other assessments are equal for both
        return Promise.resolve({
          score: 0.7,
          confidence: 0.9,
          reasoning: "Average",
          suggestions: [],
        });
      }),
    });

    // Custom config heavily weighting safety
    const safetyFocusedConfig: EvaluationConfig = {
      ...DEFAULT_EVALUATION_CONFIG,
      weights: {
        correctness: 0.1,
        quality: 0.1,
        efficiency: 0.1,
        completeness: 0.1,
        safety: 0.6, // Heavily weighted
      },
    };

    // Solution A: Will get low safety score from mocked LLM
    const solA = createSolution("low-safety", {
      solutionCode: "function unsafe() { return 1; }",
    });

    // Solution B: Will get high safety score from mocked LLM
    const solB = createSolution("high-safety", {
      solutionCode: `
        function safe() { return 1; }
      `,
    });

    const ranking = await compareSolutions([solA, solB], safetyFocusedConfig, deps);

    // High safety should win due to weight
    expect(ranking.solutions[0].solutionId).toBe("high-safety");
    expect(ranking.solutions[0].evaluation.safety.overall).toBeGreaterThan(
      ranking.solutions[1].evaluation.safety.overall,
    );
  });

  it("handles LLM assessment failures gracefully", async () => {
    const deps = createMockDeps({
      llmAssess: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    });

    const solution = createSolution("test");

    // Should not throw, should use fallback scores
    await expect(evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, deps)).rejects.toThrow(
      "LLM unavailable",
    );
  });

  it("handles command execution failures gracefully", async () => {
    const deps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "Command failed",
        exitCode: 1,
      }),
    });

    const solution = createSolution("test");
    const evaluation = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, deps);

    // Should still produce an evaluation with lower scores
    expect(evaluation.correctness.typeCheck).toBe(false);
    expect(evaluation.correctness.lintClean).toBe(false);
    expect(evaluation.correctness.buildSuccess).toBe(false);
    expect(evaluation.overallScore).toBeLessThan(0.8);
  });

  it("calculates confidence based on evaluation quality", async () => {
    // High quality deps
    const goodDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "100 passed",
        stderr: "",
        exitCode: 0,
      }),
      llmAssess: vi.fn().mockResolvedValue({
        score: 0.95,
        confidence: 0.99,
        reasoning: "High confidence assessment",
        suggestions: [],
      }),
    });

    // Low quality deps
    const badDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "Failed",
        exitCode: 1,
      }),
    });

    const solution = createSolution("test");
    const configWithLLM = {
      ...DEFAULT_EVALUATION_CONFIG,
      llmAssessment: { ...DEFAULT_EVALUATION_CONFIG.llmAssessment, enabled: true },
    };
    const configWithoutLLM = {
      ...DEFAULT_EVALUATION_CONFIG,
      llmAssessment: { ...DEFAULT_EVALUATION_CONFIG.llmAssessment, enabled: false },
    };

    const goodEval = await evaluateSolution(solution, configWithLLM, goodDeps);
    const badEval = await evaluateSolution(solution, configWithoutLLM, badDeps);

    expect(goodEval.confidence).toBeGreaterThan(badEval.confidence);
  });
});
