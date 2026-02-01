/**
 * Learning journal for audit trail and event tracking
 *
 * Logs all learning events with timestamps and metadata for complete
 * auditability. Supports queries by date range, event type, and topic.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";
import type { LearningCategory, LearningConfidence } from "./extract-learnings.js";

/**
 * Source of the learning event
 */
export type JournalEventSource =
  | "conversation" // From user message parsing
  | "feedback" // From explicit feedback (thumbs up/down)
  | "pattern" // From successful pattern detection
  | "correction" // From user corrections
  | "import" // From manual import
  | "system"; // System-generated learnings

/**
 * Type of journal event
 */
export type JournalEventType =
  | "learning_added" // New learning was captured
  | "learning_updated" // Existing learning was updated
  | "learning_removed" // Learning was removed
  | "feedback_recorded" // User feedback was recorded
  | "pattern_detected" // Pattern was detected
  | "checkpoint_created"; // Learning checkpoint was saved

/**
 * A journal entry recording a learning event
 */
export interface JournalEntry {
  /** Unique ID for this journal entry */
  id: string;
  /** Type of event */
  eventType: JournalEventType;
  /** Source of the event */
  source: JournalEventSource;
  /** Timestamp when the event occurred */
  timestamp: string;
  /** Learning category (if applicable) */
  category?: LearningCategory;
  /** Learning confidence (if applicable) */
  confidence?: LearningConfidence;
  /** Topic or subject matter */
  topic?: string;
  /** Content or summary of what was learned */
  content: string;
  /** Related learning ID (if applicable) */
  learningId?: string;
  /** Session ID where event occurred (if applicable) */
  sessionId?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Query options for filtering journal entries
 */
export interface JournalQuery {
  /** Filter by event type(s) */
  eventTypes?: JournalEventType[];
  /** Filter by source(s) */
  sources?: JournalEventSource[];
  /** Filter by category(s) */
  categories?: LearningCategory[];
  /** Filter by topic (partial match) */
  topic?: string;
  /** Filter by content (partial match) */
  content?: string;
  /** Start date for date range filter */
  startDate?: string;
  /** End date for date range filter */
  endDate?: string;
  /** Maximum number of entries to return */
  limit?: number;
  /** Number of entries to skip (for pagination) */
  offset?: number;
  /** Sort order (default: newest first) */
  order?: "asc" | "desc";
}

/**
 * Summary statistics for journal entries
 */
export interface JournalSummary {
  /** Total number of entries */
  totalEntries: number;
  /** Entries by event type */
  byEventType: Record<JournalEventType, number>;
  /** Entries by source */
  bySource: Record<JournalEventSource, number>;
  /** Entries by category */
  byCategory: Record<LearningCategory, number>;
  /** Date of oldest entry */
  oldestEntry: string | null;
  /** Date of newest entry */
  newestEntry: string | null;
  /** Top topics (by frequency) */
  topTopics: Array<{ topic: string; count: number }>;
}

const JOURNAL_FILENAME = "learning-journal.jsonl";

/**
 * Resolve the journal storage directory for an agent
 */
function resolveJournalDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "agent");
}

/**
 * Resolve the path to an agent's journal file
 */
export function resolveJournalPath(agentId: string): string {
  return path.join(resolveJournalDir(agentId), JOURNAL_FILENAME);
}

/**
 * Generate a unique ID for a journal entry
 */
function generateJournalId(): string {
  return `jrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load all journal entries for an agent
 */
export async function loadJournalEntries(agentId: string): Promise<JournalEntry[]> {
  const filePath = resolveJournalPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.map((line) => JSON.parse(line) as JournalEntry);
  } catch {
    return [];
  }
}

/**
 * Append a journal entry to the file
 */
export async function appendJournalEntry(
  agentId: string,
  entry: Omit<JournalEntry, "id" | "timestamp">,
): Promise<JournalEntry> {
  const filePath = resolveJournalPath(agentId);
  const dir = path.dirname(filePath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  const fullEntry: JournalEntry = {
    ...entry,
    id: generateJournalId(),
    timestamp: new Date().toISOString(),
  };

  // Append as JSONL
  await fs.appendFile(filePath, JSON.stringify(fullEntry) + "\n", "utf8");

  return fullEntry;
}

/**
 * Log a learning added event
 */
export async function logLearningAdded(
  agentId: string,
  options: {
    source: JournalEventSource;
    category: LearningCategory;
    confidence: LearningConfidence;
    content: string;
    topic?: string;
    learningId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "learning_added",
    source: options.source,
    category: options.category,
    confidence: options.confidence,
    content: options.content,
    topic: options.topic,
    learningId: options.learningId,
    sessionId: options.sessionId,
    metadata: options.metadata,
  });
}

/**
 * Log a learning updated event
 */
export async function logLearningUpdated(
  agentId: string,
  options: {
    source: JournalEventSource;
    learningId: string;
    content: string;
    previousContent?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "learning_updated",
    source: options.source,
    learningId: options.learningId,
    content: options.content,
    sessionId: options.sessionId,
    metadata: {
      ...options.metadata,
      previousContent: options.previousContent,
    },
  });
}

/**
 * Log a learning removed event
 */
export async function logLearningRemoved(
  agentId: string,
  options: {
    source: JournalEventSource;
    learningId: string;
    content: string;
    reason?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "learning_removed",
    source: options.source,
    learningId: options.learningId,
    content: options.content,
    sessionId: options.sessionId,
    metadata: {
      ...options.metadata,
      reason: options.reason,
    },
  });
}

/**
 * Log a feedback recorded event
 */
export async function logFeedbackRecorded(
  agentId: string,
  options: {
    feedbackType: "positive" | "negative";
    content: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "feedback_recorded",
    source: "feedback",
    content: options.content,
    sessionId: options.sessionId,
    metadata: {
      ...options.metadata,
      feedbackType: options.feedbackType,
    },
  });
}

/**
 * Log a pattern detected event
 */
export async function logPatternDetected(
  agentId: string,
  options: {
    content: string;
    topic?: string;
    confidence: LearningConfidence;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "pattern_detected",
    source: "pattern",
    category: "pattern",
    confidence: options.confidence,
    content: options.content,
    topic: options.topic,
    sessionId: options.sessionId,
    metadata: options.metadata,
  });
}

/**
 * Log a checkpoint created event
 */
export async function logCheckpointCreated(
  agentId: string,
  options: {
    checkpointId: string;
    learningCount: number;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<JournalEntry> {
  return appendJournalEntry(agentId, {
    eventType: "checkpoint_created",
    source: "system",
    content: `Checkpoint ${options.checkpointId} created with ${options.learningCount} learnings`,
    sessionId: options.sessionId,
    metadata: {
      ...options.metadata,
      checkpointId: options.checkpointId,
      learningCount: options.learningCount,
    },
  });
}

/**
 * Query journal entries with filters
 */
export async function queryJournal(
  agentId: string,
  query: JournalQuery = {},
): Promise<JournalEntry[]> {
  const entries = await loadJournalEntries(agentId);

  let filtered = entries;

  // Filter by event type
  if (query.eventTypes && query.eventTypes.length > 0) {
    filtered = filtered.filter((e) => query.eventTypes!.includes(e.eventType));
  }

  // Filter by source
  if (query.sources && query.sources.length > 0) {
    filtered = filtered.filter((e) => query.sources!.includes(e.source));
  }

  // Filter by category
  if (query.categories && query.categories.length > 0) {
    filtered = filtered.filter((e) => e.category && query.categories!.includes(e.category));
  }

  // Filter by topic (partial match)
  if (query.topic) {
    const topicLower = query.topic.toLowerCase();
    filtered = filtered.filter((e) => e.topic?.toLowerCase().includes(topicLower));
  }

  // Filter by content (partial match)
  if (query.content) {
    const contentLower = query.content.toLowerCase();
    filtered = filtered.filter((e) => e.content.toLowerCase().includes(contentLower));
  }

  // Filter by date range
  if (query.startDate) {
    const start = new Date(query.startDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= start);
  }

  if (query.endDate) {
    const end = new Date(query.endDate).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= end);
  }

  // Sort
  const sortOrder = query.order || "desc";
  filtered.sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return sortOrder === "asc" ? diff : -diff;
  });

  // Pagination
  const offset = query.offset || 0;
  const limit = query.limit || filtered.length;
  filtered = filtered.slice(offset, offset + limit);

  return filtered;
}

/**
 * Query journal entries by date range
 */
export async function queryByDateRange(
  agentId: string,
  startDate: string,
  endDate: string,
): Promise<JournalEntry[]> {
  return queryJournal(agentId, { startDate, endDate });
}

/**
 * Query journal entries by event type
 */
export async function queryByEventType(
  agentId: string,
  eventType: JournalEventType,
): Promise<JournalEntry[]> {
  return queryJournal(agentId, { eventTypes: [eventType] });
}

/**
 * Query journal entries by topic
 */
export async function queryByTopic(agentId: string, topic: string): Promise<JournalEntry[]> {
  return queryJournal(agentId, { topic });
}

/**
 * Get journal summary statistics
 */
export async function getJournalSummary(agentId: string): Promise<JournalSummary> {
  const entries = await loadJournalEntries(agentId);

  const byEventType: Record<JournalEventType, number> = {
    learning_added: 0,
    learning_updated: 0,
    learning_removed: 0,
    feedback_recorded: 0,
    pattern_detected: 0,
    checkpoint_created: 0,
  };

  const bySource: Record<JournalEventSource, number> = {
    conversation: 0,
    feedback: 0,
    pattern: 0,
    correction: 0,
    import: 0,
    system: 0,
  };

  const byCategory: Record<LearningCategory, number> = {
    preference: 0,
    correction: 0,
    pattern: 0,
    "tool-usage": 0,
  };

  const topicCounts = new Map<string, number>();

  let oldestEntry: string | null = null;
  let newestEntry: string | null = null;

  for (const entry of entries) {
    // Count by event type
    byEventType[entry.eventType]++;

    // Count by source
    bySource[entry.source]++;

    // Count by category
    if (entry.category) {
      byCategory[entry.category]++;
    }

    // Track topics
    if (entry.topic) {
      topicCounts.set(entry.topic, (topicCounts.get(entry.topic) || 0) + 1);
    }

    // Track date range
    if (!oldestEntry || entry.timestamp < oldestEntry) {
      oldestEntry = entry.timestamp;
    }
    if (!newestEntry || entry.timestamp > newestEntry) {
      newestEntry = entry.timestamp;
    }
  }

  // Get top topics
  const topTopics = Array.from(topicCounts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalEntries: entries.length,
    byEventType,
    bySource,
    byCategory,
    oldestEntry,
    newestEntry,
    topTopics,
  };
}

/**
 * Get entries from today
 */
export async function getTodayEntries(agentId: string): Promise<JournalEntry[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return queryJournal(agentId, {
    startDate: today.toISOString(),
  });
}

/**
 * Get entries from the last N days
 */
export async function getRecentEntries(agentId: string, days: number): Promise<JournalEntry[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return queryJournal(agentId, {
    startDate: startDate.toISOString(),
  });
}

/**
 * Clear the journal (for testing or reset)
 */
export async function clearJournal(agentId: string): Promise<void> {
  const filePath = resolveJournalPath(agentId);

  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist, which is fine
  }
}

/**
 * Export journal to human-readable format
 */
export async function exportJournalAsText(agentId: string): Promise<string> {
  const entries = await loadJournalEntries(agentId);
  const lines: string[] = ["# Learning Journal\n"];

  // Group by date
  const byDate = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const date = entry.timestamp.split("T")[0];
    const dateEntries = byDate.get(date) || [];
    dateEntries.push(entry);
    byDate.set(date, dateEntries);
  }

  // Sort dates descending
  const dates = Array.from(byDate.keys()).sort().reverse();

  for (const date of dates) {
    lines.push(`\n## ${date}\n`);

    const dateEntries = byDate.get(date) || [];
    dateEntries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    for (const entry of dateEntries) {
      const time = entry.timestamp.split("T")[1].slice(0, 8);
      const source = entry.source.charAt(0).toUpperCase() + entry.source.slice(1);
      const category = entry.category ? ` [${entry.category}]` : "";
      const topic = entry.topic ? ` (${entry.topic})` : "";

      lines.push(`- **${time}** ${formatEventType(entry.eventType)}${category}${topic}`);
      lines.push(`  - Source: ${source}`);
      lines.push(`  - ${entry.content}`);
    }
  }

  return lines.join("\n");
}

/**
 * Format event type for display
 */
function formatEventType(eventType: JournalEventType): string {
  switch (eventType) {
    case "learning_added":
      return "Learning Added";
    case "learning_updated":
      return "Learning Updated";
    case "learning_removed":
      return "Learning Removed";
    case "feedback_recorded":
      return "Feedback Recorded";
    case "pattern_detected":
      return "Pattern Detected";
    case "checkpoint_created":
      return "Checkpoint Created";
  }
}
