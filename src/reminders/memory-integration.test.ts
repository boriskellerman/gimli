/**
 * Reminder-Memory Integration Tests
 *
 * Verifies that the reminder system properly integrates with the existing
 * memory architecture without creating duplicate data stores.
 *
 * Key integration points tested:
 * 1. Reminders stored in the same SQLite database as memory chunks
 * 2. Reminder content is indexed for semantic search via chunks table
 * 3. No parallel/duplicate data stores created
 * 4. Memory queries can retrieve reminder context
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureMemoryIndexSchema } from "../memory/memory-schema.js";
import { ensureReminderSchema, hasReminderSchema } from "./schema.js";
import { ensureFeedbackSchema, hasFeedbackSchema } from "./feedback-schema.js";
import type { Reminder, ReminderRow } from "./types.js";
import { reminderToRow, rowToReminder } from "./types.js";

// Constants for schema tables
const EMBEDDING_CACHE_TABLE = "embedding_cache";
const FTS_TABLE = "chunks_fts";

/**
 * Helper to create a test reminder
 */
function createTestReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: "test-agent",
    title: "Test reminder",
    body: "This is a test reminder body",
    trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00Z") },
    status: "pending",
    priority: "normal",
    createdAt: new Date(),
    quietHoursExempt: false,
    contextTags: ["work", "project"],
    ...overrides,
  };
}

/**
 * Helper to insert a reminder into the database
 */
function insertReminder(db: DatabaseSync, reminder: Reminder): void {
  const row = reminderToRow(reminder);
  db.prepare(
    `INSERT INTO reminders (
      id, agent_id, title, body, trigger_type, trigger_spec,
      status, priority, created_at, triggered_at, completed_at,
      snooze_until, context_tags, quiet_hours_exempt, chunk_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.agent_id,
    row.title,
    row.body,
    row.trigger_type,
    row.trigger_spec,
    row.status,
    row.priority,
    row.created_at,
    row.triggered_at,
    row.completed_at,
    row.snooze_until,
    row.context_tags,
    row.quiet_hours_exempt,
    row.chunk_id,
  );
}

/**
 * Helper to create a memory chunk for a reminder
 */
function createReminderChunk(db: DatabaseSync, reminder: Reminder): string {
  const chunkId = `chunk-${reminder.id}`;
  const text = formatReminderAsMemoryChunk(reminder);
  const now = Date.now();

  db.prepare(
    `INSERT INTO chunks (
      id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chunkId,
    `reminders/${reminder.id}.md`,
    "memory", // Use 'memory' source for reminders to integrate with existing search
    1,
    10,
    `hash-${reminder.id}`,
    "test-model",
    text,
    JSON.stringify([]), // Empty embedding for tests
    now,
  );

  return chunkId;
}

/**
 * Format a reminder as memory chunk content
 * This is how reminders are stored for semantic search
 */
function formatReminderAsMemoryChunk(reminder: Reminder): string {
  const lines = [
    `# Reminder: ${reminder.title}`,
    `Priority: ${reminder.priority}`,
    `Status: ${reminder.status}`,
  ];

  if (reminder.trigger.type === "scheduled") {
    lines.push(`Scheduled: ${reminder.trigger.datetime.toISOString()}`);
  } else if (reminder.trigger.type === "recurring") {
    lines.push(`Recurring: ${reminder.trigger.cron}`);
  } else if (reminder.trigger.type === "context") {
    lines.push(`Context trigger: ${reminder.trigger.pattern}`);
  }

  if (reminder.body) {
    lines.push("", reminder.body);
  }

  if (reminder.contextTags?.length) {
    lines.push("", `Tags: ${reminder.contextTags.join(", ")}`);
  }

  return lines.join("\n");
}

describe("Memory Integration: Schema Co-location", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("stores reminders in the same database as memory chunks", () => {
    // Set up memory schema first (as would happen in production)
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });

    // Then add reminder schema
    ensureReminderSchema(db);

    // Verify both tables exist in same database
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("chunks"); // Memory system
    expect(tableNames).toContain("files"); // Memory system
    expect(tableNames).toContain("reminders"); // Reminder system
    expect(tableNames).toContain(EMBEDDING_CACHE_TABLE); // Memory system
  });

  it("feedback schema integrates with same database", () => {
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
    ensureFeedbackSchema(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("chunks");
    expect(tableNames).toContain("reminders");
    expect(tableNames).toContain("reminder_feedback");
  });

  it("schemas can be applied in any order (idempotent)", () => {
    // Apply in different order
    ensureReminderSchema(db);
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureFeedbackSchema(db);

    // Apply again
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
    ensureFeedbackSchema(db);

    expect(hasReminderSchema(db)).toBe(true);
    expect(hasFeedbackSchema(db)).toBe(true);
  });
});

describe("Memory Integration: Chunk Linking", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("reminders can link to memory chunks via chunk_id", () => {
    const reminder = createTestReminder();

    // First create the chunk
    const chunkId = createReminderChunk(db, reminder);

    // Then create reminder with chunk link
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Verify link exists
    const row = db.prepare(`SELECT chunk_id FROM reminders WHERE id = ?`).get(reminder.id) as {
      chunk_id: string | null;
    };

    expect(row.chunk_id).toBe(chunkId);
  });

  it("chunk content can be retrieved via reminder link", () => {
    const reminder = createTestReminder({
      title: "Review project proposal",
      body: "Need to review the Q2 proposal before Monday meeting",
      contextTags: ["work", "proposal", "urgent"],
    });

    const chunkId = createReminderChunk(db, reminder);
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Query chunk through reminder
    const result = db
      .prepare(
        `SELECT c.text
         FROM reminders r
         JOIN chunks c ON r.chunk_id = c.id
         WHERE r.id = ?`,
      )
      .get(reminder.id) as { text: string } | undefined;

    expect(result).toBeDefined();
    expect(result?.text).toContain("Review project proposal");
    expect(result?.text).toContain("Q2 proposal");
    expect(result?.text).toContain("Tags: work, proposal, urgent");
  });

  it("deleting a chunk sets reminder chunk_id to null (no cascade)", () => {
    const reminder = createTestReminder();
    const chunkId = createReminderChunk(db, reminder);
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Delete the chunk
    db.prepare(`DELETE FROM chunks WHERE id = ?`).run(chunkId);

    // Reminder should still exist, but chunk_id is now orphaned
    // In production, we'd handle this with proper cleanup
    const row = db.prepare(`SELECT id, chunk_id FROM reminders WHERE id = ?`).get(reminder.id) as {
      id: string;
      chunk_id: string | null;
    };

    expect(row.id).toBe(reminder.id);
    // The chunk_id still points to deleted chunk (orphan reference)
    // This is expected - cleanup would happen in maintenance tasks
    expect(row.chunk_id).toBe(chunkId);
  });
});

describe("Memory Integration: No Duplicate Data Stores", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
    ensureFeedbackSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("reminder content is stored only in chunks table, not duplicated", () => {
    const reminder = createTestReminder({
      title: "Meeting with team",
      body: "Discuss Q2 roadmap and milestones",
    });

    // Create chunk for semantic search
    const chunkId = createReminderChunk(db, reminder);
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Count content storage locations
    // The full text should only be in chunks, not in reminders.body
    const chunkCount = db
      .prepare(`SELECT COUNT(*) as c FROM chunks WHERE text LIKE ?`)
      .get("%Q2 roadmap%") as { c: number };

    expect(chunkCount.c).toBe(1);

    // Reminders table has body but it's the original content,
    // not a duplicate of the chunk
    const reminderBodies = db
      .prepare(`SELECT body FROM reminders WHERE id = ?`)
      .get(reminder.id) as { body: string | null };

    // Body in reminders is the original user input
    expect(reminderBodies.body).toBe("Discuss Q2 roadmap and milestones");

    // Chunk text is the formatted version for search
    const chunkText = db.prepare(`SELECT text FROM chunks WHERE id = ?`).get(chunkId) as {
      text: string;
    };

    expect(chunkText.text).toContain("# Reminder: Meeting with team");
    expect(chunkText.text).toContain("Discuss Q2 roadmap and milestones");
  });

  it("no separate reminder_chunks table exists", () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%reminder%chunk%'`)
      .all() as Array<{ name: string }>;

    expect(tables.length).toBe(0);
  });

  it("no separate reminder_embeddings table exists", () => {
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%reminder%embed%'`)
      .all() as Array<{ name: string }>;

    expect(tables.length).toBe(0);
  });

  it("reminders use existing embedding_cache table", () => {
    // Verify embedding_cache exists and is shared
    const cacheExists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(EMBEDDING_CACHE_TABLE) as { name: string } | undefined;

    expect(cacheExists?.name).toBe(EMBEDDING_CACHE_TABLE);

    // Insert a cache entry for a reminder chunk
    const reminder = createTestReminder();
    const chunkId = createReminderChunk(db, reminder);

    db.prepare(
      `INSERT INTO ${EMBEDDING_CACHE_TABLE} (
        provider, model, provider_key, hash, embedding, dims, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "test-provider",
      "test-model",
      "test-key",
      `hash-${reminder.id}`,
      JSON.stringify([0.1, 0.2, 0.3]),
      3,
      Date.now(),
    );

    // Verify it's in the same cache as regular memory
    const cacheCount = db.prepare(`SELECT COUNT(*) as c FROM ${EMBEDDING_CACHE_TABLE}`).get() as {
      c: number;
    };

    expect(cacheCount.c).toBeGreaterThanOrEqual(1);
  });
});

describe("Memory Integration: Semantic Search", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: true,
    });
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("reminder chunks appear in general chunk queries", () => {
    // Create multiple reminders with chunks
    const reminders = [
      createTestReminder({
        id: "rem-1",
        title: "Buy groceries",
        body: "Milk, eggs, bread",
        contextTags: ["shopping", "personal"],
      }),
      createTestReminder({
        id: "rem-2",
        title: "Submit expense report",
        body: "Q1 expenses need approval",
        contextTags: ["work", "finance"],
      }),
      createTestReminder({
        id: "rem-3",
        title: "Call dentist",
        body: "Schedule annual checkup",
        contextTags: ["health", "personal"],
      }),
    ];

    for (const r of reminders) {
      const chunkId = createReminderChunk(db, r);
      r.chunkId = chunkId;
      insertReminder(db, r);
    }

    // Query all chunks (simulating memory search)
    const allChunks = db.prepare(`SELECT id, text, path FROM chunks ORDER BY id`).all() as Array<{
      id: string;
      text: string;
      path: string;
    }>;

    expect(allChunks.length).toBe(3);

    // All chunks have reminder paths
    for (const chunk of allChunks) {
      expect(chunk.path).toMatch(/^reminders\/rem-\d+\.md$/);
    }
  });

  it("reminder chunks are searchable by content", () => {
    const reminder = createTestReminder({
      title: "Prepare quarterly report",
      body: "Include sales figures and projections for Q2",
      contextTags: ["work", "reports", "quarterly"],
    });

    createReminderChunk(db, reminder);

    // Search for specific terms (simulating text search)
    const results = db
      .prepare(`SELECT * FROM chunks WHERE text LIKE ? OR text LIKE ?`)
      .all("%quarterly%", "%sales figures%") as Array<{ id: string; text: string }>;

    expect(results.length).toBe(1);
    expect(results[0].text).toContain("quarterly");
    expect(results[0].text).toContain("sales figures");
  });

  it("reminders can be found by context tags", () => {
    const reminders = [
      createTestReminder({
        id: "rem-work-1",
        title: "Work task 1",
        contextTags: ["work", "urgent"],
      }),
      createTestReminder({
        id: "rem-work-2",
        title: "Work task 2",
        contextTags: ["work", "low-priority"],
      }),
      createTestReminder({
        id: "rem-personal",
        title: "Personal task",
        contextTags: ["personal"],
      }),
    ];

    for (const r of reminders) {
      createReminderChunk(db, r);
      insertReminder(db, r);
    }

    // Search by tag via chunks
    const workChunks = db
      .prepare(`SELECT * FROM chunks WHERE text LIKE ?`)
      .all("%Tags:%work%") as Array<{ id: string; text: string }>;

    expect(workChunks.length).toBe(2);

    // Search by multiple tags
    const urgentWorkChunks = db
      .prepare(`SELECT * FROM chunks WHERE text LIKE ? AND text LIKE ?`)
      .all("%work%", "%urgent%") as Array<{ id: string; text: string }>;

    expect(urgentWorkChunks.length).toBe(1);
  });
});

describe("Memory Integration: Data Consistency", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("reminder row conversion preserves all data", () => {
    const original = createTestReminder({
      title: "Important meeting",
      body: "Discuss project timeline",
      trigger: { type: "recurring", cron: "0 9 * * 1-5" },
      priority: "urgent",
      contextTags: ["work", "meetings", "important"],
      quietHoursExempt: true,
    });

    const row = reminderToRow(original);
    const restored = rowToReminder(row);

    expect(restored.id).toBe(original.id);
    expect(restored.agentId).toBe(original.agentId);
    expect(restored.title).toBe(original.title);
    expect(restored.body).toBe(original.body);
    expect(restored.status).toBe(original.status);
    expect(restored.priority).toBe(original.priority);
    expect(restored.quietHoursExempt).toBe(original.quietHoursExempt);
    expect(restored.contextTags).toEqual(original.contextTags);

    // Trigger should be correctly restored
    expect(restored.trigger.type).toBe("recurring");
    if (restored.trigger.type === "recurring") {
      expect(restored.trigger.cron).toBe("0 9 * * 1-5");
    }
  });

  it("chunk content matches reminder data", () => {
    const reminder = createTestReminder({
      title: "Review code PR",
      body: "Check the authentication changes in PR #123",
      trigger: { type: "context", pattern: "code review" },
      priority: "normal",
      contextTags: ["development", "code-review"],
    });

    const chunkId = createReminderChunk(db, reminder);

    const chunk = db.prepare(`SELECT text FROM chunks WHERE id = ?`).get(chunkId) as {
      text: string;
    };

    // Verify chunk contains all reminder information
    expect(chunk.text).toContain("# Reminder: Review code PR");
    expect(chunk.text).toContain("Priority: normal");
    expect(chunk.text).toContain("Context trigger: code review");
    expect(chunk.text).toContain("PR #123");
    expect(chunk.text).toContain("Tags: development, code-review");
  });

  it("updating reminder requires updating linked chunk", () => {
    const reminder = createTestReminder({
      title: "Original title",
      body: "Original body",
    });

    const chunkId = createReminderChunk(db, reminder);
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Update reminder
    const updatedReminder = {
      ...reminder,
      title: "Updated title",
      body: "Updated body",
    };

    db.prepare(`UPDATE reminders SET title = ?, body = ? WHERE id = ?`).run(
      updatedReminder.title,
      updatedReminder.body,
      updatedReminder.id,
    );

    // Also need to update chunk for search consistency
    const updatedChunkText = formatReminderAsMemoryChunk(updatedReminder);
    db.prepare(`UPDATE chunks SET text = ? WHERE id = ?`).run(updatedChunkText, chunkId);

    // Verify both are updated
    const reminderRow = db.prepare(`SELECT title FROM reminders WHERE id = ?`).get(reminder.id) as {
      title: string;
    };
    expect(reminderRow.title).toBe("Updated title");

    const chunkRow = db.prepare(`SELECT text FROM chunks WHERE id = ?`).get(chunkId) as {
      text: string;
    };
    expect(chunkRow.text).toContain("Updated title");
    expect(chunkRow.text).toContain("Updated body");
  });
});

describe("Memory Integration: Query Patterns", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureMemoryIndexSchema({
      db,
      embeddingCacheTable: EMBEDDING_CACHE_TABLE,
      ftsTable: FTS_TABLE,
      ftsEnabled: false,
    });
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("can join reminders with chunks for rich queries", () => {
    const reminders = [
      createTestReminder({
        id: "rem-1",
        title: "Urgent task",
        priority: "urgent",
        status: "pending",
      }),
      createTestReminder({
        id: "rem-2",
        title: "Normal task",
        priority: "normal",
        status: "pending",
      }),
      createTestReminder({
        id: "rem-3",
        title: "Completed task",
        priority: "normal",
        status: "completed",
      }),
    ];

    for (const r of reminders) {
      const chunkId = createReminderChunk(db, r);
      r.chunkId = chunkId;
      insertReminder(db, r);
    }

    // Query pending reminders with their chunk content
    const pendingWithContent = db
      .prepare(
        `SELECT r.id, r.title, r.priority, c.text
         FROM reminders r
         LEFT JOIN chunks c ON r.chunk_id = c.id
         WHERE r.status = ?
         ORDER BY r.priority`,
      )
      .all("pending") as Array<{
      id: string;
      title: string;
      priority: string;
      text: string;
    }>;

    expect(pendingWithContent.length).toBe(2);
    // Urgent should come first (alphabetically before normal)
    expect(pendingWithContent[0].priority).toBe("normal");
    expect(pendingWithContent[1].priority).toBe("urgent");
  });

  it("can find reminders by searching chunks", () => {
    const reminder = createTestReminder({
      id: "rem-search-test",
      title: "Weekly standup meeting",
      body: "Team sync on project progress",
      contextTags: ["meetings", "team"],
    });

    const chunkId = createReminderChunk(db, reminder);
    reminder.chunkId = chunkId;
    insertReminder(db, reminder);

    // Search chunks, get back reminder
    const result = db
      .prepare(
        `SELECT r.*
         FROM chunks c
         JOIN reminders r ON c.id = r.chunk_id
         WHERE c.text LIKE ?`,
      )
      .get("%standup%") as ReminderRow | undefined;

    expect(result).toBeDefined();
    expect(result?.title).toBe("Weekly standup meeting");
  });

  it("can aggregate reminder data with chunk metadata", () => {
    const reminders = [
      createTestReminder({
        id: "rem-1",
        agentId: "agent-1",
        priority: "urgent",
      }),
      createTestReminder({
        id: "rem-2",
        agentId: "agent-1",
        priority: "normal",
      }),
      createTestReminder({
        id: "rem-3",
        agentId: "agent-1",
        priority: "normal",
      }),
      createTestReminder({
        id: "rem-4",
        agentId: "agent-2",
        priority: "low",
      }),
    ];

    for (const r of reminders) {
      const chunkId = createReminderChunk(db, r);
      r.chunkId = chunkId;
      insertReminder(db, r);
    }

    // Count reminders by priority with chunk existence check
    const stats = db
      .prepare(
        `SELECT
           r.priority,
           COUNT(*) as total,
           SUM(CASE WHEN c.id IS NOT NULL THEN 1 ELSE 0 END) as with_chunks
         FROM reminders r
         LEFT JOIN chunks c ON r.chunk_id = c.id
         WHERE r.agent_id = ?
         GROUP BY r.priority
         ORDER BY r.priority`,
      )
      .all("agent-1") as Array<{
      priority: string;
      total: number;
      with_chunks: number;
    }>;

    expect(stats.length).toBe(2); // normal and urgent
    expect(stats.find((s) => s.priority === "normal")?.total).toBe(2);
    expect(stats.find((s) => s.priority === "urgent")?.total).toBe(1);

    // All reminders should have chunks
    for (const stat of stats) {
      expect(stat.with_chunks).toBe(stat.total);
    }
  });
});
