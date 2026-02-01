# Kanban Agent Multi-Iteration Workflow Design

> **PRD Phase 6 Task**: Design multi-iteration workflow (spawn sub-agents, run variations)

## Overview

This document describes the architecture for Gimli's autonomous Kanban agent multi-iteration workflow. The system enables parallel task execution through spawned sub-agents, supports variation strategies for exploring different approaches, and aggregates results for intelligent solution selection.

## Goals

1. **Parallel Execution**: Run multiple solution attempts simultaneously using `sessions_spawn`
2. **Variation Strategies**: Try different approaches (models, prompts, techniques) for each task
3. **Result Aggregation**: Collect, compare, and select the best solution from iterations
4. **Resource Management**: Enforce limits on concurrent runs, timeouts, and costs
5. **Resilient Coordination**: Handle failures gracefully without losing completed work

## Architecture

### Core Components

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                     Kanban Agent (Orchestrator)              │
                    │                                                              │
                    │  ┌────────────────┐    ┌────────────────┐                    │
                    │  │  Task Selector │───▶│ Iteration Planner │                 │
                    │  │  (from board)  │    │ (strategy selection) │              │
                    │  └────────────────┘    └────────────────┘                    │
                    │           │                    │                             │
                    │           ▼                    ▼                             │
                    │  ┌─────────────────────────────────────────────┐             │
                    │  │              Iteration Runner                │             │
                    │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐     │             │
                    │  │  │ Spawn A  │ │ Spawn B  │ │ Spawn C  │     │             │
                    │  │  │ (model X)│ │ (model Y)│ │ (prompt Z)│    │             │
                    │  │  └──────────┘ └──────────┘ └──────────┘     │             │
                    │  └─────────────────────────────────────────────┘             │
                    │           │                                                  │
                    │           ▼                                                  │
                    │  ┌─────────────────────────────────────────────┐             │
                    │  │           Result Aggregator                  │             │
                    │  │  - Collect outputs                          │             │
                    │  │  - Score solutions                          │             │
                    │  │  - Select best / merge results              │             │
                    │  └─────────────────────────────────────────────┘             │
                    │           │                                                  │
                    │           ▼                                                  │
                    │  ┌─────────────────────────────────────────────┐             │
                    │  │           Solution Presenter                 │             │
                    │  │  - Format for user                          │             │
                    │  │  - Apply to task / mark complete            │             │
                    │  └─────────────────────────────────────────────┘             │
                    └─────────────────────────────────────────────────────────────┘
```

### Integration with Existing Systems

The multi-iteration workflow builds on existing Gimli infrastructure:

| Component | Existing Infrastructure | Extension |
|-----------|------------------------|-----------|
| Sub-agent spawning | `sessions_spawn` tool | Batch spawn with variation params |
| Run tracking | `SubagentRegistry` | Iteration grouping and status tracking |
| Timeouts | `resolveAgentTimeoutMs` | Per-iteration and aggregate limits |
| Concurrency | `maxConcurrent` limits | Iteration-aware scheduling |
| Task storage | `kanban-store.ts` | Iteration metadata and results |

## Iteration Runner Architecture

### IterationPlan Type

```typescript
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

export type IterationPlanStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "cancelled";

export type IterationStrategy =
  | "parallel"       // Run all variations simultaneously
  | "sequential"     // Run one at a time, stop on success
  | "tournament"     // Run in rounds, best advances
  | "adaptive";      // Adjust strategy based on early results
```

### IterationVariation Type

```typescript
export interface IterationVariation {
  id: string;
  label: string;

  // Variation parameters
  model?: string;                    // Model override (provider/model)
  thinking?: ThinkingLevel;          // Thinking level override
  promptVariant?: string;            // Prompt modification ID
  approach?: string;                 // High-level approach description
  temperature?: number;              // Temperature override (if supported)

  // System prompt additions
  additionalContext?: string;
  constraints?: string[];

  // Tracking
  priority: number;                  // Lower = higher priority
  runId?: string;                    // Assigned when spawned
  status: VariationStatus;
  result?: IterationResult;
}

export type VariationStatus =
  | "pending"
  | "spawned"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "skipped";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
```

### IterationResult Type

```typescript
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

export interface ResultMetrics {
  // Self-reported confidence (0-1)
  confidence?: number;

  // Computed metrics
  completeness?: number;      // Did it address all requirements?
  codeQuality?: number;       // For code tasks: linting, tests pass
  responsiveness?: number;    // How well it follows instructions

  // Aggregate score
  overallScore: number;
}
```

### Completion Criteria

```typescript
export interface CompletionCriteria {
  // Stop when any variation reaches this score
  minAcceptableScore?: number;

  // Stop when N variations complete successfully
  minSuccessfulVariations?: number;

  // Always wait for all to complete (for comparison)
  waitForAll?: boolean;

  // Stop on first success
  stopOnFirstSuccess?: boolean;

  // Custom criteria (for adaptive strategy)
  custom?: (results: IterationResult[]) => boolean;
}
```

## Variation Strategies

### 1. Model Variation Strategy

Try the same task with different models to leverage their unique strengths:

```typescript
export function createModelVariations(
  task: KanbanTask,
  models: string[]
): IterationVariation[] {
  return models.map((model, index) => ({
    id: `model-${index}`,
    label: model.split("/").pop() || model,
    model,
    priority: index,
    status: "pending",
  }));
}

// Example configuration
const modelVariations = createModelVariations(task, [
  "anthropic/claude-sonnet-4-20250514",      // Fast, good for routine tasks
  "anthropic/claude-opus-4-5-20251101",      // Best reasoning
  "openai/gpt-4o",                           // Alternative perspective
]);
```

### 2. Thinking Level Variation Strategy

Vary the depth of reasoning for complex tasks:

```typescript
export function createThinkingVariations(
  task: KanbanTask,
  levels: ThinkingLevel[]
): IterationVariation[] {
  return levels.map((thinking, index) => ({
    id: `thinking-${thinking}`,
    label: `thinking:${thinking}`,
    thinking,
    priority: index,
    status: "pending",
  }));
}

// Example: try quick first, then deeper if needed
const thinkingVariations = createThinkingVariations(task, [
  "low",     // Quick pass
  "medium",  // Standard reasoning
  "high",    // Deep analysis
]);
```

### 3. Prompt Variation Strategy

Try different framing or approaches:

```typescript
export interface PromptVariant {
  id: string;
  label: string;
  additionalContext: string;
  constraints?: string[];
}

export function createPromptVariations(
  task: KanbanTask,
  variants: PromptVariant[]
): IterationVariation[] {
  return variants.map((variant, index) => ({
    id: `prompt-${variant.id}`,
    label: variant.label,
    additionalContext: variant.additionalContext,
    constraints: variant.constraints,
    priority: index,
    status: "pending",
  }));
}

// Example: different approaches to a coding task
const promptVariants: PromptVariant[] = [
  {
    id: "minimal",
    label: "Minimal implementation",
    additionalContext: "Focus on the simplest solution that works.",
    constraints: ["Minimize dependencies", "Keep code concise"],
  },
  {
    id: "robust",
    label: "Robust implementation",
    additionalContext: "Focus on error handling and edge cases.",
    constraints: ["Handle all edge cases", "Add comprehensive error handling"],
  },
  {
    id: "performant",
    label: "Performance-optimized",
    additionalContext: "Focus on efficiency and performance.",
    constraints: ["Optimize for speed", "Minimize memory usage"],
  },
];
```

### 4. Hybrid Variation Strategy

Combine multiple variation dimensions:

```typescript
export interface HybridVariationConfig {
  models?: string[];
  thinkingLevels?: ThinkingLevel[];
  promptVariants?: PromptVariant[];
  maxCombinations?: number;
}

export function createHybridVariations(
  task: KanbanTask,
  config: HybridVariationConfig
): IterationVariation[] {
  const variations: IterationVariation[] = [];
  let priority = 0;

  // Generate combinations (limited by maxCombinations)
  const models = config.models || [undefined];
  const levels = config.thinkingLevels || [undefined];
  const prompts = config.promptVariants || [{ id: "default", label: "default", additionalContext: "" }];

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
```

## Result Collection and Aggregation

### Result Collector

```typescript
export class IterationResultCollector {
  private plan: IterationPlan;
  private results: Map<string, IterationResult> = new Map();
  private listeners: Set<(result: IterationResult) => void> = new Set();

  constructor(plan: IterationPlan) {
    this.plan = plan;
  }

  /**
   * Register a completed iteration result
   */
  addResult(result: IterationResult): void {
    this.results.set(result.variationId, result);

    // Update variation status
    const variation = this.plan.variations.find(v => v.id === result.variationId);
    if (variation) {
      variation.status = result.success ? "completed" : "failed";
      variation.result = result;
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(result);
    }
  }

  /**
   * Get all results collected so far
   */
  getResults(): IterationResult[] {
    return Array.from(this.results.values());
  }

  /**
   * Get the best result based on overall score
   */
  getBestResult(): IterationResult | undefined {
    const results = this.getResults().filter(r => r.success);
    if (results.length === 0) return undefined;
    return results.reduce((best, current) =>
      current.metrics.overallScore > best.metrics.overallScore ? current : best
    );
  }

  /**
   * Check if completion criteria are met
   */
  isComplete(): boolean {
    const criteria = this.plan.completionCriteria;
    const results = this.getResults();
    const successful = results.filter(r => r.success);

    // Check min score threshold
    if (criteria.minAcceptableScore !== undefined) {
      if (successful.some(r => r.metrics.overallScore >= criteria.minAcceptableScore!)) {
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

    // Check custom criteria
    if (criteria.custom) {
      return criteria.custom(results);
    }

    // Default: complete when all variations are done
    return results.length >= this.plan.variations.length;
  }

  /**
   * Subscribe to result events
   */
  onResult(listener: (result: IterationResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

### Result Scoring

```typescript
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

export function scoreResult(
  result: IterationResult,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): number {
  if (!result.success) {
    // Apply penalties for failures
    if (result.error?.includes("timeout")) {
      return 1 - config.penalties.timeout;
    }
    return 1 - config.penalties.error;
  }

  const { weights } = config;
  let score = 0;

  // Weighted metrics
  if (result.metrics.confidence !== undefined) {
    score += result.metrics.confidence * weights.confidence;
  }
  if (result.metrics.completeness !== undefined) {
    score += result.metrics.completeness * weights.completeness;
  }
  if (result.metrics.codeQuality !== undefined) {
    score += result.metrics.codeQuality * weights.codeQuality;
  }
  if (result.metrics.responsiveness !== undefined) {
    score += result.metrics.responsiveness * weights.responsiveness;
  }

  // Speed bonus (faster is better, normalized to 0-1)
  const maxExpectedDuration = 300_000; // 5 minutes
  const speedScore = Math.max(0, 1 - (result.durationMs / maxExpectedDuration));
  score += speedScore * weights.speed;

  // Cost efficiency (lower is better, normalized to 0-1)
  const maxExpectedCost = 0.50; // $0.50
  const costScore = Math.max(0, 1 - ((result.usage.estimatedCostUsd || 0) / maxExpectedCost));
  score += costScore * weights.cost;

  return Math.max(0, Math.min(1, score));
}
```

### Result Aggregation Strategies

```typescript
export type AggregationStrategy =
  | "best"           // Select the highest-scoring result
  | "consensus"      // Merge results where they agree
  | "ensemble"       // Combine all valid outputs
  | "voting";        // Use majority decision for discrete choices

export interface AggregationResult {
  strategy: AggregationStrategy;
  selectedResults: IterationResult[];
  mergedOutput?: string;
  confidence: number;
  reasoning: string;
}

export async function aggregateResults(
  results: IterationResult[],
  strategy: AggregationStrategy,
  task: KanbanTask
): Promise<AggregationResult> {
  const successful = results.filter(r => r.success);

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
      return aggregateConsensus(successful, task);

    case "ensemble":
      return aggregateEnsemble(successful, task);

    case "voting":
      return aggregateVoting(successful, task);

    default:
      return aggregateBest(successful);
  }
}

function aggregateBest(results: IterationResult[]): AggregationResult {
  const sorted = [...results].sort((a, b) =>
    b.metrics.overallScore - a.metrics.overallScore
  );
  const best = sorted[0];

  return {
    strategy: "best",
    selectedResults: [best],
    mergedOutput: best.output,
    confidence: best.metrics.overallScore,
    reasoning: `Selected highest-scoring result (${best.metrics.overallScore.toFixed(2)})`,
  };
}

async function aggregateConsensus(
  results: IterationResult[],
  task: KanbanTask
): Promise<AggregationResult> {
  // For code tasks: find common patterns
  // For text tasks: find agreed-upon points
  // This would use a comparison sub-agent

  const outputs = results.map(r => r.output);
  const commonElements = findCommonElements(outputs);

  return {
    strategy: "consensus",
    selectedResults: results,
    mergedOutput: commonElements,
    confidence: results.length > 1 ? 0.8 : 0.5,
    reasoning: `Merged consensus from ${results.length} results`,
  };
}

function findCommonElements(outputs: string[]): string {
  // Simplified: just return the most common output
  // Real implementation would do semantic comparison
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
```

## Resource Limits and Timeouts

### Configuration

```typescript
export interface IterationLimits {
  // Concurrency
  maxConcurrentIterations: number;      // Default: 3
  maxTotalIterations: number;           // Default: 6

  // Time
  perIterationTimeoutSeconds: number;   // Default: 300 (5 min)
  totalTimeoutSeconds: number;          // Default: 900 (15 min)

  // Cost
  perIterationMaxCostUsd?: number;      // Default: $0.50
  totalMaxCostUsd?: number;             // Default: $2.00

  // Tokens
  perIterationMaxTokens?: number;       // Default: 100k
  totalMaxTokens?: number;              // Default: 500k
}

export const DEFAULT_ITERATION_LIMITS: IterationLimits = {
  maxConcurrentIterations: 3,
  maxTotalIterations: 6,
  perIterationTimeoutSeconds: 300,
  totalTimeoutSeconds: 900,
  perIterationMaxCostUsd: 0.50,
  totalMaxCostUsd: 2.00,
  perIterationMaxTokens: 100_000,
  totalMaxTokens: 500_000,
};
```

### Limit Enforcement

```typescript
export class IterationLimitEnforcer {
  private limits: IterationLimits;
  private startTime: number;
  private totalCost: number = 0;
  private totalTokens: number = 0;
  private activeCount: number = 0;
  private completedCount: number = 0;

  constructor(limits: IterationLimits = DEFAULT_ITERATION_LIMITS) {
    this.limits = limits;
    this.startTime = Date.now();
  }

  /**
   * Check if we can spawn another iteration
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
   * Record that an iteration was spawned
   */
  recordSpawn(): void {
    this.activeCount++;
  }

  /**
   * Record that an iteration completed
   */
  recordCompletion(result: IterationResult): void {
    this.activeCount--;
    this.completedCount++;
    this.totalCost += result.usage.estimatedCostUsd || 0;
    this.totalTokens += result.usage.totalTokens || 0;
  }

  /**
   * Get remaining time before total timeout
   */
  getRemainingTimeMs(): number {
    const elapsedMs = Date.now() - this.startTime;
    return Math.max(0, this.limits.totalTimeoutSeconds * 1000 - elapsedMs);
  }

  /**
   * Get per-iteration timeout (capped by remaining time)
   */
  getIterationTimeoutMs(): number {
    const configuredMs = this.limits.perIterationTimeoutSeconds * 1000;
    return Math.min(configuredMs, this.getRemainingTimeMs());
  }
}
```

## Iteration Runner Implementation

### Main Runner Class

```typescript
export class IterationRunner {
  private plan: IterationPlan;
  private collector: IterationResultCollector;
  private enforcer: IterationLimitEnforcer;
  private activeRuns: Map<string, { runId: string; startedAt: number }> = new Map();

  constructor(plan: IterationPlan, limits?: IterationLimits) {
    this.plan = plan;
    this.collector = new IterationResultCollector(plan);
    this.enforcer = new IterationLimitEnforcer(limits);
  }

  /**
   * Execute the iteration plan
   */
  async execute(): Promise<AggregationResult> {
    this.plan.status = "running";
    this.plan.startedAt = Date.now();

    try {
      // Subscribe to result events
      this.collector.onResult(result => this.onIterationComplete(result));

      // Spawn initial batch based on strategy
      await this.spawnInitialBatch();

      // Wait for completion
      await this.waitForCompletion();

      // Aggregate results
      const results = this.collector.getResults();
      const aggregated = await aggregateResults(
        results,
        this.plan.strategy === "tournament" ? "best" : "best",
        await this.getTask()
      );

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
   * Spawn the initial batch of iterations
   */
  private async spawnInitialBatch(): Promise<void> {
    const pending = this.plan.variations.filter(v => v.status === "pending");

    for (const variation of pending) {
      const canSpawn = this.enforcer.canSpawn();
      if (!canSpawn.allowed) break;

      await this.spawnVariation(variation);
    }
  }

  /**
   * Spawn a single variation as a sub-agent
   */
  private async spawnVariation(variation: IterationVariation): Promise<void> {
    const task = await this.getTask();
    const timeoutSeconds = Math.floor(this.enforcer.getIterationTimeoutMs() / 1000);

    // Build the task prompt with variation context
    const prompt = this.buildVariationPrompt(task, variation);

    try {
      const result = await callGateway({
        method: "tool.invoke",
        params: {
          tool: "sessions_spawn",
          args: {
            task: prompt,
            label: `${task.title} [${variation.label}]`,
            model: variation.model,
            thinking: variation.thinking,
            runTimeoutSeconds: timeoutSeconds,
            cleanup: "keep", // Keep for result analysis
          },
        },
        timeoutMs: 10_000,
      }) as { status: string; runId?: string; childSessionKey?: string };

      if (result.status === "accepted" && result.runId) {
        variation.runId = result.runId;
        variation.status = "spawned";
        this.activeRuns.set(variation.id, {
          runId: result.runId,
          startedAt: Date.now(),
        });
        this.enforcer.recordSpawn();
      } else {
        variation.status = "failed";
      }
    } catch (error) {
      variation.status = "failed";
    }
  }

  /**
   * Build the prompt for a specific variation
   */
  private buildVariationPrompt(task: KanbanTask, variation: IterationVariation): string {
    const parts = [
      `# Task: ${task.title}`,
      "",
      task.description || "",
      "",
    ];

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
   * Handle iteration completion
   */
  private onIterationComplete(result: IterationResult): void {
    this.enforcer.recordCompletion(result);

    // Check if we should spawn more
    if (!this.collector.isComplete()) {
      void this.spawnNextVariation();
    }
  }

  /**
   * Spawn the next pending variation if limits allow
   */
  private async spawnNextVariation(): Promise<void> {
    const canSpawn = this.enforcer.canSpawn();
    if (!canSpawn.allowed) return;

    const pending = this.plan.variations.find(v => v.status === "pending");
    if (pending) {
      await this.spawnVariation(pending);
    }
  }

  /**
   * Wait for completion criteria or timeout
   */
  private async waitForCompletion(): Promise<void> {
    const checkInterval = 1000; // 1 second

    while (!this.collector.isComplete()) {
      // Check for timeout
      if (this.enforcer.getRemainingTimeMs() <= 0) {
        // Cancel remaining runs
        await this.cancelActiveRuns();
        break;
      }

      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }

  /**
   * Cancel all active runs
   */
  private async cancelActiveRuns(): Promise<void> {
    for (const [variationId, run] of this.activeRuns) {
      const variation = this.plan.variations.find(v => v.id === variationId);
      if (variation && variation.status === "spawned") {
        variation.status = "timeout";
        // Note: actual cancellation would require gateway support
      }
    }
  }

  /**
   * Get the kanban task
   */
  private async getTask(): Promise<KanbanTask> {
    const task = await getTask(this.plan.taskId);
    if (!task) throw new Error(`Task not found: ${this.plan.taskId}`);
    return task;
  }
}
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Multi-Iteration Workflow                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. Plan Creation                                                            │
│  ┌────────────────┐    ┌────────────────────┐    ┌─────────────────────┐    │
│  │  Select Task   │───▶│  Choose Strategy   │───▶│  Generate Variations │   │
│  │  (from board)  │    │  (model/prompt/etc)│    │  (based on config)  │    │
│  └────────────────┘    └────────────────────┘    └─────────────────────┘    │
│                                                                              │
│  2. Execution                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     Iteration Runner                                 │    │
│  │                                                                      │    │
│  │  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐             │    │
│  │  │ sessions_spawn│   │ sessions_spawn│   │ sessions_spawn│            │    │
│  │  │ (variation A)│   │ (variation B)│   │ (variation C)│             │    │
│  │  └──────────────┘   └──────────────┘   └──────────────┘             │    │
│  │         │                  │                  │                      │    │
│  │         ▼                  ▼                  ▼                      │    │
│  │  ┌──────────────────────────────────────────────────────────┐       │    │
│  │  │              SubagentRegistry (existing)                  │       │    │
│  │  │  - Track run status                                       │       │    │
│  │  │  - Capture completion events                              │       │    │
│  │  │  - Store results                                          │       │    │
│  │  └──────────────────────────────────────────────────────────┘       │    │
│  │         │                                                            │    │
│  │         ▼                                                            │    │
│  │  ┌──────────────────────────────────────────────────────────┐       │    │
│  │  │              Result Collector                             │       │    │
│  │  │  - Gather outputs                                         │       │    │
│  │  │  - Score results                                          │       │    │
│  │  │  - Check completion criteria                              │       │    │
│  │  └──────────────────────────────────────────────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  3. Aggregation & Presentation                                               │
│  ┌────────────────────┐    ┌────────────────────┐    ┌─────────────────┐    │
│  │ Aggregate Results  │───▶│  Select Best /     │───▶│  Update Task    │    │
│  │ (score, compare)   │    │  Merge Solutions   │    │  (mark complete)│    │
│  └────────────────────┘    └────────────────────┘    └─────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## API Design

### Iteration Plan Store Interface

```typescript
export interface IterationPlanStore {
  // CRUD
  create(plan: Omit<IterationPlan, "id" | "createdAt" | "status">): Promise<IterationPlan>;
  get(id: string): Promise<IterationPlan | null>;
  update(id: string, updates: Partial<IterationPlan>): Promise<IterationPlan>;
  delete(id: string): Promise<void>;

  // Queries
  listByTask(taskId: string): Promise<IterationPlan[]>;
  listActive(): Promise<IterationPlan[]>;

  // Results
  addResult(planId: string, result: IterationResult): Promise<void>;
  getResults(planId: string): Promise<IterationResult[]>;
}
```

### CLI Interface

```bash
# Start multi-iteration run for a task
gimli kanban iterate <task-id> --strategy parallel --models "claude-sonnet,gpt-4o"

# Check iteration status
gimli kanban iterations list
gimli kanban iterations status <plan-id>

# View iteration results
gimli kanban iterations results <plan-id>

# Cancel active iterations
gimli kanban iterations cancel <plan-id>
```

## Configuration

### Config Schema Extension

```yaml
# gimli.config.yaml
kanban:
  iterations:
    # Default limits
    maxConcurrent: 3
    maxTotal: 6
    perIterationTimeoutSeconds: 300
    totalTimeoutSeconds: 900
    perIterationMaxCostUsd: 0.50
    totalMaxCostUsd: 2.00

    # Default strategy
    defaultStrategy: "parallel"

    # Model pool for variations
    modelPool:
      - "anthropic/claude-sonnet-4-20250514"
      - "anthropic/claude-opus-4-5-20251101"

    # Scoring weights
    scoring:
      weights:
        confidence: 0.2
        completeness: 0.3
        codeQuality: 0.2
        responsiveness: 0.2
        speed: 0.05
        cost: 0.05
```

## File Locations

```
src/
├── dashboard/
│   ├── kanban-server.ts          # Existing - add iteration endpoints
│   ├── kanban-store.ts           # Existing - add iteration metadata
│   ├── kanban-iterations.ts      # NEW - Iteration plan store
│   └── kanban-iteration-runner.ts # NEW - Main runner implementation
├── agents/
│   └── tools/
│       └── kanban-iterate-tool.ts # NEW - Agent tool for triggering iterations
└── config/
    └── types.kanban.ts            # NEW - Kanban config types
```

## Testing Strategy

1. **Unit Tests**: Individual components (scoring, limits, collector)
2. **Integration Tests**: Full iteration flow with mocked sub-agents
3. **E2E Tests**: Real sub-agent spawning with test tasks
4. **Performance Tests**: Verify concurrency limits are respected

## Security Considerations

1. **Cost Controls**: Enforce per-iteration and total cost limits
2. **Resource Limits**: Respect configured concurrency limits
3. **Timeout Enforcement**: Strict timeout handling to prevent runaway processes
4. **Isolation**: Sub-agents run in isolated sessions per existing security model
5. **Audit Trail**: Log all iteration spawns and results

## Implementation Order

1. `src/config/types.kanban.ts` - Configuration types
2. `src/dashboard/kanban-iterations.ts` - Iteration plan store
3. `src/dashboard/kanban-iteration-runner.ts` - Core runner
4. Integration with existing `sessions_spawn`
5. Result collection and scoring
6. Aggregation strategies
7. CLI commands
8. Web UI integration
9. Tests for each component

## References

- AGI Research: `docs/AGI_RESEARCH.md` (Multi-Agent Coordination Patterns)
- Existing spawn tool: `src/agents/tools/sessions-spawn-tool.ts`
- Subagent registry: `src/agents/subagent-registry.ts`
- Kanban store: `src/dashboard/kanban-store.ts`
- Agent limits: `src/config/agent-limits.ts`
- Agent timeouts: `src/agents/timeout.ts`
