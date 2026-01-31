/**
 * Tests for reminder feedback schema and database operations
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";

import {
  ensureFeedbackSchema,
  dropFeedbackSchema,
  hasFeedbackSchema,
  insertFeedbackEvent,
  getFeedbackForReminder,
  getFeedbackForAgent,
  upsertEffectivenessMetrics,
  getEffectivenessMetrics,
  getPerformanceRanking,
  getAgentFeedbackStats,
  cleanupOldFeedback,
} from "./feedback-schema.js";
import { ensureReminderSchema } from "./schema.js";

describe("feedback-schema", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    // Ensure reminder schema first (required for foreign key references)
    ensureReminderSchema(db);
    ensureFeedbackSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("ensureFeedbackSchema", () => {
    it("creates reminder_feedback table", () => {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='reminder_feedback'`)
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });

    it("creates reminder_effectiveness table", () => {
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='reminder_effectiveness'`,
        )
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });

    it("creates required indices on reminder_feedback", () => {
      const indices = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reminder_feedback'`,
        )
        .all() as Array<{ name: string }>;
      const indexNames = indices.map((i) => i.name);
      expect(indexNames).toContain("idx_feedback_reminder");
      expect(indexNames).toContain("idx_feedback_agent");
      expect(indexNames).toContain("idx_feedback_shown");
      expect(indexNames).toContain("idx_feedback_reaction");
      expect(indexNames).toContain("idx_feedback_agent_time");
    });

    it("is idempotent", () => {
      // Should not throw on second call
      expect(() => ensureFeedbackSchema(db)).not.toThrow();
    });
  });

  describe("hasFeedbackSchema", () => {
    it("returns true when schema exists", () => {
      expect(hasFeedbackSchema(db)).toBe(true);
    });

    it("returns false when schema is dropped", () => {
      dropFeedbackSchema(db);
      expect(hasFeedbackSchema(db)).toBe(false);
    });
  });

  describe("dropFeedbackSchema", () => {
    it("removes both feedback tables", () => {
      dropFeedbackSchema(db);
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'reminder_%'`)
        .all() as Array<{ name: string }>;
      // Only reminders table should remain
      expect(tables.map((t) => t.name)).toEqual(["reminders"]);
    });
  });

  describe("insertFeedbackEvent", () => {
    it("inserts a feedback event", () => {
      insertFeedbackEvent(db, {
        id: "feedback-1",
        reminderId: "reminder-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(1706745600000),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(1706745660000),
        reactionTimeMs: 60000,
        contextRelevanceScore: 0.85,
        triggerMessage: "context trigger",
        userResponse: "done",
      });

      const row = db.prepare(`SELECT * FROM reminder_feedback WHERE id = ?`).get("feedback-1") as {
        id: string;
        reminder_id: string;
        reaction: string;
      };
      expect(row).toBeDefined();
      expect(row.id).toBe("feedback-1");
      expect(row.reminder_id).toBe("reminder-1");
      expect(row.reaction).toBe("completed");
    });

    it("inserts feedback with null optional fields", () => {
      insertFeedbackEvent(db, {
        id: "feedback-2",
        reminderId: "reminder-2",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(1706745600000),
        reaction: "ignored",
        source: "timeout",
        recordedAt: new Date(1706745900000),
      });

      const row = db.prepare(`SELECT * FROM reminder_feedback WHERE id = ?`).get("feedback-2") as {
        reaction_time_ms: number | null;
        context_relevance_score: number | null;
      };
      expect(row.reaction_time_ms).toBeNull();
      expect(row.context_relevance_score).toBeNull();
    });
  });

  describe("getFeedbackForReminder", () => {
    beforeEach(() => {
      // Insert multiple feedback events
      for (let i = 1; i <= 5; i++) {
        insertFeedbackEvent(db, {
          id: `feedback-${i}`,
          reminderId: "reminder-1",
          agentId: "agent-1",
          sessionKey: "main",
          shownAt: new Date(1706745600000 + i * 60000),
          reaction: i % 2 === 0 ? "completed" : "dismissed",
          source: "explicit",
          recordedAt: new Date(1706745600000 + i * 60000 + 5000),
        });
      }
    });

    it("returns all feedback for a reminder", () => {
      const feedback = getFeedbackForReminder(db, "reminder-1");
      expect(feedback).toHaveLength(5);
    });

    it("returns feedback in descending order by shown_at", () => {
      const feedback = getFeedbackForReminder(db, "reminder-1");
      for (let i = 1; i < feedback.length; i++) {
        expect(feedback[i - 1].shown_at).toBeGreaterThan(feedback[i].shown_at);
      }
    });

    it("respects limit parameter", () => {
      const feedback = getFeedbackForReminder(db, "reminder-1", 3);
      expect(feedback).toHaveLength(3);
    });

    it("returns empty array for unknown reminder", () => {
      const feedback = getFeedbackForReminder(db, "unknown");
      expect(feedback).toHaveLength(0);
    });
  });

  describe("getFeedbackForAgent", () => {
    beforeEach(() => {
      // Insert feedback for two different agents
      insertFeedbackEvent(db, {
        id: "feedback-a1",
        reminderId: "reminder-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(1706745600000),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(1706745660000),
      });
      insertFeedbackEvent(db, {
        id: "feedback-a2",
        reminderId: "reminder-2",
        agentId: "agent-2",
        sessionKey: "main",
        shownAt: new Date(1706745700000),
        reaction: "dismissed",
        source: "explicit",
        recordedAt: new Date(1706745760000),
      });
    });

    it("returns feedback only for specified agent", () => {
      const feedback = getFeedbackForAgent(db, "agent-1");
      expect(feedback).toHaveLength(1);
      expect(feedback[0].agent_id).toBe("agent-1");
    });

    it("filters by time window when sinceMs provided", () => {
      const feedback = getFeedbackForAgent(db, "agent-1", 1706745700000);
      expect(feedback).toHaveLength(0);
    });

    it("includes feedback within time window", () => {
      const feedback = getFeedbackForAgent(db, "agent-1", 1706745500000);
      expect(feedback).toHaveLength(1);
    });
  });

  describe("upsertEffectivenessMetrics", () => {
    it("inserts new metrics", () => {
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-1",
        totalShowings: 10,
        completedCount: 5,
        dismissedCount: 2,
        snoozedCount: 1,
        ignoredCount: 1,
        actedCount: 1,
        completionRate: 0.5,
        dismissalRate: 0.2,
        avgReactionTimeMs: 60000,
        avgContextRelevance: 0.75,
        effectivenessScore: 0.65,
        trend: "improving",
        recentScores: [0.5, 0.55, 0.6, 0.65],
      });

      const metrics = getEffectivenessMetrics(db, "reminder-1");
      expect(metrics).toBeDefined();
      expect(metrics?.total_showings).toBe(10);
      expect(metrics?.effectiveness_score).toBe(0.65);
      expect(metrics?.trend).toBe("improving");
    });

    it("updates existing metrics on conflict", () => {
      // First insert
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-1",
        totalShowings: 5,
        completedCount: 2,
        dismissedCount: 1,
        snoozedCount: 1,
        ignoredCount: 1,
        actedCount: 0,
        completionRate: 0.4,
        dismissalRate: 0.2,
        avgReactionTimeMs: 50000,
        avgContextRelevance: null,
        effectivenessScore: 0.5,
        trend: "stable",
        recentScores: [0.5],
      });

      // Update
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-1",
        totalShowings: 10,
        completedCount: 5,
        dismissedCount: 2,
        snoozedCount: 1,
        ignoredCount: 1,
        actedCount: 1,
        completionRate: 0.5,
        dismissalRate: 0.2,
        avgReactionTimeMs: 60000,
        avgContextRelevance: 0.8,
        effectivenessScore: 0.65,
        trend: "improving",
        recentScores: [0.5, 0.55, 0.6, 0.65],
      });

      const metrics = getEffectivenessMetrics(db, "reminder-1");
      expect(metrics?.total_showings).toBe(10);
      expect(metrics?.effectiveness_score).toBe(0.65);
      expect(metrics?.avg_context_relevance).toBe(0.8);
    });

    it("stores recent scores as JSON", () => {
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-1",
        totalShowings: 5,
        completedCount: 3,
        dismissedCount: 1,
        snoozedCount: 0,
        ignoredCount: 1,
        actedCount: 0,
        completionRate: 0.6,
        dismissalRate: 0.2,
        avgReactionTimeMs: null,
        avgContextRelevance: null,
        effectivenessScore: 0.6,
        trend: "stable",
        recentScores: [0.55, 0.58, 0.6],
      });

      const metrics = getEffectivenessMetrics(db, "reminder-1");
      expect(metrics?.recent_scores).toBe("[0.55,0.58,0.6]");
    });
  });

  describe("getPerformanceRanking", () => {
    beforeEach(() => {
      // Create reminders
      db.prepare(
        `INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "reminder-1",
        "agent-1",
        "High performer",
        "scheduled",
        "2024-02-01T10:00:00Z",
        Date.now(),
      );
      db.prepare(
        `INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "reminder-2",
        "agent-1",
        "Low performer",
        "scheduled",
        "2024-02-01T11:00:00Z",
        Date.now(),
      );
      db.prepare(
        `INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "reminder-3",
        "agent-1",
        "Medium performer",
        "scheduled",
        "2024-02-01T12:00:00Z",
        Date.now(),
      );

      // Insert metrics
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-1",
        totalShowings: 10,
        completedCount: 8,
        dismissedCount: 1,
        snoozedCount: 1,
        ignoredCount: 0,
        actedCount: 0,
        completionRate: 0.8,
        dismissalRate: 0.1,
        avgReactionTimeMs: 30000,
        avgContextRelevance: null,
        effectivenessScore: 0.9,
        trend: "stable",
        recentScores: [0.9],
      });
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-2",
        totalShowings: 10,
        completedCount: 1,
        dismissedCount: 7,
        snoozedCount: 1,
        ignoredCount: 1,
        actedCount: 0,
        completionRate: 0.1,
        dismissalRate: 0.7,
        avgReactionTimeMs: 120000,
        avgContextRelevance: null,
        effectivenessScore: 0.2,
        trend: "declining",
        recentScores: [0.2],
      });
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-3",
        totalShowings: 10,
        completedCount: 5,
        dismissedCount: 2,
        snoozedCount: 2,
        ignoredCount: 1,
        actedCount: 0,
        completionRate: 0.5,
        dismissalRate: 0.2,
        avgReactionTimeMs: 60000,
        avgContextRelevance: null,
        effectivenessScore: 0.5,
        trend: "stable",
        recentScores: [0.5],
      });
    });

    it("returns top performers sorted by effectiveness score", () => {
      const ranking = getPerformanceRanking(db, "agent-1", 2);
      expect(ranking.top).toHaveLength(2);
      expect(ranking.top[0].reminderId).toBe("reminder-1");
      expect(ranking.top[0].effectivenessScore).toBe(0.9);
    });

    it("returns bottom performers sorted by effectiveness score", () => {
      const ranking = getPerformanceRanking(db, "agent-1", 2);
      expect(ranking.bottom).toHaveLength(2);
      expect(ranking.bottom[0].reminderId).toBe("reminder-2");
      expect(ranking.bottom[0].effectivenessScore).toBe(0.2);
    });

    it("excludes reminders with less than 3 showings", () => {
      // Add a reminder with low showings
      db.prepare(
        `INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "reminder-4",
        "agent-1",
        "New reminder",
        "scheduled",
        "2024-02-01T13:00:00Z",
        Date.now(),
      );
      upsertEffectivenessMetrics(db, {
        reminderId: "reminder-4",
        totalShowings: 2,
        completedCount: 2,
        dismissedCount: 0,
        snoozedCount: 0,
        ignoredCount: 0,
        actedCount: 0,
        completionRate: 1.0,
        dismissalRate: 0,
        avgReactionTimeMs: 10000,
        avgContextRelevance: null,
        effectivenessScore: 0.95,
        trend: "stable",
        recentScores: [0.95],
      });

      const ranking = getPerformanceRanking(db, "agent-1");
      // reminder-4 should not appear despite high score
      expect(ranking.top.find((r) => r.reminderId === "reminder-4")).toBeUndefined();
    });
  });

  describe("getAgentFeedbackStats", () => {
    beforeEach(() => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Insert feedback with various reactions across time
      insertFeedbackEvent(db, {
        id: "fb-1",
        reminderId: "r-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - oneDay),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(now - oneDay + 5000),
      });
      insertFeedbackEvent(db, {
        id: "fb-2",
        reminderId: "r-2",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - 2 * oneDay),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(now - 2 * oneDay + 5000),
      });
      insertFeedbackEvent(db, {
        id: "fb-3",
        reminderId: "r-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - 3 * oneDay),
        reaction: "dismissed",
        source: "explicit",
        recordedAt: new Date(now - 3 * oneDay + 5000),
      });
      insertFeedbackEvent(db, {
        id: "fb-4",
        reminderId: "r-3",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - 4 * oneDay),
        reaction: "snoozed",
        source: "explicit",
        recordedAt: new Date(now - 4 * oneDay + 5000),
      });
    });

    it("calculates total showings", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 14);
      expect(stats.totalShowings).toBe(4);
    });

    it("calculates unique reminders", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 14);
      expect(stats.uniqueReminders).toBe(3);
    });

    it("counts reactions by type", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 14);
      expect(stats.byReaction.completed).toBe(2);
      expect(stats.byReaction.dismissed).toBe(1);
      expect(stats.byReaction.snoozed).toBe(1);
      expect(stats.byReaction.ignored).toBe(0);
      expect(stats.byReaction.acted).toBe(0);
    });

    it("calculates completion rate", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 14);
      expect(stats.avgCompletionRate).toBe(0.5); // 2 completed / 4 total
    });

    it("calculates dismissal rate", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 14);
      expect(stats.avgDismissalRate).toBe(0.25); // 1 dismissed / 4 total
    });

    it("respects time window", () => {
      const stats = getAgentFeedbackStats(db, "agent-1", 2);
      // Only feedback from last 2 days
      expect(stats.totalShowings).toBe(2);
    });

    it("returns zeros for agent with no feedback", () => {
      const stats = getAgentFeedbackStats(db, "unknown-agent", 14);
      expect(stats.totalShowings).toBe(0);
      expect(stats.uniqueReminders).toBe(0);
      expect(stats.avgCompletionRate).toBe(0);
    });
  });

  describe("cleanupOldFeedback", () => {
    it("removes feedback older than retention period", () => {
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      // Insert old feedback
      insertFeedbackEvent(db, {
        id: "old-1",
        reminderId: "r-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - 100 * oneDay),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(now - 100 * oneDay + 5000),
      });

      // Insert recent feedback
      insertFeedbackEvent(db, {
        id: "new-1",
        reminderId: "r-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(now - oneDay),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(now - oneDay + 5000),
      });

      const deleted = cleanupOldFeedback(db, 90);
      expect(deleted).toBe(1);

      const remaining = db.prepare(`SELECT COUNT(*) as count FROM reminder_feedback`).get() as {
        count: number;
      };
      expect(remaining.count).toBe(1);
    });

    it("returns 0 when nothing to cleanup", () => {
      insertFeedbackEvent(db, {
        id: "new-1",
        reminderId: "r-1",
        agentId: "agent-1",
        sessionKey: "main",
        shownAt: new Date(),
        reaction: "completed",
        source: "explicit",
        recordedAt: new Date(),
      });

      const deleted = cleanupOldFeedback(db, 90);
      expect(deleted).toBe(0);
    });
  });
});
