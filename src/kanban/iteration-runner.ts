/**
 * Iteration Runner for Kanban Agent Multi-Iteration Workflow
 *
 * Enables parallel task execution through spawned sub-agents,
 * supports variation strategies, and aggregates results for
 * intelligent solution selection.
 */

import crypto from "node:crypto";
import type { ThinkLevel } from "../auto-reply/thinking.js";
import { callGateway } from "../gateway/call.js";
import type { KanbanTask } from "../dashboard/kanban-store.js";

// ============================================================================
// Types
// ============================================================================

export type IterationPlanStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export type IterationStrategy =
  | "parallel" // Run all variations simultaneously
  | "sequential" // Run one at a time, stop on success
  | "tournament" // Run in rounds, best advances
  | "adaptive"; // Adjust strategy based on early results

export type VariationStatus =
  | "pending"
  | "spawned"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "skipped";

export interface ResultMetrics {
  /** Self-reported confidence (0-1) */
  confidence?: number;
  /** Did it address all requirements? */
  completeness?: number;
  /** For code tasks: linting, tests pass */
  codeQuality?: number;
  /** How well it follows instructions */
  responsiveness?: number;
  /** Aggregate score (0-1) */
  overallScore: number;
}

export interface IterationResult {
  variationId: string;
  runId: string;
  sessionKey: string;

  // Timing
  startedAt: number;
  endedAt: number;
  durationMs: number;

  // Output
  output: string;
  outputType: "code" | "text" | "structured" | "mixed";

  // Quality metrics
  metrics: ResultMetrics;

  // Resource usage
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };

  // Status
  success: boolean;
  error?: string;
}

export interface PromptVariant {
  id: string;
  label: string;
  additionalContext: string;
  constraints?: string[];
}

export interface IterationVariation {
  id: string;
  label: string;

  // Variation parameters
  model?: string;
  thinking?: ThinkLevel;
  promptVariant?: string;
  approach?: string;
  temperature?: number;

  // System prompt additions
  additionalContext?: string;
  constraints?: string[];

  // Tracking
  priority: number;
  runId?: string;
  status: VariationStatus;
  result?: IterationResult;
}

export interface CompletionCriteria {
  /** Stop when any variation reaches this score */
  minAcceptableScore?: number;
  /** Stop when N variations complete successfully */
  minSuccessfulVariations?: number;
  /** Always wait for all to complete (for comparison) */
  waitForAll?: boolean;
  /** Stop on first success */
  stopOnFirstSuccess?: boolean;
}

export interface IterationPlan {
  id: string;
  taskId: string;
  taskTitle: string;
  taskDescription?: string;

  // Iteration configuration
  strategy: IterationStrategy;
  variations: IterationVariation[];

  // Limits
  maxIterations: number;
  maxParallel: number;
  timeoutSeconds: number;
  maxCostUsd?: number;

  // Completion criteria
  completionCriteria: CompletionCriteria;

  // Metadata
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  status: IterationPlanStatus;
}

export interface IterationLimits {
  maxConcurrentIterations: number;
  maxTotalIterations: number;
  perIterationTimeoutSeconds: number;
  totalTimeoutSeconds: number;
  perIterationMaxCostUsd?: number;
  totalMaxCostUsd?: number;
  perIterationMaxTokens?: number;
  totalMaxTokens?: number;
}

export const DEFAULT_ITERATION_LIMITS: IterationLimits = {
  maxConcurrentIterations: 3,
  maxTotalIterations: 6,
  perIterationTimeoutSeconds: 300,
  totalTimeoutSeconds: 900,
  perIterationMaxCostUsd: 0.5,
  totalMaxCostUsd: 2.0,
  perIterationMaxTokens: 100_000,
  totalMaxTokens: 500_000,
};

export interface ScoringConfig {
  weights: {
    confidence: number;
    completeness: number;
    codeQuality: number;
    responsiveness: number;
    speed: number;
    cost: number;
  };
  penalties: {
    timeout: number;
    error: number;
    incomplete: number;
  };
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: {
    confidence: 0.2,
    completeness: 0.3,
    codeQuality: 0.2,
    responsiveness: 0.2,
    speed: 0.05,
    cost: 0.05,
  },
  penalties: {
    timeout: 0.5,
    error: 1.0,
    incomplete: 0.3,
  },
};

export type AggregationStrategy =
  | "best" // Select the highest-scoring result
  | "consensus" // Merge results where they agree
  | "ensemble" // Combine all valid outputs
  | "voting"; // Use majority decision for discrete choices

export interface AggregationResult {
  strategy: AggregationStrategy;
  selectedResults: IterationResult[];
  mergedOutput?: string;
  confidence: number;
  reasoning: string;
}

// ============================================================================
// Variation Strategy Factories
// ============================================================================

/**
 * Create variations that try the same task with different models.
 */
export function createModelVariations(
  task: Pick<KanbanTask, "id" | "title">,
  models: string[],
): IterationVariation[] {
  return models.map((model, index) => ({
    id: `model-${index}`,
    label: model.split("/").pop() || model,
    model,
    priority: index,
    status: "pending" as VariationStatus,
  }));
}

/**
 * Create variations with different thinking levels.
 */
export function createThinkingVariations(
  task: Pick<KanbanTask, "id" | "title">,
  levels: ThinkLevel[],
): IterationVariation[] {
  return levels.map((thinking, index) => ({
    id: `thinking-${thinking}`,
    label: `thinking:${thinking}`,
    thinking,
    priority: index,
    status: "pending" as VariationStatus,
  }));
}

/**
 * Create variations with different prompt framings.
 */
export function createPromptVariations(
  task: Pick<KanbanTask, "id" | "title">,
  variants: PromptVariant[],
): IterationVariation[] {
  return variants.map((variant, index) => ({
    id: `prompt-${variant.id}`,
    label: variant.label,
    promptVariant: variant.id,
    additionalContext: variant.additionalContext,
    constraints: variant.constraints,
    priority: index,
    status: "pending" as VariationStatus,
  }));
}

export interface HybridVariationConfig {
  models?: string[];
  thinkingLevels?: ThinkLevel[];
  promptVariants?: PromptVariant[];
  maxCombinations?: number;
}

/**
 * Create hybrid variations combining multiple dimensions.
 */
export function createHybridVariations(
  task: Pick<KanbanTask, "id" | "title">,
  config: HybridVariationConfig,
): IterationVariation[] {
  const variations: IterationVariation[] = [];
  let priority = 0;

  const models = config.models || [undefined];
  const levels = config.thinkingLevels || [undefined];
  const prompts = config.promptVariants || [
    { id: "default", label: "default", additionalContext: "" },
  ];

  for (const model of models) {
    for (const thinking of levels) {
      for (const prompt of prompts) {
        if (config.maxCombinations && variations.length >= config.maxCombinations) {
          break;
        }

        const parts = [
          model?.split("/").pop(),
          thinking && `think:${thinking}`,
          prompt.id !== "default" && prompt.label,
        ].filter(Boolean);

        variations.push({
          id: `hybrid-${priority}`,
          label: parts.join(" + ") || "default",
          model,
          thinking,
          additionalContext: prompt.additionalContext,
          constraints: prompt.constraints,
          priority: priority++,
          status: "pending",
        });
      }
    }
  }

  return variations;
}

// ============================================================================
// Result Scoring
// ============================================================================

/**
 * Score a result based on configured weights and penalties.
 */
export function scoreResult(
  result: IterationResult,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  if (!result.success) {
    if (result.error?.includes("timeout")) {
      return 1 - config.penalties.timeout;
    }
    return 1 - config.penalties.error;
  }

  const { weights } = config;
  let score = 0;
  let totalWeight = 0;

  if (result.metrics.confidence !== undefined) {
    score += result.metrics.confidence * weights.confidence;
    totalWeight += weights.confidence;
  }
  if (result.metrics.completeness !== undefined) {
    score += result.metrics.completeness * weights.completeness;
    totalWeight += weights.completeness;
  }
  if (result.metrics.codeQuality !== undefined) {
    score += result.metrics.codeQuality * weights.codeQuality;
    totalWeight += weights.codeQuality;
  }
  if (result.metrics.responsiveness !== undefined) {
    score += result.metrics.responsiveness * weights.responsiveness;
    totalWeight += weights.responsiveness;
  }

  // Speed bonus (faster is better, normalized to 0-1)
  const maxExpectedDuration = 300_000; // 5 minutes
  const speedScore = Math.max(0, 1 - result.durationMs / maxExpectedDuration);
  score += speedScore * weights.speed;
  totalWeight += weights.speed;

  // Cost efficiency (lower is better, normalized to 0-1)
  const maxExpectedCost = 0.5;
  const costScore = Math.max(0, 1 - (result.usage.estimatedCostUsd || 0) / maxExpectedCost);
  score += costScore * weights.cost;
  totalWeight += weights.cost;

  // Normalize by actual weight used
  if (totalWeight > 0) {
    score = score / totalWeight;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Parse confidence score from agent output.
 * Looks for patterns like "Confidence: 85%", "confidence score: 0.85", etc.
 */
export function parseConfidenceFromOutput(output: string): number | undefined {
  // Match patterns like "Confidence: 85%", "confidence: 0.85", "confidence score: 85"
  const patterns = [
    /confidence[:\s]+(\d+(?:\.\d+)?)\s*%/i,
    /confidence[:\s]+(\d+(?:\.\d+)?)/i,
    /confidence\s+score[:\s]+(\d+(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      if (!isNaN(value)) {
        // Normalize to 0-1 range
        return value > 1 ? value / 100 : value;
      }
    }
  }
  return undefined;
}

// ============================================================================
// Result Collection
// ============================================================================

export class IterationResultCollector {
  private plan: IterationPlan;
  private results = new Map<string, IterationResult>();
  private listeners = new Set<(result: IterationResult) => void>();

  constructor(plan: IterationPlan) {
    this.plan = plan;
  }

  /**
   * Register a completed iteration result.
   */
  addResult(result: IterationResult): void {
    this.results.set(result.variationId, result);

    // Update variation status
    const variation = this.plan.variations.find((v) => v.id === result.variationId);
    if (variation) {
      variation.status = result.success ? "completed" : "failed";
      variation.result = result;
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(result);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get all results collected so far.
   */
  getResults(): IterationResult[] {
    return Array.from(this.results.values());
  }

  /**
   * Get the best result based on overall score.
   */
  getBestResult(): IterationResult | undefined {
    const results = this.getResults().filter((r) => r.success);
    if (results.length === 0) return undefined;
    return results.reduce((best, current) =>
      current.metrics.overallScore > best.metrics.overallScore ? current : best,
    );
  }

  /**
   * Check if completion criteria are met.
   */
  isComplete(): boolean {
    const criteria = this.plan.completionCriteria;
    const results = this.getResults();
    const successful = results.filter((r) => r.success);

    // Check min score threshold
    if (criteria.minAcceptableScore !== undefined) {
      if (successful.some((r) => r.metrics.overallScore >= criteria.minAcceptableScore!)) {
        return true;
      }
    }

    // Check min successful count
    if (criteria.minSuccessfulVariations !== undefined) {
      if (successful.length >= criteria.minSuccessfulVariations) {
        return true;
      }
    }

    // Check stop on first success
    if (criteria.stopOnFirstSuccess && successful.length > 0) {
      return true;
    }

    // Check if all variations are done
    if (criteria.waitForAll) {
      return results.length >= this.plan.variations.length;
    }

    // Default: complete when all variations are done
    return results.length >= this.plan.variations.length;
  }

  /**
   * Subscribe to result events.
   */
  onResult(listener: (result: IterationResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get summary statistics.
   */
  getSummary(): {
    total: number;
    completed: number;
    successful: number;
    failed: number;
    pending: number;
  } {
    const results = this.getResults();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const pending = this.plan.variations.filter(
      (v) => v.status === "pending" || v.status === "spawned" || v.status === "running",
    );

    return {
      total: this.plan.variations.length,
      completed: results.length,
      successful: successful.length,
      failed: failed.length,
      pending: pending.length,
    };
  }
}

// ============================================================================
// Limit Enforcement
// ============================================================================

export class IterationLimitEnforcer {
  private limits: IterationLimits;
  private startTime: number;
  private totalCost = 0;
  private totalTokens = 0;
  private activeCount = 0;
  private completedCount = 0;

  constructor(limits: IterationLimits = DEFAULT_ITERATION_LIMITS) {
    this.limits = limits;
    this.startTime = Date.now();
  }

  /**
   * Check if we can spawn another iteration.
   */
  canSpawn(): { allowed: boolean; reason?: string } {
    // Check concurrent limit
    if (this.activeCount >= this.limits.maxConcurrentIterations) {
      return { allowed: false, reason: "Max concurrent iterations reached" };
    }

    // Check total limit
    if (this.completedCount + this.activeCount >= this.limits.maxTotalIterations) {
      return { allowed: false, reason: "Max total iterations reached" };
    }

    // Check total timeout
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    if (elapsedSeconds >= this.limits.totalTimeoutSeconds) {
      return { allowed: false, reason: "Total timeout exceeded" };
    }

    // Check total cost
    if (this.limits.totalMaxCostUsd && this.totalCost >= this.limits.totalMaxCostUsd) {
      return { allowed: false, reason: "Total cost limit exceeded" };
    }

    // Check total tokens
    if (this.limits.totalMaxTokens && this.totalTokens >= this.limits.totalMaxTokens) {
      return { allowed: false, reason: "Total token limit exceeded" };
    }

    return { allowed: true };
  }

  /**
   * Record that an iteration was spawned.
   */
  recordSpawn(): void {
    this.activeCount++;
  }

  /**
   * Record that an iteration completed.
   */
  recordCompletion(result: IterationResult): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.completedCount++;
    this.totalCost += result.usage.estimatedCostUsd || 0;
    this.totalTokens += result.usage.totalTokens || 0;
  }

  /**
   * Get remaining time before total timeout.
   */
  getRemainingTimeMs(): number {
    const elapsedMs = Date.now() - this.startTime;
    return Math.max(0, this.limits.totalTimeoutSeconds * 1000 - elapsedMs);
  }

  /**
   * Get per-iteration timeout (capped by remaining time).
   */
  getIterationTimeoutMs(): number {
    const configuredMs = this.limits.perIterationTimeoutSeconds * 1000;
    return Math.min(configuredMs, this.getRemainingTimeMs());
  }

  /**
   * Get current resource usage.
   */
  getUsage(): {
    activeCount: number;
    completedCount: number;
    totalCost: number;
    totalTokens: number;
    elapsedMs: number;
    remainingMs: number;
  } {
    return {
      activeCount: this.activeCount,
      completedCount: this.completedCount,
      totalCost: this.totalCost,
      totalTokens: this.totalTokens,
      elapsedMs: Date.now() - this.startTime,
      remainingMs: this.getRemainingTimeMs(),
    };
  }

  /**
   * Reset the enforcer for testing.
   */
  reset(): void {
    this.startTime = Date.now();
    this.totalCost = 0;
    this.totalTokens = 0;
    this.activeCount = 0;
    this.completedCount = 0;
  }
}

// ============================================================================
// Result Aggregation
// ============================================================================

function aggregateBest(results: IterationResult[]): AggregationResult {
  const sorted = [...results].sort((a, b) => b.metrics.overallScore - a.metrics.overallScore);
  const best = sorted[0];

  return {
    strategy: "best",
    selectedResults: [best],
    mergedOutput: best.output,
    confidence: best.metrics.overallScore,
    reasoning: `Selected highest-scoring result (${best.metrics.overallScore.toFixed(2)})`,
  };
}

function findMostCommonOutput(outputs: string[]): string {
  const counts = new Map<string, number>();
  for (const output of outputs) {
    counts.set(output, (counts.get(output) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommon = outputs[0];
  for (const [output, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommon = output;
    }
  }

  return mostCommon;
}

function aggregateConsensus(results: IterationResult[]): AggregationResult {
  const outputs = results.map((r) => r.output);
  const commonOutput = findMostCommonOutput(outputs);
  const avgScore = results.reduce((sum, r) => sum + r.metrics.overallScore, 0) / results.length;

  return {
    strategy: "consensus",
    selectedResults: results,
    mergedOutput: commonOutput,
    confidence: results.length > 1 ? avgScore * 0.9 : avgScore * 0.7,
    reasoning: `Merged consensus from ${results.length} results`,
  };
}

function aggregateVoting(results: IterationResult[]): AggregationResult {
  // Simple voting: pick the output that appears most frequently
  const outputs = results.map((r) => r.output);
  const winner = findMostCommonOutput(outputs);
  const winnerResults = results.filter((r) => r.output === winner);
  const voteRatio = winnerResults.length / results.length;

  return {
    strategy: "voting",
    selectedResults: winnerResults,
    mergedOutput: winner,
    confidence: voteRatio,
    reasoning: `Selected by voting (${winnerResults.length}/${results.length} votes)`,
  };
}

/**
 * Aggregate results from multiple iterations.
 */
export function aggregateResults(
  results: IterationResult[],
  strategy: AggregationStrategy,
): AggregationResult {
  const successful = results.filter((r) => r.success);

  if (successful.length === 0) {
    return {
      strategy,
      selectedResults: [],
      confidence: 0,
      reasoning: "No successful results to aggregate",
    };
  }

  switch (strategy) {
    case "best":
      return aggregateBest(successful);
    case "consensus":
      return aggregateConsensus(successful);
    case "voting":
      return aggregateVoting(successful);
    case "ensemble":
      // Ensemble just returns all successful results
      return {
        strategy: "ensemble",
        selectedResults: successful,
        mergedOutput: successful.map((r) => r.output).join("\n\n---\n\n"),
        confidence:
          successful.reduce((sum, r) => sum + r.metrics.overallScore, 0) / successful.length,
        reasoning: `Ensemble of ${successful.length} results`,
      };
    default:
      return aggregateBest(successful);
  }
}

// ============================================================================
// Iteration Runner
// ============================================================================

export interface IterationRunnerOptions {
  limits?: IterationLimits;
  scoringConfig?: ScoringConfig;
  /** Hook called when a result is received */
  onResult?: (result: IterationResult) => void;
  /** Hook called when spawning a variation */
  onSpawn?: (variation: IterationVariation) => void;
  /** Polling interval for checking completion (ms) */
  pollIntervalMs?: number;
}

export interface SpawnResponse {
  status: string;
  runId?: string;
  childSessionKey?: string;
  error?: string;
}

export class IterationRunner {
  private plan: IterationPlan;
  private collector: IterationResultCollector;
  private enforcer: IterationLimitEnforcer;
  private scoringConfig: ScoringConfig;
  private activeRuns = new Map<string, { runId: string; startedAt: number }>();
  private onResultHook?: (result: IterationResult) => void;
  private onSpawnHook?: (variation: IterationVariation) => void;
  private pollIntervalMs: number;
  private stopped = false;

  constructor(plan: IterationPlan, options: IterationRunnerOptions = {}) {
    this.plan = plan;
    this.collector = new IterationResultCollector(plan);
    this.enforcer = new IterationLimitEnforcer(options.limits);
    this.scoringConfig = options.scoringConfig || DEFAULT_SCORING_CONFIG;
    this.onResultHook = options.onResult;
    this.onSpawnHook = options.onSpawn;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;

    // Wire up result listener
    this.collector.onResult((result) => this.handleIterationComplete(result));
  }

  /**
   * Execute the iteration plan.
   */
  async execute(): Promise<AggregationResult> {
    this.plan.status = "running";
    this.plan.startedAt = Date.now();
    this.stopped = false;

    try {
      // Spawn initial batch based on strategy
      await this.spawnInitialBatch();

      // Wait for completion
      await this.waitForCompletion();

      // Aggregate results
      const results = this.collector.getResults();
      const aggregated = aggregateResults(results, "best");

      this.plan.status = "completed";
      this.plan.completedAt = Date.now();

      return aggregated;
    } catch (error) {
      this.plan.status = "failed";
      this.plan.completedAt = Date.now();
      throw error;
    }
  }

  /**
   * Stop the runner and cancel pending iterations.
   */
  stop(): void {
    this.stopped = true;
    this.plan.status = "cancelled";
    this.plan.completedAt = Date.now();
  }

  /**
   * Get current status.
   */
  getStatus(): {
    plan: IterationPlan;
    summary: ReturnType<IterationResultCollector["getSummary"]>;
    usage: ReturnType<IterationLimitEnforcer["getUsage"]>;
  } {
    return {
      plan: this.plan,
      summary: this.collector.getSummary(),
      usage: this.enforcer.getUsage(),
    };
  }

  /**
   * Get all results.
   */
  getResults(): IterationResult[] {
    return this.collector.getResults();
  }

  /**
   * Get the best result so far.
   */
  getBestResult(): IterationResult | undefined {
    return this.collector.getBestResult();
  }

  /**
   * Spawn the initial batch of iterations.
   */
  private async spawnInitialBatch(): Promise<void> {
    const pending = this.plan.variations
      .filter((v) => v.status === "pending")
      .sort((a, b) => a.priority - b.priority);

    for (const variation of pending) {
      if (this.stopped) break;

      const canSpawn = this.enforcer.canSpawn();
      if (!canSpawn.allowed) break;

      await this.spawnVariation(variation);
    }
  }

  /**
   * Spawn a single variation as a sub-agent.
   */
  async spawnVariation(variation: IterationVariation): Promise<boolean> {
    const timeoutSeconds = Math.floor(this.enforcer.getIterationTimeoutMs() / 1000);
    if (timeoutSeconds <= 0) {
      variation.status = "skipped";
      return false;
    }

    // Build the task prompt with variation context
    const prompt = this.buildVariationPrompt(variation);

    try {
      const result = (await callGateway({
        method: "tool.invoke",
        params: {
          tool: "sessions_spawn",
          args: {
            task: prompt,
            label: `${this.plan.taskTitle} [${variation.label}]`,
            model: variation.model,
            thinking: variation.thinking,
            runTimeoutSeconds: timeoutSeconds,
            cleanup: "keep",
          },
        },
        timeoutMs: 10_000,
      })) as SpawnResponse;

      if (result.status === "accepted" && result.runId) {
        variation.runId = result.runId;
        variation.status = "spawned";
        this.activeRuns.set(variation.id, {
          runId: result.runId,
          startedAt: Date.now(),
        });
        this.enforcer.recordSpawn();
        this.onSpawnHook?.(variation);
        return true;
      } else {
        variation.status = "failed";
        return false;
      }
    } catch {
      variation.status = "failed";
      return false;
    }
  }

  /**
   * Build the prompt for a specific variation.
   */
  private buildVariationPrompt(variation: IterationVariation): string {
    const parts = [`# Task: ${this.plan.taskTitle}`, ""];

    if (this.plan.taskDescription) {
      parts.push(this.plan.taskDescription, "");
    }

    if (variation.additionalContext) {
      parts.push("## Approach");
      parts.push(variation.additionalContext);
      parts.push("");
    }

    if (variation.constraints && variation.constraints.length > 0) {
      parts.push("## Constraints");
      for (const constraint of variation.constraints) {
        parts.push(`- ${constraint}`);
      }
      parts.push("");
    }

    parts.push("## Output Requirements");
    parts.push("- Provide your solution clearly");
    parts.push("- Include a confidence score (0-100) at the end");
    parts.push("- Note any limitations or assumptions");

    return parts.join("\n");
  }

  /**
   * Handle iteration completion.
   */
  private handleIterationComplete(result: IterationResult): void {
    this.enforcer.recordCompletion(result);
    this.onResultHook?.(result);

    // Check if we should spawn more
    if (!this.stopped && !this.collector.isComplete()) {
      void this.spawnNextVariation();
    }
  }

  /**
   * Spawn the next pending variation if limits allow.
   */
  private async spawnNextVariation(): Promise<void> {
    const canSpawn = this.enforcer.canSpawn();
    if (!canSpawn.allowed) return;

    const pending = this.plan.variations
      .filter((v) => v.status === "pending")
      .sort((a, b) => a.priority - b.priority);

    if (pending.length > 0) {
      await this.spawnVariation(pending[0]);
    }
  }

  /**
   * Wait for completion criteria or timeout.
   */
  private async waitForCompletion(): Promise<void> {
    while (!this.stopped && !this.collector.isComplete()) {
      // Check for timeout
      if (this.enforcer.getRemainingTimeMs() <= 0) {
        this.plan.status = "timeout";
        await this.markTimeoutVariations();
        break;
      }

      // Poll for results (in a real implementation, this would use events)
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));

      // Check for spawned variations that might have completed
      await this.pollActiveRuns();
    }
  }

  /**
   * Poll active runs for completion.
   * In a production implementation, this would use gateway events.
   */
  private async pollActiveRuns(): Promise<void> {
    for (const [variationId, run] of this.activeRuns) {
      const variation = this.plan.variations.find((v) => v.id === variationId);
      if (!variation || variation.status !== "spawned") continue;

      try {
        const status = (await callGateway({
          method: "agent.status",
          params: { runId: run.runId },
          timeoutMs: 5_000,
        })) as { status?: string; output?: string; error?: string };

        if (status.status === "completed" || status.status === "ok") {
          const endedAt = Date.now();
          const confidence = parseConfidenceFromOutput(status.output || "");

          const result: IterationResult = {
            variationId,
            runId: run.runId,
            sessionKey: `run:${run.runId}`,
            startedAt: run.startedAt,
            endedAt,
            durationMs: endedAt - run.startedAt,
            output: status.output || "",
            outputType: "text",
            metrics: {
              confidence,
              overallScore: 0,
            },
            usage: {},
            success: true,
          };

          // Calculate overall score
          result.metrics.overallScore = scoreResult(result, this.scoringConfig);

          this.activeRuns.delete(variationId);
          this.collector.addResult(result);
        } else if (status.status === "error" || status.status === "failed") {
          const endedAt = Date.now();
          const result: IterationResult = {
            variationId,
            runId: run.runId,
            sessionKey: `run:${run.runId}`,
            startedAt: run.startedAt,
            endedAt,
            durationMs: endedAt - run.startedAt,
            output: "",
            outputType: "text",
            metrics: { overallScore: 0 },
            usage: {},
            success: false,
            error: status.error || "Unknown error",
          };

          this.activeRuns.delete(variationId);
          this.collector.addResult(result);
        }
      } catch {
        // Ignore polling errors, will retry next interval
      }
    }
  }

  /**
   * Mark remaining active variations as timed out.
   */
  private async markTimeoutVariations(): Promise<void> {
    const now = Date.now();
    for (const [variationId, run] of this.activeRuns) {
      const variation = this.plan.variations.find((v) => v.id === variationId);
      if (variation) {
        variation.status = "timeout";

        const result: IterationResult = {
          variationId,
          runId: run.runId,
          sessionKey: `run:${run.runId}`,
          startedAt: run.startedAt,
          endedAt: now,
          durationMs: now - run.startedAt,
          output: "",
          outputType: "text",
          metrics: { overallScore: 0 },
          usage: {},
          success: false,
          error: "timeout",
        };

        this.collector.addResult(result);
      }
    }
    this.activeRuns.clear();
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create an iteration plan for a kanban task.
 */
export function createIterationPlan(
  task: Pick<KanbanTask, "id" | "title" | "description">,
  options: {
    strategy?: IterationStrategy;
    variations: IterationVariation[];
    limits?: Partial<IterationLimits>;
    completionCriteria?: CompletionCriteria;
  },
): IterationPlan {
  const limits = { ...DEFAULT_ITERATION_LIMITS, ...options.limits };

  return {
    id: crypto.randomUUID(),
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    strategy: options.strategy || "parallel",
    variations: options.variations,
    maxIterations: limits.maxTotalIterations,
    maxParallel: limits.maxConcurrentIterations,
    timeoutSeconds: limits.totalTimeoutSeconds,
    maxCostUsd: limits.totalMaxCostUsd,
    completionCriteria: options.completionCriteria || { waitForAll: true },
    createdAt: Date.now(),
    status: "pending",
  };
}

/**
 * Create and execute an iteration plan.
 */
export async function runIterations(
  task: Pick<KanbanTask, "id" | "title" | "description">,
  options: {
    strategy?: IterationStrategy;
    variations: IterationVariation[];
    limits?: Partial<IterationLimits>;
    completionCriteria?: CompletionCriteria;
    scoringConfig?: ScoringConfig;
    onResult?: (result: IterationResult) => void;
    onSpawn?: (variation: IterationVariation) => void;
  },
): Promise<AggregationResult> {
  const plan = createIterationPlan(task, options);
  const runner = new IterationRunner(plan, {
    limits: { ...DEFAULT_ITERATION_LIMITS, ...options.limits },
    scoringConfig: options.scoringConfig,
    onResult: options.onResult,
    onSpawn: options.onSpawn,
  });

  return runner.execute();
}
