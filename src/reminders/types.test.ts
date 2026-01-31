/**
 * Reminder types unit tests
 *
 * Tests for type definitions, row conversion, and utility functions.
 */

import { describe, expect, it } from "vitest";

import {
  clampSnoozeDuration,
  defaultPriorityConfig,
  defaultReminderInjectionConfig,
  formatReminderForContext,
  formatRemindersForInjection,
  getRelevanceAdjustment,
  getSnoozeConstraints,
  isQuietHours,
  isReminderDue,
  isReminderEligible,
  reminderToRow,
  rowToReminder,
  selectRemindersForInjection,
  shouldAutoRepeat,
  shouldBypassQuietHours,
  sortRemindersByPriority,
  type ProactiveReminderResult,
  type Reminder,
  type ReminderInjectionConfig,
  type ReminderRow,
} from "./types.js";

describe("rowToReminder", () => {
  it("converts scheduled reminder row to Reminder object", () => {
    const row: ReminderRow = {
      id: "rem-001",
      agent_id: "main",
      title: "Call dentist",
      body: "Schedule annual checkup",
      trigger_type: "scheduled",
      trigger_spec: "2026-02-15T10:00:00.000Z",
      status: "pending",
      priority: "normal",
      created_at: 1706745600000,
      triggered_at: null,
      completed_at: null,
      snooze_until: null,
      context_tags: '["health","appointments"]',
      quiet_hours_exempt: 0,
      chunk_id: "chunk-abc",
    };

    const reminder = rowToReminder(row);

    expect(reminder.id).toBe("rem-001");
    expect(reminder.agentId).toBe("main");
    expect(reminder.title).toBe("Call dentist");
    expect(reminder.body).toBe("Schedule annual checkup");
    expect(reminder.trigger.type).toBe("scheduled");
    expect((reminder.trigger as { type: "scheduled"; datetime: Date }).datetime).toEqual(
      new Date("2026-02-15T10:00:00.000Z"),
    );
    expect(reminder.status).toBe("pending");
    expect(reminder.priority).toBe("normal");
    expect(reminder.contextTags).toEqual(["health", "appointments"]);
    expect(reminder.quietHoursExempt).toBe(false);
    expect(reminder.chunkId).toBe("chunk-abc");
  });

  it("converts recurring reminder row to Reminder object", () => {
    const row: ReminderRow = {
      id: "rem-002",
      agent_id: "work",
      title: "Daily standup",
      body: null,
      trigger_type: "recurring",
      trigger_spec: "0 9 * * 1-5",
      status: "pending",
      priority: "normal",
      created_at: 1706745600000,
      triggered_at: null,
      completed_at: null,
      snooze_until: null,
      context_tags: null,
      quiet_hours_exempt: 0,
      chunk_id: null,
    };

    const reminder = rowToReminder(row);

    expect(reminder.trigger.type).toBe("recurring");
    expect((reminder.trigger as { type: "recurring"; cron: string }).cron).toBe("0 9 * * 1-5");
    expect(reminder.body).toBeUndefined();
    expect(reminder.contextTags).toBeUndefined();
    expect(reminder.chunkId).toBeUndefined();
  });

  it("converts context reminder row to Reminder object", () => {
    const row: ReminderRow = {
      id: "rem-003",
      agent_id: "main",
      title: "Expense reports",
      body: null,
      trigger_type: "context",
      trigger_spec: "expense|reimbursement|receipt",
      status: "pending",
      priority: "low",
      created_at: 1706745600000,
      triggered_at: null,
      completed_at: null,
      snooze_until: null,
      context_tags: null,
      quiet_hours_exempt: 0,
      chunk_id: null,
    };

    const reminder = rowToReminder(row);

    expect(reminder.trigger.type).toBe("context");
    expect((reminder.trigger as { type: "context"; pattern: string }).pattern).toBe(
      "expense|reimbursement|receipt",
    );
    expect(reminder.priority).toBe("low");
  });

  it("handles snoozed reminder with snooze_until set", () => {
    const snoozeTime = Date.now() + 3600000;
    const row: ReminderRow = {
      id: "rem-004",
      agent_id: "main",
      title: "Follow up",
      body: null,
      trigger_type: "scheduled",
      trigger_spec: "2026-02-01T10:00:00.000Z",
      status: "snoozed",
      priority: "normal",
      created_at: 1706745600000,
      triggered_at: 1706800000000,
      completed_at: null,
      snooze_until: snoozeTime,
      context_tags: null,
      quiet_hours_exempt: 0,
      chunk_id: null,
    };

    const reminder = rowToReminder(row);

    expect(reminder.status).toBe("snoozed");
    expect(reminder.snoozeUntil).toEqual(new Date(snoozeTime));
    expect(reminder.triggeredAt).toEqual(new Date(1706800000000));
  });

  it("handles urgent reminder with quiet_hours_exempt", () => {
    const row: ReminderRow = {
      id: "rem-005",
      agent_id: "main",
      title: "Server down alert",
      body: null,
      trigger_type: "scheduled",
      trigger_spec: "2026-02-01T03:00:00.000Z",
      status: "pending",
      priority: "urgent",
      created_at: 1706745600000,
      triggered_at: null,
      completed_at: null,
      snooze_until: null,
      context_tags: null,
      quiet_hours_exempt: 1,
      chunk_id: null,
    };

    const reminder = rowToReminder(row);

    expect(reminder.priority).toBe("urgent");
    expect(reminder.quietHoursExempt).toBe(true);
  });
});

describe("reminderToRow", () => {
  it("converts scheduled Reminder to database row", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Call dentist",
      body: "Schedule annual checkup",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(1706745600000),
      contextTags: ["health", "appointments"],
      quietHoursExempt: false,
      chunkId: "chunk-abc",
    };

    const row = reminderToRow(reminder);

    expect(row.id).toBe("rem-001");
    expect(row.agent_id).toBe("main");
    expect(row.trigger_type).toBe("scheduled");
    expect(row.trigger_spec).toBe("2026-02-15T10:00:00.000Z");
    expect(row.context_tags).toBe('["health","appointments"]');
    expect(row.quiet_hours_exempt).toBe(0);
    expect(row.chunk_id).toBe("chunk-abc");
  });

  it("converts recurring Reminder to database row", () => {
    const reminder: Reminder = {
      id: "rem-002",
      agentId: "work",
      title: "Weekly review",
      trigger: { type: "recurring", cron: "0 17 * * 5" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(1706745600000),
      quietHoursExempt: false,
    };

    const row = reminderToRow(reminder);

    expect(row.trigger_type).toBe("recurring");
    expect(row.trigger_spec).toBe("0 17 * * 5");
    expect(row.body).toBeNull();
    expect(row.context_tags).toBeNull();
    expect(row.chunk_id).toBeNull();
  });

  it("converts context Reminder to database row", () => {
    const reminder: Reminder = {
      id: "rem-003",
      agentId: "main",
      title: "Expense reminder",
      trigger: { type: "context", pattern: "expense|receipt" },
      status: "pending",
      priority: "low",
      createdAt: new Date(1706745600000),
      quietHoursExempt: false,
    };

    const row = reminderToRow(reminder);

    expect(row.trigger_type).toBe("context");
    expect(row.trigger_spec).toBe("expense|receipt");
  });

  it("handles completed reminder with timestamps", () => {
    const reminder: Reminder = {
      id: "rem-004",
      agentId: "main",
      title: "Done task",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "completed",
      priority: "normal",
      createdAt: new Date(1706745600000),
      triggeredAt: new Date(1706800000000),
      completedAt: new Date(1706803600000),
      quietHoursExempt: false,
    };

    const row = reminderToRow(reminder);

    expect(row.status).toBe("completed");
    expect(row.triggered_at).toBe(1706800000000);
    expect(row.completed_at).toBe(1706803600000);
  });
});

describe("isReminderDue", () => {
  it("returns true for scheduled reminder past due date", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Past reminder",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const asOf = new Date("2026-01-02T10:00:00.000Z");
    expect(isReminderDue(reminder, asOf)).toBe(true);
  });

  it("returns false for scheduled reminder before due date", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Future reminder",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const asOf = new Date("2026-01-15T10:00:00.000Z");
    expect(isReminderDue(reminder, asOf)).toBe(false);
  });

  it("returns false for non-pending reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Completed reminder",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "completed",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const asOf = new Date("2026-01-02T10:00:00.000Z");
    expect(isReminderDue(reminder, asOf)).toBe(false);
  });

  it("returns false for snoozed reminder before snooze time", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Snoozed reminder",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      snoozeUntil: new Date("2026-01-03T10:00:00.000Z"),
      quietHoursExempt: false,
    };

    const asOf = new Date("2026-01-02T10:00:00.000Z");
    expect(isReminderDue(reminder, asOf)).toBe(false);
  });

  it("returns true for snoozed reminder after snooze time", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Snoozed reminder",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      snoozeUntil: new Date("2026-01-02T10:00:00.000Z"),
      quietHoursExempt: false,
    };

    const asOf = new Date("2026-01-03T10:00:00.000Z");
    expect(isReminderDue(reminder, asOf)).toBe(true);
  });

  it("returns false for recurring reminders (handled by cron)", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Daily standup",
      trigger: { type: "recurring", cron: "0 9 * * 1-5" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(isReminderDue(reminder)).toBe(false);
  });

  it("returns false for context reminders (not time-based)", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Expense reminder",
      trigger: { type: "context", pattern: "expense|receipt" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(isReminderDue(reminder)).toBe(false);
  });
});

describe("isQuietHours", () => {
  it("returns false when quiet hours not configured", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: undefined,
      quietHoursEnd: undefined,
    };

    expect(isQuietHours(config)).toBe(false);
  });

  it("returns true during quiet hours (same day)", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: "09:00",
      quietHoursEnd: "17:00",
    };

    // 10:00 AM is within 9:00 AM - 5:00 PM
    const now = new Date("2026-01-15T10:00:00.000Z");
    expect(isQuietHours(config, now)).toBe(true);
  });

  it("returns false outside quiet hours (same day)", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: "09:00",
      quietHoursEnd: "17:00",
    };

    // 8:00 AM is before 9:00 AM - 5:00 PM
    const now = new Date("2026-01-15T08:00:00.000Z");
    expect(isQuietHours(config, now)).toBe(false);
  });

  it("returns true during overnight quiet hours (after start)", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    // 11:00 PM is after 10:00 PM start
    const now = new Date("2026-01-15T23:00:00.000Z");
    expect(isQuietHours(config, now)).toBe(true);
  });

  it("returns true during overnight quiet hours (before end)", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    // 5:00 AM is before 7:00 AM end
    const now = new Date("2026-01-15T05:00:00.000Z");
    expect(isQuietHours(config, now)).toBe(true);
  });

  it("returns false outside overnight quiet hours", () => {
    const config: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    // 12:00 PM is outside 10:00 PM - 7:00 AM
    const now = new Date("2026-01-15T12:00:00.000Z");
    expect(isQuietHours(config, now)).toBe(false);
  });
});

describe("formatReminderForContext", () => {
  it("formats urgent scheduled reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Server maintenance",
      body: "Update production servers",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);

    expect(formatted).toContain("[!] Server maintenance");
    expect(formatted).toContain("Due:");
    expect(formatted).toContain("Update production servers");
  });

  it("formats normal recurring reminder", () => {
    const reminder: Reminder = {
      id: "rem-002",
      agentId: "main",
      title: "Weekly review",
      trigger: { type: "recurring", cron: "0 17 * * 5" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);

    expect(formatted).toContain("[-] Weekly review");
    expect(formatted).toContain("Recurring: 0 17 * * 5");
  });

  it("formats low priority context reminder", () => {
    const reminder: Reminder = {
      id: "rem-003",
      agentId: "main",
      title: "Expense reports",
      trigger: { type: "context", pattern: "expense|receipt" },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);

    expect(formatted).toContain("[.] Expense reports");
    expect(formatted).toContain("Context: expense|receipt");
  });
});

describe("formatRemindersForInjection", () => {
  it("returns empty string for empty array", () => {
    expect(formatRemindersForInjection([])).toBe("");
  });

  it("formats single reminder with header", () => {
    const reminders: ProactiveReminderResult[] = [
      {
        reminder: {
          id: "rem-001",
          agentId: "main",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
        relevanceScore: 0.9,
        isDue: true,
        matchSource: "schedule",
      },
    ];

    const formatted = formatRemindersForInjection(reminders);

    expect(formatted).toContain("## Active Reminders");
    expect(formatted).toContain("Test reminder");
  });

  it("formats multiple reminders", () => {
    const reminders: ProactiveReminderResult[] = [
      {
        reminder: {
          id: "rem-001",
          agentId: "main",
          title: "First reminder",
          trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
          status: "pending",
          priority: "urgent",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
        relevanceScore: 0.9,
        isDue: true,
        matchSource: "schedule",
      },
      {
        reminder: {
          id: "rem-002",
          agentId: "main",
          title: "Second reminder",
          trigger: { type: "context", pattern: "test" },
          status: "pending",
          priority: "low",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
        relevanceScore: 0.7,
        isDue: false,
        matchSource: "context",
      },
    ];

    const formatted = formatRemindersForInjection(reminders);

    expect(formatted).toContain("First reminder");
    expect(formatted).toContain("Second reminder");
    expect(formatted).toContain("[!]");
    expect(formatted).toContain("[.]");
  });
});

describe("defaultReminderInjectionConfig", () => {
  it("has expected default values", () => {
    expect(defaultReminderInjectionConfig.enabled).toBe(true);
    expect(defaultReminderInjectionConfig.maxReminders).toBe(3);
    expect(defaultReminderInjectionConfig.includeContextual).toBe(true);
    expect(defaultReminderInjectionConfig.minContextScore).toBe(0.4);
    expect(defaultReminderInjectionConfig.quietHoursStart).toBeUndefined();
    expect(defaultReminderInjectionConfig.quietHoursEnd).toBeUndefined();
  });
});

// ============================================================================
// Priority System Tests
// ============================================================================

describe("defaultPriorityConfig", () => {
  it("has expected urgent priority defaults", () => {
    expect(defaultPriorityConfig.urgent.bypassQuietHours).toBe(true);
    expect(defaultPriorityConfig.urgent.repeatOnDismissMinutes).toBe(5);
    expect(defaultPriorityConfig.urgent.minSnoozeMinutes).toBe(5);
    expect(defaultPriorityConfig.urgent.maxSnoozeMinutes).toBe(60);
    expect(defaultPriorityConfig.urgent.escalateToAllChannels).toBe(true);
    expect(defaultPriorityConfig.urgent.relevanceBoost).toBe(1.5);
  });

  it("has expected normal priority defaults", () => {
    expect(defaultPriorityConfig.normal.maxBatchSize).toBe(3);
    expect(defaultPriorityConfig.normal.minSnoozeMinutes).toBe(15);
    expect(defaultPriorityConfig.normal.maxSnoozeMinutes).toBe(24 * 60);
  });

  it("has expected low priority defaults", () => {
    expect(defaultPriorityConfig.low.coalesceByContext).toBe(true);
    expect(defaultPriorityConfig.low.digestTime).toBeNull();
    expect(defaultPriorityConfig.low.minSnoozeMinutes).toBe(60);
    expect(defaultPriorityConfig.low.maxSnoozeMinutes).toBe(7 * 24 * 60);
    expect(defaultPriorityConfig.low.relevanceFactor).toBe(0.7);
  });
});

describe("isReminderEligible", () => {
  it("returns true for pending reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Test",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(isReminderEligible(reminder)).toBe(true);
  });

  it("returns false for completed reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Test",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "completed",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(isReminderEligible(reminder)).toBe(false);
  });

  it("returns false for dismissed reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Test",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "dismissed",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(isReminderEligible(reminder)).toBe(false);
  });

  it("returns true for snoozed reminder when snooze time has passed", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Test",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "snoozed",
      priority: "normal",
      createdAt: new Date(),
      snoozeUntil: new Date("2026-01-15T10:00:00.000Z"),
      quietHoursExempt: false,
    };

    const now = new Date("2026-01-16T10:00:00.000Z");
    expect(isReminderEligible(reminder, now)).toBe(true);
  });

  it("returns false for snoozed reminder when snooze time has not passed", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Test",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "snoozed",
      priority: "normal",
      createdAt: new Date(),
      snoozeUntil: new Date("2026-01-15T10:00:00.000Z"),
      quietHoursExempt: false,
    };

    const now = new Date("2026-01-14T10:00:00.000Z");
    expect(isReminderEligible(reminder, now)).toBe(false);
  });
});

describe("shouldBypassQuietHours", () => {
  it("returns true for urgent reminder with default config", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Urgent",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(shouldBypassQuietHours(reminder)).toBe(true);
  });

  it("returns false for normal reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Normal",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(shouldBypassQuietHours(reminder)).toBe(false);
  });

  it("returns false for low priority reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Low",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    expect(shouldBypassQuietHours(reminder)).toBe(false);
  });

  it("returns true for any priority when quietHoursExempt is true", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Exempt",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: true,
    };

    expect(shouldBypassQuietHours(reminder)).toBe(true);
  });
});

describe("sortRemindersByPriority", () => {
  it("sorts urgent before normal before low", () => {
    const low: Reminder = {
      id: "rem-low",
      agentId: "main",
      title: "Low",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const normal: Reminder = {
      id: "rem-normal",
      agentId: "main",
      title: "Normal",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const urgent: Reminder = {
      id: "rem-urgent",
      agentId: "main",
      title: "Urgent",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const sorted = sortRemindersByPriority([low, normal, urgent]);

    expect(sorted[0].priority).toBe("urgent");
    expect(sorted[1].priority).toBe("normal");
    expect(sorted[2].priority).toBe("low");
  });

  it("sorts by due time within same priority", () => {
    const early: Reminder = {
      id: "rem-early",
      agentId: "main",
      title: "Early",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T08:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const late: Reminder = {
      id: "rem-late",
      agentId: "main",
      title: "Late",
      trigger: { type: "scheduled", datetime: new Date("2026-01-01T12:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const sorted = sortRemindersByPriority([late, early]);

    expect(sorted[0].id).toBe("rem-early");
    expect(sorted[1].id).toBe("rem-late");
  });

  it("does not mutate original array", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-1",
        agentId: "main",
        title: "First",
        trigger: { type: "scheduled", datetime: new Date() },
        status: "pending",
        priority: "low",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    const sorted = sortRemindersByPriority(reminders);

    expect(sorted).not.toBe(reminders);
  });
});

describe("selectRemindersForInjection", () => {
  const baseConfig: ReminderInjectionConfig = {
    enabled: true,
    maxReminders: 2,
    includeContextual: true,
    minContextScore: 0.4,
  };

  it("includes all urgent reminders regardless of limit", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-urgent-1",
        agentId: "main",
        title: "Urgent 1",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-urgent-2",
        agentId: "main",
        title: "Urgent 2",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-urgent-3",
        agentId: "main",
        title: "Urgent 3",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    const selected = selectRemindersForInjection(reminders, baseConfig);

    // All 3 urgent reminders included despite maxReminders = 2
    expect(selected).toHaveLength(3);
    expect(selected.every((r) => r.priority === "urgent")).toBe(true);
  });

  it("limits normal and low reminders to maxReminders", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-normal-1",
        agentId: "main",
        title: "Normal 1",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-normal-2",
        agentId: "main",
        title: "Normal 2",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-low-1",
        agentId: "main",
        title: "Low 1",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "low",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    const selected = selectRemindersForInjection(reminders, baseConfig);

    // Only 2 reminders (maxReminders limit)
    expect(selected).toHaveLength(2);
    // Normal reminders prioritized over low
    expect(selected.every((r) => r.priority === "normal")).toBe(true);
  });

  it("filters out completed reminders", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-pending",
        agentId: "main",
        title: "Pending",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-completed",
        agentId: "main",
        title: "Completed",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "completed",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    const selected = selectRemindersForInjection(reminders, baseConfig);

    expect(selected).toHaveLength(1);
    expect(selected[0].id).toBe("rem-pending");
  });

  it("only includes urgent during quiet hours", () => {
    const quietConfig: ReminderInjectionConfig = {
      ...baseConfig,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    const reminders: Reminder[] = [
      {
        id: "rem-urgent",
        agentId: "main",
        title: "Urgent",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-normal",
        agentId: "main",
        title: "Normal",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    // 11:00 PM is during quiet hours
    const now = new Date("2026-01-15T23:00:00.000Z");
    const selected = selectRemindersForInjection(reminders, quietConfig, now);

    expect(selected).toHaveLength(1);
    expect(selected[0].priority).toBe("urgent");
  });

  it("includes quietHoursExempt reminders during quiet hours", () => {
    const quietConfig: ReminderInjectionConfig = {
      ...baseConfig,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    const reminders: Reminder[] = [
      {
        id: "rem-exempt",
        agentId: "main",
        title: "Exempt",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "pending",
        priority: "low",
        createdAt: new Date(),
        quietHoursExempt: true,
      },
    ];

    // 11:00 PM is during quiet hours
    const now = new Date("2026-01-15T23:00:00.000Z");
    const selected = selectRemindersForInjection(reminders, quietConfig, now);

    expect(selected).toHaveLength(1);
    expect(selected[0].quietHoursExempt).toBe(true);
  });
});

describe("getSnoozeConstraints", () => {
  it("returns urgent snooze constraints", () => {
    const constraints = getSnoozeConstraints("urgent");

    expect(constraints.minMinutes).toBe(5);
    expect(constraints.maxMinutes).toBe(60);
  });

  it("returns normal snooze constraints", () => {
    const constraints = getSnoozeConstraints("normal");

    expect(constraints.minMinutes).toBe(15);
    expect(constraints.maxMinutes).toBe(24 * 60);
  });

  it("returns low snooze constraints", () => {
    const constraints = getSnoozeConstraints("low");

    expect(constraints.minMinutes).toBe(60);
    expect(constraints.maxMinutes).toBe(7 * 24 * 60);
  });
});

describe("clampSnoozeDuration", () => {
  it("clamps below minimum for urgent", () => {
    expect(clampSnoozeDuration(2, "urgent")).toBe(5);
  });

  it("clamps above maximum for urgent", () => {
    expect(clampSnoozeDuration(120, "urgent")).toBe(60);
  });

  it("returns value within range unchanged", () => {
    expect(clampSnoozeDuration(30, "urgent")).toBe(30);
  });

  it("respects normal priority constraints", () => {
    expect(clampSnoozeDuration(5, "normal")).toBe(15);
    expect(clampSnoozeDuration(30 * 24 * 60, "normal")).toBe(24 * 60);
  });

  it("respects low priority constraints", () => {
    expect(clampSnoozeDuration(30, "low")).toBe(60);
    expect(clampSnoozeDuration(10 * 24 * 60, "low")).toBe(7 * 24 * 60);
  });
});

describe("getRelevanceAdjustment", () => {
  it("returns boost for urgent", () => {
    expect(getRelevanceAdjustment("urgent")).toBe(1.5);
  });

  it("returns 1.0 for normal", () => {
    expect(getRelevanceAdjustment("normal")).toBe(1.0);
  });

  it("returns reduced factor for low", () => {
    expect(getRelevanceAdjustment("low")).toBe(0.7);
  });
});

describe("shouldAutoRepeat", () => {
  it("returns true with interval for urgent reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Urgent",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const result = shouldAutoRepeat(reminder);

    expect(result.shouldRepeat).toBe(true);
    expect(result.intervalMinutes).toBe(5);
  });

  it("returns false for normal reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Normal",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const result = shouldAutoRepeat(reminder);

    expect(result.shouldRepeat).toBe(false);
    expect(result.intervalMinutes).toBeNull();
  });

  it("returns false for low priority reminder", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Low",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const result = shouldAutoRepeat(reminder);

    expect(result.shouldRepeat).toBe(false);
    expect(result.intervalMinutes).toBeNull();
  });
});
