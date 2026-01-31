/**
 * Reminder types unit tests
 *
 * Tests for type definitions, row conversion, and utility functions.
 */

import { describe, expect, it } from "vitest";

import {
  defaultReminderInjectionConfig,
  formatReminderForContext,
  formatRemindersForInjection,
  isQuietHours,
  isReminderDue,
  reminderToRow,
  rowToReminder,
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
