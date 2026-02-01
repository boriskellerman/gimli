/**
 * A/B Testing for Response Strategies
 *
 * Enables experimentation with different response approaches to identify
 * which strategies work best for different contexts. Tracks performance
 * metrics from user feedback and automatically selects winning variants.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";

/**
 * Response strategy dimensions that can be tested
 */
export type StrategyDimension =
  | "response-length"
  | "explanation-style"
  | "example-inclusion"
  | "proactivity"
  | "confirmation-style";

/**
 * Individual variant within a strategy dimension
 */
export interface StrategyVariant {
  /** Unique identifier for this variant */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this variant does */
  description: string;
  /** Prompt modifier or instruction to apply */
  instruction: string;
}

/**
 * Definition of a strategy experiment
 */
export interface StrategyExperiment {
  /** Unique experiment ID */
  id: string;
  /** Strategy dimension being tested */
  dimension: StrategyDimension;
  /** Human-readable experiment name */
  name: string;
  /** Available variants to test */
  variants: StrategyVariant[];
  /** Whether the experiment is active */
  active: boolean;
  /** When the experiment was created */
  createdAt: string;
  /** Optional end date for the experiment */
  endDate?: string;
  /** Traffic allocation (0-1, what percentage of requests to include) */
  trafficAllocation: number;
}

/**
 * Record of a variant assignment
 */
export interface VariantAssignment {
  /** Experiment ID */
  experimentId: string;
  /** Assigned variant ID */
  variantId: string;
  /** Session or interaction key */
  sessionKey: string;
  /** When the assignment was made */
  timestamp: string;
}

/**
 * Performance metrics for a variant
 */
export interface VariantMetrics {
  /** Variant ID */
  variantId: string;
  /** Total number of exposures */
  exposures: number;
  /** Number of positive feedback events */
  positiveCount: number;
  /** Number of negative feedback events */
  negativeCount: number;
  /** Computed success rate (0-1) */
  successRate: number;
  /** Confidence score based on sample size (0-1) */
  confidence: number;
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Complete experiment results
 */
export interface ExperimentResults {
  /** Experiment ID */
  experimentId: string;
  /** Metrics for each variant */
  variantMetrics: VariantMetrics[];
  /** ID of the currently winning variant (if any) */
  winningVariant: string | null;
  /** Statistical significance of the winner (0-1) */
  significance: number;
  /** Total sample size across all variants */
  totalSamples: number;
  /** When the results were last computed */
  computedAt: string;
}

/**
 * Stored experiment state
 */
export interface ExperimentState {
  /** All experiments */
  experiments: StrategyExperiment[];
  /** Variant assignments */
  assignments: VariantAssignment[];
  /** Metrics per variant per experiment */
  metrics: Record<string, VariantMetrics[]>;
  /** Last updated timestamp */
  updatedAt: string;
}

const EXPERIMENTS_FILENAME = "ab-experiments.json";
const MIN_SAMPLES_FOR_SIGNIFICANCE = 30;
const SIGNIFICANCE_THRESHOLD = 0.95;

/**
 * Predefined strategy experiments
 */
export const defaultExperiments: StrategyExperiment[] = [
  {
    id: "response-length-v1",
    dimension: "response-length",
    name: "Response Length Test",
    variants: [
      {
        id: "concise",
        name: "Concise",
        description: "Short, direct responses",
        instruction: "Keep responses brief and to the point. Aim for 2-3 sentences when possible.",
      },
      {
        id: "detailed",
        name: "Detailed",
        description: "Comprehensive responses with context",
        instruction:
          "Provide thorough explanations with relevant context. Include reasoning and examples.",
      },
      {
        id: "adaptive",
        name: "Adaptive",
        description: "Length based on query complexity",
        instruction:
          "Match response length to query complexity. Simple questions get brief answers; complex ones get detailed responses.",
      },
    ],
    active: false,
    createdAt: new Date().toISOString(),
    trafficAllocation: 1.0,
  },
  {
    id: "explanation-style-v1",
    dimension: "explanation-style",
    name: "Explanation Style Test",
    variants: [
      {
        id: "step-by-step",
        name: "Step by Step",
        description: "Sequential breakdown of concepts",
        instruction:
          "Explain concepts in numbered steps. Break down complex ideas into sequential parts.",
      },
      {
        id: "analogy-driven",
        name: "Analogy Driven",
        description: "Use analogies and comparisons",
        instruction:
          "Use analogies and real-world comparisons to explain concepts. Relate new ideas to familiar ones.",
      },
      {
        id: "direct-technical",
        name: "Direct Technical",
        description: "Straightforward technical explanation",
        instruction:
          "Provide direct technical explanations without analogies. Use precise terminology.",
      },
    ],
    active: false,
    createdAt: new Date().toISOString(),
    trafficAllocation: 1.0,
  },
  {
    id: "example-inclusion-v1",
    dimension: "example-inclusion",
    name: "Example Inclusion Test",
    variants: [
      {
        id: "always-examples",
        name: "Always Include Examples",
        description: "Include examples in every response",
        instruction:
          "Always include at least one concrete example in your response to illustrate the concept.",
      },
      {
        id: "on-request",
        name: "Examples on Request",
        description: "Only include examples when asked",
        instruction:
          "Only include examples when explicitly requested or when essential for understanding.",
      },
      {
        id: "smart-examples",
        name: "Smart Examples",
        description: "Include examples for complex topics only",
        instruction:
          "Include examples for complex or abstract topics. Skip examples for simple, concrete questions.",
      },
    ],
    active: false,
    createdAt: new Date().toISOString(),
    trafficAllocation: 1.0,
  },
  {
    id: "proactivity-v1",
    dimension: "proactivity",
    name: "Proactivity Test",
    variants: [
      {
        id: "reactive",
        name: "Reactive Only",
        description: "Only answer what is asked",
        instruction:
          "Answer only the specific question asked. Do not volunteer additional information.",
      },
      {
        id: "proactive",
        name: "Proactive",
        description: "Anticipate follow-up needs",
        instruction:
          "Anticipate likely follow-up questions and address them proactively. Suggest next steps.",
      },
      {
        id: "balanced",
        name: "Balanced",
        description: "Add context when highly relevant",
        instruction:
          "Answer the question directly, but add brief context when it is highly relevant to the task.",
      },
    ],
    active: false,
    createdAt: new Date().toISOString(),
    trafficAllocation: 1.0,
  },
  {
    id: "confirmation-style-v1",
    dimension: "confirmation-style",
    name: "Confirmation Style Test",
    variants: [
      {
        id: "confirm-first",
        name: "Confirm First",
        description: "Always confirm understanding before acting",
        instruction:
          "Before taking action, confirm your understanding of the request. Ask clarifying questions.",
      },
      {
        id: "act-first",
        name: "Act First",
        description: "Take action immediately",
        instruction:
          "Take action immediately based on the request. Only ask for clarification if truly ambiguous.",
      },
      {
        id: "confidence-based",
        name: "Confidence Based",
        description: "Confirm when unsure, act when confident",
        instruction:
          "Act immediately when confident about the request. Confirm understanding when there is ambiguity.",
      },
    ],
    active: false,
    createdAt: new Date().toISOString(),
    trafficAllocation: 1.0,
  },
];

/**
 * Resolve the path to an agent's experiments file
 */
export function resolveExperimentsPath(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "agent", EXPERIMENTS_FILENAME);
}

/**
 * Load experiment state for an agent
 */
export async function loadExperimentState(agentId: string): Promise<ExperimentState> {
  const filePath = resolveExperimentsPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return validateState(data);
  } catch {
    return createEmptyState();
  }
}

/**
 * Create an empty experiment state
 */
export function createEmptyState(): ExperimentState {
  return {
    experiments: [],
    assignments: [],
    metrics: {},
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validate and normalize loaded state
 */
function validateState(data: unknown): ExperimentState {
  if (!data || typeof data !== "object") {
    return createEmptyState();
  }

  const state = data as Partial<ExperimentState>;

  return {
    experiments: Array.isArray(state.experiments) ? state.experiments : [],
    assignments: Array.isArray(state.assignments) ? state.assignments : [],
    metrics: state.metrics && typeof state.metrics === "object" ? state.metrics : {},
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

/**
 * Save experiment state for an agent
 */
export async function saveExperimentState(agentId: string, state: ExperimentState): Promise<void> {
  const filePath = resolveExperimentsPath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  state.updatedAt = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Initialize default experiments for an agent (if not already present)
 */
export async function initializeExperiments(agentId: string): Promise<ExperimentState> {
  const state = await loadExperimentState(agentId);

  // Add default experiments that don't exist
  for (const defaultExp of defaultExperiments) {
    const exists = state.experiments.some((e) => e.id === defaultExp.id);
    if (!exists) {
      state.experiments.push({
        ...defaultExp,
        createdAt: new Date().toISOString(),
      });
    }
  }

  await saveExperimentState(agentId, state);
  return state;
}

/**
 * Enable or disable an experiment
 */
export async function setExperimentActive(
  agentId: string,
  experimentId: string,
  active: boolean,
): Promise<boolean> {
  const state = await loadExperimentState(agentId);
  const experiment = state.experiments.find((e) => e.id === experimentId);

  if (!experiment) {
    return false;
  }

  experiment.active = active;
  await saveExperimentState(agentId, state);
  return true;
}

/**
 * Get all active experiments for an agent
 */
export async function getActiveExperiments(agentId: string): Promise<StrategyExperiment[]> {
  const state = await loadExperimentState(agentId);
  return state.experiments.filter((e) => e.active);
}

/**
 * Generate a deterministic hash for consistent variant assignment
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Assign a variant for a session within an experiment
 * Uses deterministic assignment based on session key for consistency
 */
export function assignVariant(
  experiment: StrategyExperiment,
  sessionKey: string,
): StrategyVariant | null {
  if (!experiment.active || experiment.variants.length === 0) {
    return null;
  }

  // Check traffic allocation
  const hash = hashString(`${experiment.id}:${sessionKey}:traffic`);
  const trafficCheck = (hash % 100) / 100;
  if (trafficCheck > experiment.trafficAllocation) {
    return null; // Not in experiment
  }

  // Deterministic variant assignment
  const variantHash = hashString(`${experiment.id}:${sessionKey}:variant`);
  const variantIndex = variantHash % experiment.variants.length;

  return experiment.variants[variantIndex];
}

/**
 * Get assigned variants for all active experiments
 */
export async function getAssignedVariants(
  agentId: string,
  sessionKey: string,
): Promise<Map<string, StrategyVariant>> {
  const activeExperiments = await getActiveExperiments(agentId);
  const assignments = new Map<string, StrategyVariant>();

  for (const experiment of activeExperiments) {
    const variant = assignVariant(experiment, sessionKey);
    if (variant) {
      assignments.set(experiment.id, variant);
    }
  }

  return assignments;
}

/**
 * Record a variant assignment (for tracking)
 */
export async function recordAssignment(
  agentId: string,
  experimentId: string,
  variantId: string,
  sessionKey: string,
): Promise<void> {
  const state = await loadExperimentState(agentId);

  // Check if assignment already exists
  const exists = state.assignments.some(
    (a) => a.experimentId === experimentId && a.sessionKey === sessionKey,
  );

  if (!exists) {
    state.assignments.push({
      experimentId,
      variantId,
      sessionKey,
      timestamp: new Date().toISOString(),
    });

    // Initialize metrics if needed
    if (!state.metrics[experimentId]) {
      const experiment = state.experiments.find((e) => e.id === experimentId);
      if (experiment) {
        state.metrics[experimentId] = experiment.variants.map((v) => ({
          variantId: v.id,
          exposures: 0,
          positiveCount: 0,
          negativeCount: 0,
          successRate: 0,
          confidence: 0,
          lastUpdated: new Date().toISOString(),
        }));
      }
    }

    // Increment exposure count
    const experimentMetrics = state.metrics[experimentId];
    if (experimentMetrics) {
      const variantMetric = experimentMetrics.find((m) => m.variantId === variantId);
      if (variantMetric) {
        variantMetric.exposures++;
        variantMetric.lastUpdated = new Date().toISOString();
      }
    }

    await saveExperimentState(agentId, state);
  }
}

/**
 * Record feedback for a variant
 */
export async function recordVariantFeedback(
  agentId: string,
  experimentId: string,
  variantId: string,
  isPositive: boolean,
): Promise<void> {
  const state = await loadExperimentState(agentId);

  if (!state.metrics[experimentId]) {
    return;
  }

  const variantMetric = state.metrics[experimentId].find((m) => m.variantId === variantId);
  if (!variantMetric) {
    return;
  }

  if (isPositive) {
    variantMetric.positiveCount++;
  } else {
    variantMetric.negativeCount++;
  }

  // Recalculate success rate
  const total = variantMetric.positiveCount + variantMetric.negativeCount;
  variantMetric.successRate = total > 0 ? variantMetric.positiveCount / total : 0;

  // Calculate confidence based on sample size
  // Uses a simple approach: confidence increases with sample size
  variantMetric.confidence = Math.min(1, total / MIN_SAMPLES_FOR_SIGNIFICANCE);

  variantMetric.lastUpdated = new Date().toISOString();

  await saveExperimentState(agentId, state);
}

/**
 * Calculate experiment results and determine winner
 */
export async function calculateExperimentResults(
  agentId: string,
  experimentId: string,
): Promise<ExperimentResults | null> {
  const state = await loadExperimentState(agentId);
  const experimentMetrics = state.metrics[experimentId];

  if (!experimentMetrics || experimentMetrics.length === 0) {
    return null;
  }

  // Calculate total samples
  const totalSamples = experimentMetrics.reduce(
    (sum, m) => sum + m.positiveCount + m.negativeCount,
    0,
  );

  // Find the best performing variant
  let winningVariant: string | null = null;
  let bestRate = -1;
  let significance = 0;

  for (const metric of experimentMetrics) {
    const samples = metric.positiveCount + metric.negativeCount;
    if (samples >= MIN_SAMPLES_FOR_SIGNIFICANCE && metric.successRate > bestRate) {
      bestRate = metric.successRate;
      winningVariant = metric.variantId;
    }
  }

  // Calculate statistical significance (simplified z-test)
  if (winningVariant && experimentMetrics.length >= 2) {
    const winner = experimentMetrics.find((m) => m.variantId === winningVariant)!;
    const others = experimentMetrics.filter((m) => m.variantId !== winningVariant);

    // Compare winner against pooled other variants
    const winnerSamples = winner.positiveCount + winner.negativeCount;
    const otherSamples = others.reduce((sum, m) => sum + m.positiveCount + m.negativeCount, 0);
    const otherPositive = others.reduce((sum, m) => sum + m.positiveCount, 0);
    const otherRate = otherSamples > 0 ? otherPositive / otherSamples : 0;

    if (winnerSamples > 0 && otherSamples > 0) {
      // Simplified significance calculation
      const pooledRate = (winner.positiveCount + otherPositive) / (winnerSamples + otherSamples);
      const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / winnerSamples + 1 / otherSamples));

      if (se > 0) {
        const z = Math.abs(winner.successRate - otherRate) / se;
        // Convert z-score to approximate significance (using normal CDF approximation)
        significance = 1 - Math.exp(-0.5 * z * z);
      }
    }
  }

  return {
    experimentId,
    variantMetrics: experimentMetrics,
    winningVariant: significance >= SIGNIFICANCE_THRESHOLD ? winningVariant : null,
    significance,
    totalSamples,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Get the winning variant for an experiment (if one has been determined)
 */
export async function getWinningVariant(
  agentId: string,
  experimentId: string,
): Promise<StrategyVariant | null> {
  const state = await loadExperimentState(agentId);
  const experiment = state.experiments.find((e) => e.id === experimentId);

  if (!experiment) {
    return null;
  }

  const results = await calculateExperimentResults(agentId, experimentId);
  if (!results || !results.winningVariant) {
    return null;
  }

  return experiment.variants.find((v) => v.id === results.winningVariant) || null;
}

/**
 * Build combined instruction from all active variant assignments
 */
export async function buildStrategyInstruction(
  agentId: string,
  sessionKey: string,
): Promise<string> {
  const assignments = await getAssignedVariants(agentId, sessionKey);

  if (assignments.size === 0) {
    return "";
  }

  const instructions: string[] = [];

  for (const [experimentId, variant] of assignments) {
    // Record the assignment
    await recordAssignment(agentId, experimentId, variant.id, sessionKey);

    // Add the instruction
    instructions.push(variant.instruction);
  }

  if (instructions.length === 0) {
    return "";
  }

  return `Response strategy guidelines:\n${instructions.map((i) => `- ${i}`).join("\n")}`;
}

/**
 * Create a custom experiment
 */
export async function createExperiment(
  agentId: string,
  experiment: Omit<StrategyExperiment, "createdAt">,
): Promise<StrategyExperiment> {
  const state = await loadExperimentState(agentId);

  const newExperiment: StrategyExperiment = {
    ...experiment,
    createdAt: new Date().toISOString(),
  };

  state.experiments.push(newExperiment);
  await saveExperimentState(agentId, state);

  return newExperiment;
}

/**
 * Delete an experiment
 */
export async function deleteExperiment(agentId: string, experimentId: string): Promise<boolean> {
  const state = await loadExperimentState(agentId);
  const index = state.experiments.findIndex((e) => e.id === experimentId);

  if (index === -1) {
    return false;
  }

  state.experiments.splice(index, 1);

  // Clean up related data
  state.assignments = state.assignments.filter((a) => a.experimentId !== experimentId);
  delete state.metrics[experimentId];

  await saveExperimentState(agentId, state);
  return true;
}

/**
 * Get a summary of all experiments and their status
 */
export async function getExperimentsSummary(agentId: string): Promise<
  Array<{
    experiment: StrategyExperiment;
    results: ExperimentResults | null;
  }>
> {
  const state = await loadExperimentState(agentId);
  const summaries: Array<{
    experiment: StrategyExperiment;
    results: ExperimentResults | null;
  }> = [];

  for (const experiment of state.experiments) {
    const results = await calculateExperimentResults(agentId, experiment.id);
    summaries.push({ experiment, results });
  }

  return summaries;
}

/**
 * Apply winning strategies as permanent defaults
 * This "graduates" a winning variant to become the default behavior
 */
export async function graduateWinningVariant(
  agentId: string,
  experimentId: string,
): Promise<StrategyVariant | null> {
  const winner = await getWinningVariant(agentId, experimentId);

  if (!winner) {
    return null;
  }

  // Deactivate the experiment since we have a winner
  await setExperimentActive(agentId, experimentId, false);

  return winner;
}

/**
 * Reset experiment metrics (for re-running experiments)
 */
export async function resetExperimentMetrics(agentId: string, experimentId: string): Promise<void> {
  const state = await loadExperimentState(agentId);
  const experiment = state.experiments.find((e) => e.id === experimentId);

  if (!experiment) {
    return;
  }

  // Reset metrics
  state.metrics[experimentId] = experiment.variants.map((v) => ({
    variantId: v.id,
    exposures: 0,
    positiveCount: 0,
    negativeCount: 0,
    successRate: 0,
    confidence: 0,
    lastUpdated: new Date().toISOString(),
  }));

  // Clear assignments for this experiment
  state.assignments = state.assignments.filter((a) => a.experimentId !== experimentId);

  await saveExperimentState(agentId, state);
}
