/**
 * Reminder delivery integration tests
 *
 * Tests for reminder creation, storage, retrieval, and delivery simulation
 * across different channel types (Telegram, Discord, WhatsApp, etc.).
 */

import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dropReminderSchema, ensureReminderSchema, getReminderStats } from "./schema.js";
import {
  formatReminderForContext,
  formatRemindersForInjection,
  isQuietHours,
  isReminderDue,
  isReminderEligible,
  reminderToRow,
  rowToReminder,
  selectRemindersForInjection,
  shouldBypassQuietHours,
  type CreateReminderInput,
  type ProactiveReminderResult,
  type Reminder,
  type ReminderInjectionConfig,
  type ReminderRow,
} from "./types.js";

// ============================================================================
// Reminder Creation Flow Tests
// ============================================================================

describe("reminder creation flow", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates and stores a scheduled reminder", () => {
    const input: CreateReminderInput = {
      agentId: "main",
      title: "Call dentist",
      body: "Schedule annual checkup",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      priority: "normal",
      contextTags: ["health", "appointments"],
    };

    // Create reminder from input
    const reminder: Reminder = {
      id: `rem-${Date.now()}`,
      agentId: input.agentId,
      title: input.title,
      body: input.body,
      trigger: input.trigger,
      status: "pending",
      priority: input.priority ?? "normal",
      createdAt: new Date(),
      contextTags: input.contextTags,
      quietHoursExempt: input.quietHoursExempt ?? false,
    };

    // Convert to row and insert
    const row = reminderToRow(reminder);
    db.prepare(`
      INSERT INTO reminders (
        id, agent_id, title, body, trigger_type, trigger_spec,
        status, priority, created_at, triggered_at, completed_at,
        snooze_until, context_tags, quiet_hours_exempt, chunk_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

    // Verify storage
    const stored = db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(reminder.id) as ReminderRow;

    expect(stored).toBeDefined();
    expect(stored.title).toBe("Call dentist");
    expect(stored.body).toBe("Schedule annual checkup");
    expect(stored.trigger_type).toBe("scheduled");
    expect(stored.status).toBe("pending");
    expect(stored.priority).toBe("normal");

    // Convert back and verify round-trip
    const retrieved = rowToReminder(stored);
    expect(retrieved.id).toBe(reminder.id);
    expect(retrieved.title).toBe(reminder.title);
    expect(retrieved.trigger.type).toBe("scheduled");
    expect((retrieved.trigger as { type: "scheduled"; datetime: Date }).datetime).toEqual(
      new Date("2026-02-15T10:00:00.000Z"),
    );
    expect(retrieved.contextTags).toEqual(["health", "appointments"]);
  });

  it("creates and stores a recurring reminder", () => {
    const input: CreateReminderInput = {
      agentId: "work",
      title: "Daily standup",
      trigger: { type: "recurring", cron: "0 9 * * 1-5" },
      priority: "normal",
    };

    const reminder: Reminder = {
      id: `rem-${Date.now()}`,
      agentId: input.agentId,
      title: input.title,
      trigger: input.trigger,
      status: "pending",
      priority: input.priority ?? "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const row = reminderToRow(reminder);
    db.prepare(`
      INSERT INTO reminders (
        id, agent_id, title, body, trigger_type, trigger_spec,
        status, priority, created_at, triggered_at, completed_at,
        snooze_until, context_tags, quiet_hours_exempt, chunk_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

    const stored = db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(reminder.id) as ReminderRow;

    expect(stored.trigger_type).toBe("recurring");
    expect(stored.trigger_spec).toBe("0 9 * * 1-5");

    const retrieved = rowToReminder(stored);
    expect(retrieved.trigger.type).toBe("recurring");
    expect((retrieved.trigger as { type: "recurring"; cron: string }).cron).toBe("0 9 * * 1-5");
  });

  it("creates and stores a context-triggered reminder", () => {
    const input: CreateReminderInput = {
      agentId: "main",
      title: "Submit expense reports",
      trigger: { type: "context", pattern: "expense|reimbursement|receipt" },
      priority: "low",
      contextTags: ["finance", "work"],
    };

    const reminder: Reminder = {
      id: `rem-${Date.now()}`,
      agentId: input.agentId,
      title: input.title,
      trigger: input.trigger,
      status: "pending",
      priority: input.priority ?? "normal",
      createdAt: new Date(),
      contextTags: input.contextTags,
      quietHoursExempt: false,
    };

    const row = reminderToRow(reminder);
    db.prepare(`
      INSERT INTO reminders (
        id, agent_id, title, body, trigger_type, trigger_spec,
        status, priority, created_at, triggered_at, completed_at,
        snooze_until, context_tags, quiet_hours_exempt, chunk_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

    const stored = db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(reminder.id) as ReminderRow;

    expect(stored.trigger_type).toBe("context");
    expect(stored.trigger_spec).toBe("expense|reimbursement|receipt");
    expect(stored.priority).toBe("low");
  });

  it("creates an urgent reminder with quiet hours exemption", () => {
    const input: CreateReminderInput = {
      agentId: "main",
      title: "Server maintenance window",
      body: "Production servers need immediate attention",
      trigger: { type: "scheduled", datetime: new Date("2026-02-01T03:00:00.000Z") },
      priority: "urgent",
      quietHoursExempt: true,
    };

    const reminder: Reminder = {
      id: `rem-${Date.now()}`,
      agentId: input.agentId,
      title: input.title,
      body: input.body,
      trigger: input.trigger,
      status: "pending",
      priority: input.priority ?? "normal",
      createdAt: new Date(),
      quietHoursExempt: input.quietHoursExempt ?? false,
    };

    const row = reminderToRow(reminder);
    db.prepare(`
      INSERT INTO reminders (
        id, agent_id, title, body, trigger_type, trigger_spec,
        status, priority, created_at, triggered_at, completed_at,
        snooze_until, context_tags, quiet_hours_exempt, chunk_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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

    const stored = db
      .prepare("SELECT * FROM reminders WHERE id = ?")
      .get(reminder.id) as ReminderRow;

    expect(stored.priority).toBe("urgent");
    expect(stored.quiet_hours_exempt).toBe(1);

    const retrieved = rowToReminder(stored);
    expect(retrieved.quietHoursExempt).toBe(true);
    expect(shouldBypassQuietHours(retrieved)).toBe(true);
  });
});

// ============================================================================
// Reminder Retrieval Tests
// ============================================================================

describe("reminder retrieval", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("retrieves pending reminders for an agent", () => {
    // Insert test reminders
    const reminders = [
      { id: "rem-1", status: "pending", priority: "normal" },
      { id: "rem-2", status: "pending", priority: "urgent" },
      { id: "rem-3", status: "completed", priority: "normal" },
      { id: "rem-4", status: "dismissed", priority: "low" },
    ];

    for (const r of reminders) {
      db.prepare(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, priority, created_at)
        VALUES (?, 'main', ?, 'scheduled', '2026-01-01T10:00:00.000Z', ?, ?, ?)
      `).run(r.id, `Test ${r.id}`, r.status, r.priority, Date.now());
    }

    const rows = db
      .prepare("SELECT * FROM reminders WHERE agent_id = ? AND status = ?")
      .all("main", "pending") as ReminderRow[];

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain("rem-1");
    expect(rows.map((r) => r.id)).toContain("rem-2");
  });

  it("retrieves reminders filtered by priority", () => {
    const reminders = [
      { id: "rem-urgent-1", priority: "urgent" },
      { id: "rem-urgent-2", priority: "urgent" },
      { id: "rem-normal-1", priority: "normal" },
      { id: "rem-low-1", priority: "low" },
    ];

    for (const r of reminders) {
      db.prepare(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, priority, created_at)
        VALUES (?, 'main', ?, 'scheduled', '2026-01-01T10:00:00.000Z', ?, ?)
      `).run(r.id, `Test ${r.id}`, r.priority, Date.now());
    }

    const urgentRows = db
      .prepare("SELECT * FROM reminders WHERE agent_id = ? AND priority = ?")
      .all("main", "urgent") as ReminderRow[];

    expect(urgentRows).toHaveLength(2);
    expect(urgentRows.every((r) => r.priority === "urgent")).toBe(true);
  });

  it("retrieves due reminders based on trigger time", () => {
    const now = new Date("2026-02-01T12:00:00.000Z");
    const reminders = [
      { id: "rem-past", datetime: "2026-01-15T10:00:00.000Z" }, // Past
      { id: "rem-now", datetime: "2026-02-01T11:00:00.000Z" }, // Past
      { id: "rem-future", datetime: "2026-02-15T10:00:00.000Z" }, // Future
    ];

    for (const r of reminders) {
      db.prepare(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
        VALUES (?, 'main', ?, 'scheduled', ?, ?)
      `).run(r.id, `Test ${r.id}`, r.datetime, Date.now());
    }

    const rows = db
      .prepare("SELECT * FROM reminders WHERE agent_id = ? AND status = 'pending'")
      .all("main") as ReminderRow[];

    const dueReminders = rows.map(rowToReminder).filter((reminder) => isReminderDue(reminder, now));

    expect(dueReminders).toHaveLength(2);
    expect(dueReminders.map((r) => r.id)).toContain("rem-past");
    expect(dueReminders.map((r) => r.id)).toContain("rem-now");
    expect(dueReminders.map((r) => r.id)).not.toContain("rem-future");
  });
});

// ============================================================================
// Delivery Simulation Tests
// ============================================================================

describe("reminder delivery simulation", () => {
  /**
   * Simulates formatting a reminder for delivery to a specific channel.
   * Each channel may have different formatting requirements.
   */
  function formatReminderForChannel(
    reminder: Reminder,
    channel: "telegram" | "discord" | "whatsapp" | "slack" | "imessage",
  ): { text: string; payload?: Record<string, unknown> } {
    const base = formatReminderForContext(reminder);

    switch (channel) {
      case "telegram":
        // Telegram supports HTML formatting
        return {
          text: base
            .replace("[!]", "<b>[URGENT]</b>")
            .replace("[-]", "[Normal]")
            .replace("[.]", "[Low]"),
          payload: {
            channelData: {
              telegram: {
                buttons:
                  reminder.priority === "urgent"
                    ? [
                        [
                          { text: "Done", callback_data: `reminder_done_${reminder.id}` },
                          { text: "Snooze", callback_data: `reminder_snooze_${reminder.id}` },
                        ],
                      ]
                    : undefined,
              },
            },
          },
        };

      case "discord":
        // Discord uses markdown
        return {
          text: base
            .replace("[!]", "**[URGENT]**")
            .replace("[-]", "[Normal]")
            .replace("[.]", "[Low]"),
          payload: {
            channelData: {
              discord: {
                embed:
                  reminder.priority === "urgent"
                    ? {
                        title: reminder.title,
                        description: reminder.body,
                        color: 0xff0000, // Red for urgent
                      }
                    : undefined,
              },
            },
          },
        };

      case "whatsapp":
        // WhatsApp has limited formatting
        return {
          text: base.replace("[!]", "*URGENT*").replace("[-]", "").replace("[.]", ""),
        };

      case "slack":
        // Slack uses mrkdwn
        return {
          text: base
            .replace("[!]", ":rotating_light: *URGENT*")
            .replace("[-]", ":bell:")
            .replace("[.]", ":memo:"),
          payload: {
            channelData: {
              slack: {
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*${reminder.title}*${reminder.body ? `\n${reminder.body}` : ""}`,
                    },
                  },
                ],
              },
            },
          },
        };

      case "imessage":
        // iMessage is plain text
        return {
          text: base.replace("[!]", "URGENT:").replace("[-]", "Reminder:").replace("[.]", "Note:"),
        };

      default:
        return { text: base };
    }
  }

  it("formats urgent reminder for Telegram with buttons", () => {
    const reminder: Reminder = {
      id: "rem-001",
      agentId: "main",
      title: "Server maintenance",
      body: "Update production servers",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T10:00:00.000Z") },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: true,
    };

    const formatted = formatReminderForChannel(reminder, "telegram");

    expect(formatted.text).toContain("<b>[URGENT]</b>");
    expect(formatted.text).toContain("Server maintenance");
    expect(formatted.payload?.channelData).toBeDefined();
    const telegram = formatted.payload?.channelData as { telegram?: { buttons?: unknown[] } };
    expect(telegram.telegram?.buttons).toBeDefined();
    expect(telegram.telegram?.buttons).toHaveLength(1);
  });

  it("formats reminder for Discord with embed for urgent priority", () => {
    const reminder: Reminder = {
      id: "rem-002",
      agentId: "main",
      title: "Deploy deadline",
      body: "Release must be out by EOD",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T17:00:00.000Z") },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForChannel(reminder, "discord");

    expect(formatted.text).toContain("**[URGENT]**");
    expect(formatted.payload?.channelData).toBeDefined();
    const discord = formatted.payload?.channelData as {
      discord?: { embed?: { color: number } };
    };
    expect(discord.discord?.embed?.color).toBe(0xff0000);
  });

  it("formats reminder for WhatsApp with simple formatting", () => {
    const reminder: Reminder = {
      id: "rem-003",
      agentId: "main",
      title: "Pick up groceries",
      trigger: { type: "scheduled", datetime: new Date("2026-02-15T18:00:00.000Z") },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForChannel(reminder, "whatsapp");

    expect(formatted.text).toContain("Pick up groceries");
    // Normal priority should not have special formatting
    expect(formatted.text).not.toContain("*URGENT*");
    expect(formatted.payload).toBeUndefined();
  });

  it("formats reminder for Slack with blocks", () => {
    const reminder: Reminder = {
      id: "rem-004",
      agentId: "work",
      title: "Team meeting",
      body: "Quarterly review with stakeholders",
      trigger: { type: "recurring", cron: "0 14 * * 1" },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForChannel(reminder, "slack");

    expect(formatted.text).toContain(":bell:");
    expect(formatted.text).toContain("Team meeting");
    expect(formatted.payload?.channelData).toBeDefined();
    const slack = formatted.payload?.channelData as { slack?: { blocks?: unknown[] } };
    expect(slack.slack?.blocks).toBeDefined();
  });

  it("formats low priority reminder for iMessage", () => {
    const reminder: Reminder = {
      id: "rem-005",
      agentId: "main",
      title: "Water plants",
      trigger: { type: "context", pattern: "garden|plants|water" },
      status: "pending",
      priority: "low",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForChannel(reminder, "imessage");

    expect(formatted.text).toContain("Note:");
    expect(formatted.text).toContain("Water plants");
  });
});

// ============================================================================
// Delivery Selection Tests
// ============================================================================

describe("reminder delivery selection", () => {
  it("selects reminders respecting priority order", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-low",
        agentId: "main",
        title: "Low priority",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "low",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-normal",
        agentId: "main",
        title: "Normal priority",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-urgent",
        agentId: "main",
        title: "Urgent priority",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
    ];

    const config: ReminderInjectionConfig = {
      enabled: true,
      maxReminders: 2,
      includeContextual: true,
      minContextScore: 0.4,
    };

    const selected = selectRemindersForInjection(reminders, config);

    // Urgent is always first, then normal (up to limit)
    expect(selected[0].priority).toBe("urgent");
    // Normal and low compete for remaining slots
    expect(selected.some((r) => r.priority === "normal")).toBe(true);
  });

  it("filters out non-eligible reminders during selection", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-pending",
        agentId: "main",
        title: "Pending",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-completed",
        agentId: "main",
        title: "Completed",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "completed",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-snoozed-active",
        agentId: "main",
        title: "Snoozed but due",
        trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
        status: "snoozed",
        priority: "normal",
        createdAt: new Date(),
        snoozeUntil: new Date("2026-01-15T10:00:00.000Z"),
        quietHoursExempt: false,
      },
    ];

    const config: ReminderInjectionConfig = {
      enabled: true,
      maxReminders: 5,
      includeContextual: true,
      minContextScore: 0.4,
    };

    // Check at time after snooze has expired
    const now = new Date("2026-02-01T12:00:00.000Z");
    const selected = selectRemindersForInjection(reminders, config, now);

    expect(selected).toHaveLength(2);
    expect(selected.map((r) => r.id)).toContain("rem-pending");
    expect(selected.map((r) => r.id)).toContain("rem-snoozed-active");
    expect(selected.map((r) => r.id)).not.toContain("rem-completed");
  });

  it("respects quiet hours for non-urgent reminders", () => {
    const reminders: Reminder[] = [
      {
        id: "rem-urgent",
        agentId: "main",
        title: "Urgent",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-normal",
        agentId: "main",
        title: "Normal",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      },
      {
        id: "rem-exempt",
        agentId: "main",
        title: "Exempt normal",
        trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: true,
      },
    ];

    const config: ReminderInjectionConfig = {
      enabled: true,
      maxReminders: 5,
      includeContextual: true,
      minContextScore: 0.4,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    // During quiet hours (11 PM)
    const quietTime = new Date("2026-02-01T23:00:00.000Z");
    const selected = selectRemindersForInjection(reminders, config, quietTime);

    expect(selected).toHaveLength(2);
    expect(selected.map((r) => r.id)).toContain("rem-urgent");
    expect(selected.map((r) => r.id)).toContain("rem-exempt");
    expect(selected.map((r) => r.id)).not.toContain("rem-normal");
  });
});

// ============================================================================
// Multi-Channel Delivery Tests
// ============================================================================

describe("multi-channel delivery simulation", () => {
  /**
   * Simulates delivering reminders to multiple channels based on user preferences.
   */
  interface DeliveryResult {
    channel: string;
    reminderId: string;
    success: boolean;
    messageId?: string;
    error?: string;
  }

  async function simulateDelivery(
    reminder: Reminder,
    channels: string[],
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];

    for (const channel of channels) {
      // Simulate delivery with mock success/failure
      const success = Math.random() > 0.1; // 90% success rate
      results.push({
        channel,
        reminderId: reminder.id,
        success,
        messageId: success ? `msg-${channel}-${Date.now()}` : undefined,
        error: success ? undefined : "Delivery failed",
      });
    }

    return results;
  }

  it("delivers urgent reminder to all channels", async () => {
    const reminder: Reminder = {
      id: "rem-urgent-multi",
      agentId: "main",
      title: "Critical alert",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "urgent",
      createdAt: new Date(),
      quietHoursExempt: true,
    };

    const channels = ["telegram", "discord", "whatsapp"];
    const results = await simulateDelivery(reminder, channels);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.reminderId === reminder.id)).toBe(true);
    expect(results.map((r) => r.channel)).toEqual(channels);
  });

  it("handles partial delivery failure gracefully", async () => {
    const reminder: Reminder = {
      id: "rem-partial",
      agentId: "main",
      title: "Test reminder",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    // Force deterministic results for testing
    const mockDelivery = async (r: Reminder, channels: string[]): Promise<DeliveryResult[]> => {
      return channels.map((channel, idx) => ({
        channel,
        reminderId: r.id,
        success: idx !== 1, // Second channel fails
        messageId: idx !== 1 ? `msg-${channel}` : undefined,
        error: idx === 1 ? "Channel unavailable" : undefined,
      }));
    };

    const results = await mockDelivery(reminder, ["telegram", "discord", "whatsapp"]);

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    expect(successful).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0].channel).toBe("discord");
    expect(failed[0].error).toBe("Channel unavailable");
  });
});

// ============================================================================
// Injection Formatting Tests
// ============================================================================

describe("reminder injection formatting", () => {
  it("formats multiple reminders for context injection", () => {
    const reminders: ProactiveReminderResult[] = [
      {
        reminder: {
          id: "rem-1",
          agentId: "main",
          title: "Urgent task",
          trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
          status: "pending",
          priority: "urgent",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
        relevanceScore: 1.0,
        isDue: true,
        matchSource: "schedule",
      },
      {
        reminder: {
          id: "rem-2",
          agentId: "main",
          title: "Context reminder",
          body: "Related to current conversation",
          trigger: { type: "context", pattern: "meeting|schedule" },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
        relevanceScore: 0.8,
        isDue: false,
        matchSource: "context",
      },
    ];

    const formatted = formatRemindersForInjection(reminders);

    expect(formatted).toContain("## Active Reminders");
    expect(formatted).toContain("[!] Urgent task");
    expect(formatted).toContain("[-] Context reminder");
    expect(formatted).toContain("Related to current conversation");
  });

  it("returns empty string for no reminders", () => {
    const formatted = formatRemindersForInjection([]);
    expect(formatted).toBe("");
  });
});

// ============================================================================
// Database Integration Tests
// ============================================================================

describe("database integration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    ensureReminderSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("tracks reminder lifecycle through status changes", () => {
    // Create reminder
    const id = `rem-lifecycle-${Date.now()}`;
    db.prepare(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
      VALUES (?, 'main', 'Lifecycle test', 'scheduled', '2026-02-01T10:00:00.000Z', 'pending', ?)
    `).run(id, Date.now());

    // Verify pending
    let row = db.prepare("SELECT status FROM reminders WHERE id = ?").get(id) as { status: string };
    expect(row.status).toBe("pending");

    // Trigger reminder
    const triggeredAt = Date.now();
    db.prepare("UPDATE reminders SET status = 'triggered', triggered_at = ? WHERE id = ?").run(
      triggeredAt,
      id,
    );

    row = db.prepare("SELECT status, triggered_at FROM reminders WHERE id = ?").get(id) as {
      status: string;
      triggered_at: number;
    };
    expect(row.status).toBe("triggered");
    expect(row.triggered_at).toBe(triggeredAt);

    // Snooze reminder
    const snoozeUntil = Date.now() + 3600000;
    db.prepare("UPDATE reminders SET status = 'snoozed', snooze_until = ? WHERE id = ?").run(
      snoozeUntil,
      id,
    );

    row = db.prepare("SELECT status, snooze_until FROM reminders WHERE id = ?").get(id) as {
      status: string;
      snooze_until: number;
    };
    expect(row.status).toBe("snoozed");
    expect(row.snooze_until).toBe(snoozeUntil);

    // Complete reminder
    const completedAt = Date.now();
    db.prepare("UPDATE reminders SET status = 'completed', completed_at = ? WHERE id = ?").run(
      completedAt,
      id,
    );

    row = db.prepare("SELECT status, completed_at FROM reminders WHERE id = ?").get(id) as {
      status: string;
      completed_at: number;
    };
    expect(row.status).toBe("completed");
    expect(row.completed_at).toBe(completedAt);
  });

  it("maintains accurate stats across operations", () => {
    // Insert varied reminders
    const statuses = ["pending", "pending", "triggered", "completed", "dismissed", "snoozed"];
    for (let i = 0; i < statuses.length; i++) {
      db.prepare(`
        INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, status, created_at)
        VALUES (?, 'main', ?, 'scheduled', '2026-02-01T10:00:00.000Z', ?, ?)
      `).run(`rem-stat-${i}`, `Test ${i}`, statuses[i], Date.now());
    }

    const stats = getReminderStats(db, "main");

    expect(stats.pending).toBe(2);
    expect(stats.triggered).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.dismissed).toBe(1);
    expect(stats.snoozed).toBe(1);
    expect(stats.total).toBe(6);
  });

  it("isolates reminders by agent", () => {
    // Insert reminders for different agents
    db.prepare(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES (?, ?, ?, 'scheduled', '2026-02-01T10:00:00.000Z', ?)
    `).run("rem-main-1", "main", "Main 1", Date.now());

    db.prepare(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES (?, ?, ?, 'scheduled', '2026-02-01T10:00:00.000Z', ?)
    `).run("rem-main-2", "main", "Main 2", Date.now());

    db.prepare(`
      INSERT INTO reminders (id, agent_id, title, trigger_type, trigger_spec, created_at)
      VALUES (?, ?, ?, 'scheduled', '2026-02-01T10:00:00.000Z', ?)
    `).run("rem-work-1", "work", "Work 1", Date.now());

    const mainStats = getReminderStats(db, "main");
    const workStats = getReminderStats(db, "work");

    expect(mainStats.total).toBe(2);
    expect(workStats.total).toBe(1);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe("edge cases", () => {
  it("handles reminder with no body gracefully", () => {
    const reminder: Reminder = {
      id: "rem-nobody",
      agentId: "main",
      title: "Title only",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);

    expect(formatted).toContain("Title only");
    expect(formatted).toContain("[-]");
  });

  it("handles very long reminder titles", () => {
    const longTitle = "A".repeat(500);
    const reminder: Reminder = {
      id: "rem-long",
      agentId: "main",
      title: longTitle,
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);
    expect(formatted).toContain(longTitle);
  });

  it("handles reminder with special characters in title", () => {
    const reminder: Reminder = {
      id: "rem-special",
      agentId: "main",
      title: "Meeting with <John> & 'Team' \"Leaders\"",
      trigger: { type: "scheduled", datetime: new Date() },
      status: "pending",
      priority: "normal",
      createdAt: new Date(),
      quietHoursExempt: false,
    };

    const formatted = formatReminderForContext(reminder);
    expect(formatted).toContain("<John>");
    expect(formatted).toContain("& 'Team'");
  });

  it("handles reminder at exact quiet hours boundary", () => {
    const config: ReminderInjectionConfig = {
      enabled: true,
      maxReminders: 3,
      includeContextual: true,
      minContextScore: 0.4,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    };

    // Exactly at start of quiet hours
    const atStart = new Date("2026-02-01T22:00:00.000Z");
    expect(isQuietHours(config, atStart)).toBe(true);

    // Just before end of quiet hours
    const beforeEnd = new Date("2026-02-01T06:59:00.000Z");
    expect(isQuietHours(config, beforeEnd)).toBe(true);

    // Exactly at end of quiet hours
    const atEnd = new Date("2026-02-01T07:00:00.000Z");
    expect(isQuietHours(config, atEnd)).toBe(false);
  });
});
