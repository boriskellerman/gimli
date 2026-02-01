/**
 * Memory decay module for reducing relevance of outdated memories.
 *
 * Applies time-based decay to relevance scores during retrieval, allowing
 * recent memories to have higher priority while older memories gradually
 * lose relevance.
 */

export type DecayFunction = "exponential" | "linear" | "stepped";

export type DecayConfig = {
  /** Whether decay is enabled (default: false). */
  enabled: boolean;
  /** Decay function type (default: "exponential"). */
  function: DecayFunction;
  /** Half-life in days for exponential decay (default: 30). */
  halfLifeDays: number;
  /** Minimum decay factor (0-1, default: 0.1). Scores won't drop below original * minFactor. */
  minFactor: number;
  /** For stepped decay: age thresholds in days and their factors. */
  steps?: Array<{ ageDays: number; factor: number }>;
};

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  enabled: false,
  function: "exponential",
  halfLifeDays: 30,
  minFactor: 0.1,
  steps: [
    { ageDays: 7, factor: 1.0 },
    { ageDays: 30, factor: 0.8 },
    { ageDays: 90, factor: 0.5 },
    { ageDays: 365, factor: 0.2 },
  ],
};

/**
 * Calculates the decay factor for a given age.
 *
 * @param ageDays - Age of the memory in days
 * @param config - Decay configuration
 * @returns Decay factor between minFactor and 1.0
 */
export function calculateDecayFactor(ageDays: number, config: DecayConfig): number {
  if (!config.enabled || ageDays <= 0) {
    return 1.0;
  }

  const minFactor = Math.max(0, Math.min(1, config.minFactor));
  let factor: number;

  switch (config.function) {
    case "exponential":
      factor = calculateExponentialDecay(ageDays, config.halfLifeDays);
      break;
    case "linear":
      factor = calculateLinearDecay(ageDays, config.halfLifeDays);
      break;
    case "stepped":
      factor = calculateSteppedDecay(ageDays, config.steps ?? DEFAULT_DECAY_CONFIG.steps!);
      break;
    default:
      factor = 1.0;
  }

  // Ensure factor stays within bounds
  return Math.max(minFactor, Math.min(1, factor));
}

/**
 * Exponential decay: factor = 0.5^(age/halfLife)
 * Provides smooth, natural decay that never reaches zero.
 */
function calculateExponentialDecay(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1.0;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * Linear decay: factor = 1 - (age / (2 * halfLife))
 * Simple linear reduction over time.
 */
function calculateLinearDecay(ageDays: number, halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1.0;
  // At halfLifeDays, factor = 0.5 (same as exponential at half-life)
  return Math.max(0, 1 - ageDays / (2 * halfLifeDays));
}

/**
 * Stepped decay: uses discrete thresholds for factor changes.
 * Provides predictable, human-readable decay boundaries.
 */
function calculateSteppedDecay(
  ageDays: number,
  steps: Array<{ ageDays: number; factor: number }>,
): number {
  if (steps.length === 0) return 1.0;

  // Sort steps by age in ascending order
  const sorted = [...steps].sort((a, b) => a.ageDays - b.ageDays);

  // Find the applicable step (last step where ageDays threshold is <= actual age)
  let factor = 1.0;
  for (const step of sorted) {
    if (ageDays >= step.ageDays) {
      factor = step.factor;
    } else {
      break;
    }
  }

  return factor;
}

/**
 * Applies decay to a relevance score based on memory age.
 *
 * @param score - Original relevance score (typically 0-1)
 * @param updatedAtMs - Timestamp when the memory was last updated (ms since epoch)
 * @param config - Decay configuration
 * @param nowMs - Current timestamp (ms since epoch), defaults to Date.now()
 * @returns Decayed score
 */
export function applyDecay(
  score: number,
  updatedAtMs: number,
  config: DecayConfig,
  nowMs?: number,
): number {
  if (!config.enabled) {
    return score;
  }

  const now = nowMs ?? Date.now();
  const ageMs = Math.max(0, now - updatedAtMs);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  const factor = calculateDecayFactor(ageDays, config);
  return score * factor;
}

/**
 * Applies decay to an array of search results.
 *
 * @param results - Array of search results with score and updatedAt fields
 * @param config - Decay configuration
 * @param nowMs - Current timestamp (ms since epoch), defaults to Date.now()
 * @returns Results with decayed scores, sorted by decayed score descending
 */
export function applyDecayToResults<T extends { score: number; updatedAt?: number | null }>(
  results: T[],
  config: DecayConfig,
  nowMs?: number,
): T[] {
  if (!config.enabled || results.length === 0) {
    return results;
  }

  const now = nowMs ?? Date.now();

  return results
    .map((result) => {
      const updatedAt = result.updatedAt ?? now;
      const decayedScore = applyDecay(result.score, updatedAt, config, now);
      return { ...result, score: decayedScore };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Determines if a memory should be archived based on its age.
 *
 * @param updatedAtMs - Timestamp when the memory was last updated (ms since epoch)
 * @param archiveAfterDays - Age threshold in days after which to archive
 * @param nowMs - Current timestamp (ms since epoch), defaults to Date.now()
 * @returns true if the memory should be archived
 */
export function shouldArchive(
  updatedAtMs: number,
  archiveAfterDays: number,
  nowMs?: number,
): boolean {
  if (archiveAfterDays <= 0) return false;

  const now = nowMs ?? Date.now();
  const ageMs = Math.max(0, now - updatedAtMs);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  return ageDays >= archiveAfterDays;
}

/**
 * Merges user-provided decay config with defaults.
 *
 * @param partial - Partial decay configuration from user
 * @returns Complete decay configuration
 */
export function resolveDecayConfig(partial?: Partial<DecayConfig>): DecayConfig {
  if (!partial) {
    return { ...DEFAULT_DECAY_CONFIG };
  }

  return {
    enabled: partial.enabled ?? DEFAULT_DECAY_CONFIG.enabled,
    function: partial.function ?? DEFAULT_DECAY_CONFIG.function,
    halfLifeDays: Math.max(1, partial.halfLifeDays ?? DEFAULT_DECAY_CONFIG.halfLifeDays),
    minFactor: Math.max(0, Math.min(1, partial.minFactor ?? DEFAULT_DECAY_CONFIG.minFactor)),
    steps: partial.steps ?? DEFAULT_DECAY_CONFIG.steps,
  };
}

/**
 * Calculates the age in days from a timestamp.
 *
 * @param updatedAtMs - Timestamp in milliseconds
 * @param nowMs - Current timestamp (ms since epoch), defaults to Date.now()
 * @returns Age in days
 */
export function calculateAgeDays(updatedAtMs: number, nowMs?: number): number {
  const now = nowMs ?? Date.now();
  const ageMs = Math.max(0, now - updatedAtMs);
  return ageMs / (1000 * 60 * 60 * 24);
}
