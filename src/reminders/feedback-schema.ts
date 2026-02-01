/**
 * Reminder feedback system SQLite schema
 *
 * Extends the reminder system with tables for tracking
 * feedback events and aggregated effectiveness metrics.
 */

import type { DatabaseSync } from "node:sqlite";

import type { ReminderReaction, FeedbackSource } from "./feedback-types.js";

/**
 * Create the reminder_feedback table and indices
 *
 * Should be called after ensureReminderSchema to ensure
 * the reminders table exists for foreign key reference.
 */
export function ensureFeedbackSchema(db: DatabaseSync): void {
  // Create feedback events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminder_feedback (
      id TEXT PRIMARY KEY,
      reminder_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_key TEXT NOT NULL,

      -- When the reminder was shown
      shown_at INTEGER NOT NULL,

      -- User reaction and how it was detected
      reaction TEXT NOT NULL CHECK (reaction IN ('completed', 'dismissed', 'snoozed', 'ignored', 'acted')),
      source TEXT NOT NULL CHECK (source IN ('explicit', 'inferred', 'timeout')),

      -- When feedback was recorded
      recorded_at INTEGER NOT NULL,

      -- Time from showing to reaction (milliseconds)
      reaction_time_ms INTEGER,

      -- Context relevance for context-triggered reminders
      context_relevance_score REAL,

      -- The message that triggered context reminder (if applicable)
      trigger_message TEXT,

      -- User's response after reminder was shown
      user_response TEXT
    );
  `);

  // Indices for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_reminder ON reminder_feedback(reminder_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_agent ON reminder_feedback(agent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_shown ON reminder_feedback(shown_at);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_feedback_reaction ON reminder_feedback(reaction);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_feedback_agent_time ON reminder_feedback(agent_id, shown_at);`,
  );

  // Create effectiveness metrics cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminder_effectiveness (
      reminder_id TEXT PRIMARY KEY,
      total_showings INTEGER NOT NULL DEFAULT 0,

      -- Reaction counts
      completed_count INTEGER NOT NULL DEFAULT 0,
      dismissed_count INTEGER NOT NULL DEFAULT 0,
      snoozed_count INTEGER NOT NULL DEFAULT 0,
      ignored_count INTEGER NOT NULL DEFAULT 0,
      acted_count INTEGER NOT NULL DEFAULT 0,

      -- Calculated rates
      completion_rate REAL NOT NULL DEFAULT 0,
      dismissal_rate REAL NOT NULL DEFAULT 0,

      -- Average metrics
      avg_reaction_time_ms REAL,
      avg_context_relevance REAL,

      -- Overall score and trend
      effectiveness_score REAL NOT NULL DEFAULT 0.5,
      trend TEXT CHECK (trend IN ('improving', 'declining', 'stable')) DEFAULT 'stable',

      -- Recent effectiveness scores for trend calculation (JSON array)
      recent_scores TEXT,

      -- Last calculation timestamp
      last_calculated_at INTEGER NOT NULL
    );
  `);

  // Ensure required columns exist (for migrations)
  ensureColumn(db, "reminder_feedback", "trigger_message", "TEXT");
  ensureColumn(db, "reminder_feedback", "user_response", "TEXT");
  ensureColumn(db, "reminder_effectiveness", "recent_scores", "TEXT");
}

/**
 * Add a column to a table if it doesn't exist
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Drop the feedback tables (for testing)
 */
export function dropFeedbackSchema(db: DatabaseSync): void {
  db.exec(`DROP TABLE IF EXISTS reminder_feedback;`);
  db.exec(`DROP TABLE IF EXISTS reminder_effectiveness;`);
}

/**
 * Check if the feedback tables exist
 */
export function hasFeedbackSchema(db: DatabaseSync): boolean {
  const feedbackTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reminder_feedback'`)
    .get() as { name: string } | undefined;

  const effectivenessTable = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reminder_effectiveness'`)
    .get() as { name: string } | undefined;

  return (
    feedbackTable?.name === "reminder_feedback" &&
    effectivenessTable?.name === "reminder_effectiveness"
  );
}

/**
 * Insert a feedback event
 */
export function insertFeedbackEvent(
  db: DatabaseSync,
  event: {
    id: string;
    reminderId: string;
    agentId: string;
    sessionKey: string;
    shownAt: Date;
    reaction: ReminderReaction;
    source: FeedbackSource;
    recordedAt: Date;
    reactionTimeMs?: number;
    contextRelevanceScore?: number;
    triggerMessage?: string;
    userResponse?: string;
  },
): void {
  db.prepare(`
    INSERT INTO reminder_feedback (
      id, reminder_id, agent_id, session_key,
      shown_at, reaction, source, recorded_at,
      reaction_time_ms, context_relevance_score,
      trigger_message, user_response
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id,
    event.reminderId,
    event.agentId,
    event.sessionKey,
    event.shownAt.getTime(),
    event.reaction,
    event.source,
    event.recordedAt.getTime(),
    event.reactionTimeMs ?? null,
    event.contextRelevanceScore ?? null,
    event.triggerMessage ?? null,
    event.userResponse ?? null,
  );
}

/**
 * Get feedback events for a reminder
 */
export function getFeedbackForReminder(
  db: DatabaseSync,
  reminderId: string,
  limit?: number,
): Array<{
  id: string;
  reminder_id: string;
  agent_id: string;
  session_key: string;
  shown_at: number;
  reaction: ReminderReaction;
  source: FeedbackSource;
  recorded_at: number;
  reaction_time_ms: number | null;
  context_relevance_score: number | null;
  trigger_message: string | null;
  user_response: string | null;
}> {
  const query = limit
    ? `SELECT * FROM reminder_feedback WHERE reminder_id = ? ORDER BY shown_at DESC LIMIT ?`
    : `SELECT * FROM reminder_feedback WHERE reminder_id = ? ORDER BY shown_at DESC`;

  const params = limit ? [reminderId, limit] : [reminderId];

  return db.prepare(query).all(...params) as Array<{
    id: string;
    reminder_id: string;
    agent_id: string;
    session_key: string;
    shown_at: number;
    reaction: ReminderReaction;
    source: FeedbackSource;
    recorded_at: number;
    reaction_time_ms: number | null;
    context_relevance_score: number | null;
    trigger_message: string | null;
    user_response: string | null;
  }>;
}

/**
 * Get feedback events for an agent within a time window
 */
export function getFeedbackForAgent(
  db: DatabaseSync,
  agentId: string,
  sinceMs?: number,
): Array<{
  id: string;
  reminder_id: string;
  agent_id: string;
  session_key: string;
  shown_at: number;
  reaction: ReminderReaction;
  source: FeedbackSource;
  recorded_at: number;
  reaction_time_ms: number | null;
  context_relevance_score: number | null;
}> {
  const query = sinceMs
    ? `SELECT * FROM reminder_feedback WHERE agent_id = ? AND shown_at >= ? ORDER BY shown_at DESC`
    : `SELECT * FROM reminder_feedback WHERE agent_id = ? ORDER BY shown_at DESC`;

  const params = sinceMs ? [agentId, sinceMs] : [agentId];

  return db.prepare(query).all(...params) as Array<{
    id: string;
    reminder_id: string;
    agent_id: string;
    session_key: string;
    shown_at: number;
    reaction: ReminderReaction;
    source: FeedbackSource;
    recorded_at: number;
    reaction_time_ms: number | null;
    context_relevance_score: number | null;
  }>;
}

/**
 * Update or insert effectiveness metrics for a reminder
 */
export function upsertEffectivenessMetrics(
  db: DatabaseSync,
  metrics: {
    reminderId: string;
    totalShowings: number;
    completedCount: number;
    dismissedCount: number;
    snoozedCount: number;
    ignoredCount: number;
    actedCount: number;
    completionRate: number;
    dismissalRate: number;
    avgReactionTimeMs: number | null;
    avgContextRelevance: number | null;
    effectivenessScore: number;
    trend: "improving" | "declining" | "stable";
    recentScores: number[];
  },
): void {
  db.prepare(`
    INSERT INTO reminder_effectiveness (
      reminder_id, total_showings,
      completed_count, dismissed_count, snoozed_count, ignored_count, acted_count,
      completion_rate, dismissal_rate,
      avg_reaction_time_ms, avg_context_relevance,
      effectiveness_score, trend, recent_scores,
      last_calculated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reminder_id) DO UPDATE SET
      total_showings = excluded.total_showings,
      completed_count = excluded.completed_count,
      dismissed_count = excluded.dismissed_count,
      snoozed_count = excluded.snoozed_count,
      ignored_count = excluded.ignored_count,
      acted_count = excluded.acted_count,
      completion_rate = excluded.completion_rate,
      dismissal_rate = excluded.dismissal_rate,
      avg_reaction_time_ms = excluded.avg_reaction_time_ms,
      avg_context_relevance = excluded.avg_context_relevance,
      effectiveness_score = excluded.effectiveness_score,
      trend = excluded.trend,
      recent_scores = excluded.recent_scores,
      last_calculated_at = excluded.last_calculated_at
  `).run(
    metrics.reminderId,
    metrics.totalShowings,
    metrics.completedCount,
    metrics.dismissedCount,
    metrics.snoozedCount,
    metrics.ignoredCount,
    metrics.actedCount,
    metrics.completionRate,
    metrics.dismissalRate,
    metrics.avgReactionTimeMs,
    metrics.avgContextRelevance,
    metrics.effectivenessScore,
    metrics.trend,
    JSON.stringify(metrics.recentScores),
    Date.now(),
  );
}

/**
 * Get effectiveness metrics for a reminder
 */
export function getEffectivenessMetrics(
  db: DatabaseSync,
  reminderId: string,
):
  | {
      reminder_id: string;
      total_showings: number;
      completed_count: number;
      dismissed_count: number;
      snoozed_count: number;
      ignored_count: number;
      acted_count: number;
      completion_rate: number;
      dismissal_rate: number;
      avg_reaction_time_ms: number | null;
      avg_context_relevance: number | null;
      effectiveness_score: number;
      trend: string;
      recent_scores: string | null;
      last_calculated_at: number;
    }
  | undefined {
  return db.prepare(`SELECT * FROM reminder_effectiveness WHERE reminder_id = ?`).get(reminderId) as
    | {
        reminder_id: string;
        total_showings: number;
        completed_count: number;
        dismissed_count: number;
        snoozed_count: number;
        ignored_count: number;
        acted_count: number;
        completion_rate: number;
        dismissal_rate: number;
        avg_reaction_time_ms: number | null;
        avg_context_relevance: number | null;
        effectiveness_score: number;
        trend: string;
        recent_scores: string | null;
        last_calculated_at: number;
      }
    | undefined;
}

/**
 * Get top/bottom performers for an agent
 */
export function getPerformanceRanking(
  db: DatabaseSync,
  agentId: string,
  limit: number = 5,
): {
  top: Array<{ reminderId: string; effectivenessScore: number }>;
  bottom: Array<{ reminderId: string; effectivenessScore: number }>;
} {
  // Get top performers
  const topRows = db
    .prepare(`
    SELECT re.reminder_id, re.effectiveness_score
    FROM reminder_effectiveness re
    JOIN reminders r ON re.reminder_id = r.id
    WHERE r.agent_id = ? AND re.total_showings >= 3
    ORDER BY re.effectiveness_score DESC
    LIMIT ?
  `)
    .all(agentId, limit) as Array<{ reminder_id: string; effectiveness_score: number }>;

  // Get bottom performers
  const bottomRows = db
    .prepare(`
    SELECT re.reminder_id, re.effectiveness_score
    FROM reminder_effectiveness re
    JOIN reminders r ON re.reminder_id = r.id
    WHERE r.agent_id = ? AND re.total_showings >= 3
    ORDER BY re.effectiveness_score ASC
    LIMIT ?
  `)
    .all(agentId, limit) as Array<{ reminder_id: string; effectiveness_score: number }>;

  return {
    top: topRows.map((r) => ({
      reminderId: r.reminder_id,
      effectivenessScore: r.effectiveness_score,
    })),
    bottom: bottomRows.map((r) => ({
      reminderId: r.reminder_id,
      effectivenessScore: r.effectiveness_score,
    })),
  };
}

/**
 * Get aggregate feedback stats for an agent
 */
export function getAgentFeedbackStats(
  db: DatabaseSync,
  agentId: string,
  sinceDays: number = 14,
): {
  totalShowings: number;
  uniqueReminders: number;
  byReaction: Record<string, number>;
  avgCompletionRate: number;
  avgDismissalRate: number;
} {
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  // Total showings
  const totalRow = db
    .prepare(`
    SELECT COUNT(*) as count
    FROM reminder_feedback
    WHERE agent_id = ? AND shown_at >= ?
  `)
    .get(agentId, sinceMs) as { count: number };

  // Unique reminders
  const uniqueRow = db
    .prepare(`
    SELECT COUNT(DISTINCT reminder_id) as count
    FROM reminder_feedback
    WHERE agent_id = ? AND shown_at >= ?
  `)
    .get(agentId, sinceMs) as { count: number };

  // By reaction
  const reactionRows = db
    .prepare(`
    SELECT reaction, COUNT(*) as count
    FROM reminder_feedback
    WHERE agent_id = ? AND shown_at >= ?
    GROUP BY reaction
  `)
    .all(agentId, sinceMs) as Array<{ reaction: string; count: number }>;

  const byReaction: Record<string, number> = {
    completed: 0,
    dismissed: 0,
    snoozed: 0,
    ignored: 0,
    acted: 0,
  };
  for (const row of reactionRows) {
    byReaction[row.reaction] = row.count;
  }

  const total = totalRow.count || 1; // Avoid division by zero
  const avgCompletionRate = byReaction.completed / total;
  const avgDismissalRate = byReaction.dismissed / total;

  return {
    totalShowings: totalRow.count,
    uniqueReminders: uniqueRow.count,
    byReaction,
    avgCompletionRate,
    avgDismissalRate,
  };
}

/**
 * Clean up old feedback events beyond retention period
 */
export function cleanupOldFeedback(db: DatabaseSync, retentionDays: number = 90): number {
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const result = db
    .prepare(`
    DELETE FROM reminder_feedback WHERE shown_at < ?
  `)
    .run(cutoffMs);

  return Number(result.changes);
}
