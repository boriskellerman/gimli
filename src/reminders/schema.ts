/**
 * Reminder system SQLite schema
 *
 * Extends the existing memory database with a reminders table
 * that links to memory chunks for semantic search.
 */

import type { DatabaseSync } from "node:sqlite";

/**
 * Create the reminders table and indices
 *
 * Should be called after ensureMemoryIndexSchema to ensure
 * the chunks table exists for foreign key reference.
 */
export function ensureReminderSchema(db: DatabaseSync): void {
  // Create reminders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,

      -- Reminder content
      title TEXT NOT NULL,
      body TEXT,

      -- Trigger configuration
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'recurring', 'context')),
      trigger_spec TEXT NOT NULL,

      -- Status tracking
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'completed', 'dismissed', 'snoozed')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'normal', 'low')),

      -- Timing
      created_at INTEGER NOT NULL,
      triggered_at INTEGER,
      completed_at INTEGER,
      snooze_until INTEGER,

      -- Context for smart delivery
      context_tags TEXT,
      quiet_hours_exempt INTEGER NOT NULL DEFAULT 0,

      -- Link to memory chunk for semantic search
      chunk_id TEXT
    );
  `);

  // Create indices for common queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_agent_id ON reminders(agent_id);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_priority ON reminders(priority);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_reminders_trigger ON reminders(trigger_type, trigger_spec);`,
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_snooze ON reminders(snooze_until);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reminders_chunk ON reminders(chunk_id);`);

  // Ensure required columns exist (for migrations)
  ensureColumn(db, "reminders", "body", "TEXT");
  ensureColumn(db, "reminders", "context_tags", "TEXT");
  ensureColumn(db, "reminders", "quiet_hours_exempt", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "reminders", "chunk_id", "TEXT");
}

/**
 * Add a column to the reminders table if it doesn't exist
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Drop the reminders table (for testing)
 */
export function dropReminderSchema(db: DatabaseSync): void {
  db.exec(`DROP TABLE IF EXISTS reminders;`);
}

/**
 * Check if the reminders table exists
 */
export function hasReminderSchema(db: DatabaseSync): boolean {
  const result = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reminders'`)
    .get() as { name: string } | undefined;
  return result?.name === "reminders";
}

/**
 * Get count of reminders by status for an agent
 */
export function getReminderStats(db: DatabaseSync, agentId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM reminders
       WHERE agent_id = ?
       GROUP BY status`,
    )
    .all(agentId) as Array<{ status: string; count: number }>;

  const stats: Record<string, number> = {
    pending: 0,
    triggered: 0,
    completed: 0,
    dismissed: 0,
    snoozed: 0,
    total: 0,
  };

  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }

  return stats;
}
