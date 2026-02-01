/**
 * Tests for reminder effectiveness learning integration
 */

import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  calculateOutcomeScore,
  recordOutcome,
  outcomeToLearning,
  processReminderOutcome,
  generateSystemLearnings,
  createEmptyPatternStats,
  type ReminderOutcome,
} from "./learning-integration.js";
import {
  ensureFeedbackSchema,
  dropFeedbackSchema,
  insertFeedbackEvent,
} from "./feedback-schema.js";
import type { Reminder, ReminderTriggerType } from "./types.js";

// Mock the learning store
vi.mock("../learning/learnings-store.js", () => ({
  addLearning: vi.fn().mockResolvedValue({ id: "test-learning" }),
}));

describe("learning-integration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    // Create in-memory database
    db = new DatabaseSync(":memory:");

    // Create reminders table (simplified for testing)
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        trigger_type TEXT NOT NULL,
        trigger_spec TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        triggered_at INTEGER,
        completed_at INTEGER,
        snooze_until INTEGER,
        context_tags TEXT,
        quiet_hours_exempt INTEGER DEFAULT 0,
        chunk_id TEXT
      )
    `);

    ensureFeedbackSchema(db);
  });

  afterEach(() => {
    dropFeedbackSchema(db);
    db.close();
    vi.clearAllMocks();
  });

  describe("calculateOutcomeScore", () => {
    it("should return 1.0 for completed reactions", () => {
      expect(calculateOutcomeScore("completed")).toBe(1.0);
    });

    it("should return 0.8 for acted reactions", () => {
      expect(calculateOutcomeScore("acted")).toBe(0.8);
    });

    it("should return 0.3 for snoozed reactions", () => {
      expect(calculateOutcomeScore("snoozed")).toBe(0.3);
    });

    it("should return 0.1 for dismissed reactions", () => {
      expect(calculateOutcomeScore("dismissed")).toBe(0.1);
    });

    it("should return 0.0 for ignored reactions", () => {
      expect(calculateOutcomeScore("ignored")).toBe(0.0);
    });
  });

  describe("recordOutcome", () => {
    it("should record a new outcome and calculate metrics", async () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
        reactionTimeMs: 30000,
      };

      const metrics = await recordOutcome(db, outcome);

      expect(metrics.reminderId).toBe("rem-1");
      expect(metrics.totalShowings).toBe(1);
      expect(metrics.reactionCounts.completed).toBe(1);
      expect(metrics.completionRate).toBe(1.0);
      expect(metrics.dismissalRate).toBe(0);
      expect(metrics.effectivenessScore).toBeGreaterThan(0.5);
    });

    it("should accumulate outcomes for the same reminder", async () => {
      // First outcome
      await recordOutcome(db, {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
      });

      // Simulate existing feedback in database
      insertFeedbackEvent(db, {
        id: "fb-1",
        reminderId: "rem-1",
        agentId: "test-agent",
        sessionKey: "session-1",
        shownAt: new Date(),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(),
      });

      // Second outcome
      const metrics = await recordOutcome(db, {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "dismissed",
      });

      expect(metrics.totalShowings).toBe(2);
      expect(metrics.reactionCounts.completed).toBe(1);
      expect(metrics.reactionCounts.dismissed).toBe(1);
      expect(metrics.completionRate).toBe(0.5);
      expect(metrics.dismissalRate).toBe(0.5);
    });

    it("should calculate average reaction time", async () => {
      insertFeedbackEvent(db, {
        id: "fb-1",
        reminderId: "rem-1",
        agentId: "test-agent",
        sessionKey: "session-1",
        shownAt: new Date(),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(),
        reactionTimeMs: 20000,
      });

      const metrics = await recordOutcome(db, {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
        reactionTimeMs: 40000,
      });

      expect(metrics.avgReactionTimeMs).toBe(30000);
    });

    it("should calculate average context relevance", async () => {
      insertFeedbackEvent(db, {
        id: "fb-1",
        reminderId: "rem-1",
        agentId: "test-agent",
        sessionKey: "session-1",
        shownAt: new Date(),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(),
        contextRelevanceScore: 0.6,
      });

      const metrics = await recordOutcome(db, {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
        contextRelevanceScore: 0.8,
      });

      expect(metrics.avgContextRelevanceScore).toBe(0.7);
    });

    it("should track trend over multiple outcomes", async () => {
      // Add multiple outcomes with improving scores
      for (let i = 0; i < 5; i++) {
        insertFeedbackEvent(db, {
          id: `fb-${i}`,
          reminderId: "rem-1",
          agentId: "test-agent",
          sessionKey: `session-${i}`,
          shownAt: new Date(Date.now() - (5 - i) * 1000),
          reaction: i < 2 ? "dismissed" : "completed", // Improving
          source: "explicit",
          recordedAt: new Date(),
        });
      }

      const metrics = await recordOutcome(db, {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
      });

      // Should have some trend value
      expect(["improving", "declining", "stable"]).toContain(metrics.trend);
    });
  });

  describe("outcomeToLearning", () => {
    const createReminder = (
      id: string,
      triggerType: ReminderTriggerType = "scheduled",
    ): Reminder => ({
      id,
      agentId: "test-agent",
      title: "Test Reminder",
      trigger:
        triggerType === "scheduled"
          ? { type: "scheduled", datetime: new Date("2024-01-15T10:00:00") }
          : triggerType === "context"
            ? { type: "context", pattern: "meeting" }
            : { type: "recurring", cron: "0 9 * * *" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    });

    it("should create positive learning for completed reaction", () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 5,
        reactionCounts: {
          completed: 4,
          dismissed: 1,
          snoozed: 0,
          ignored: 0,
          acted: 0,
        },
        completionRate: 0.8,
        dismissalRate: 0.2,
        avgReactionTimeMs: 30000,
        avgContextRelevanceScore: null,
        effectivenessScore: 0.75,
        trend: "stable" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, createReminder("rem-1"), metrics);

      expect(learning).not.toBeNull();
      expect(learning?.outcomeType).toBe("positive");
      expect(learning?.category).toBe("pattern");
      expect(learning?.content).toContain("Test Reminder");
      expect(learning?.confidence).toBe("high");
    });

    it("should create positive learning for acted reaction", () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "acted",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 3,
        reactionCounts: {
          completed: 1,
          dismissed: 0,
          snoozed: 0,
          ignored: 0,
          acted: 2,
        },
        completionRate: 0.33,
        dismissalRate: 0,
        avgReactionTimeMs: null,
        avgContextRelevanceScore: null,
        effectivenessScore: 0.6,
        trend: "stable" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, createReminder("rem-1"), metrics);

      expect(learning).not.toBeNull();
      expect(learning?.outcomeType).toBe("positive");
    });

    it("should create negative learning for consistently dismissed reminders", () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "dismissed",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 5,
        reactionCounts: {
          completed: 0,
          dismissed: 5,
          snoozed: 0,
          ignored: 0,
          acted: 0,
        },
        completionRate: 0,
        dismissalRate: 1.0,
        avgReactionTimeMs: null,
        avgContextRelevanceScore: 0.2,
        effectivenessScore: 0.15,
        trend: "declining" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, createReminder("rem-1", "context"), metrics);

      expect(learning).not.toBeNull();
      expect(learning?.outcomeType).toBe("negative");
      expect(learning?.category).toBe("correction");
      expect(learning?.content).toContain("not working well");
    });

    it("should return null for neutral outcomes with few showings", () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "snoozed",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 2, // Not enough data
        reactionCounts: {
          completed: 1,
          dismissed: 0,
          snoozed: 1,
          ignored: 0,
          acted: 0,
        },
        completionRate: 0.5,
        dismissalRate: 0,
        avgReactionTimeMs: null,
        avgContextRelevanceScore: null,
        effectivenessScore: 0.5,
        trend: "stable" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, createReminder("rem-1"), metrics);

      expect(learning).toBeNull();
    });

    it("should include time-of-day info for scheduled reminders", () => {
      const morningReminder = createReminder("rem-1", "scheduled");
      morningReminder.trigger = { type: "scheduled", datetime: new Date("2024-01-15T09:00:00") };

      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 5,
        reactionCounts: { completed: 5, dismissed: 0, snoozed: 0, ignored: 0, acted: 0 },
        completionRate: 1.0,
        dismissalRate: 0,
        avgReactionTimeMs: null,
        avgContextRelevanceScore: null,
        effectivenessScore: 0.8,
        trend: "stable" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, morningReminder, metrics);

      expect(learning?.content).toContain("morning");
    });

    it("should include context pattern info for context reminders", () => {
      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
      };

      const metrics = {
        reminderId: "rem-1",
        totalShowings: 5,
        reactionCounts: { completed: 5, dismissed: 0, snoozed: 0, ignored: 0, acted: 0 },
        completionRate: 1.0,
        dismissalRate: 0,
        avgReactionTimeMs: null,
        avgContextRelevanceScore: null,
        effectivenessScore: 0.8,
        trend: "stable" as const,
        lastCalculatedAt: new Date(),
      };

      const learning = outcomeToLearning(outcome, createReminder("rem-1", "context"), metrics);

      expect(learning?.content).toContain("meeting");
    });
  });

  describe("processReminderOutcome", () => {
    it("should process an outcome and return metrics, learning, and suggestions", async () => {
      const reminder: Reminder = {
        id: "rem-1",
        agentId: "test-agent",
        title: "Test Reminder",
        trigger: { type: "scheduled", datetime: new Date() },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      };

      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "completed",
        reactionTimeMs: 15000,
      };

      const result = await processReminderOutcome(db, outcome, reminder);

      expect(result.metrics).toBeDefined();
      expect(result.metrics.reminderId).toBe("rem-1");
      expect(result.metrics.totalShowings).toBe(1);
      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it("should generate suggestions for ineffective reminders", async () => {
      const reminder: Reminder = {
        id: "rem-1",
        agentId: "test-agent",
        title: "Ineffective Reminder",
        trigger: { type: "scheduled", datetime: new Date() },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      };

      // Add multiple dismissed feedback events
      for (let i = 0; i < 5; i++) {
        insertFeedbackEvent(db, {
          id: `fb-${i}`,
          reminderId: "rem-1",
          agentId: "test-agent",
          sessionKey: `session-${i}`,
          shownAt: new Date(),
          reaction: "dismissed",
          source: "explicit",
          recordedAt: new Date(),
        });
      }

      const outcome: ReminderOutcome = {
        reminderId: "rem-1",
        agentId: "test-agent",
        reaction: "dismissed",
      };

      const result = await processReminderOutcome(db, outcome, reminder);

      expect(result.metrics.dismissalRate).toBeGreaterThan(0.5);
      // Should suggest reducing frequency or archiving
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("generateSystemLearnings", () => {
    it("should return empty array when not enough data", () => {
      const stats = createEmptyPatternStats();
      stats.overall.totalShowings = 5; // Less than minShowingsForMetrics * 3

      const learnings = generateSystemLearnings("test-agent", stats);

      expect(learnings).toHaveLength(0);
    });

    it("should generate learnings for effective priority levels", () => {
      const stats = createEmptyPatternStats();
      stats.overall.totalShowings = 30;
      stats.byPriority.urgent = { count: 10, avgEffectiveness: 0.85, avgCompletionRate: 0.9 };
      stats.byPriority.normal = { count: 15, avgEffectiveness: 0.6, avgCompletionRate: 0.5 };
      stats.byPriority.low = { count: 5, avgEffectiveness: 0.4, avgCompletionRate: 0.3 };

      const learnings = generateSystemLearnings("test-agent", stats);

      const priorityLearning = learnings.find(
        (l) => l.category === "pattern" && l.content.includes("priority"),
      );
      expect(priorityLearning).toBeDefined();
      expect(priorityLearning?.content).toContain("urgent");
    });

    it("should generate learnings for best trigger type", () => {
      const stats = createEmptyPatternStats();
      stats.overall.totalShowings = 30;
      stats.byTriggerType.context = { count: 15, avgEffectiveness: 0.85, avgCompletionRate: 0.8 };
      stats.byTriggerType.scheduled = {
        count: 10,
        avgEffectiveness: 0.5,
        avgCompletionRate: 0.4,
      };
      stats.byTriggerType.recurring = { count: 5, avgEffectiveness: 0.3, avgCompletionRate: 0.2 };

      const learnings = generateSystemLearnings("test-agent", stats);

      const triggerLearning = learnings.find(
        (l) => l.category === "preference" && l.content.includes("context"),
      );
      expect(triggerLearning).toBeDefined();
    });

    it("should generate learnings for time-of-day preferences", () => {
      const stats = createEmptyPatternStats();
      stats.overall.totalShowings = 30;
      stats.byTimeOfDay.morning = { count: 10, avgEffectiveness: 0.9 };
      stats.byTimeOfDay.afternoon = { count: 8, avgEffectiveness: 0.5 };
      stats.byTimeOfDay.evening = { count: 7, avgEffectiveness: 0.2 };
      stats.byTimeOfDay.night = { count: 5, avgEffectiveness: 0.3 };

      const learnings = generateSystemLearnings("test-agent", stats);

      // Should learn morning is best
      const morningLearning = learnings.find((l) => l.content.includes("morning"));
      expect(morningLearning).toBeDefined();
      expect(morningLearning?.outcomeType).toBe("positive");

      // Should learn evening is worst
      const eveningLearning = learnings.find((l) => l.content.includes("evening"));
      expect(eveningLearning).toBeDefined();
      expect(eveningLearning?.outcomeType).toBe("negative");
    });
  });

  describe("createEmptyPatternStats", () => {
    it("should create stats with all zeroes", () => {
      const stats = createEmptyPatternStats();

      expect(stats.overall.totalReminders).toBe(0);
      expect(stats.overall.totalShowings).toBe(0);
      expect(stats.overall.avgEffectiveness).toBe(0);

      expect(stats.byPriority.urgent.count).toBe(0);
      expect(stats.byPriority.normal.count).toBe(0);
      expect(stats.byPriority.low.count).toBe(0);

      expect(stats.byTriggerType.scheduled.count).toBe(0);
      expect(stats.byTriggerType.recurring.count).toBe(0);
      expect(stats.byTriggerType.context.count).toBe(0);

      expect(stats.byTimeOfDay.morning.count).toBe(0);
      expect(stats.byTimeOfDay.afternoon.count).toBe(0);
      expect(stats.byTimeOfDay.evening.count).toBe(0);
      expect(stats.byTimeOfDay.night.count).toBe(0);
    });
  });
});
