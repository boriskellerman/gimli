/**
 * Pattern detection algorithms
 *
 * Analyzes observations to identify recurring patterns in user behavior.
 * Supports time-based, event-based, and context-based pattern detection.
 */

import { randomUUID } from "crypto";

import {
  calculateConfidence,
  type ContextObservationData,
  type ContextPattern,
  type DayOfWeekTrigger,
  type EventObservationData,
  type EventPattern,
  type EventPatternTrigger,
  type Pattern,
  type PatternConfig,
  type PatternObservation,
  type TimeObservationData,
  type TimeOfDayTrigger,
  type TimePattern,
  type TimePatternTrigger,
  defaultPatternConfig,
} from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Detection-specific configuration
 */
export interface DetectorConfig extends PatternConfig {
  /** Time tolerance for clustering observations (minutes) */
  timeClusterToleranceMinutes: number;

  /** Minimum percentage of observations at same time to form pattern */
  timeConsistencyThreshold: number;

  /** Minimum observations to detect an event sequence */
  minEventSequenceObservations: number;

  /** Maximum delay variation (coefficient of variation) for event patterns */
  maxEventDelayVariation: number;

  /** Minimum keyword overlap ratio for context patterns */
  minKeywordOverlapRatio: number;
}

/**
 * Default detector configuration
 */
export const defaultDetectorConfig: DetectorConfig = {
  ...defaultPatternConfig,
  timeClusterToleranceMinutes: 30,
  timeConsistencyThreshold: 0.6,
  minEventSequenceObservations: 3,
  maxEventDelayVariation: 0.5,
  minKeywordOverlapRatio: 0.3,
};

// ============================================================================
// Time Pattern Detection
// ============================================================================

/**
 * A cluster of time observations occurring at similar times
 */
interface TimeCluster {
  /** Average hour of observations */
  averageHour: number;
  /** Average minute of observations */
  averageMinute: number;
  /** Days of week these observations occurred */
  daysOfWeek: number[];
  /** The action being performed */
  action: string;
  /** Observations in this cluster */
  observations: PatternObservation[];
}

/**
 * Convert hour and minute to minutes since midnight
 */
function toMinutesSinceMidnight(hour: number, minute: number): number {
  return hour * 60 + minute;
}

/**
 * Calculate distance between two times in minutes, accounting for midnight wrap
 */
function timeDistanceMinutes(
  hour1: number,
  minute1: number,
  hour2: number,
  minute2: number,
): number {
  const mins1 = toMinutesSinceMidnight(hour1, minute1);
  const mins2 = toMinutesSinceMidnight(hour2, minute2);
  const diff = Math.abs(mins1 - mins2);
  // Account for wrap around midnight
  return Math.min(diff, 24 * 60 - diff);
}

/**
 * Cluster time observations by similar time-of-day and action
 */
function clusterTimeObservations(
  observations: PatternObservation[],
  toleranceMinutes: number,
): TimeCluster[] {
  const timeObs = observations.filter((o) => o.type === "time-based");
  if (timeObs.length === 0) return [];

  const clusters: TimeCluster[] = [];

  for (const obs of timeObs) {
    const data = obs.data as TimeObservationData;

    // Find existing cluster this observation fits into
    let foundCluster = false;
    for (const cluster of clusters) {
      // Check if same action and similar time
      if (cluster.action !== data.action) continue;

      const distance = timeDistanceMinutes(
        cluster.averageHour,
        cluster.averageMinute,
        data.hour,
        data.minute,
      );

      if (distance <= toleranceMinutes) {
        // Add to cluster and update average
        const n = cluster.observations.length;
        cluster.averageHour = (cluster.averageHour * n + data.hour) / (n + 1);
        cluster.averageMinute = (cluster.averageMinute * n + data.minute) / (n + 1);
        if (!cluster.daysOfWeek.includes(data.dayOfWeek)) {
          cluster.daysOfWeek.push(data.dayOfWeek);
        }
        cluster.observations.push(obs);
        foundCluster = true;
        break;
      }
    }

    // Create new cluster if no match found
    if (!foundCluster) {
      clusters.push({
        averageHour: data.hour,
        averageMinute: data.minute,
        daysOfWeek: [data.dayOfWeek],
        action: data.action,
        observations: [obs],
      });
    }
  }

  return clusters;
}

/**
 * Calculate consistency score for a time cluster
 *
 * Measures how consistently observations occur at the same time.
 * Higher scores indicate more predictable timing.
 */
function calculateTimeConsistency(cluster: TimeCluster): number {
  if (cluster.observations.length < 2) return 0;

  // Calculate standard deviation of times
  const times = cluster.observations.map((o) => {
    const data = o.data as TimeObservationData;
    return toMinutesSinceMidnight(data.hour, data.minute);
  });

  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + (t - mean) ** 2, 0) / times.length;
  const stdDev = Math.sqrt(variance);

  // Convert to a 0-1 consistency score
  // stdDev of 0 = perfect consistency (1.0)
  // stdDev of 60 minutes = moderate consistency (~0.5)
  // stdDev > 120 minutes = low consistency (~0.2)
  return Math.exp(-stdDev / 60);
}

/**
 * Determine if a cluster represents a day-of-week pattern
 */
function isDayOfWeekPattern(cluster: TimeCluster): boolean {
  // If observations cluster on specific days (not all 7), it's a day-of-week pattern
  return cluster.daysOfWeek.length <= 3 && cluster.observations.length >= 2;
}

/**
 * Create a time pattern trigger from a cluster
 */
function createTimePatternTrigger(cluster: TimeCluster): TimePatternTrigger {
  const hour = Math.round(cluster.averageHour);
  const minute = Math.round(cluster.averageMinute) % 60;

  if (isDayOfWeekPattern(cluster)) {
    // Use day-of-week trigger for the most common day
    const dayCounts = new Map<number, number>();
    for (const obs of cluster.observations) {
      const data = obs.data as TimeObservationData;
      dayCounts.set(data.dayOfWeek, (dayCounts.get(data.dayOfWeek) ?? 0) + 1);
    }

    let mostCommonDay = 1;
    let maxCount = 0;
    for (const [day, count] of dayCounts) {
      if (count > maxCount) {
        mostCommonDay = day;
        maxCount = count;
      }
    }

    return {
      kind: "day-of-week",
      dayOfWeek: mostCommonDay,
      hour,
      minute,
    } satisfies DayOfWeekTrigger;
  }

  // Default to time-of-day trigger
  return {
    kind: "time-of-day",
    hour,
    minute,
  } satisfies TimeOfDayTrigger;
}

/**
 * Detect time-based patterns from observations
 */
export function detectTimePatterns(
  observations: PatternObservation[],
  agentId: string,
  config: DetectorConfig = defaultDetectorConfig,
): TimePattern[] {
  const clusters = clusterTimeObservations(observations, config.timeClusterToleranceMinutes);
  const patterns: TimePattern[] = [];

  for (const cluster of clusters) {
    // Skip clusters with too few observations
    if (cluster.observations.length < config.minObservations) continue;

    const consistency = calculateTimeConsistency(cluster);
    if (consistency < config.timeConsistencyThreshold) continue;

    const timestamps = cluster.observations.map((o) => o.timestamp);
    const firstObserved = new Date(Math.min(...timestamps.map((t) => t.getTime())));
    const lastObserved = new Date(Math.max(...timestamps.map((t) => t.getTime())));
    const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

    const confidence = calculateConfidence({
      observationCount: cluster.observations.length,
      daysSinceLastObserved,
      consistencyScore: consistency,
    });

    const trigger = createTimePatternTrigger(cluster);

    patterns.push({
      id: randomUUID(),
      agentId,
      description: `${cluster.action} at ${Math.round(cluster.averageHour)}:${Math.round(cluster.averageMinute).toString().padStart(2, "0")}`,
      type: "time-based",
      confidence,
      observationCount: cluster.observations.length,
      firstObserved,
      lastObserved,
      active: confidence >= config.activationThreshold,
      trigger,
      typicalAction: cluster.action,
      toleranceMinutes: config.timeClusterToleranceMinutes,
      daysOfWeek: isDayOfWeekPattern(cluster) ? cluster.daysOfWeek : undefined,
    });
  }

  return patterns;
}

// ============================================================================
// Event Pattern Detection
// ============================================================================

/**
 * A sequence of event -> follow-up pairs
 */
interface EventSequence {
  /** The triggering event */
  event: string;
  /** The follow-up action */
  followUp: string;
  /** Delays between event and follow-up (seconds) */
  delays: number[];
  /** Observations in this sequence */
  observations: PatternObservation[];
}

/**
 * Group event observations into sequences
 */
function groupEventSequences(observations: PatternObservation[]): EventSequence[] {
  const eventObs = observations.filter((o) => o.type === "event-based");
  if (eventObs.length === 0) return [];

  // Group by event + followUp combination
  const sequenceMap = new Map<string, EventSequence>();

  for (const obs of eventObs) {
    const data = obs.data as EventObservationData;
    const key = `${data.event}::${data.followUp}`;

    const existing = sequenceMap.get(key);
    if (existing) {
      existing.delays.push(data.delaySeconds);
      existing.observations.push(obs);
    } else {
      sequenceMap.set(key, {
        event: data.event,
        followUp: data.followUp,
        delays: [data.delaySeconds],
        observations: [obs],
      });
    }
  }

  return Array.from(sequenceMap.values());
}

/**
 * Calculate consistency score for an event sequence
 *
 * Measures how consistently the follow-up occurs after the event
 * and how consistent the delay is.
 */
function calculateEventConsistency(sequence: EventSequence): number {
  if (sequence.delays.length < 2) return 0.5; // Neutral for single observation

  // Calculate coefficient of variation for delays
  const mean = sequence.delays.reduce((a, b) => a + b, 0) / sequence.delays.length;
  if (mean === 0) return 1.0; // Perfect consistency if all delays are 0

  const variance =
    sequence.delays.reduce((sum, d) => sum + (d - mean) ** 2, 0) / sequence.delays.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;

  // Convert CV to consistency score
  // CV of 0 = perfect consistency (1.0)
  // CV of 0.5 = moderate consistency (~0.6)
  // CV > 1.0 = low consistency (~0.4)
  return Math.exp(-cv);
}

/**
 * Parse event string to create trigger
 */
function createEventTrigger(event: string): EventPatternTrigger {
  // Parse structured event strings like "tool:git_commit" or "command:/deploy"
  if (event.startsWith("tool:")) {
    return {
      kind: "tool-call",
      toolName: event.slice(5),
    };
  }

  if (event.startsWith("command:")) {
    return {
      kind: "command",
      command: event.slice(8),
    };
  }

  if (event.startsWith("session:")) {
    const sessionEvent = event.slice(8) as "start" | "end" | "compact" | "reset";
    return {
      kind: "session-event",
      event: sessionEvent,
    };
  }

  if (event.startsWith("error:")) {
    return {
      kind: "error",
      errorType: event.slice(6) || undefined,
    };
  }

  if (event.startsWith("mention:")) {
    return {
      kind: "user-mention",
      keywords: event.slice(8).split(","),
    };
  }

  // Default: treat as tool call
  return {
    kind: "tool-call",
    toolName: event,
  };
}

/**
 * Detect event-based patterns from observations
 */
export function detectEventPatterns(
  observations: PatternObservation[],
  agentId: string,
  config: DetectorConfig = defaultDetectorConfig,
): EventPattern[] {
  const sequences = groupEventSequences(observations);
  const patterns: EventPattern[] = [];

  for (const sequence of sequences) {
    // Skip sequences with too few observations
    if (sequence.observations.length < config.minEventSequenceObservations) continue;

    const consistency = calculateEventConsistency(sequence);

    // Skip if delay variation is too high
    if (consistency < 1 - config.maxEventDelayVariation) continue;

    const timestamps = sequence.observations.map((o) => o.timestamp);
    const firstObserved = new Date(Math.min(...timestamps.map((t) => t.getTime())));
    const lastObserved = new Date(Math.max(...timestamps.map((t) => t.getTime())));
    const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

    const confidence = calculateConfidence({
      observationCount: sequence.observations.length,
      daysSinceLastObserved,
      consistencyScore: consistency,
    });

    const trigger = createEventTrigger(sequence.event);

    // Calculate typical delay and reasonable expiration
    const typicalDelay = Math.round(
      sequence.delays.reduce((a, b) => a + b, 0) / sequence.delays.length,
    );
    const maxDelay = Math.max(...sequence.delays);
    const expiration = Math.max(maxDelay * 2, 300); // At least 5 minutes

    patterns.push({
      id: randomUUID(),
      agentId,
      description: `After ${sequence.event}: ${sequence.followUp}`,
      type: "event-based",
      confidence,
      observationCount: sequence.observations.length,
      firstObserved,
      lastObserved,
      active: confidence >= config.activationThreshold,
      trigger,
      typicalFollowUp: sequence.followUp,
      typicalDelaySeconds: typicalDelay,
      expirationSeconds: expiration,
    });
  }

  return patterns;
}

// ============================================================================
// Context Pattern Detection
// ============================================================================

/**
 * A cluster of context observations with similar keywords and needs
 */
interface ContextCluster {
  /** Keywords that appear in this context */
  keywords: Set<string>;
  /** The need expressed in this context */
  need: string;
  /** Semantic similarity scores if available */
  similarityScores: number[];
  /** Observations in this cluster */
  observations: PatternObservation[];
}

/**
 * Check if two keywords are similar (substring match)
 */
function keywordsSimilar(kw1: string, kw2: string): boolean {
  const k1 = kw1.toLowerCase();
  const k2 = kw2.toLowerCase();
  return k1.includes(k2) || k2.includes(k1);
}

/**
 * Calculate keyword overlap ratio between a set and a list of keywords
 *
 * Uses substring matching to handle variations like "deploy" / "deployment"
 */
function keywordOverlapRatio(set1: Set<string>, keywords: string[]): number {
  if (set1.size === 0 || keywords.length === 0) return 0;

  let matchCount = 0;

  for (const kw of keywords) {
    // Check if this keyword matches any keyword in the set
    for (const setKw of set1) {
      if (keywordsSimilar(kw, setKw)) {
        matchCount++;
        break;
      }
    }
  }

  return matchCount / Math.min(set1.size, keywords.length);
}

/**
 * Group context observations into clusters by similar keywords and needs
 */
function clusterContextObservations(
  observations: PatternObservation[],
  minOverlapRatio: number,
): ContextCluster[] {
  const contextObs = observations.filter((o) => o.type === "context-based");
  if (contextObs.length === 0) return [];

  const clusters: ContextCluster[] = [];

  for (const obs of contextObs) {
    const data = obs.data as ContextObservationData;
    const obsKeywords = data.keywords.map((k) => k.toLowerCase());

    // Find existing cluster this observation fits into
    let foundCluster = false;
    for (const cluster of clusters) {
      // Must have same need
      if (cluster.need !== data.need) continue;

      // Check keyword overlap
      const overlap = keywordOverlapRatio(cluster.keywords, obsKeywords);
      if (overlap >= minOverlapRatio) {
        // Add to cluster
        for (const kw of obsKeywords) {
          cluster.keywords.add(kw);
        }
        if (data.similarityScore !== undefined) {
          cluster.similarityScores.push(data.similarityScore);
        }
        cluster.observations.push(obs);
        foundCluster = true;
        break;
      }
    }

    // Create new cluster if no match found
    if (!foundCluster) {
      clusters.push({
        keywords: new Set(obsKeywords),
        need: data.need,
        similarityScores: data.similarityScore !== undefined ? [data.similarityScore] : [],
        observations: [obs],
      });
    }
  }

  return clusters;
}

/**
 * Calculate consistency score for a context cluster
 *
 * Measures how consistently the same need appears with similar context.
 */
function calculateContextConsistency(cluster: ContextCluster): number {
  // Base consistency on observation count relative to unique keywords
  // More observations with fewer unique keywords = more consistent
  const obsCount = cluster.observations.length;
  const keywordCount = cluster.keywords.size;

  // Higher ratio = more consistent pattern
  const ratio = obsCount / Math.max(keywordCount, 1);

  // Normalize to 0-1 scale
  return Math.min(1, ratio / 3);
}

/**
 * Find the most representative keywords for a cluster
 */
function findRepresentativeKeywords(cluster: ContextCluster, maxKeywords: number = 5): string[] {
  // Count keyword frequency across observations
  const keywordCounts = new Map<string, number>();

  for (const obs of cluster.observations) {
    const data = obs.data as ContextObservationData;
    for (const kw of data.keywords) {
      const normalized = kw.toLowerCase();
      keywordCounts.set(normalized, (keywordCounts.get(normalized) ?? 0) + 1);
    }
  }

  // Sort by frequency and take top N
  const sorted = Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([kw]) => kw);

  return sorted;
}

/**
 * Detect context-based patterns from observations
 */
export function detectContextPatterns(
  observations: PatternObservation[],
  agentId: string,
  config: DetectorConfig = defaultDetectorConfig,
): ContextPattern[] {
  const clusters = clusterContextObservations(observations, config.minKeywordOverlapRatio);
  const patterns: ContextPattern[] = [];

  for (const cluster of clusters) {
    // Skip clusters with too few observations
    if (cluster.observations.length < config.minObservations) continue;

    const consistency = calculateContextConsistency(cluster);

    const timestamps = cluster.observations.map((o) => o.timestamp);
    const firstObserved = new Date(Math.min(...timestamps.map((t) => t.getTime())));
    const lastObserved = new Date(Math.max(...timestamps.map((t) => t.getTime())));
    const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

    const confidence = calculateConfidence({
      observationCount: cluster.observations.length,
      daysSinceLastObserved,
      consistencyScore: consistency,
    });

    const keywords = findRepresentativeKeywords(cluster);

    // Determine relevance threshold from observed similarity scores
    const hasSemanticScores = cluster.similarityScores.length > 0;
    const relevanceThreshold = hasSemanticScores
      ? Math.min(...cluster.similarityScores) * 0.9 // 90% of minimum observed score
      : 0.5; // Default threshold

    patterns.push({
      id: randomUUID(),
      agentId,
      description: `When discussing [${keywords.join(", ")}]: ${cluster.need}`,
      type: "context-based",
      confidence,
      observationCount: cluster.observations.length,
      firstObserved,
      lastObserved,
      active: confidence >= config.activationThreshold,
      contextKeywords: keywords,
      relevanceThreshold,
      typicalNeed: cluster.need,
      useSemanticMatching: hasSemanticScores,
    });
  }

  return patterns;
}

// ============================================================================
// Combined Detection
// ============================================================================

/**
 * Result of pattern detection
 */
export interface DetectionResult {
  /** Detected time patterns */
  timePatterns: TimePattern[];
  /** Detected event patterns */
  eventPatterns: EventPattern[];
  /** Detected context patterns */
  contextPatterns: ContextPattern[];
  /** All patterns combined */
  allPatterns: Pattern[];
}

/**
 * Detect all pattern types from observations
 */
export function detectPatterns(
  observations: PatternObservation[],
  agentId: string,
  config: DetectorConfig = defaultDetectorConfig,
): DetectionResult {
  const timePatterns = detectTimePatterns(observations, agentId, config);
  const eventPatterns = detectEventPatterns(observations, agentId, config);
  const contextPatterns = detectContextPatterns(observations, agentId, config);

  return {
    timePatterns,
    eventPatterns,
    contextPatterns,
    allPatterns: [...timePatterns, ...eventPatterns, ...contextPatterns],
  };
}

/**
 * Merge newly detected patterns with existing patterns
 *
 * Updates existing patterns if they match, or adds new ones.
 */
export function mergePatterns(
  existing: Pattern[],
  detected: Pattern[],
  config: DetectorConfig = defaultDetectorConfig,
): Pattern[] {
  const result = [...existing];

  for (const newPattern of detected) {
    // Find matching existing pattern
    const existingIndex = result.findIndex((p) => patternsMatch(p, newPattern));

    if (existingIndex >= 0) {
      // Update existing pattern
      const existingPattern = result[existingIndex]!;
      result[existingIndex] = {
        ...existingPattern,
        confidence: Math.max(existingPattern.confidence, newPattern.confidence),
        observationCount: existingPattern.observationCount + newPattern.observationCount,
        lastObserved: new Date(
          Math.max(existingPattern.lastObserved.getTime(), newPattern.lastObserved.getTime()),
        ),
        active:
          Math.max(existingPattern.confidence, newPattern.confidence) >= config.activationThreshold,
      };
    } else {
      // Add new pattern
      result.push(newPattern);
    }
  }

  // Enforce max patterns limit
  if (result.length > config.maxPatternsPerAgent) {
    // Sort by confidence and keep top N
    result.sort((a, b) => b.confidence - a.confidence);
    result.length = config.maxPatternsPerAgent;
  }

  return result;
}

/**
 * Check if two patterns represent the same underlying behavior
 */
function patternsMatch(p1: Pattern, p2: Pattern): boolean {
  if (p1.type !== p2.type || p1.agentId !== p2.agentId) return false;

  switch (p1.type) {
    case "time-based": {
      const t1 = p1 as TimePattern;
      const t2 = p2 as TimePattern;
      return t1.typicalAction === t2.typicalAction && triggersMatch(t1.trigger, t2.trigger);
    }

    case "event-based": {
      const e1 = p1 as EventPattern;
      const e2 = p2 as EventPattern;
      return e1.typicalFollowUp === e2.typicalFollowUp && e1.trigger.kind === e2.trigger.kind;
    }

    case "context-based": {
      const c1 = p1 as ContextPattern;
      const c2 = p2 as ContextPattern;
      if (c1.typicalNeed !== c2.typicalNeed) return false;

      // Check keyword overlap
      const overlap = c1.contextKeywords.filter((k) =>
        c2.contextKeywords.some((k2) => k2.toLowerCase() === k.toLowerCase()),
      );
      return overlap.length >= Math.min(c1.contextKeywords.length, c2.contextKeywords.length) / 2;
    }
  }
}

/**
 * Check if two time triggers match
 */
function triggersMatch(t1: TimePatternTrigger, t2: TimePatternTrigger): boolean {
  if (t1.kind !== t2.kind) return false;

  switch (t1.kind) {
    case "time-of-day": {
      const other = t2 as typeof t1;
      return Math.abs(t1.hour - other.hour) <= 1 && Math.abs(t1.minute - other.minute) <= 30;
    }

    case "day-of-week": {
      const other = t2 as typeof t1;
      return t1.dayOfWeek === other.dayOfWeek;
    }

    case "interval": {
      const other = t2 as typeof t1;
      return Math.abs(t1.intervalMinutes - other.intervalMinutes) <= 15;
    }
  }
}
