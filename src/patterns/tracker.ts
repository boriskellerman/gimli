/**
 * Pattern tracker for observing and recording user activity patterns
 *
 * This module provides the core pattern tracking functionality for Gimli's
 * anticipation system. It observes user activity and records observations
 * that can be used to build patterns over time.
 *
 * Integrates with the existing memory system for storage, using the same
 * SQLite database and memory indexing infrastructure.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  calculateConfidence,
  type ContextObservationData,
  type ContextPattern,
  defaultPatternConfig,
  type EventObservationData,
  type EventPattern,
  type Pattern,
  type PatternConfig,
  type PatternObservation,
  type PatternType,
  type TimeObservationData,
  type TimePattern,
} from "./types.js";

// ============================================================================
// Schema
// ============================================================================

/**
 * SQL statements for pattern observation schema
 *
 * This extends the memory system's SQLite database with tables for
 * storing pattern observations.
 */
export const PATTERN_SCHEMA = `
  -- Pattern observations table: stores individual observations before they form patterns
  CREATE TABLE IF NOT EXISTS pattern_observations (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'time-based' | 'event-based' | 'context-based'
    timestamp INTEGER NOT NULL,
    data TEXT NOT NULL,  -- JSON serialized observation data
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pattern_observations_agent ON pattern_observations(agent_id);
  CREATE INDEX IF NOT EXISTS idx_pattern_observations_type ON pattern_observations(type);
  CREATE INDEX IF NOT EXISTS idx_pattern_observations_timestamp ON pattern_observations(timestamp);

  -- Patterns table: stores recognized patterns built from observations
  CREATE TABLE IF NOT EXISTS patterns (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    observation_count INTEGER NOT NULL DEFAULT 0,
    first_observed INTEGER NOT NULL,
    last_observed INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 0,
    linked_reminder_id TEXT,
    data TEXT NOT NULL,  -- JSON serialized pattern-specific data
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_patterns_agent ON patterns(agent_id);
  CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
  CREATE INDEX IF NOT EXISTS idx_patterns_active ON patterns(active);
  CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);
`;

// ============================================================================
// Row Types
// ============================================================================

/**
 * Database row for pattern observations
 */
export interface PatternObservationRow {
  id: string;
  agent_id: string;
  type: PatternType;
  timestamp: number;
  data: string;
  created_at: number;
}

/**
 * Database row for patterns
 */
export interface PatternRow {
  id: string;
  agent_id: string;
  type: PatternType;
  description: string;
  confidence: number;
  observation_count: number;
  first_observed: number;
  last_observed: number;
  active: number;
  linked_reminder_id: string | null;
  data: string;
  created_at: number;
  updated_at: number;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert observation row to PatternObservation
 */
export function rowToObservation(row: PatternObservationRow): PatternObservation {
  const data = JSON.parse(row.data) as
    | TimeObservationData
    | EventObservationData
    | ContextObservationData;

  return {
    type: row.type,
    agentId: row.agent_id,
    timestamp: new Date(row.timestamp),
    data,
  };
}

/**
 * Convert PatternObservation to row values
 */
export function observationToRow(
  observation: PatternObservation,
  id?: string,
): PatternObservationRow {
  return {
    id: id ?? randomUUID(),
    agent_id: observation.agentId,
    type: observation.type,
    timestamp: observation.timestamp.getTime(),
    data: JSON.stringify(observation.data),
    created_at: Date.now(),
  };
}

/**
 * Convert pattern row to Pattern object
 */
export function rowToPattern(row: PatternRow): Pattern {
  const baseData = {
    id: row.id,
    agentId: row.agent_id,
    type: row.type,
    description: row.description,
    confidence: row.confidence,
    observationCount: row.observation_count,
    firstObserved: new Date(row.first_observed),
    lastObserved: new Date(row.last_observed),
    active: row.active === 1,
    linkedReminderId: row.linked_reminder_id ?? undefined,
  };

  const patternData = JSON.parse(row.data) as Record<string, unknown>;

  switch (row.type) {
    case "time-based":
      return {
        ...baseData,
        type: "time-based",
        trigger: patternData.trigger,
        typicalAction: patternData.typicalAction,
        toleranceMinutes: patternData.toleranceMinutes ?? 30,
        daysOfWeek: patternData.daysOfWeek,
      } as TimePattern;

    case "event-based":
      return {
        ...baseData,
        type: "event-based",
        trigger: patternData.trigger,
        typicalFollowUp: patternData.typicalFollowUp,
        typicalDelaySeconds: patternData.typicalDelaySeconds,
        expirationSeconds: patternData.expirationSeconds ?? 3600,
      } as EventPattern;

    case "context-based":
      return {
        ...baseData,
        type: "context-based",
        contextKeywords: patternData.contextKeywords ?? [],
        relevanceThreshold: patternData.relevanceThreshold ?? 0.4,
        typicalNeed: patternData.typicalNeed,
        relatedChunkIds: patternData.relatedChunkIds,
        useSemanticMatching: patternData.useSemanticMatching ?? true,
      } as ContextPattern;
  }
}

/**
 * Convert Pattern to row values
 */
export function patternToRow(pattern: Pattern): PatternRow {
  const now = Date.now();

  // Extract pattern-specific data
  let patternData: Record<string, unknown>;
  switch (pattern.type) {
    case "time-based":
      patternData = {
        trigger: pattern.trigger,
        typicalAction: pattern.typicalAction,
        toleranceMinutes: pattern.toleranceMinutes,
        daysOfWeek: pattern.daysOfWeek,
      };
      break;

    case "event-based":
      patternData = {
        trigger: pattern.trigger,
        typicalFollowUp: pattern.typicalFollowUp,
        typicalDelaySeconds: pattern.typicalDelaySeconds,
        expirationSeconds: pattern.expirationSeconds,
      };
      break;

    case "context-based":
      patternData = {
        contextKeywords: pattern.contextKeywords,
        relevanceThreshold: pattern.relevanceThreshold,
        typicalNeed: pattern.typicalNeed,
        relatedChunkIds: pattern.relatedChunkIds,
        useSemanticMatching: pattern.useSemanticMatching,
      };
      break;
  }

  return {
    id: pattern.id,
    agent_id: pattern.agentId,
    type: pattern.type,
    description: pattern.description,
    confidence: pattern.confidence,
    observation_count: pattern.observationCount,
    first_observed: pattern.firstObserved.getTime(),
    last_observed: pattern.lastObserved.getTime(),
    active: pattern.active ? 1 : 0,
    linked_reminder_id: pattern.linkedReminderId ?? null,
    data: JSON.stringify(patternData),
    created_at: now,
    updated_at: now,
  };
}

// ============================================================================
// Pattern Tracker
// ============================================================================

/**
 * Options for creating a pattern tracker
 */
export interface PatternTrackerOptions {
  /** SQLite database connection (from memory system) */
  db: DatabaseSync;
  /** Agent ID to scope observations */
  agentId: string;
  /** Pattern configuration (optional, uses defaults) */
  config?: Partial<PatternConfig>;
}

/**
 * Options for querying observations
 */
export interface ObservationQueryOptions {
  /** Filter by pattern type */
  type?: PatternType;
  /** Filter observations after this date */
  after?: Date;
  /** Filter observations before this date */
  before?: Date;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Options for querying patterns
 */
export interface PatternQueryOptions {
  /** Filter by pattern type */
  type?: PatternType;
  /** Only return active patterns */
  activeOnly?: boolean;
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result from recording an observation
 */
export interface RecordObservationResult {
  /** ID of the recorded observation */
  observationId: string;
  /** Any patterns that were updated or created as a result */
  affectedPatterns: Pattern[];
  /** Whether any pattern became active due to this observation */
  newlyActivated: boolean;
}

/**
 * Pattern tracker for observing and managing activity patterns
 *
 * This class integrates with the existing memory system's SQLite database
 * to store observations and patterns. It provides methods for:
 * - Recording observations of user activity
 * - Querying and managing patterns
 * - Pattern lifecycle (activation, archival)
 */
export class PatternTracker {
  private readonly db: DatabaseSync;
  private readonly agentId: string;
  private readonly config: PatternConfig;
  private schemaInitialized = false;

  constructor(options: PatternTrackerOptions) {
    this.db = options.db;
    this.agentId = options.agentId;
    this.config = { ...defaultPatternConfig, ...options.config };
  }

  /**
   * Ensure the pattern schema is initialized
   */
  ensureSchema(): void {
    if (this.schemaInitialized) return;
    this.db.exec(PATTERN_SCHEMA);
    this.schemaInitialized = true;
  }

  /**
   * Record a time-based observation
   *
   * Used when the user performs an action at a particular time,
   * which may contribute to identifying time-based patterns.
   */
  recordTimeObservation(data: { action: string; timestamp?: Date }): RecordObservationResult {
    this.ensureSchema();

    const now = data.timestamp ?? new Date();
    const observation: PatternObservation = {
      type: "time-based",
      agentId: this.agentId,
      timestamp: now,
      data: {
        type: "time-based",
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay() === 0 ? 7 : now.getDay(), // Convert Sunday=0 to Sunday=7
        action: data.action,
      },
    };

    return this.recordObservation(observation);
  }

  /**
   * Record an event-based observation
   *
   * Used when the user performs an action in response to an event,
   * which may contribute to identifying event-based patterns.
   */
  recordEventObservation(data: {
    event: string;
    followUp: string;
    delaySeconds: number;
    timestamp?: Date;
  }): RecordObservationResult {
    this.ensureSchema();

    const observation: PatternObservation = {
      type: "event-based",
      agentId: this.agentId,
      timestamp: data.timestamp ?? new Date(),
      data: {
        type: "event-based",
        event: data.event,
        followUp: data.followUp,
        delaySeconds: data.delaySeconds,
      },
    };

    return this.recordObservation(observation);
  }

  /**
   * Record a context-based observation
   *
   * Used when the user needs something in a particular context,
   * which may contribute to identifying context-based patterns.
   */
  recordContextObservation(data: {
    keywords: string[];
    need: string;
    similarityScore?: number;
    timestamp?: Date;
  }): RecordObservationResult {
    this.ensureSchema();

    const observation: PatternObservation = {
      type: "context-based",
      agentId: this.agentId,
      timestamp: data.timestamp ?? new Date(),
      data: {
        type: "context-based",
        keywords: data.keywords,
        need: data.need,
        similarityScore: data.similarityScore,
      },
    };

    return this.recordObservation(observation);
  }

  /**
   * Record a generic observation
   *
   * Lower-level method that handles any observation type.
   */
  recordObservation(observation: PatternObservation): RecordObservationResult {
    this.ensureSchema();

    // Validate observation belongs to this agent
    if (observation.agentId !== this.agentId) {
      throw new Error(`Observation agent ID mismatch: expected ${this.agentId}`);
    }

    // Insert the observation
    const row = observationToRow(observation);
    this.db
      .prepare(
        `INSERT INTO pattern_observations (id, agent_id, type, timestamp, data, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.agent_id, row.type, row.timestamp, row.data, row.created_at);

    // Find and update related patterns
    const affectedPatterns = this.updatePatternsFromObservation(observation);
    const newlyActivated = affectedPatterns.some(
      (p) => p.active && p.observationCount === this.config.minObservations,
    );

    return {
      observationId: row.id,
      affectedPatterns,
      newlyActivated,
    };
  }

  /**
   * Query observations with optional filters
   */
  queryObservations(options: ObservationQueryOptions = {}): PatternObservation[] {
    this.ensureSchema();

    const conditions: string[] = ["agent_id = ?"];
    const params: (string | number)[] = [this.agentId];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    if (options.after) {
      conditions.push("timestamp >= ?");
      params.push(options.after.getTime());
    }

    if (options.before) {
      conditions.push("timestamp <= ?");
      params.push(options.before.getTime());
    }

    let sql = `SELECT * FROM pattern_observations WHERE ${conditions.join(" AND ")} ORDER BY timestamp DESC`;

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as PatternObservationRow[];
    return rows.map(rowToObservation);
  }

  /**
   * Query patterns with optional filters
   */
  queryPatterns(options: PatternQueryOptions = {}): Pattern[] {
    this.ensureSchema();

    const conditions: string[] = ["agent_id = ?"];
    const params: (string | number)[] = [this.agentId];

    if (options.type) {
      conditions.push("type = ?");
      params.push(options.type);
    }

    if (options.activeOnly) {
      conditions.push("active = 1");
    }

    if (options.minConfidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(options.minConfidence);
    }

    let sql = `SELECT * FROM patterns WHERE ${conditions.join(" AND ")} ORDER BY confidence DESC, observation_count DESC`;

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as PatternRow[];
    return rows.map(rowToPattern);
  }

  /**
   * Get a specific pattern by ID
   */
  getPattern(id: string): Pattern | null {
    this.ensureSchema();

    const row = this.db
      .prepare("SELECT * FROM patterns WHERE id = ? AND agent_id = ?")
      .get(id, this.agentId) as PatternRow | undefined;

    return row ? rowToPattern(row) : null;
  }

  /**
   * Update a pattern's properties
   */
  updatePattern(id: string, updates: Partial<Pattern>): Pattern | null {
    this.ensureSchema();

    const existing = this.getPattern(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      agentId: existing.agentId,
    } as Pattern;
    const row = patternToRow(updated);

    this.db
      .prepare(
        `UPDATE patterns SET
         type = ?, description = ?, confidence = ?, observation_count = ?,
         first_observed = ?, last_observed = ?, active = ?, linked_reminder_id = ?,
         data = ?, updated_at = ?
         WHERE id = ? AND agent_id = ?`,
      )
      .run(
        row.type,
        row.description,
        row.confidence,
        row.observation_count,
        row.first_observed,
        row.last_observed,
        row.active,
        row.linked_reminder_id,
        row.data,
        Date.now(),
        id,
        this.agentId,
      );

    return updated;
  }

  /**
   * Delete a pattern
   */
  deletePattern(id: string): boolean {
    this.ensureSchema();

    const result = this.db
      .prepare("DELETE FROM patterns WHERE id = ? AND agent_id = ?")
      .run(id, this.agentId);

    return result.changes > 0;
  }

  /**
   * Archive inactive patterns based on configuration
   */
  archiveInactivePatterns(): number {
    this.ensureSchema();

    const cutoffMs = Date.now() - this.config.archiveAfterDays * 24 * 60 * 60 * 1000;

    const result = this.db
      .prepare("DELETE FROM patterns WHERE agent_id = ? AND last_observed < ? AND active = 0")
      .run(this.agentId, cutoffMs);

    return Number(result.changes);
  }

  /**
   * Prune old observations to prevent unbounded growth
   *
   * Keeps the most recent observations and deletes older ones.
   */
  pruneObservations(maxObservations: number = 10000): number {
    this.ensureSchema();

    // Count total observations for this agent
    const count = this.db
      .prepare("SELECT COUNT(*) as c FROM pattern_observations WHERE agent_id = ?")
      .get(this.agentId) as { c: number };

    if (count.c <= maxObservations) return 0;

    const toDelete = count.c - maxObservations;

    // Delete oldest observations
    const result = this.db
      .prepare(
        `DELETE FROM pattern_observations WHERE id IN (
           SELECT id FROM pattern_observations
           WHERE agent_id = ?
           ORDER BY timestamp ASC
           LIMIT ?
         )`,
      )
      .run(this.agentId, toDelete);

    return Number(result.changes);
  }

  /**
   * Get statistics about patterns and observations
   */
  getStats(): {
    totalObservations: number;
    totalPatterns: number;
    activePatterns: number;
    byType: Record<PatternType, { observations: number; patterns: number }>;
  } {
    this.ensureSchema();

    const obsTotal = this.db
      .prepare("SELECT COUNT(*) as c FROM pattern_observations WHERE agent_id = ?")
      .get(this.agentId) as { c: number };

    const patternTotal = this.db
      .prepare("SELECT COUNT(*) as c FROM patterns WHERE agent_id = ?")
      .get(this.agentId) as { c: number };

    const activePatterns = this.db
      .prepare("SELECT COUNT(*) as c FROM patterns WHERE agent_id = ? AND active = 1")
      .get(this.agentId) as { c: number };

    const obsByType = this.db
      .prepare(
        "SELECT type, COUNT(*) as c FROM pattern_observations WHERE agent_id = ? GROUP BY type",
      )
      .all(this.agentId) as Array<{ type: PatternType; c: number }>;

    const patternsByType = this.db
      .prepare("SELECT type, COUNT(*) as c FROM patterns WHERE agent_id = ? GROUP BY type")
      .all(this.agentId) as Array<{ type: PatternType; c: number }>;

    const byType: Record<PatternType, { observations: number; patterns: number }> = {
      "time-based": { observations: 0, patterns: 0 },
      "event-based": { observations: 0, patterns: 0 },
      "context-based": { observations: 0, patterns: 0 },
    };

    for (const row of obsByType) {
      byType[row.type].observations = row.c;
    }
    for (const row of patternsByType) {
      byType[row.type].patterns = row.c;
    }

    return {
      totalObservations: obsTotal.c,
      totalPatterns: patternTotal.c,
      activePatterns: activePatterns.c,
      byType,
    };
  }

  /**
   * Update patterns based on a new observation
   *
   * This is where pattern recognition logic lives. It finds or creates
   * patterns that match the observation and updates their statistics.
   */
  private updatePatternsFromObservation(observation: PatternObservation): Pattern[] {
    // Find existing patterns that might match this observation
    const existingPatterns = this.findMatchingPatterns(observation);

    if (existingPatterns.length > 0) {
      // Update existing patterns
      return existingPatterns.map((pattern) => this.incrementPatternObservation(pattern));
    }

    // No matching pattern found - consider creating a new candidate pattern
    // Only create if we've seen similar observations before
    const similarObservations = this.findSimilarObservations(observation);

    if (similarObservations.length >= this.config.minObservations - 1) {
      // Enough similar observations to create a pattern candidate
      const newPattern = this.createPatternFromObservations([...similarObservations, observation]);
      if (newPattern) {
        return [newPattern];
      }
    }

    return [];
  }

  /**
   * Find patterns that match an observation
   */
  private findMatchingPatterns(observation: PatternObservation): Pattern[] {
    const patterns = this.queryPatterns({ type: observation.type });

    return patterns.filter((pattern) => this.doesObservationMatchPattern(observation, pattern));
  }

  /**
   * Check if an observation matches a pattern
   */
  private doesObservationMatchPattern(observation: PatternObservation, pattern: Pattern): boolean {
    if (observation.type !== pattern.type) return false;

    switch (observation.type) {
      case "time-based": {
        const obsData = observation.data as TimeObservationData;
        const timePattern = pattern as TimePattern;

        // Check if observation falls within pattern's time window
        if (timePattern.trigger.kind === "time-of-day") {
          const patternMinutes = timePattern.trigger.hour * 60 + timePattern.trigger.minute;
          const obsMinutes = obsData.hour * 60 + obsData.minute;
          const diff = Math.abs(patternMinutes - obsMinutes);
          const withinTolerance =
            diff <= timePattern.toleranceMinutes || diff >= 24 * 60 - timePattern.toleranceMinutes;

          if (!withinTolerance) return false;
        }

        if (timePattern.trigger.kind === "day-of-week") {
          if (timePattern.trigger.dayOfWeek !== obsData.dayOfWeek) return false;
        }

        // Check action similarity (simple substring match for now)
        return this.areActionsSimilar(obsData.action, timePattern.typicalAction);
      }

      case "event-based": {
        const obsData = observation.data as EventObservationData;
        const eventPattern = pattern as EventPattern;

        // Check if the event matches
        return (
          obsData.event === this.getTriggerEventName(eventPattern) &&
          this.areActionsSimilar(obsData.followUp, eventPattern.typicalFollowUp)
        );
      }

      case "context-based": {
        const obsData = observation.data as ContextObservationData;
        const contextPattern = pattern as ContextPattern;

        // Check keyword overlap
        const keywordMatch = obsData.keywords.some((k) =>
          contextPattern.contextKeywords.some((pk) => k.toLowerCase().includes(pk.toLowerCase())),
        );

        return keywordMatch && this.areActionsSimilar(obsData.need, contextPattern.typicalNeed);
      }

      default:
        return false;
    }
  }

  /**
   * Get event name from an event pattern trigger
   */
  private getTriggerEventName(pattern: EventPattern): string {
    switch (pattern.trigger.kind) {
      case "tool-call":
        return `tool-call:${pattern.trigger.toolName}`;
      case "error":
        return `error:${pattern.trigger.errorType ?? "any"}`;
      case "command":
        return `command:${pattern.trigger.command}`;
      case "session-event":
        return `session:${pattern.trigger.event}`;
      case "user-mention":
        return `mention:${pattern.trigger.keywords.join(",")}`;
    }
  }

  /**
   * Check if two actions are similar (simple heuristic)
   */
  private areActionsSimilar(action1: string, action2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().trim();
    const a1 = normalize(action1);
    const a2 = normalize(action2);

    // Exact match
    if (a1 === a2) return true;

    // One contains the other
    if (a1.includes(a2) || a2.includes(a1)) return true;

    // Word overlap (at least 50% of words match)
    const words1 = new Set(a1.split(/\s+/));
    const words2 = new Set(a2.split(/\s+/));
    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const minSize = Math.min(words1.size, words2.size);

    return minSize > 0 && intersection.size / minSize >= 0.5;
  }

  /**
   * Find observations similar to the given one
   */
  private findSimilarObservations(observation: PatternObservation): PatternObservation[] {
    // Look back at recent observations of the same type
    const recent = this.queryObservations({
      type: observation.type,
      limit: 100,
    });

    return recent.filter((obs) => this.areObservationsSimilar(observation, obs));
  }

  /**
   * Check if two observations are similar
   */
  private areObservationsSimilar(obs1: PatternObservation, obs2: PatternObservation): boolean {
    if (obs1.type !== obs2.type) return false;

    switch (obs1.type) {
      case "time-based": {
        const d1 = obs1.data as TimeObservationData;
        const d2 = obs2.data as TimeObservationData;

        // Similar time (within 30 minutes)
        const mins1 = d1.hour * 60 + d1.minute;
        const mins2 = d2.hour * 60 + d2.minute;
        const timeDiff = Math.abs(mins1 - mins2);
        const timeClose = timeDiff <= 30 || timeDiff >= 24 * 60 - 30;

        return timeClose && this.areActionsSimilar(d1.action, d2.action);
      }

      case "event-based": {
        const d1 = obs1.data as EventObservationData;
        const d2 = obs2.data as EventObservationData;

        return d1.event === d2.event && this.areActionsSimilar(d1.followUp, d2.followUp);
      }

      case "context-based": {
        const d1 = obs1.data as ContextObservationData;
        const d2 = obs2.data as ContextObservationData;

        // Check keyword overlap
        const overlap = d1.keywords.some((k1) =>
          d2.keywords.some((k2) => k1.toLowerCase().includes(k2.toLowerCase())),
        );

        return overlap && this.areActionsSimilar(d1.need, d2.need);
      }

      default:
        return false;
    }
  }

  /**
   * Increment a pattern's observation count and recalculate confidence
   */
  private incrementPatternObservation(pattern: Pattern): Pattern {
    const now = new Date();

    const newObservationCount = pattern.observationCount + 1;
    const newConfidence = calculateConfidence({
      observationCount: newObservationCount,
      daysSinceLastObserved: 0, // Just observed now
      consistencyScore: this.calculateConsistencyScore(pattern),
    });

    const shouldActivate =
      !pattern.active &&
      newConfidence >= this.config.activationThreshold &&
      newObservationCount >= this.config.minObservations;

    const updated = this.updatePattern(pattern.id, {
      observationCount: newObservationCount,
      lastObserved: now,
      confidence: newConfidence,
      active: pattern.active || shouldActivate,
    });

    return updated ?? pattern;
  }

  /**
   * Calculate consistency score for a pattern based on observation regularity
   */
  private calculateConsistencyScore(pattern: Pattern): number {
    // Simple heuristic: more observations = more consistent
    // This could be enhanced with actual interval analysis
    const baseScore = Math.min(1, pattern.observationCount / 10);
    return baseScore;
  }

  /**
   * Create a new pattern from a set of similar observations
   */
  private createPatternFromObservations(observations: PatternObservation[]): Pattern | null {
    if (observations.length === 0) return null;

    const first = observations[0];
    const now = new Date();
    const timestamps = observations.map((o) => o.timestamp.getTime());
    const firstObserved = new Date(Math.min(...timestamps));
    const lastObserved = new Date(Math.max(...timestamps));

    const newConfidence = calculateConfidence({
      observationCount: observations.length,
      daysSinceLastObserved: (now.getTime() - lastObserved.getTime()) / (1000 * 60 * 60 * 24),
      consistencyScore: 0.5, // Initial consistency score
    });

    const id = randomUUID();
    let pattern: Pattern;

    switch (first.type) {
      case "time-based": {
        const timeObs = observations.map((o) => o.data as TimeObservationData);
        const avgHour = Math.round(timeObs.reduce((sum, o) => sum + o.hour, 0) / timeObs.length);
        const avgMinute = Math.round(
          timeObs.reduce((sum, o) => sum + o.minute, 0) / timeObs.length,
        );
        const action = timeObs[0].action;

        pattern = {
          id,
          agentId: this.agentId,
          type: "time-based",
          description: `${action} around ${avgHour}:${avgMinute.toString().padStart(2, "0")}`,
          confidence: newConfidence,
          observationCount: observations.length,
          firstObserved,
          lastObserved,
          active: newConfidence >= this.config.activationThreshold,
          trigger: {
            kind: "time-of-day",
            hour: avgHour,
            minute: avgMinute,
          },
          typicalAction: action,
          toleranceMinutes: 30,
        };
        break;
      }

      case "event-based": {
        const eventObs = observations.map((o) => o.data as EventObservationData);
        const event = eventObs[0].event;
        const followUp = eventObs[0].followUp;
        const avgDelay = Math.round(
          eventObs.reduce((sum, o) => sum + o.delaySeconds, 0) / eventObs.length,
        );

        // Parse event string to determine trigger type
        const [eventType, eventValue] = event.split(":", 2);
        let trigger: EventPattern["trigger"];

        switch (eventType) {
          case "tool-call":
            trigger = { kind: "tool-call", toolName: eventValue };
            break;
          case "error":
            trigger = { kind: "error", errorType: eventValue === "any" ? undefined : eventValue };
            break;
          case "command":
            trigger = { kind: "command", command: eventValue };
            break;
          case "session":
            trigger = {
              kind: "session-event",
              event: eventValue as "start" | "end" | "compact" | "reset",
            };
            break;
          case "mention":
            trigger = { kind: "user-mention", keywords: eventValue.split(",") };
            break;
          default:
            trigger = { kind: "command", command: event };
        }

        pattern = {
          id,
          agentId: this.agentId,
          type: "event-based",
          description: `After ${event}: ${followUp}`,
          confidence: newConfidence,
          observationCount: observations.length,
          firstObserved,
          lastObserved,
          active: newConfidence >= this.config.activationThreshold,
          trigger,
          typicalFollowUp: followUp,
          typicalDelaySeconds: avgDelay,
          expirationSeconds: 3600, // Default 1 hour
        };
        break;
      }

      case "context-based": {
        const contextObs = observations.map((o) => o.data as ContextObservationData);
        const allKeywords = new Set(contextObs.flatMap((o) => o.keywords));
        const need = contextObs[0].need;

        pattern = {
          id,
          agentId: this.agentId,
          type: "context-based",
          description: `When discussing [${[...allKeywords].slice(0, 3).join(", ")}]: ${need}`,
          confidence: newConfidence,
          observationCount: observations.length,
          firstObserved,
          lastObserved,
          active: newConfidence >= this.config.activationThreshold,
          contextKeywords: [...allKeywords],
          relevanceThreshold: 0.4,
          typicalNeed: need,
          useSemanticMatching: true,
        };
        break;
      }

      default:
        return null;
    }

    // Insert the pattern
    const row = patternToRow(pattern);
    this.db
      .prepare(
        `INSERT INTO patterns
         (id, agent_id, type, description, confidence, observation_count,
          first_observed, last_observed, active, linked_reminder_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.agent_id,
        row.type,
        row.description,
        row.confidence,
        row.observation_count,
        row.first_observed,
        row.last_observed,
        row.active,
        row.linked_reminder_id,
        row.data,
        row.created_at,
        row.updated_at,
      );

    return pattern;
  }
}

/**
 * Create a pattern tracker instance
 *
 * Factory function for creating a PatternTracker with the given options.
 * Uses the memory system's SQLite database connection.
 */
export function createPatternTracker(options: PatternTrackerOptions): PatternTracker {
  return new PatternTracker(options);
}
