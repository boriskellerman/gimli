import { describe, expect, it, vi } from "vitest";
import {
  booleanToScore,
  calculateCategoryConsistency,
  calculateCommentRatio,
  calculateRankingConfidence,
  calculateSizeMetrics,
  checkDangerousOps,
  checkSecretsExposed,
  clamp01,
  compareSolutions,
  type ComparatorDeps,
  type CommandResult,
  DEFAULT_AUTO_ACCEPTANCE_CONFIG,
  DEFAULT_EVALUATION_CONFIG,
  estimateComplexity,
  estimateDuplication,
  type EvaluationConfig,
  evaluateSolution,
  formatRankingAsMarkdown,
  generatePairwiseComparisons,
  identifyStrengths,
  identifyWeaknesses,
  inverseScore,
  type LLMAssessment,
  rankSolutions,
  ratioToScore,
  shouldAutoAccept,
  type SolutionEvaluation,
  type SolutionInput,
} from "./comparator.js";

// ============================================================================
// Test utilities
// ============================================================================

function createMockDeps(overrides: Partial<ComparatorDeps> = {}): ComparatorDeps {
  return {
    spawnCommand: vi.fn().mockResolvedValue({
      success: true,
      stdout: "10 passed",
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

function createMockSolution(overrides: Partial<SolutionInput> = {}): SolutionInput {
  return {
    solutionId: "solution-1",
    iterationId: "iteration-1",
    taskDescription: "Implement feature X",
    originalCode: "// Original code\nfunction foo() { return 1; }",
    solutionCode: "// Solution code\n/** Doc comment */\nfunction foo() { return 2; }",
    changedFiles: ["src/foo.ts"],
    ...overrides,
  };
}

function createMockEvaluation(overrides: Partial<SolutionEvaluation> = {}): SolutionEvaluation {
  return {
    solutionId: "solution-1",
    iterationId: "iteration-1",
    correctness: {
      testsPass: 1.0,
      typeCheck: true,
      lintClean: true,
      buildSuccess: true,
      noRegressions: true,
      requirementCoverage: 0.8,
      edgeCaseHandling: 0.7,
      apiCompatible: true,
      overall: 0.85,
    },
    quality: {
      complexity: { average: 3, max: 5, score: 0.9 },
      size: { linesAdded: 10, linesRemoved: 5, netChange: 5, score: 0.95 },
      duplication: { percentage: 0.02, score: 0.98 },
      naming: 0.85,
      comments: 0.8,
      patternAdherence: 0.82,
      errorHandling: 0.78,
      overall: 0.85,
    },
    efficiency: {
      algorithmic: 0.8,
      resourceCleanup: true,
      asyncEfficiency: 0.75,
      overall: 0.78,
    },
    completeness: {
      requirementsMet: 0.9,
      documentationAdded: true,
      testsAdded: 1,
      changelogUpdated: false,
      overall: 0.85,
    },
    safety: {
      noDangerousOps: true,
      securityReview: 0.9,
      noSecretsExposed: true,
      rollbackSafe: 0.85,
      overall: 0.9,
    },
    overallScore: 0.85,
    confidence: 0.8,
    evaluatedAt: new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  };
}

// ============================================================================
// Scoring utilities tests
// ============================================================================

describe("booleanToScore", () => {
  it("returns 1.0 for true", () => {
    expect(booleanToScore(true)).toBe(1.0);
  });

  it("returns 0.0 for false", () => {
    expect(booleanToScore(false)).toBe(0.0);
  });
});

describe("ratioToScore", () => {
  it("returns ratio when below target", () => {
    expect(ratioToScore(5, 10)).toBe(0.5);
  });

  it("returns 1.0 when at target", () => {
    expect(ratioToScore(10, 10)).toBe(1.0);
  });

  it("caps at 1.0 when above target", () => {
    expect(ratioToScore(15, 10)).toBe(1.0);
  });

  it("returns 0 for zero target", () => {
    expect(ratioToScore(5, 0)).toBe(0);
  });

  it("returns 0 for negative target", () => {
    expect(ratioToScore(5, -1)).toBe(0);
  });
});

describe("inverseScore", () => {
  it("returns 1.0 when at or below baseline", () => {
    expect(inverseScore(5, 10, 20)).toBe(1.0);
    expect(inverseScore(10, 10, 20)).toBe(1.0);
  });

  it("returns 0.0 when at or above worst", () => {
    expect(inverseScore(20, 10, 20)).toBe(0.0);
    expect(inverseScore(25, 10, 20)).toBe(0.0);
  });

  it("returns interpolated value between baseline and worst", () => {
    expect(inverseScore(15, 10, 20)).toBe(0.5);
  });
});

describe("clamp01", () => {
  it("returns value when between 0 and 1", () => {
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("clamps to 0 when negative", () => {
    expect(clamp01(-0.5)).toBe(0);
  });

  it("clamps to 1 when above 1", () => {
    expect(clamp01(1.5)).toBe(1);
  });
});

// ============================================================================
// Code analysis tests
// ============================================================================

describe("checkDangerousOps", () => {
  it("returns safe for clean code", () => {
    const result = checkDangerousOps("function foo() { return 1; }");
    expect(result.safe).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detects rm -rf /", () => {
    const result = checkDangerousOps('run("rm -rf /")');
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("rm -rf / detected");
  });

  it("detects DROP TABLE", () => {
    const result = checkDangerousOps('query("DROP TABLE users")');
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("DROP TABLE detected");
  });

  it("detects dangerous eval usage", () => {
    const result = checkDangerousOps('eval("malicious code")');
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("eval() usage detected");
  });

  it("detects process termination with exit code", () => {
    const code = "process" + ".exit(1)";
    const result = checkDangerousOps(code);
    expect(result.safe).toBe(false);
  });
});

describe("checkSecretsExposed", () => {
  it("returns safe for clean code", () => {
    const result = checkSecretsExposed("const x = 'hello';");
    expect(result.safe).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("detects OpenAI API keys", () => {
    const result = checkSecretsExposed('const key = "sk-abcdefghijklmnopqrstuvwxyz123456789";');
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("OpenAI API key detected");
  });

  it("detects hardcoded passwords", () => {
    const result = checkSecretsExposed('const password = "supersecret123";');
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("Hardcoded password detected");
  });

  it("detects PRIVATE_KEY references", () => {
    const keyRef = "PRIVATE" + "_KEY";
    const result = checkSecretsExposed(`const ${keyRef} = someValue;`);
    expect(result.safe).toBe(false);
    expect(result.issues).toContain("Private key reference detected");
  });
});

describe("calculateSizeMetrics", () => {
  it("calculates lines added for larger solution", () => {
    const original = "line1\nline2";
    const solution = "line1\nline2\nline3\nline4";
    const result = calculateSizeMetrics(original, solution);

    expect(result.linesAdded).toBe(2);
    expect(result.linesRemoved).toBe(0);
    expect(result.netChange).toBe(2);
  });

  it("calculates lines removed for smaller solution", () => {
    const original = "line1\nline2\nline3\nline4";
    const solution = "line1\nline2";
    const result = calculateSizeMetrics(original, solution);

    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(2);
    expect(result.netChange).toBe(-2);
  });

  it("handles equal size", () => {
    const original = "line1\nline2";
    const solution = "line1\nline2";
    const result = calculateSizeMetrics(original, solution);

    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
    expect(result.netChange).toBe(0);
  });
});

describe("estimateComplexity", () => {
  it("returns base complexity for simple code", () => {
    const code = "function foo() { return 1; }";
    const result = estimateComplexity(code);

    expect(result.average).toBeGreaterThanOrEqual(1);
    expect(result.max).toBeGreaterThanOrEqual(1);
  });

  it("increases complexity for conditionals", () => {
    const simple = "function foo() { return 1; }";
    const complex =
      "function foo(x) { if (x > 0) { return 1; } else if (x < 0) { return -1; } return 0; }";

    const simpleResult = estimateComplexity(simple);
    const complexResult = estimateComplexity(complex);

    expect(complexResult.max).toBeGreaterThan(simpleResult.max);
  });

  it("increases complexity for loops", () => {
    const simple = "function foo() { return 1; }";
    const withLoop = "function foo(arr) { for (const x of arr) { console.log(x); } }";

    const simpleResult = estimateComplexity(simple);
    const loopResult = estimateComplexity(withLoop);

    expect(loopResult.max).toBeGreaterThan(simpleResult.max);
  });
});

describe("estimateDuplication", () => {
  it("returns 0 for unique lines", () => {
    const code = "const a = 1;\nconst b = 2;\nconst c = 3;";
    expect(estimateDuplication(code)).toBe(0);
  });

  it("detects duplicate lines", () => {
    const code = "const longLine = 'this is a long line';\nconst longLine = 'this is a long line';";
    const result = estimateDuplication(code);
    expect(result).toBeGreaterThan(0);
  });

  it("handles empty code", () => {
    expect(estimateDuplication("")).toBe(0);
  });
});

describe("calculateCommentRatio", () => {
  it("returns high score for good comment ratio", () => {
    const code = `
      // This is a comment
      const x = 1;
      const y = 2;
      const z = 3;
      // Another comment
      const w = 4;
    `;
    const result = calculateCommentRatio(code);
    expect(result).toBeGreaterThan(0);
  });

  it("returns lower score for no comments", () => {
    const code = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const result = calculateCommentRatio(code);
    expect(result).toBeLessThan(1);
  });

  it("handles empty code", () => {
    expect(calculateCommentRatio("")).toBe(0);
  });
});

// ============================================================================
// Evaluation tests
// ============================================================================

describe("evaluateSolution", () => {
  it("evaluates a solution with all checks passing", async () => {
    const deps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "42 passed",
        stderr: "",
        exitCode: 0,
      }),
    });

    const solution = createMockSolution();
    const result = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, deps);

    expect(result.solutionId).toBe("solution-1");
    expect(result.iterationId).toBe("iteration-1");
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.correctness).toBeDefined();
    expect(result.quality).toBeDefined();
    expect(result.efficiency).toBeDefined();
    expect(result.completeness).toBeDefined();
    expect(result.safety).toBeDefined();
  });

  it("produces lower score when checks fail", async () => {
    const passingDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "42 passed",
        stderr: "",
        exitCode: 0,
      }),
    });

    const failingDeps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "5 failed",
        exitCode: 1,
      }),
    });

    const solution = createMockSolution();

    const passingResult = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, passingDeps);
    const failingResult = await evaluateSolution(solution, DEFAULT_EVALUATION_CONFIG, failingDeps);

    expect(failingResult.overallScore).toBeLessThan(passingResult.overallScore);
  });

  it("uses LLM assessments when enabled", async () => {
    const llmAssess = vi.fn().mockResolvedValue({
      score: 0.9,
      confidence: 0.95,
      reasoning: "Excellent code",
      suggestions: [],
    });

    const deps = createMockDeps({ llmAssess });
    const config: EvaluationConfig = {
      ...DEFAULT_EVALUATION_CONFIG,
      llmAssessment: { ...DEFAULT_EVALUATION_CONFIG.llmAssessment, enabled: true },
    };

    const solution = createMockSolution();
    await evaluateSolution(solution, config, deps);

    expect(llmAssess).toHaveBeenCalled();
  });

  it("skips LLM assessments when disabled", async () => {
    const llmAssess = vi.fn();
    const deps = createMockDeps({ llmAssess });
    const config: EvaluationConfig = {
      ...DEFAULT_EVALUATION_CONFIG,
      llmAssessment: { ...DEFAULT_EVALUATION_CONFIG.llmAssessment, enabled: false },
    };

    const solution = createMockSolution();
    await evaluateSolution(solution, config, deps);

    expect(llmAssess).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Strength/weakness identification tests
// ============================================================================

describe("identifyStrengths", () => {
  it("identifies all tests passing", () => {
    const evaluation = createMockEvaluation({
      correctness: { ...createMockEvaluation().correctness, testsPass: 1.0 },
    });
    const strengths = identifyStrengths(evaluation);
    expect(strengths).toContain("All tests pass");
  });

  it("identifies clean type check and lint", () => {
    const evaluation = createMockEvaluation({
      correctness: {
        ...createMockEvaluation().correctness,
        typeCheck: true,
        lintClean: true,
      },
    });
    const strengths = identifyStrengths(evaluation);
    expect(strengths).toContain("Clean type check and lint");
  });

  it("identifies low complexity", () => {
    const evaluation = createMockEvaluation({
      quality: {
        ...createMockEvaluation().quality,
        complexity: { average: 2, max: 3, score: 0.9 },
      },
    });
    const strengths = identifyStrengths(evaluation);
    expect(strengths).toContain("Low code complexity");
  });

  it("identifies documentation", () => {
    const evaluation = createMockEvaluation({
      completeness: { ...createMockEvaluation().completeness, documentationAdded: true },
    });
    const strengths = identifyStrengths(evaluation);
    expect(strengths).toContain("Well documented");
  });
});

describe("identifyWeaknesses", () => {
  it("identifies failing tests", () => {
    const evaluation = createMockEvaluation({
      correctness: { ...createMockEvaluation().correctness, testsPass: 0.8 },
    });
    const weaknesses = identifyWeaknesses(evaluation);
    expect(weaknesses.some((w) => w.includes("tests failing"))).toBe(true);
  });

  it("identifies type check errors", () => {
    const evaluation = createMockEvaluation({
      correctness: { ...createMockEvaluation().correctness, typeCheck: false },
    });
    const weaknesses = identifyWeaknesses(evaluation);
    expect(weaknesses).toContain("Type check errors");
  });

  it("identifies lint errors", () => {
    const evaluation = createMockEvaluation({
      correctness: { ...createMockEvaluation().correctness, lintClean: false },
    });
    const weaknesses = identifyWeaknesses(evaluation);
    expect(weaknesses).toContain("Lint errors present");
  });

  it("identifies missing documentation", () => {
    const evaluation = createMockEvaluation({
      completeness: { ...createMockEvaluation().completeness, documentationAdded: false },
    });
    const weaknesses = identifyWeaknesses(evaluation);
    expect(weaknesses).toContain("Missing documentation");
  });

  it("identifies dangerous operations", () => {
    const evaluation = createMockEvaluation({
      safety: { ...createMockEvaluation().safety, noDangerousOps: false },
    });
    const weaknesses = identifyWeaknesses(evaluation);
    expect(weaknesses).toContain("Contains potentially dangerous operations");
  });
});

// ============================================================================
// Ranking tests
// ============================================================================

describe("generatePairwiseComparisons", () => {
  it("generates comparisons for all category pairs", () => {
    const eval1 = createMockEvaluation({ solutionId: "sol-1", overallScore: 0.9 });
    const eval2 = createMockEvaluation({ solutionId: "sol-2", overallScore: 0.8 });

    const comparisons = generatePairwiseComparisons([eval1, eval2]);

    // 5 categories for 1 pair
    expect(comparisons.length).toBe(5);
    expect(comparisons.every((c) => c.solutionA === "sol-1" && c.solutionB === "sol-2")).toBe(true);
  });

  it("identifies ties for similar scores", () => {
    const eval1 = createMockEvaluation({
      solutionId: "sol-1",
      correctness: { ...createMockEvaluation().correctness, overall: 0.85 },
    });
    const eval2 = createMockEvaluation({
      solutionId: "sol-2",
      correctness: { ...createMockEvaluation().correctness, overall: 0.84 },
    });

    const comparisons = generatePairwiseComparisons([eval1, eval2]);
    const correctnessComparison = comparisons.find((c) => c.category === "correctness");

    expect(correctnessComparison?.winner).toBe("tie");
  });

  it("identifies winner for significant score differences", () => {
    const eval1 = createMockEvaluation({
      solutionId: "sol-1",
      correctness: { ...createMockEvaluation().correctness, overall: 0.9 },
    });
    const eval2 = createMockEvaluation({
      solutionId: "sol-2",
      correctness: { ...createMockEvaluation().correctness, overall: 0.7 },
    });

    const comparisons = generatePairwiseComparisons([eval1, eval2]);
    const correctnessComparison = comparisons.find((c) => c.category === "correctness");

    expect(correctnessComparison?.winner).toBe("sol-1");
  });
});

describe("calculateCategoryConsistency", () => {
  it("returns 1.0 when first wins all categories", () => {
    const first = {
      solutionId: "first",
      rank: 1,
      score: 0.9,
      evaluation: createMockEvaluation({
        correctness: { ...createMockEvaluation().correctness, overall: 0.95 },
        quality: { ...createMockEvaluation().quality, overall: 0.95 },
        efficiency: { ...createMockEvaluation().efficiency, overall: 0.95 },
        completeness: { ...createMockEvaluation().completeness, overall: 0.95 },
        safety: { ...createMockEvaluation().safety, overall: 0.95 },
      }),
      strengths: [],
      weaknesses: [],
    };
    const second = {
      solutionId: "second",
      rank: 2,
      score: 0.7,
      evaluation: createMockEvaluation({
        correctness: { ...createMockEvaluation().correctness, overall: 0.7 },
        quality: { ...createMockEvaluation().quality, overall: 0.7 },
        efficiency: { ...createMockEvaluation().efficiency, overall: 0.7 },
        completeness: { ...createMockEvaluation().completeness, overall: 0.7 },
        safety: { ...createMockEvaluation().safety, overall: 0.7 },
      }),
      strengths: [],
      weaknesses: [],
    };

    expect(calculateCategoryConsistency(first, second)).toBe(1.0);
  });

  it("returns 0.0 when second wins all categories", () => {
    const first = {
      solutionId: "first",
      rank: 1,
      score: 0.7,
      evaluation: createMockEvaluation({
        correctness: { ...createMockEvaluation().correctness, overall: 0.7 },
        quality: { ...createMockEvaluation().quality, overall: 0.7 },
        efficiency: { ...createMockEvaluation().efficiency, overall: 0.7 },
        completeness: { ...createMockEvaluation().completeness, overall: 0.7 },
        safety: { ...createMockEvaluation().safety, overall: 0.7 },
      }),
      strengths: [],
      weaknesses: [],
    };
    const second = {
      solutionId: "second",
      rank: 2,
      score: 0.9,
      evaluation: createMockEvaluation({
        correctness: { ...createMockEvaluation().correctness, overall: 0.9 },
        quality: { ...createMockEvaluation().quality, overall: 0.9 },
        efficiency: { ...createMockEvaluation().efficiency, overall: 0.9 },
        completeness: { ...createMockEvaluation().completeness, overall: 0.9 },
        safety: { ...createMockEvaluation().safety, overall: 0.9 },
      }),
      strengths: [],
      weaknesses: [],
    };

    expect(calculateCategoryConsistency(first, second)).toBe(0.0);
  });
});

describe("calculateRankingConfidence", () => {
  it("returns 0 for empty list", () => {
    expect(calculateRankingConfidence([])).toBe(0);
  });

  it("returns 1 for single solution", () => {
    const solutions = [
      {
        solutionId: "sol-1",
        rank: 1,
        score: 0.85,
        evaluation: createMockEvaluation(),
        strengths: [],
        weaknesses: [],
      },
    ];
    expect(calculateRankingConfidence(solutions)).toBe(1);
  });

  it("returns higher confidence for larger score gaps", () => {
    const smallGap = [
      {
        solutionId: "sol-1",
        rank: 1,
        score: 0.85,
        evaluation: createMockEvaluation({ confidence: 0.8 }),
        strengths: [],
        weaknesses: [],
      },
      {
        solutionId: "sol-2",
        rank: 2,
        score: 0.84,
        evaluation: createMockEvaluation({ confidence: 0.8 }),
        strengths: [],
        weaknesses: [],
      },
    ];

    const largeGap = [
      {
        solutionId: "sol-1",
        rank: 1,
        score: 0.95,
        evaluation: createMockEvaluation({ confidence: 0.8 }),
        strengths: [],
        weaknesses: [],
      },
      {
        solutionId: "sol-2",
        rank: 2,
        score: 0.75,
        evaluation: createMockEvaluation({ confidence: 0.8 }),
        strengths: [],
        weaknesses: [],
      },
    ];

    expect(calculateRankingConfidence(largeGap)).toBeGreaterThan(
      calculateRankingConfidence(smallGap),
    );
  });
});

describe("rankSolutions", () => {
  it("returns empty ranking for no evaluations", () => {
    const ranking = rankSolutions([]);
    expect(ranking.solutions).toEqual([]);
    expect(ranking.winner).toBeNull();
    expect(ranking.confidence).toBe(0);
  });

  it("ranks solutions by overall score", () => {
    const eval1 = createMockEvaluation({ solutionId: "low", overallScore: 0.7 });
    const eval2 = createMockEvaluation({ solutionId: "high", overallScore: 0.9 });
    const eval3 = createMockEvaluation({ solutionId: "mid", overallScore: 0.8 });

    const ranking = rankSolutions([eval1, eval2, eval3]);

    expect(ranking.solutions[0].solutionId).toBe("high");
    expect(ranking.solutions[1].solutionId).toBe("mid");
    expect(ranking.solutions[2].solutionId).toBe("low");
  });

  it("assigns correct ranks", () => {
    const eval1 = createMockEvaluation({ solutionId: "sol-1", overallScore: 0.9 });
    const eval2 = createMockEvaluation({ solutionId: "sol-2", overallScore: 0.8 });

    const ranking = rankSolutions([eval1, eval2]);

    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.solutions[1].rank).toBe(2);
  });

  it("includes strengths and weaknesses", () => {
    const evaluation = createMockEvaluation();
    const ranking = rankSolutions([evaluation]);

    expect(ranking.solutions[0].strengths).toBeDefined();
    expect(ranking.solutions[0].weaknesses).toBeDefined();
  });

  it("sets winner when confidence is high enough", () => {
    const eval1 = createMockEvaluation({ solutionId: "clear-winner", overallScore: 0.95 });
    const eval2 = createMockEvaluation({ solutionId: "loser", overallScore: 0.6 });

    const ranking = rankSolutions([eval1, eval2]);

    expect(ranking.winner?.solutionId).toBe("clear-winner");
  });

  it("sets winner to null when confidence is low", () => {
    const eval1 = createMockEvaluation({
      solutionId: "sol-1",
      overallScore: 0.801,
      confidence: 0.3,
    });
    const eval2 = createMockEvaluation({
      solutionId: "sol-2",
      overallScore: 0.8,
      confidence: 0.3,
    });

    const ranking = rankSolutions([eval1, eval2]);

    // Very close scores with low confidence should not produce a clear winner
    expect(ranking.confidence).toBeLessThan(0.6);
    expect(ranking.winner).toBeNull();
  });
});

// ============================================================================
// Auto-acceptance tests
// ============================================================================

describe("shouldAutoAccept", () => {
  it("rejects when auto-acceptance is disabled", () => {
    const ranking = rankSolutions([createMockEvaluation({ overallScore: 0.95 })]);
    const config = { ...DEFAULT_AUTO_ACCEPTANCE_CONFIG, enabled: false };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toBe("Auto-acceptance disabled");
  });

  it("rejects when no clear winner", () => {
    const ranking = { ...rankSolutions([]), winner: null };
    const config = { ...DEFAULT_AUTO_ACCEPTANCE_CONFIG, enabled: true };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toBe("No clear winner");
  });

  it("rejects when score is below threshold", () => {
    const evaluation = createMockEvaluation({ overallScore: 0.7 });
    const ranking = rankSolutions([evaluation]);
    const config = { ...DEFAULT_AUTO_ACCEPTANCE_CONFIG, enabled: true, minScore: 0.85 };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Score");
    expect(result.reason).toContain("below threshold");
  });

  it("rejects when confidence is below threshold", () => {
    const evaluation = createMockEvaluation({ overallScore: 0.9, confidence: 0.5 });
    const ranking = rankSolutions([evaluation]);
    const config = { ...DEFAULT_AUTO_ACCEPTANCE_CONFIG, enabled: true, minConfidence: 0.8 };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Confidence");
    expect(result.reason).toContain("below threshold");
  });

  it("rejects when category minimum not met", () => {
    const evaluation = createMockEvaluation({
      overallScore: 0.9,
      confidence: 0.9,
      // Set all categories high except safety so it fails on safety
      correctness: { ...createMockEvaluation().correctness, overall: 0.95 },
      quality: { ...createMockEvaluation().quality, overall: 0.95 },
      efficiency: { ...createMockEvaluation().efficiency, overall: 0.95 },
      completeness: { ...createMockEvaluation().completeness, overall: 0.95 },
      safety: { ...createMockEvaluation().safety, overall: 0.5 },
    });
    const ranking = rankSolutions([evaluation]);
    const config = {
      ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
      enabled: true,
      categoryMinimums: {
        correctness: 0.9,
        quality: 0.7,
        efficiency: 0.6,
        completeness: 0.8,
        safety: 0.95,
      },
    };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("safety");
    expect(result.reason).toContain("below minimum");
  });

  it("rejects when score gap is too small", () => {
    // Create evaluations with very similar scores
    const eval1 = createMockEvaluation({
      solutionId: "sol-1",
      overallScore: 0.9,
      confidence: 0.9,
      // Ensure all category minimums are met
      correctness: { ...createMockEvaluation().correctness, overall: 0.95 },
      quality: { ...createMockEvaluation().quality, overall: 0.85 },
      efficiency: { ...createMockEvaluation().efficiency, overall: 0.8 },
      completeness: { ...createMockEvaluation().completeness, overall: 0.9 },
      safety: { ...createMockEvaluation().safety, overall: 0.98 },
    });
    const eval2 = createMockEvaluation({
      solutionId: "sol-2",
      overallScore: 0.85, // Gap is 0.05, below minScoreGap of 0.1
      confidence: 0.9,
    });

    // Manually construct a ranking with a winner to test score gap check
    const ranking = rankSolutions([eval1, eval2]);
    // Force the ranking to have a winner by setting high confidence
    ranking.winner = ranking.solutions[0];
    ranking.confidence = 0.8;

    const config = {
      ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
      enabled: true,
      minScore: 0.85,
      minConfidence: 0.7,
      minScoreGap: 0.1,
      categoryMinimums: {
        correctness: 0.9,
        quality: 0.7,
        efficiency: 0.6,
        completeness: 0.8,
        safety: 0.95,
      },
    };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(false);
    expect(result.reason).toContain("Score gap");
  });

  it("accepts when all criteria are met", () => {
    const evaluation = createMockEvaluation({
      overallScore: 0.92,
      confidence: 0.9,
      correctness: { ...createMockEvaluation().correctness, overall: 0.95 },
      quality: { ...createMockEvaluation().quality, overall: 0.85 },
      efficiency: { ...createMockEvaluation().efficiency, overall: 0.8 },
      completeness: { ...createMockEvaluation().completeness, overall: 0.9 },
      safety: { ...createMockEvaluation().safety, overall: 0.98 },
    });
    const ranking = rankSolutions([evaluation]);
    const config = {
      ...DEFAULT_AUTO_ACCEPTANCE_CONFIG,
      enabled: true,
      minScore: 0.85,
      minConfidence: 0.8,
      categoryMinimums: {
        correctness: 0.9,
        quality: 0.7,
        efficiency: 0.6,
        completeness: 0.8,
        safety: 0.95,
      },
    };

    const result = shouldAutoAccept(ranking, config);

    expect(result.accept).toBe(true);
    expect(result.reason).toBe("All criteria met");
  });
});

// ============================================================================
// compareSolutions integration test
// ============================================================================

describe("compareSolutions", () => {
  it("evaluates and ranks multiple solutions", async () => {
    const deps = createMockDeps({
      spawnCommand: vi.fn().mockResolvedValue({
        success: true,
        stdout: "20 passed",
        stderr: "",
        exitCode: 0,
      }),
    });

    const solutions = [
      createMockSolution({ solutionId: "sol-1" }),
      createMockSolution({ solutionId: "sol-2" }),
    ];

    const ranking = await compareSolutions(solutions, DEFAULT_EVALUATION_CONFIG, deps);

    expect(ranking.solutions.length).toBe(2);
    expect(ranking.solutions[0].rank).toBe(1);
    expect(ranking.solutions[1].rank).toBe(2);
  });
});

// ============================================================================
// Markdown formatting tests
// ============================================================================

describe("formatRankingAsMarkdown", () => {
  it("returns empty message for no solutions", () => {
    const ranking = rankSolutions([]);
    const markdown = formatRankingAsMarkdown(ranking);

    expect(markdown).toContain("No solutions to compare");
  });

  it("includes winner information when available", () => {
    const evaluation = createMockEvaluation({ solutionId: "winner-sol", overallScore: 0.95 });
    const ranking = rankSolutions([evaluation]);
    const markdown = formatRankingAsMarkdown(ranking);

    expect(markdown).toContain("Winner: winner-sol");
    expect(markdown).toContain("Score:");
    expect(markdown).toContain("Confidence:");
  });

  it("includes comparison table", () => {
    const evaluation = createMockEvaluation();
    const ranking = rankSolutions([evaluation]);
    const markdown = formatRankingAsMarkdown(ranking);

    expect(markdown).toContain("| Category |");
    expect(markdown).toContain("Correctness");
    expect(markdown).toContain("Quality");
    expect(markdown).toContain("Efficiency");
    expect(markdown).toContain("Completeness");
    expect(markdown).toContain("Safety");
    expect(markdown).toContain("**Overall**");
  });

  it("includes strengths and weaknesses for winner", () => {
    const evaluation = createMockEvaluation({
      solutionId: "test-sol",
      overallScore: 0.95,
      correctness: {
        ...createMockEvaluation().correctness,
        testsPass: 1.0,
        typeCheck: true,
        lintClean: true,
      },
    });
    const ranking = rankSolutions([evaluation]);
    const markdown = formatRankingAsMarkdown(ranking);

    expect(markdown).toContain("Why test-sol?");
    expect(markdown).toContain("**Strengths:**");
  });

  it("shows manual review recommendation when no clear winner", () => {
    const eval1 = createMockEvaluation({
      solutionId: "sol-1",
      overallScore: 0.801,
      confidence: 0.3,
    });
    const eval2 = createMockEvaluation({
      solutionId: "sol-2",
      overallScore: 0.8,
      confidence: 0.3,
    });
    const ranking = rankSolutions([eval1, eval2]);
    const markdown = formatRankingAsMarkdown(ranking);

    expect(markdown).toContain("No clear winner");
    expect(markdown).toContain("manual review recommended");
  });
});
