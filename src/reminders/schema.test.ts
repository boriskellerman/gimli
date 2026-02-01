/**
 * Reminder schema unit tests
 *
 * Tests for SQLite schema creation and helper functions.
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dropReminderSchema,
  ensureReminderSchema,
  getReminderStats,
  hasReminderSchema,
} from "./schema.js";

describe("ensureReminderSchema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates reminders table with required columns", () => {
    ensureReminderSchema(db);

    const columns = db.prepare("PRAGMA table_info(reminders)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;

    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("agent_id");
    expect(columnNames).toContain("title");
    expect(columnNames).toContain("body");
    expect(columnNames).toContain("trigger_type");
    expect(columnNames).toContain("trigger_spec");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("priority");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("triggered_at");
    expect(columnNames).toContain("completed_at");
    expect(columnNames).toContain("snooze_until");
    expect(columnNames).toContain("context_tags");
    expect(columnNames).toContain("quiet_hours_exempt");
    expect(columnNames).toContain("chunk_id");
  });

  it("creates indices for common queries", () => {
    ensureReminderSchema(db);

    const indices = db.prepare("PRAGMA index_list(reminders)").all() as Array<{
      name: string;
    }>;

    const indexNames = indices.map((i) => i.name);

    expect(indexNames).toContain("idx_reminders_agent_id");
    expect(indexNames).toContain("idx_reminders_status");
    expect(indexNames).toContain("idx_reminders_priority");
    expect(indexNames).toContain("idx_reminders_trigger");
    expect(indexNames).toContain("idx_reminders_snooze");
    expect(indexNames).toContain("idx_reminders_chunk");
  });

  it("is idempotent (can be called multiple times)", () => {
    ensureReminderSchema(db);
    ensureReminderSchema(db);
    ensureReminderSchema(db);

    expect(hasReminderSchema(db)).toBe(true);
  });

  it("enforces trigger_type constraint", () => {
    ensureReminderSchema(db);

    // Valid trigger types should work
    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 1706745600000)
    `);

    // Invalid trigger type should fail
    expect(() => {
      db.exec(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
        VALUES ('rem-002', 'main', 'Test', 'invalid', '2026-01-01', 1706745600000)
      `);
    }).toThrow();
  });

  it("enforces status constraint", () => {
    ensureReminderSchema(db);

    // Valid status should work
    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
      VALUES ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 'pending', 1706745600000)
    `);

    // Invalid status should fail
    expect(() => {
      db.exec(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
        VALUES ('rem-002', 'main', 'Test', 'scheduled', '2026-01-01', 'invalid', 1706745600000)
      `);
    }).toThrow();
  });

  it("enforces priority constraint", () => {
    ensureReminderSchema(db);

    // Valid priorities should work
    for (const priority of ["urgent", "normal", "low"]) {
      db.exec(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, priority, created_at)
        VALUES ('rem-${priority}', 'main', 'Test', 'scheduled', '2026-01-01', '${priority}', 1706745600000)
      `);
    }

    // Invalid priority should fail
    expect(() => {
      db.exec(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, priority, created_at)
        VALUES ('rem-bad', 'main', 'Test', 'scheduled', '2026-01-01', 'critical', 1706745600000)
      `);
    }).toThrow();
  });

  it("defaults status to pending", () => {
    ensureReminderSchema(db);

    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 1706745600000)
    `);

    const row = db.prepare("SELECT status FROM reminders WHERE id = 'rem-001'").get() as {
      status: string;
    };
    expect(row.status).toBe("pending");
  });

  it("defaults priority to normal", () => {
    ensureReminderSchema(db);

    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 1706745600000)
    `);

    const row = db.prepare("SELECT priority FROM reminders WHERE id = 'rem-001'").get() as {
      priority: string;
    };
    expect(row.priority).toBe("normal");
  });

  it("defaults quiet_hours_exempt to 0", () => {
    ensureReminderSchema(db);

    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 1706745600000)
    `);

    const row = db
      .prepare("SELECT quiet_hours_exempt FROM reminders WHERE id = 'rem-001'")
      .get() as {
      quiet_hours_exempt: number;
    };
    expect(row.quiet_hours_exempt).toBe(0);
  });
});

describe("dropReminderSchema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("drops the reminders table", () => {
    ensureReminderSchema(db);
    expect(hasReminderSchema(db)).toBe(true);

    dropReminderSchema(db);
    expect(hasReminderSchema(db)).toBe(false);
  });

  it("is safe to call when table does not exist", () => {
    expect(() => dropReminderSchema(db)).not.toThrow();
    expect(hasReminderSchema(db)).toBe(false);
  });
});

describe("hasReminderSchema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns false when table does not exist", () => {
    expect(hasReminderSchema(db)).toBe(false);
  });

  it("returns true when table exists", () => {
    ensureReminderSchema(db);
    expect(hasReminderSchema(db)).toBe(true);
  });
});

describe("getReminderStats", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns zero counts for empty table", () => {
    const stats = getReminderStats(db, "main");

    expect(stats.pending).toBe(0);
    expect(stats.triggered).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.dismissed).toBe(0);
    expect(stats.snoozed).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("counts reminders by status", () => {
    // Insert test data
    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
      VALUES
        ('rem-001', 'main', 'Test 1', 'scheduled', '2026-01-01', 'pending', 1706745600000),
        ('rem-002', 'main', 'Test 2', 'scheduled', '2026-01-01', 'pending', 1706745600000),
        ('rem-003', 'main', 'Test 3', 'scheduled', '2026-01-01', 'triggered', 1706745600000),
        ('rem-004', 'main', 'Test 4', 'scheduled', '2026-01-01', 'completed', 1706745600000),
        ('rem-005', 'main', 'Test 5', 'scheduled', '2026-01-01', 'completed', 1706745600000),
        ('rem-006', 'main', 'Test 6', 'scheduled', '2026-01-01', 'completed', 1706745600000)
    `);

    const stats = getReminderStats(db, "main");

    expect(stats.pending).toBe(2);
    expect(stats.triggered).toBe(1);
    expect(stats.completed).toBe(3);
    expect(stats.dismissed).toBe(0);
    expect(stats.snoozed).toBe(0);
    expect(stats.total).toBe(6);
  });

  it("filters by agent_id", () => {
    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
      VALUES
        ('rem-001', 'main', 'Test 1', 'scheduled', '2026-01-01', 'pending', 1706745600000),
        ('rem-002', 'work', 'Test 2', 'scheduled', '2026-01-01', 'pending', 1706745600000),
        ('rem-003', 'main', 'Test 3', 'scheduled', '2026-01-01', 'completed', 1706745600000)
    `);

    const mainStats = getReminderStats(db, "main");
    expect(mainStats.pending).toBe(1);
    expect(mainStats.completed).toBe(1);
    expect(mainStats.total).toBe(2);

    const workStats = getReminderStats(db, "work");
    expect(workStats.pending).toBe(1);
    expect(workStats.total).toBe(1);
  });

  it("handles all status types", () => {
    db.exec(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
      VALUES
        ('rem-001', 'main', 'Test', 'scheduled', '2026-01-01', 'pending', 1706745600000),
        ('rem-002', 'main', 'Test', 'scheduled', '2026-01-01', 'triggered', 1706745600000),
        ('rem-003', 'main', 'Test', 'scheduled', '2026-01-01', 'completed', 1706745600000),
        ('rem-004', 'main', 'Test', 'scheduled', '2026-01-01', 'dismissed', 1706745600000),
        ('rem-005', 'main', 'Test', 'scheduled', '2026-01-01', 'snoozed', 1706745600000)
    `);

    const stats = getReminderStats(db, "main");

    expect(stats.pending).toBe(1);
    expect(stats.triggered).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.dismissed).toBe(1);
    expect(stats.snoozed).toBe(1);
    expect(stats.total).toBe(5);
  });
});
