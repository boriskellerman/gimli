import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  loadJournalEntries,
  appendJournalEntry,
  logLearningAdded,
  logLearningUpdated,
  logLearningRemoved,
  logFeedbackRecorded,
  logPatternDetected,
  logCheckpointCreated,
  queryJournal,
  queryByDateRange,
  queryByEventType,
  queryByTopic,
  getJournalSummary,
  getTodayEntries,
  getRecentEntries,
  clearJournal,
  exportJournalAsText,
  resolveJournalPath,
  type JournalEntry,
  type JournalQuery,
} from "./journal.js";

// Mock the config paths module
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => testDir,
}));

// Mock the routing module
vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: (id: string) => id.replace(/[^a-zA-Z0-9-_]/g, "_"),
}));

let testDir: string;
const testAgentId = "test-agent";

// Helper to create entries with specific timestamps
async function createEntry(
  agentId: string,
  overrides: Partial<Omit<JournalEntry, "id" | "timestamp">> & { timestamp?: string },
): Promise<JournalEntry> {
  const entry = await appendJournalEntry(agentId, {
    eventType: "learning_added",
    source: "conversation",
    content: "Test content",
    ...overrides,
  });

  // If a specific timestamp was provided, we need to update the file
  if (overrides.timestamp) {
    const entries = await loadJournalEntries(agentId);
    const lastEntry = entries[entries.length - 1];
    lastEntry.timestamp = overrides.timestamp;

    // Rewrite the file
    const filePath = resolveJournalPath(agentId);
    const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.writeFile(filePath, content, "utf8");

    return lastEntry;
  }

  return entry;
}

// Helper to create a date offset from now
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-journal-test-"));
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("loadJournalEntries", () => {
  it("returns empty array for non-existent file", async () => {
    const entries = await loadJournalEntries(testAgentId);
    expect(entries).toEqual([]);
  });

  it("loads entries from JSONL file", async () => {
    await createEntry(testAgentId, { content: "First entry" });
    await createEntry(testAgentId, { content: "Second entry" });

    const entries = await loadJournalEntries(testAgentId);

    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe("First entry");
    expect(entries[1].content).toBe("Second entry");
  });
});

describe("appendJournalEntry", () => {
  it("creates file if it does not exist", async () => {
    const entry = await appendJournalEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      content: "Test content",
    });

    expect(entry.id).toMatch(/^jrn_/);
    expect(entry.timestamp).toBeDefined();
    expect(entry.eventType).toBe("learning_added");
    expect(entry.source).toBe("conversation");
    expect(entry.content).toBe("Test content");
  });

  it("appends to existing file", async () => {
    await appendJournalEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      content: "First",
    });

    await appendJournalEntry(testAgentId, {
      eventType: "feedback_recorded",
      source: "feedback",
      content: "Second",
    });

    const entries = await loadJournalEntries(testAgentId);
    expect(entries).toHaveLength(2);
  });

  it("includes optional fields when provided", async () => {
    const entry = await appendJournalEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      content: "Test",
      category: "preference",
      confidence: "high",
      topic: "coding style",
      learningId: "l_123",
      sessionId: "s_456",
      metadata: { extra: "data" },
    });

    expect(entry.category).toBe("preference");
    expect(entry.confidence).toBe("high");
    expect(entry.topic).toBe("coding style");
    expect(entry.learningId).toBe("l_123");
    expect(entry.sessionId).toBe("s_456");
    expect(entry.metadata).toEqual({ extra: "data" });
  });
});

describe("logLearningAdded", () => {
  it("creates a learning_added event", async () => {
    const entry = await logLearningAdded(testAgentId, {
      source: "conversation",
      category: "preference",
      confidence: "high",
      content: "User prefers TypeScript",
      topic: "language preference",
      learningId: "l_123",
      sessionId: "s_456",
    });

    expect(entry.eventType).toBe("learning_added");
    expect(entry.source).toBe("conversation");
    expect(entry.category).toBe("preference");
    expect(entry.confidence).toBe("high");
    expect(entry.content).toBe("User prefers TypeScript");
    expect(entry.topic).toBe("language preference");
  });
});

describe("logLearningUpdated", () => {
  it("creates a learning_updated event", async () => {
    const entry = await logLearningUpdated(testAgentId, {
      source: "conversation",
      learningId: "l_123",
      content: "Updated preference",
      previousContent: "Old preference",
    });

    expect(entry.eventType).toBe("learning_updated");
    expect(entry.learningId).toBe("l_123");
    expect(entry.metadata?.previousContent).toBe("Old preference");
  });
});

describe("logLearningRemoved", () => {
  it("creates a learning_removed event", async () => {
    const entry = await logLearningRemoved(testAgentId, {
      source: "system",
      learningId: "l_123",
      content: "Removed learning content",
      reason: "Outdated",
    });

    expect(entry.eventType).toBe("learning_removed");
    expect(entry.learningId).toBe("l_123");
    expect(entry.metadata?.reason).toBe("Outdated");
  });
});

describe("logFeedbackRecorded", () => {
  it("creates a feedback_recorded event", async () => {
    const entry = await logFeedbackRecorded(testAgentId, {
      feedbackType: "positive",
      content: "User gave thumbs up",
      sessionId: "s_123",
    });

    expect(entry.eventType).toBe("feedback_recorded");
    expect(entry.source).toBe("feedback");
    expect(entry.metadata?.feedbackType).toBe("positive");
  });
});

describe("logPatternDetected", () => {
  it("creates a pattern_detected event", async () => {
    const entry = await logPatternDetected(testAgentId, {
      content: "User frequently asks about TypeScript",
      topic: "language",
      confidence: "medium",
    });

    expect(entry.eventType).toBe("pattern_detected");
    expect(entry.source).toBe("pattern");
    expect(entry.category).toBe("pattern");
    expect(entry.topic).toBe("language");
  });
});

describe("logCheckpointCreated", () => {
  it("creates a checkpoint_created event", async () => {
    const entry = await logCheckpointCreated(testAgentId, {
      checkpointId: "cp_123",
      learningCount: 42,
    });

    expect(entry.eventType).toBe("checkpoint_created");
    expect(entry.source).toBe("system");
    expect(entry.content).toBe("Checkpoint cp_123 created with 42 learnings");
    expect(entry.metadata?.checkpointId).toBe("cp_123");
    expect(entry.metadata?.learningCount).toBe(42);
  });
});

describe("queryJournal", () => {
  beforeEach(async () => {
    // Create various test entries
    await createEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      category: "preference",
      content: "Prefers TypeScript",
      topic: "language",
      timestamp: daysAgo(5),
    });
    await createEntry(testAgentId, {
      eventType: "feedback_recorded",
      source: "feedback",
      content: "Positive feedback",
      timestamp: daysAgo(3),
    });
    await createEntry(testAgentId, {
      eventType: "learning_added",
      source: "pattern",
      category: "pattern",
      content: "Uses async/await",
      topic: "coding style",
      timestamp: daysAgo(1),
    });
  });

  it("returns all entries when no filters provided", async () => {
    const entries = await queryJournal(testAgentId);
    expect(entries).toHaveLength(3);
  });

  it("filters by event type", async () => {
    const entries = await queryJournal(testAgentId, {
      eventTypes: ["learning_added"],
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.eventType === "learning_added")).toBe(true);
  });

  it("filters by source", async () => {
    const entries = await queryJournal(testAgentId, {
      sources: ["conversation"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("conversation");
  });

  it("filters by category", async () => {
    const entries = await queryJournal(testAgentId, {
      categories: ["preference"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].category).toBe("preference");
  });

  it("filters by topic (partial match)", async () => {
    const entries = await queryJournal(testAgentId, {
      topic: "lang",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].topic).toBe("language");
  });

  it("filters by content (partial match)", async () => {
    const entries = await queryJournal(testAgentId, {
      content: "typescript",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain("TypeScript");
  });

  it("filters by date range", async () => {
    const entries = await queryJournal(testAgentId, {
      startDate: daysAgo(4),
      endDate: daysAgo(2),
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Positive feedback");
  });

  it("applies limit", async () => {
    const entries = await queryJournal(testAgentId, { limit: 2 });
    expect(entries).toHaveLength(2);
  });

  it("applies offset for pagination", async () => {
    const all = await queryJournal(testAgentId);
    const offset = await queryJournal(testAgentId, { offset: 1 });

    expect(offset).toHaveLength(2);
    expect(offset[0].id).toBe(all[1].id);
  });

  it("sorts descending by default (newest first)", async () => {
    const entries = await queryJournal(testAgentId);
    expect(entries[0].content).toBe("Uses async/await"); // Most recent
    expect(entries[2].content).toBe("Prefers TypeScript"); // Oldest
  });

  it("sorts ascending when specified", async () => {
    const entries = await queryJournal(testAgentId, { order: "asc" });
    expect(entries[0].content).toBe("Prefers TypeScript"); // Oldest
    expect(entries[2].content).toBe("Uses async/await"); // Most recent
  });
});

describe("queryByDateRange", () => {
  it("returns entries within date range", async () => {
    await createEntry(testAgentId, { content: "Old", timestamp: daysAgo(10) });
    await createEntry(testAgentId, { content: "Recent", timestamp: daysAgo(2) });
    await createEntry(testAgentId, { content: "Today", timestamp: daysAgo(0) });

    const entries = await queryByDateRange(testAgentId, daysAgo(5), daysAgo(1));
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Recent");
  });
});

describe("queryByEventType", () => {
  it("returns entries of specified type", async () => {
    await createEntry(testAgentId, { eventType: "learning_added", content: "Learning" });
    await createEntry(testAgentId, { eventType: "feedback_recorded", content: "Feedback" });

    const entries = await queryByEventType(testAgentId, "feedback_recorded");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Feedback");
  });
});

describe("queryByTopic", () => {
  it("returns entries matching topic", async () => {
    await createEntry(testAgentId, { topic: "coding style", content: "Style entry" });
    await createEntry(testAgentId, { topic: "testing", content: "Test entry" });

    const entries = await queryByTopic(testAgentId, "coding");
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Style entry");
  });
});

describe("getJournalSummary", () => {
  it("returns empty summary for empty journal", async () => {
    const summary = await getJournalSummary(testAgentId);

    expect(summary.totalEntries).toBe(0);
    expect(summary.byEventType.learning_added).toBe(0);
    expect(summary.bySource.conversation).toBe(0);
    expect(summary.byCategory.preference).toBe(0);
    expect(summary.oldestEntry).toBeNull();
    expect(summary.newestEntry).toBeNull();
    expect(summary.topTopics).toHaveLength(0);
  });

  it("calculates correct summary statistics", async () => {
    await createEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      category: "preference",
      topic: "language",
      timestamp: daysAgo(5),
    });
    await createEntry(testAgentId, {
      eventType: "learning_added",
      source: "conversation",
      category: "preference",
      topic: "language",
      timestamp: daysAgo(3),
    });
    await createEntry(testAgentId, {
      eventType: "feedback_recorded",
      source: "feedback",
      topic: "style",
      timestamp: daysAgo(1),
    });

    const summary = await getJournalSummary(testAgentId);

    expect(summary.totalEntries).toBe(3);
    expect(summary.byEventType.learning_added).toBe(2);
    expect(summary.byEventType.feedback_recorded).toBe(1);
    expect(summary.bySource.conversation).toBe(2);
    expect(summary.bySource.feedback).toBe(1);
    expect(summary.byCategory.preference).toBe(2);
    expect(summary.topTopics[0]).toEqual({ topic: "language", count: 2 });
    expect(summary.topTopics[1]).toEqual({ topic: "style", count: 1 });
  });

  it("tracks date range correctly", async () => {
    const oldDate = daysAgo(10);
    const newDate = daysAgo(1);

    await createEntry(testAgentId, { timestamp: oldDate });
    await createEntry(testAgentId, { timestamp: daysAgo(5) });
    await createEntry(testAgentId, { timestamp: newDate });

    const summary = await getJournalSummary(testAgentId);

    expect(summary.oldestEntry).toBe(oldDate);
    expect(summary.newestEntry).toBe(newDate);
  });
});

describe("getTodayEntries", () => {
  it("returns only entries from today", async () => {
    await createEntry(testAgentId, { content: "Yesterday", timestamp: daysAgo(1) });
    await createEntry(testAgentId, { content: "Today" }); // Uses current timestamp

    const entries = await getTodayEntries(testAgentId);

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((e) => e.content === "Today")).toBe(true);
    expect(entries.every((e) => e.content !== "Yesterday")).toBe(true);
  });
});

describe("getRecentEntries", () => {
  it("returns entries from the last N days", async () => {
    await createEntry(testAgentId, { content: "Old", timestamp: daysAgo(10) });
    await createEntry(testAgentId, { content: "Recent", timestamp: daysAgo(2) });
    await createEntry(testAgentId, { content: "Today" });

    const entries = await getRecentEntries(testAgentId, 5);

    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries.some((e) => e.content === "Recent")).toBe(true);
    expect(entries.some((e) => e.content === "Today")).toBe(true);
    expect(entries.every((e) => e.content !== "Old")).toBe(true);
  });
});

describe("clearJournal", () => {
  it("removes all journal entries", async () => {
    await createEntry(testAgentId, { content: "Entry 1" });
    await createEntry(testAgentId, { content: "Entry 2" });

    let entries = await loadJournalEntries(testAgentId);
    expect(entries).toHaveLength(2);

    await clearJournal(testAgentId);

    entries = await loadJournalEntries(testAgentId);
    expect(entries).toHaveLength(0);
  });

  it("handles non-existent file gracefully", async () => {
    // Should not throw
    await expect(clearJournal(testAgentId)).resolves.toBeUndefined();
  });
});

describe("exportJournalAsText", () => {
  it("exports empty journal as minimal markdown", async () => {
    const text = await exportJournalAsText(testAgentId);
    expect(text).toContain("# Learning Journal");
  });

  it("exports entries grouped by date", async () => {
    const today = new Date().toISOString().split("T")[0];

    await logLearningAdded(testAgentId, {
      source: "conversation",
      category: "preference",
      confidence: "high",
      content: "Prefers TypeScript",
      topic: "language",
    });

    const text = await exportJournalAsText(testAgentId);

    expect(text).toContain("# Learning Journal");
    expect(text).toContain(`## ${today}`);
    expect(text).toContain("Learning Added");
    expect(text).toContain("[preference]");
    expect(text).toContain("(language)");
    expect(text).toContain("Source: Conversation");
    expect(text).toContain("Prefers TypeScript");
  });

  it("formats event types correctly", async () => {
    await createEntry(testAgentId, { eventType: "learning_added" });
    await createEntry(testAgentId, { eventType: "feedback_recorded" });
    await createEntry(testAgentId, { eventType: "pattern_detected" });

    const text = await exportJournalAsText(testAgentId);

    expect(text).toContain("Learning Added");
    expect(text).toContain("Feedback Recorded");
    expect(text).toContain("Pattern Detected");
  });
});

describe("resolveJournalPath", () => {
  it("returns path to learning-journal.jsonl", () => {
    const journalPath = resolveJournalPath(testAgentId);
    expect(journalPath).toContain("learning-journal.jsonl");
    expect(journalPath).toContain("agents");
    expect(journalPath).toContain("test-agent");
  });
});
