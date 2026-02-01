/**
 * Solution comparator for evaluating parallel agent iteration outputs
 *
 * Evaluates solutions across multiple criteria (correctness, quality,
 * efficiency, completeness, safety) using both automated checks and
 * LLM-based assessment. Implements ranking and auto-acceptance logic.
 *
 * Note: Uses spawn() with argument arrays for safe command execution
 * (no shell injection risk).
 */

import { spawn } from "node:child_process";

// ============================================================================
// Type definitions
// ============================================================================

/**
 * LLM assessment result for subjective criteria
 */
export interface LLMAssessment {
  score: number; // 0.0 - 1.0
  confidence: number; // 0.0 - 1.0
  reasoning: string;
  suggestions?: string[];
}

/**
 * Correctness score breakdown
 */
export interface CorrectnessScore {
  testsPass: number; // Ratio of passing tests (0-1)
  typeCheck: boolean; // tsc passes
  lintClean: boolean; // No lint errors
  buildSuccess: boolean; // Build completes
  noRegressions: boolean; // No test count decrease
  requirementCoverage: number; // 0-1, LLM assessed
  edgeCaseHandling: number; // 0-1, LLM assessed
  apiCompatible: boolean; // No breaking changes
  overall: number; // Aggregated score (0-1)
}

/**
 * Code quality score breakdown
 */
export interface QualityScore {
  complexity: {
    average: number; // Avg cyclomatic complexity
    max: number; // Max in any function
    score: number; // Normalized 0-1 (lower is better)
  };
  size: {
    linesAdded: number;
    linesRemoved: number;
    netChange: number;
    score: number; // Normalized 0-1
  };
  duplication: {
    percentage: number;
    score: number; // 1 - duplication%
  };
  naming: number; // LLM assessed 0-1
  comments: number; // Ratio-based 0-1
  patternAdherence: number; // LLM assessed 0-1
  errorHandling: number; // LLM assessed 0-1
  overall: number;
}

/**
 * Efficiency score breakdown
 */
export interface EfficiencyScore {
  runtime?: {
    baseline: number; // ms
    solution: number; // ms
    ratio: number; // solution / baseline
    score: number; // Normalized 0-1
  };
  memory?: {
    baseline: number; // bytes
    solution: number; // bytes
    ratio: number;
    score: number;
  };
  algorithmic: number; // LLM assessed complexity
  resourceCleanup: boolean;
  asyncEfficiency: number;
  overall: number;
}

/**
 * Completeness score breakdown
 */
export interface CompletenessScore {
  requirementsMet: number; // Ratio of requirements addressed
  documentationAdded: boolean;
  testsAdded: number; // Ratio of new code covered
  changelogUpdated: boolean;
  overall: number;
}

/**
 * Safety score breakdown
 */
export interface SafetyScore {
  noDangerousOps: boolean; // No rm -rf, DROP TABLE, etc.
  securityReview: number; // LLM assessed 0-1
  noSecretsExposed: boolean; // No hardcoded credentials
  rollbackSafe: number; // How easily reversible
  overall: number;
}

/**
 * Complete solution evaluation
 */
export interface SolutionEvaluation {
  solutionId: string;
  iterationId: string;

  correctness: CorrectnessScore;
  quality: QualityScore;
  efficiency: EfficiencyScore;
  completeness: CompletenessScore;
  safety: SafetyScore;

  // Weighted aggregate
  overallScore: number;

  // Confidence in the evaluation
  confidence: number;

  // Evaluation timestamp
  evaluatedAt: Date;
}

/**
 * Ranked solution with analysis
 */
export interface RankedSolution {
  solutionId: string;
  rank: number; // 1 = best
  score: number;
  evaluation: SolutionEvaluation;
  strengths: string[];
  weaknesses: string[];
}

/**
 * Pairwise comparison detail
 */
export interface ComparisonDetail {
  solutionA: string;
  solutionB: string;
  winner: string | "tie";
  category: string;
  scoreDiff: number;
  reasoning: string;
}

/**
 * Solution ranking result
 */
export interface SolutionRanking {
  solutions: RankedSolution[];
  winner: RankedSolution | null;
  confidence: number;
  comparisonDetails: ComparisonDetail[];
}

/**
 * Auto-acceptance configuration
 */
export interface AutoAcceptanceConfig {
  minScore: number;
  minConfidence: number;
  categoryMinimums: {
    correctness: number;
    quality: number;
    efficiency: number;
    completeness: number;
    safety: number;
  };
  minScoreGap: number;
  enabled: boolean;
}

/**
 * Auto-acceptance result
 */
export interface AutoAcceptanceResult {
  accept: boolean;
  reason: string;
}

/**
 * Evaluation configuration
 */
export interface EvaluationConfig {
  weights: {
    correctness: number;
    quality: number;
    efficiency: number;
    completeness: number;
    safety: number;
  };
  autoAcceptance: AutoAcceptanceConfig;
  llmAssessment: {
    enabled: boolean;
    model: string;
    maxTokens: number;
    temperature: number;
  };
  timeouts: {
    typeCheck: number;
    lint: number;
    build: number;
    tests: number;
  };
  cache: {
    enabled: boolean;
    ttlSeconds: number;
  };
}

/**
 * LLM assessment function type (injectable for testing)
 */
export type LLMAssessor = (
  criterion: string,
  taskDescription: string,
  originalCode: string,
  solutionCode: string,
) => Promise<LLMAssessment>;

/**
 * Dependencies for the comparator
 */
export interface ComparatorDeps {
  /** Run shell commands (uses spawn internally - safe from injection) */
  spawnCommand: (cmd: string, args: string[], timeout?: number) => Promise<CommandResult>;
  /** LLM assessment function */
  llmAssess?: LLMAssessor;
  /** Get current timestamp */
  now?: () => Date;
}

/**
 * Command execution result
 */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Solution input for evaluation
 */
export interface SolutionInput {
  solutionId: string;
  iterationId: string;
  taskDescription: string;
  originalCode: string;
  solutionCode: string;
  changedFiles: string[];
}

// ============================================================================
// Default configuration
// ============================================================================

export const DEFAULT_AUTO_ACCEPTANCE_CONFIG: AutoAcceptanceConfig = {
  minScore: 0.85,
  minConfidence: 0.8,
  categoryMinimums: {
    correctness: 0.9,
    quality: 0.7,
    efficiency: 0.6,
    completeness: 0.8,
    safety: 0.95,
  },
  minScoreGap: 0.1,
  enabled: false,
};

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  weights: {
    correctness: 0.4,
    quality: 0.25,
    efficiency: 0.15,
    completeness: 0.1,
    safety: 0.1,
  },
  autoAcceptance: DEFAULT_AUTO_ACCEPTANCE_CONFIG,
  llmAssessment: {
    enabled: true,
    model: "claude-3-5-sonnet",
    maxTokens: 1024,
    temperature: 0.1,
  },
  timeouts: {
    typeCheck: 60000,
    lint: 30000,
    build: 120000,
    tests: 300000,
  },
  cache: {
    enabled: true,
    ttlSeconds: 3600,
  },
};

// ============================================================================
// Scoring utilities
// ============================================================================

/**
 * Convert boolean to score
 */
export function booleanToScore(value: boolean): number {
  return value ? 1.0 : 0.0;
}

/**
 * Convert ratio to score (capped at 1.0)
 */
export function ratioToScore(actual: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(1.0, actual / target);
}

/**
 * Inverse score for metrics where lower is better
 */
export function inverseScore(value: number, baseline: number, worst: number): number {
  if (value <= baseline) return 1.0;
  if (value >= worst) return 0.0;
  return 1.0 - (value - baseline) / (worst - baseline);
}

/**
 * Clamp a value between 0 and 1
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

// ============================================================================
// Default dependency implementations
// ============================================================================

/**
 * Default command executor using spawn (safe - no shell injection)
 */
export async function defaultSpawnCommand(
  cmd: string,
  args: string[],
  timeout = 60000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    proc.on("error", (err) => {
      resolve({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: 1,
      });
    });
  });
}

/**
 * Default LLM assessor (returns neutral scores when no LLM available)
 */
export function defaultLLMAssess(): Promise<LLMAssessment> {
  return Promise.resolve({
    score: 0.5,
    confidence: 0.3,
    reasoning: "LLM assessment not configured",
    suggestions: [],
  });
}

/**
 * Create default dependencies
 */
export function createDefaultDeps(): ComparatorDeps {
  return {
    spawnCommand: defaultSpawnCommand,
    llmAssess: defaultLLMAssess,
    now: () => new Date(),
  };
}

// ============================================================================
// Automated checks
// ============================================================================

/**
 * Run type check via tsc
 */
export async function runTypeCheck(
  deps: ComparatorDeps,
  timeout: number,
): Promise<{ success: boolean; errors: string[] }> {
  const result = await deps.spawnCommand("npx", ["tsc", "--noEmit"], timeout);
  const errors = result.stderr
    .split("\n")
    .filter((line) => line.includes("error TS"))
    .slice(0, 10);
  return { success: result.success, errors };
}

/**
 * Run linter
 */
export async function runLint(
  deps: ComparatorDeps,
  timeout: number,
): Promise<{ success: boolean; errors: string[] }> {
  const result = await deps.spawnCommand("pnpm", ["lint"], timeout);
  const errors = result.stderr
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(0, 10);
  return { success: result.success, errors };
}

/**
 * Run build
 */
export async function runBuild(
  deps: ComparatorDeps,
  timeout: number,
): Promise<{ success: boolean; errors: string[] }> {
  const result = await deps.spawnCommand("pnpm", ["build"], timeout);
  const errors = result.stderr
    .split("\n")
    .filter((line) => line.includes("error"))
    .slice(0, 10);
  return { success: result.success, errors };
}

/**
 * Run tests and parse results
 */
export async function runTests(
  deps: ComparatorDeps,
  timeout: number,
): Promise<{
  success: boolean;
  passed: number;
  failed: number;
  total: number;
  errors: string[];
}> {
  const result = await deps.spawnCommand("pnpm", ["test", "--reporter=verbose"], timeout);
  const output = result.stdout + result.stderr;

  // Parse test counts from vitest output
  // Looks for patterns like "Tests  42 passed (42)" or "Tests  5 failed | 37 passed"
  const passedMatch = output.match(/(\d+)\s*passed/);
  const failedMatch = output.match(/(\d+)\s*failed/);

  const passed = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  const failed = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  const total = passed + failed;

  const errors = output
    .split("\n")
    .filter((line) => line.includes("FAIL") || line.includes("Error:"))
    .slice(0, 10);

  return {
    success: failed === 0 && passed > 0,
    passed,
    failed,
    total,
    errors,
  };
}

// Dangerous operation patterns for security checking
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+-rf\s+\//, description: "rm -rf / detected" },
  { pattern: /DROP\s+TABLE/i, description: "DROP TABLE detected" },
  { pattern: /DROP\s+DATABASE/i, description: "DROP DATABASE detected" },
  { pattern: /TRUNCATE\s+TABLE/i, description: "TRUNCATE TABLE detected" },
  { pattern: /process\.exit\s*\(\s*\d+\s*\)/, description: "process.exit with code detected" },
  { pattern: /\beval\s*\(/, description: "eval() usage detected" },
  // Check for dynamic code execution patterns
  { pattern: /\bnew\s+Function\s*\(/, description: "Dynamic Function constructor detected" },
];

/**
 * Check for dangerous operations in code
 */
export function checkDangerousOps(code: string): { safe: boolean; issues: string[] } {
  const issues: string[] = [];
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      issues.push(description);
    }
  }

  return { safe: issues.length === 0, issues };
}

/**
 * Check for exposed secrets in code
 */
export function checkSecretsExposed(code: string): { safe: boolean; issues: string[] } {
  const secretPatterns = [
    { pattern: /['"]sk-[a-zA-Z0-9]{20,}['"]/, description: "OpenAI API key detected" },
    { pattern: /['"][a-zA-Z0-9_-]{39}['"]/, description: "Possible API key detected" },
    { pattern: /password\s*=\s*['"][^'"]+['"]/, description: "Hardcoded password detected" },
    { pattern: /secret\s*=\s*['"][^'"]+['"]/, description: "Hardcoded secret detected" },
    { pattern: /PRIVATE[_\s]KEY/, description: "Private key reference detected" },
  ];

  const issues: string[] = [];
  for (const { pattern, description } of secretPatterns) {
    if (pattern.test(code)) {
      issues.push(description);
    }
  }

  return { safe: issues.length === 0, issues };
}

/**
 * Calculate code size metrics from diff
 */
export function calculateSizeMetrics(
  originalCode: string,
  solutionCode: string,
): { linesAdded: number; linesRemoved: number; netChange: number } {
  const originalLines = originalCode.split("\n").length;
  const solutionLines = solutionCode.split("\n").length;
  const netChange = solutionLines - originalLines;

  return {
    linesAdded: Math.max(0, netChange),
    linesRemoved: Math.max(0, -netChange),
    netChange,
  };
}

/**
 * Calculate simple complexity estimate based on code patterns
 */
export function estimateComplexity(code: string): { average: number; max: number } {
  // Split by function-like boundaries
  const functionBlocks = code.split(/(?:function|=>|async\s+function)\s*[^{]*\{/);

  let totalComplexity = 0;
  let maxComplexity = 0;
  let functionCount = 0;

  for (const block of functionBlocks) {
    if (!block.trim()) continue;

    // Count decision points (simplified cyclomatic complexity)
    let complexity = 1; // Base complexity
    complexity += (block.match(/\bif\b/g) || []).length;
    complexity += (block.match(/\belse\s+if\b/g) || []).length;
    complexity += (block.match(/\bfor\b/g) || []).length;
    complexity += (block.match(/\bwhile\b/g) || []).length;
    complexity += (block.match(/\bswitch\b/g) || []).length;
    complexity += (block.match(/\bcase\b/g) || []).length;
    complexity += (block.match(/\bcatch\b/g) || []).length;
    complexity += (block.match(/\?\?/g) || []).length;
    complexity += (block.match(/\?\./g) || []).length;
    complexity += (block.match(/&&|\|\|/g) || []).length;
    complexity += (block.match(/\?[^:]+:/g) || []).length; // Ternary

    totalComplexity += complexity;
    maxComplexity = Math.max(maxComplexity, complexity);
    functionCount++;
  }

  return {
    average: functionCount > 0 ? totalComplexity / functionCount : 1,
    max: maxComplexity || 1,
  };
}

/**
 * Estimate code duplication percentage (simplified)
 */
export function estimateDuplication(code: string): number {
  const lines = code.split("\n").filter((line) => line.trim().length > 10);
  if (lines.length < 2) return 0;

  const seen = new Set<string>();
  let duplicates = 0;

  for (const line of lines) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      duplicates++;
    } else {
      seen.add(normalized);
    }
  }

  return duplicates / lines.length;
}

/**
 * Calculate comment ratio
 */
export function calculateCommentRatio(code: string): number {
  const lines = code.split("\n");
  const codeLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("//") && !trimmed.startsWith("/*");
  }).length;

  const commentLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*");
  }).length;

  const total = codeLines + commentLines;
  if (total === 0) return 0;

  // Target: 10-20% comments
  const ratio = commentLines / total;
  if (ratio >= 0.1 && ratio <= 0.2) return 1.0;
  if (ratio < 0.1) return ratio / 0.1;
  return Math.max(0, 1 - (ratio - 0.2) / 0.3);
}

// ============================================================================
// Category score calculators
// ============================================================================

/**
 * Calculate correctness score
 */
export async function calculateCorrectnessScore(
  deps: ComparatorDeps,
  solution: SolutionInput,
  config: EvaluationConfig,
): Promise<CorrectnessScore> {
  // Run automated checks in parallel
  const [typeCheckResult, lintResult, buildResult, testResult] = await Promise.all([
    runTypeCheck(deps, config.timeouts.typeCheck),
    runLint(deps, config.timeouts.lint),
    runBuild(deps, config.timeouts.build),
    runTests(deps, config.timeouts.tests),
  ]);

  // Calculate test pass ratio
  const testsPass = testResult.total > 0 ? testResult.passed / testResult.total : 0;

  // LLM assessments for semantic checks
  let requirementCoverage = 0.5;
  let edgeCaseHandling = 0.5;

  if (config.llmAssessment.enabled && deps.llmAssess) {
    const [reqAssess, edgeAssess] = await Promise.all([
      deps.llmAssess(
        "requirement_coverage",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
      deps.llmAssess(
        "edge_case_handling",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
    ]);
    requirementCoverage = reqAssess.score;
    edgeCaseHandling = edgeAssess.score;
  }

  // Calculate overall correctness
  // Automated checks (60% weight)
  const automatedScore =
    testsPass * 0.3 +
    booleanToScore(typeCheckResult.success) * 0.1 +
    booleanToScore(lintResult.success) * 0.1 +
    booleanToScore(buildResult.success) * 0.1;

  // LLM assessments (40% weight)
  const llmScore = requirementCoverage * 0.25 + edgeCaseHandling * 0.15;

  const overall = clamp01(automatedScore + llmScore);

  return {
    testsPass,
    typeCheck: typeCheckResult.success,
    lintClean: lintResult.success,
    buildSuccess: buildResult.success,
    noRegressions: testResult.failed === 0,
    requirementCoverage,
    edgeCaseHandling,
    apiCompatible: true, // TODO: implement API compatibility check
    overall,
  };
}

/**
 * Calculate quality score
 */
export async function calculateQualityScore(
  deps: ComparatorDeps,
  solution: SolutionInput,
  config: EvaluationConfig,
): Promise<QualityScore> {
  const sizeMetrics = calculateSizeMetrics(solution.originalCode, solution.solutionCode);
  const complexityMetrics = estimateComplexity(solution.solutionCode);
  const duplicationPct = estimateDuplication(solution.solutionCode);
  const commentRatio = calculateCommentRatio(solution.solutionCode);

  // Score complexity (target: avg < 5, max < 10)
  const complexityScore = clamp01(
    (inverseScore(complexityMetrics.average, 5, 15) + inverseScore(complexityMetrics.max, 10, 25)) /
      2,
  );

  // Score size (prefer smaller changes, up to 200 lines net change is good)
  const sizeScore = inverseScore(Math.abs(sizeMetrics.netChange), 50, 500);

  // Score duplication
  const duplicationScore = 1 - duplicationPct;

  // LLM assessments
  let naming = 0.5;
  let patternAdherence = 0.5;
  let errorHandling = 0.5;

  if (config.llmAssessment.enabled && deps.llmAssess) {
    const [nameAssess, patternAssess, errorAssess] = await Promise.all([
      deps.llmAssess(
        "naming_quality",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
      deps.llmAssess(
        "pattern_adherence",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
      deps.llmAssess(
        "error_handling",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
    ]);
    naming = nameAssess.score;
    patternAdherence = patternAssess.score;
    errorHandling = errorAssess.score;
  }

  // Calculate overall quality
  const overall = clamp01(
    complexityScore * 0.2 +
      sizeScore * 0.1 +
      duplicationScore * 0.15 +
      naming * 0.15 +
      commentRatio * 0.1 +
      patternAdherence * 0.15 +
      errorHandling * 0.15,
  );

  return {
    complexity: {
      average: complexityMetrics.average,
      max: complexityMetrics.max,
      score: complexityScore,
    },
    size: {
      ...sizeMetrics,
      score: sizeScore,
    },
    duplication: {
      percentage: duplicationPct,
      score: duplicationScore,
    },
    naming,
    comments: commentRatio,
    patternAdherence,
    errorHandling,
    overall,
  };
}

/**
 * Calculate efficiency score
 */
export async function calculateEfficiencyScore(
  deps: ComparatorDeps,
  solution: SolutionInput,
  config: EvaluationConfig,
): Promise<EfficiencyScore> {
  // LLM assessments for algorithm complexity
  let algorithmic = 0.5;
  let asyncEfficiency = 0.5;

  if (config.llmAssessment.enabled && deps.llmAssess) {
    const [algoAssess, asyncAssess] = await Promise.all([
      deps.llmAssess(
        "algorithmic_complexity",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
      deps.llmAssess(
        "async_efficiency",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
    ]);
    algorithmic = algoAssess.score;
    asyncEfficiency = asyncAssess.score;
  }

  // Check for resource cleanup patterns
  const hasCleanup =
    solution.solutionCode.includes("finally") ||
    solution.solutionCode.includes(".close()") ||
    solution.solutionCode.includes("[Symbol.dispose]") ||
    solution.solutionCode.includes("using ");

  // Calculate overall efficiency
  const overall = clamp01(
    algorithmic * 0.5 + asyncEfficiency * 0.3 + booleanToScore(hasCleanup) * 0.2,
  );

  return {
    algorithmic,
    resourceCleanup: hasCleanup,
    asyncEfficiency,
    overall,
  };
}

/**
 * Calculate completeness score
 */
export async function calculateCompletenessScore(
  deps: ComparatorDeps,
  solution: SolutionInput,
  config: EvaluationConfig,
): Promise<CompletenessScore> {
  // Check for documentation
  const hasDocComments =
    solution.solutionCode.includes("/**") || solution.solutionCode.includes("@param");

  // Check for test additions
  const hasTestCode =
    solution.changedFiles.some((f) => f.endsWith(".test.ts")) ||
    solution.solutionCode.includes("describe(") ||
    solution.solutionCode.includes("it(") ||
    solution.solutionCode.includes("test(");

  // LLM assessment for requirement coverage
  let requirementsMet = 0.5;
  if (config.llmAssessment.enabled && deps.llmAssess) {
    const reqAssess = await deps.llmAssess(
      "requirements_met",
      solution.taskDescription,
      solution.originalCode,
      solution.solutionCode,
    );
    requirementsMet = reqAssess.score;
  }

  // Calculate overall completeness
  const overall = clamp01(
    requirementsMet * 0.5 +
      booleanToScore(hasDocComments) * 0.2 +
      booleanToScore(hasTestCode) * 0.3,
  );

  return {
    requirementsMet,
    documentationAdded: hasDocComments,
    testsAdded: booleanToScore(hasTestCode),
    changelogUpdated: false, // Would need file check
    overall,
  };
}

/**
 * Calculate safety score
 */
export async function calculateSafetyScore(
  deps: ComparatorDeps,
  solution: SolutionInput,
  config: EvaluationConfig,
): Promise<SafetyScore> {
  const dangerCheck = checkDangerousOps(solution.solutionCode);
  const secretsCheck = checkSecretsExposed(solution.solutionCode);

  // LLM security review
  let securityReview = 0.5;
  let rollbackSafe = 0.5;

  if (config.llmAssessment.enabled && deps.llmAssess) {
    const [secAssess, rollbackAssess] = await Promise.all([
      deps.llmAssess(
        "security_review",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
      deps.llmAssess(
        "rollback_safety",
        solution.taskDescription,
        solution.originalCode,
        solution.solutionCode,
      ),
    ]);
    securityReview = secAssess.score;
    rollbackSafe = rollbackAssess.score;
  }

  // Calculate overall safety
  const overall = clamp01(
    booleanToScore(dangerCheck.safe) * 0.3 +
      securityReview * 0.3 +
      booleanToScore(secretsCheck.safe) * 0.2 +
      rollbackSafe * 0.2,
  );

  return {
    noDangerousOps: dangerCheck.safe,
    securityReview,
    noSecretsExposed: secretsCheck.safe,
    rollbackSafe,
    overall,
  };
}

// ============================================================================
// Main evaluation functions
// ============================================================================

/**
 * Evaluate a single solution
 */
export async function evaluateSolution(
  solution: SolutionInput,
  config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
  deps: ComparatorDeps = createDefaultDeps(),
): Promise<SolutionEvaluation> {
  // Calculate all category scores in parallel
  const [correctness, quality, efficiency, completeness, safety] = await Promise.all([
    calculateCorrectnessScore(deps, solution, config),
    calculateQualityScore(deps, solution, config),
    calculateEfficiencyScore(deps, solution, config),
    calculateCompletenessScore(deps, solution, config),
    calculateSafetyScore(deps, solution, config),
  ]);

  // Calculate weighted overall score
  const overallScore = clamp01(
    correctness.overall * config.weights.correctness +
      quality.overall * config.weights.quality +
      efficiency.overall * config.weights.efficiency +
      completeness.overall * config.weights.completeness +
      safety.overall * config.weights.safety,
  );

  // Calculate confidence based on LLM assessment availability and automated check success
  const automatedConfidence =
    (booleanToScore(correctness.typeCheck) +
      booleanToScore(correctness.lintClean) +
      booleanToScore(correctness.buildSuccess)) /
    3;

  const llmConfidence = config.llmAssessment.enabled ? 0.8 : 0.3;
  const confidence = clamp01(automatedConfidence * 0.6 + llmConfidence * 0.4);

  return {
    solutionId: solution.solutionId,
    iterationId: solution.iterationId,
    correctness,
    quality,
    efficiency,
    completeness,
    safety,
    overallScore,
    confidence,
    evaluatedAt: deps.now?.() ?? new Date(),
  };
}

/**
 * Identify strengths of a solution
 */
export function identifyStrengths(evaluation: SolutionEvaluation): string[] {
  const strengths: string[] = [];

  if (evaluation.correctness.testsPass >= 0.95) {
    strengths.push("All tests pass");
  }
  if (evaluation.correctness.typeCheck && evaluation.correctness.lintClean) {
    strengths.push("Clean type check and lint");
  }
  if (evaluation.quality.complexity.score >= 0.8) {
    strengths.push("Low code complexity");
  }
  if (evaluation.quality.duplication.score >= 0.95) {
    strengths.push("No code duplication");
  }
  if (evaluation.quality.patternAdherence >= 0.8) {
    strengths.push("Follows codebase patterns");
  }
  if (evaluation.completeness.documentationAdded) {
    strengths.push("Well documented");
  }
  if (evaluation.completeness.testsAdded >= 0.5) {
    strengths.push("Includes new tests");
  }
  if (evaluation.safety.overall >= 0.9) {
    strengths.push("High safety score");
  }

  return strengths;
}

/**
 * Identify weaknesses of a solution
 */
export function identifyWeaknesses(evaluation: SolutionEvaluation): string[] {
  const weaknesses: string[] = [];

  if (evaluation.correctness.testsPass < 1.0) {
    weaknesses.push(`${Math.round((1 - evaluation.correctness.testsPass) * 100)}% tests failing`);
  }
  if (!evaluation.correctness.typeCheck) {
    weaknesses.push("Type check errors");
  }
  if (!evaluation.correctness.lintClean) {
    weaknesses.push("Lint errors present");
  }
  if (evaluation.quality.complexity.max > 15) {
    weaknesses.push("High function complexity");
  }
  if (evaluation.quality.duplication.percentage > 0.1) {
    weaknesses.push("Code duplication detected");
  }
  if (!evaluation.completeness.documentationAdded) {
    weaknesses.push("Missing documentation");
  }
  if (!evaluation.safety.noDangerousOps) {
    weaknesses.push("Contains potentially dangerous operations");
  }
  if (!evaluation.safety.noSecretsExposed) {
    weaknesses.push("Possible secrets in code");
  }

  return weaknesses;
}

/**
 * Generate pairwise comparisons between solutions
 */
export function generatePairwiseComparisons(evaluations: SolutionEvaluation[]): ComparisonDetail[] {
  const comparisons: ComparisonDetail[] = [];
  const categories = ["correctness", "quality", "efficiency", "completeness", "safety"] as const;

  for (let i = 0; i < evaluations.length; i++) {
    for (let j = i + 1; j < evaluations.length; j++) {
      const a = evaluations[i];
      const b = evaluations[j];

      for (const category of categories) {
        const scoreA = a[category].overall;
        const scoreB = b[category].overall;
        const diff = scoreA - scoreB;

        let winner: string | "tie";
        let reasoning: string;

        if (Math.abs(diff) < 0.05) {
          winner = "tie";
          reasoning = `Both solutions have similar ${category} scores`;
        } else if (diff > 0) {
          winner = a.solutionId;
          reasoning = `${a.solutionId} has better ${category} (${scoreA.toFixed(2)} vs ${scoreB.toFixed(2)})`;
        } else {
          winner = b.solutionId;
          reasoning = `${b.solutionId} has better ${category} (${scoreB.toFixed(2)} vs ${scoreA.toFixed(2)})`;
        }

        comparisons.push({
          solutionA: a.solutionId,
          solutionB: b.solutionId,
          winner,
          category,
          scoreDiff: Math.abs(diff),
          reasoning,
        });
      }
    }
  }

  return comparisons;
}

/**
 * Calculate category consistency between two solutions
 */
export function calculateCategoryConsistency(
  first: RankedSolution,
  second: RankedSolution,
): number {
  const categories = ["correctness", "quality", "efficiency", "completeness", "safety"] as const;
  let firstWins = 0;

  for (const cat of categories) {
    if (first.evaluation[cat].overall > second.evaluation[cat].overall) {
      firstWins++;
    }
  }

  return firstWins / categories.length;
}

/**
 * Calculate confidence in the ranking
 */
export function calculateRankingConfidence(solutions: RankedSolution[]): number {
  if (solutions.length === 0) return 0;
  if (solutions.length === 1) return 1;

  // Factor 1: Score gap between #1 and #2
  const scoreGap = solutions[0].score - solutions[1].score;
  const gapConfidence = Math.min(1, scoreGap / 0.1); // 0.1 gap = 100% confidence

  // Factor 2: Average evaluation confidence
  const avgEvalConfidence =
    solutions.reduce((sum, s) => sum + s.evaluation.confidence, 0) / solutions.length;

  // Factor 3: Consistency across categories
  const consistencyScore = calculateCategoryConsistency(solutions[0], solutions[1]);

  // Weighted combination
  return clamp01(gapConfidence * 0.4 + avgEvalConfidence * 0.3 + consistencyScore * 0.3);
}

/**
 * Rank multiple solutions
 */
export function rankSolutions(evaluations: SolutionEvaluation[]): SolutionRanking {
  if (evaluations.length === 0) {
    return {
      solutions: [],
      winner: null,
      confidence: 0,
      comparisonDetails: [],
    };
  }

  // Sort by overall score descending
  const sorted = [...evaluations].sort((a, b) => b.overallScore - a.overallScore);

  // Build rankings with analysis
  const solutions: RankedSolution[] = sorted.map((evaluation, index) => ({
    solutionId: evaluation.solutionId,
    rank: index + 1,
    score: evaluation.overallScore,
    evaluation,
    strengths: identifyStrengths(evaluation),
    weaknesses: identifyWeaknesses(evaluation),
  }));

  // Generate pairwise comparisons
  const comparisonDetails = generatePairwiseComparisons(evaluations);

  // Calculate confidence in the ranking
  const confidence = calculateRankingConfidence(solutions);

  return {
    solutions,
    winner: confidence >= 0.6 ? solutions[0] : null,
    confidence,
    comparisonDetails,
  };
}

/**
 * Check if a solution should be auto-accepted
 */
export function shouldAutoAccept(
  ranking: SolutionRanking,
  config: AutoAcceptanceConfig = DEFAULT_AUTO_ACCEPTANCE_CONFIG,
): AutoAcceptanceResult {
  if (!config.enabled) {
    return { accept: false, reason: "Auto-acceptance disabled" };
  }

  if (!ranking.winner) {
    return { accept: false, reason: "No clear winner" };
  }

  const winner = ranking.winner;
  const evaluation = winner.evaluation;

  // Check overall score
  if (winner.score < config.minScore) {
    return {
      accept: false,
      reason: `Score ${winner.score.toFixed(2)} below threshold ${config.minScore}`,
    };
  }

  // Check evaluation confidence
  if (evaluation.confidence < config.minConfidence) {
    return {
      accept: false,
      reason: `Confidence ${evaluation.confidence.toFixed(2)} below threshold ${config.minConfidence}`,
    };
  }

  // Check category minimums
  const categoryScores: Record<string, number> = {
    correctness: evaluation.correctness.overall,
    quality: evaluation.quality.overall,
    efficiency: evaluation.efficiency.overall,
    completeness: evaluation.completeness.overall,
    safety: evaluation.safety.overall,
  };

  for (const [category, minimum] of Object.entries(config.categoryMinimums)) {
    const score = categoryScores[category];
    if (score < minimum) {
      return {
        accept: false,
        reason: `${category} score ${score.toFixed(2)} below minimum ${minimum}`,
      };
    }
  }

  // Check score gap (if multiple solutions)
  if (ranking.solutions.length > 1) {
    const gap = winner.score - ranking.solutions[1].score;
    if (gap < config.minScoreGap) {
      return {
        accept: false,
        reason: `Score gap ${gap.toFixed(2)} below minimum ${config.minScoreGap}`,
      };
    }
  }

  return { accept: true, reason: "All criteria met" };
}

/**
 * Compare multiple solutions and return ranking
 */
export async function compareSolutions(
  solutions: SolutionInput[],
  config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG,
  deps: ComparatorDeps = createDefaultDeps(),
): Promise<SolutionRanking> {
  // Evaluate all solutions in parallel
  const evaluations = await Promise.all(
    solutions.map((solution) => evaluateSolution(solution, config, deps)),
  );

  return rankSolutions(evaluations);
}

/**
 * Format ranking as markdown for user presentation
 */
export function formatRankingAsMarkdown(ranking: SolutionRanking): string {
  if (ranking.solutions.length === 0) {
    return "## Solution Comparison Results\n\nNo solutions to compare.";
  }

  const lines: string[] = ["## Solution Comparison Results", ""];

  if (ranking.winner) {
    lines.push(
      `### Winner: ${ranking.winner.solutionId} (Score: ${ranking.winner.score.toFixed(2)}, Confidence: ${Math.round(ranking.confidence * 100)}%)`,
    );
  } else {
    lines.push("### No clear winner - manual review recommended");
  }

  lines.push("");
  lines.push("| Category | " + ranking.solutions.map((s) => s.solutionId).join(" | ") + " |");
  lines.push("|----------|" + ranking.solutions.map(() => "------").join("|") + "|");

  const categories = [
    ["Correctness", "correctness"],
    ["Quality", "quality"],
    ["Efficiency", "efficiency"],
    ["Completeness", "completeness"],
    ["Safety", "safety"],
    ["**Overall**", "overall"],
  ] as const;

  for (const [label, key] of categories) {
    const scores =
      key === "overall"
        ? ranking.solutions.map((s) => s.score.toFixed(2))
        : ranking.solutions.map((s) =>
            (s.evaluation[key as keyof SolutionEvaluation] as { overall: number }).overall.toFixed(
              2,
            ),
          );

    // Bold the best score
    const maxScore = Math.max(...scores.map(parseFloat));
    const formattedScores = scores.map((score) =>
      parseFloat(score) === maxScore ? `**${score}**` : score,
    );

    lines.push(`| ${label} | ${formattedScores.join(" | ")} |`);
  }

  if (ranking.winner) {
    lines.push("");
    lines.push(`### Why ${ranking.winner.solutionId}?`);
    lines.push("");

    if (ranking.winner.strengths.length > 0) {
      lines.push("**Strengths:**");
      for (const strength of ranking.winner.strengths) {
        lines.push(`- ${strength}`);
      }
    }

    if (ranking.winner.weaknesses.length > 0) {
      lines.push("");
      lines.push("**Trade-offs:**");
      for (const weakness of ranking.winner.weaknesses) {
        lines.push(`- ${weakness}`);
      }
    }
  }

  return lines.join("\n");
}
