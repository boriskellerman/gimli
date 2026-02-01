/**
 * Quiet hours verification tests
 *
 * Comprehensive tests to verify that reminders don't fire during
 * configured quiet hours, with proper handling of priority levels
 * and boundary conditions.
 */

import { describe, expect, it } from "vitest";

import {
  defaultPriorityConfig,
  isQuietHours,
  selectRemindersForInjection,
  shouldBypassQuietHours,
  type PrioritySystemConfig,
  type Reminder,
  type ReminderInjectionConfig,
} from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test reminder with specified properties
 */
function createReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "rem-test",
    agentId: "main",
    title: "Test Reminder",
    trigger: { type: "scheduled", datetime: new Date("2026-01-01T10:00:00.000Z") },
    status: "pending",
    priority: "normal",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    quietHoursExempt: false,
    ...overrides,
  };
}

/**
 * Create a test config with quiet hours
 */
function createQuietConfig(
  overrides: Partial<ReminderInjectionConfig> = {},
): ReminderInjectionConfig {
  return {
    enabled: true,
    maxReminders: 3,
    includeContextual: true,
    minContextScore: 0.4,
    quietHoursStart: "22:00",
    quietHoursEnd: "07:00",
    ...overrides,
  };
}

/**
 * Create a Date object with specific hour and minute (in UTC)
 * Using a fixed date to avoid timezone issues
 */
function createTimeUTC(hour: number, minute: number = 0): Date {
  return new Date(
    `2026-01-15T${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}:00.000Z`,
  );
}

// ============================================================================
// isQuietHours Tests
// ============================================================================

describe("isQuietHours", () => {
  describe("when quiet hours are not configured", () => {
    it("returns false when quietHoursStart is undefined", () => {
      const config = createQuietConfig({ quietHoursStart: undefined });
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });

    it("returns false when quietHoursEnd is undefined", () => {
      const config = createQuietConfig({ quietHoursEnd: undefined });
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });

    it("returns false when both are undefined", () => {
      const config = createQuietConfig({ quietHoursStart: undefined, quietHoursEnd: undefined });
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });
  });

  describe("same-day quiet hours (e.g., 09:00 to 17:00)", () => {
    const config = createQuietConfig({ quietHoursStart: "09:00", quietHoursEnd: "17:00" });

    it("returns false before quiet hours start", () => {
      expect(isQuietHours(config, createTimeUTC(8, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(8, 59))).toBe(false);
    });

    it("returns true at exact start time", () => {
      expect(isQuietHours(config, createTimeUTC(9, 0))).toBe(true);
    });

    it("returns true during quiet hours", () => {
      expect(isQuietHours(config, createTimeUTC(10, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(12, 30))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(16, 59))).toBe(true);
    });

    it("returns false at exact end time", () => {
      expect(isQuietHours(config, createTimeUTC(17, 0))).toBe(false);
    });

    it("returns false after quiet hours end", () => {
      expect(isQuietHours(config, createTimeUTC(17, 1))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(18, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });
  });

  describe("overnight quiet hours (e.g., 22:00 to 07:00)", () => {
    const config = createQuietConfig({ quietHoursStart: "22:00", quietHoursEnd: "07:00" });

    it("returns false before quiet hours start (afternoon)", () => {
      expect(isQuietHours(config, createTimeUTC(12, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(21, 59))).toBe(false);
    });

    it("returns true at exact start time", () => {
      expect(isQuietHours(config, createTimeUTC(22, 0))).toBe(true);
    });

    it("returns true during evening quiet hours", () => {
      expect(isQuietHours(config, createTimeUTC(22, 30))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(23, 59))).toBe(true);
    });

    it("returns true at midnight", () => {
      expect(isQuietHours(config, createTimeUTC(0, 0))).toBe(true);
    });

    it("returns true during early morning quiet hours", () => {
      expect(isQuietHours(config, createTimeUTC(1, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(5, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(6, 59))).toBe(true);
    });

    it("returns false at exact end time", () => {
      expect(isQuietHours(config, createTimeUTC(7, 0))).toBe(false);
    });

    it("returns false after quiet hours end (morning)", () => {
      expect(isQuietHours(config, createTimeUTC(7, 1))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(8, 0))).toBe(false);
    });
  });

  describe("boundary conditions", () => {
    it("handles midnight start time (00:00 to 06:00)", () => {
      const config = createQuietConfig({ quietHoursStart: "00:00", quietHoursEnd: "06:00" });

      expect(isQuietHours(config, createTimeUTC(0, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(3, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(5, 59))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(6, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });

    it("handles midnight end time (20:00 to 00:00)", () => {
      const config = createQuietConfig({ quietHoursStart: "20:00", quietHoursEnd: "00:00" });

      // This is overnight (20:00 is after 00:00)
      expect(isQuietHours(config, createTimeUTC(19, 59))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(20, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(23, 59))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(0, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(12, 0))).toBe(false);
    });

    it("handles single minute window (10:00 to 10:01)", () => {
      const config = createQuietConfig({ quietHoursStart: "10:00", quietHoursEnd: "10:01" });

      expect(isQuietHours(config, createTimeUTC(9, 59))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(10, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(10, 1))).toBe(false);
    });

    it("handles full day quiet hours (00:00 to 23:59)", () => {
      const config = createQuietConfig({ quietHoursStart: "00:00", quietHoursEnd: "23:59" });

      expect(isQuietHours(config, createTimeUTC(0, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(12, 0))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(23, 58))).toBe(true);
      expect(isQuietHours(config, createTimeUTC(23, 59))).toBe(false);
    });
  });
});

// ============================================================================
// shouldBypassQuietHours Tests
// ============================================================================

describe("shouldBypassQuietHours", () => {
  describe("priority-based bypass", () => {
    it("urgent priority bypasses quiet hours by default", () => {
      const reminder = createReminder({ priority: "urgent", quietHoursExempt: false });
      expect(shouldBypassQuietHours(reminder)).toBe(true);
    });

    it("normal priority does not bypass quiet hours", () => {
      const reminder = createReminder({ priority: "normal", quietHoursExempt: false });
      expect(shouldBypassQuietHours(reminder)).toBe(false);
    });

    it("low priority does not bypass quiet hours", () => {
      const reminder = createReminder({ priority: "low", quietHoursExempt: false });
      expect(shouldBypassQuietHours(reminder)).toBe(false);
    });
  });

  describe("explicit exemption", () => {
    it("normal priority with quietHoursExempt bypasses quiet hours", () => {
      const reminder = createReminder({ priority: "normal", quietHoursExempt: true });
      expect(shouldBypassQuietHours(reminder)).toBe(true);
    });

    it("low priority with quietHoursExempt bypasses quiet hours", () => {
      const reminder = createReminder({ priority: "low", quietHoursExempt: true });
      expect(shouldBypassQuietHours(reminder)).toBe(true);
    });

    it("urgent priority with quietHoursExempt still bypasses (redundant but valid)", () => {
      const reminder = createReminder({ priority: "urgent", quietHoursExempt: true });
      expect(shouldBypassQuietHours(reminder)).toBe(true);
    });
  });

  describe("custom priority config", () => {
    it("respects custom config that disables urgent bypass", () => {
      const reminder = createReminder({ priority: "urgent", quietHoursExempt: false });
      const customConfig: PrioritySystemConfig = {
        ...defaultPriorityConfig,
        urgent: {
          ...defaultPriorityConfig.urgent,
          bypassQuietHours: false,
        },
      };

      expect(shouldBypassQuietHours(reminder, customConfig)).toBe(false);
    });

    it("explicit exemption overrides disabled urgent bypass", () => {
      const reminder = createReminder({ priority: "urgent", quietHoursExempt: true });
      const customConfig: PrioritySystemConfig = {
        ...defaultPriorityConfig,
        urgent: {
          ...defaultPriorityConfig.urgent,
          bypassQuietHours: false,
        },
      };

      expect(shouldBypassQuietHours(reminder, customConfig)).toBe(true);
    });
  });
});

// ============================================================================
// selectRemindersForInjection Quiet Hours Tests
// ============================================================================

describe("selectRemindersForInjection - quiet hours filtering", () => {
  describe("normal/low priority reminders held during quiet hours", () => {
    const quietConfig = createQuietConfig();

    it("holds normal priority reminders during quiet hours", () => {
      const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];
      const duringQuietHours = createTimeUTC(23, 0); // 11 PM

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("holds low priority reminders during quiet hours", () => {
      const reminders = [createReminder({ id: "rem-low", priority: "low" })];
      const duringQuietHours = createTimeUTC(3, 0); // 3 AM

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("holds multiple normal/low reminders during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-normal-1", priority: "normal" }),
        createReminder({ id: "rem-normal-2", priority: "normal" }),
        createReminder({ id: "rem-low-1", priority: "low" }),
      ];
      const duringQuietHours = createTimeUTC(23, 30);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("releases normal/low reminders after quiet hours end", () => {
      const reminders = [
        createReminder({ id: "rem-normal", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ];
      const afterQuietHours = createTimeUTC(8, 0); // 8 AM

      const selected = selectRemindersForInjection(reminders, quietConfig, afterQuietHours);

      expect(selected).toHaveLength(2);
    });
  });

  describe("urgent reminders bypass quiet hours", () => {
    const quietConfig = createQuietConfig();

    it("delivers urgent reminders during quiet hours", () => {
      const reminders = [createReminder({ id: "rem-urgent", priority: "urgent" })];
      const duringQuietHours = createTimeUTC(23, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(1);
      expect(selected[0].priority).toBe("urgent");
    });

    it("delivers multiple urgent reminders during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-urgent-1", priority: "urgent" }),
        createReminder({ id: "rem-urgent-2", priority: "urgent" }),
        createReminder({ id: "rem-urgent-3", priority: "urgent" }),
      ];
      const duringQuietHours = createTimeUTC(2, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(3);
      expect(selected.every((r) => r.priority === "urgent")).toBe(true);
    });

    it("separates urgent from held normal/low during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-urgent", priority: "urgent" }),
        createReminder({ id: "rem-normal", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ];
      const duringQuietHours = createTimeUTC(23, 30);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(1);
      expect(selected[0].id).toBe("rem-urgent");
    });
  });

  describe("quietHoursExempt reminders bypass quiet hours", () => {
    const quietConfig = createQuietConfig();

    it("delivers normal priority exempt reminder during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-exempt", priority: "normal", quietHoursExempt: true }),
      ];
      const duringQuietHours = createTimeUTC(1, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(1);
      expect(selected[0].quietHoursExempt).toBe(true);
    });

    it("delivers low priority exempt reminder during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-exempt-low", priority: "low", quietHoursExempt: true }),
      ];
      const duringQuietHours = createTimeUTC(4, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(1);
    });

    it("mixes exempt and urgent during quiet hours, holds non-exempt", () => {
      const reminders = [
        createReminder({ id: "rem-urgent", priority: "urgent", quietHoursExempt: false }),
        createReminder({ id: "rem-exempt", priority: "normal", quietHoursExempt: true }),
        createReminder({ id: "rem-held", priority: "normal", quietHoursExempt: false }),
      ];
      const duringQuietHours = createTimeUTC(0, 30);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(2);
      const ids = selected.map((r) => r.id);
      expect(ids).toContain("rem-urgent");
      expect(ids).toContain("rem-exempt");
      expect(ids).not.toContain("rem-held");
    });
  });

  describe("quiet hours boundary transitions", () => {
    const quietConfig = createQuietConfig({ quietHoursStart: "22:00", quietHoursEnd: "07:00" });

    it("delivers reminders at the exact end of quiet hours", () => {
      const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];

      // At 07:00 (end time), quiet hours should be over
      const atEndTime = createTimeUTC(7, 0);
      const selected = selectRemindersForInjection(reminders, quietConfig, atEndTime);

      expect(selected).toHaveLength(1);
    });

    it("holds reminders at the exact start of quiet hours", () => {
      const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];

      // At 22:00 (start time), quiet hours should be active
      const atStartTime = createTimeUTC(22, 0);
      const selected = selectRemindersForInjection(reminders, quietConfig, atStartTime);

      expect(selected).toHaveLength(0);
    });

    it("delivers reminders one minute before quiet hours start", () => {
      const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];

      const beforeStart = createTimeUTC(21, 59);
      const selected = selectRemindersForInjection(reminders, quietConfig, beforeStart);

      expect(selected).toHaveLength(1);
    });

    it("holds reminders one minute before quiet hours end", () => {
      const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];

      const beforeEnd = createTimeUTC(6, 59);
      const selected = selectRemindersForInjection(reminders, quietConfig, beforeEnd);

      expect(selected).toHaveLength(0);
    });
  });

  describe("quiet hours with no configuration", () => {
    const noQuietConfig = createQuietConfig({
      quietHoursStart: undefined,
      quietHoursEnd: undefined,
    });

    it("delivers all eligible reminders when no quiet hours configured", () => {
      const reminders = [
        createReminder({ id: "rem-urgent", priority: "urgent" }),
        createReminder({ id: "rem-normal", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ];

      // Even at 3 AM, reminders should be delivered
      const lateNight = createTimeUTC(3, 0);
      const selected = selectRemindersForInjection(reminders, noQuietConfig, lateNight);

      expect(selected).toHaveLength(3);
    });
  });

  describe("interaction with maxReminders limit", () => {
    const quietConfig = createQuietConfig({ maxReminders: 2 });

    it("applies maxReminders limit to exempt reminders during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-exempt-1", priority: "normal", quietHoursExempt: true }),
        createReminder({ id: "rem-exempt-2", priority: "normal", quietHoursExempt: true }),
        createReminder({ id: "rem-exempt-3", priority: "normal", quietHoursExempt: true }),
      ];
      const duringQuietHours = createTimeUTC(23, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      // maxReminders applies to normal/low, so only 2 exempt reminders
      expect(selected).toHaveLength(2);
    });

    it("urgent reminders bypass maxReminders limit during quiet hours", () => {
      const reminders = [
        createReminder({ id: "rem-urgent-1", priority: "urgent" }),
        createReminder({ id: "rem-urgent-2", priority: "urgent" }),
        createReminder({ id: "rem-urgent-3", priority: "urgent" }),
        createReminder({ id: "rem-exempt", priority: "normal", quietHoursExempt: true }),
      ];
      const duringQuietHours = createTimeUTC(1, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      // All 3 urgent (unlimited) + up to 2 normal/low (limited) = 4 total
      expect(selected).toHaveLength(4);
    });
  });

  describe("snoozed reminders during quiet hours", () => {
    const quietConfig = createQuietConfig();

    it("holds snoozed normal reminder that becomes due during quiet hours", () => {
      const reminders = [
        createReminder({
          id: "rem-snoozed",
          priority: "normal",
          status: "snoozed",
          snoozeUntil: new Date("2026-01-15T22:30:00.000Z"), // Snooze ends during quiet hours
        }),
      ];
      // After snooze ends but during quiet hours
      const duringQuietHours = createTimeUTC(23, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("delivers snoozed urgent reminder that becomes due during quiet hours", () => {
      const reminders = [
        createReminder({
          id: "rem-snoozed-urgent",
          priority: "urgent",
          status: "snoozed",
          snoozeUntil: new Date("2026-01-15T22:30:00.000Z"),
        }),
      ];
      const duringQuietHours = createTimeUTC(23, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(1);
    });
  });

  describe("various trigger types during quiet hours", () => {
    const quietConfig = createQuietConfig();

    it("holds scheduled normal reminder during quiet hours", () => {
      const reminders = [
        createReminder({
          id: "rem-scheduled",
          priority: "normal",
          trigger: { type: "scheduled", datetime: new Date("2026-01-15T10:00:00.000Z") },
        }),
      ];
      const duringQuietHours = createTimeUTC(23, 30);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("holds recurring normal reminder during quiet hours", () => {
      const reminders = [
        createReminder({
          id: "rem-recurring",
          priority: "normal",
          trigger: { type: "recurring", cron: "0 9 * * *" },
        }),
      ];
      const duringQuietHours = createTimeUTC(1, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });

    it("holds context-triggered normal reminder during quiet hours", () => {
      const reminders = [
        createReminder({
          id: "rem-context",
          priority: "normal",
          trigger: { type: "context", pattern: "expense|receipt" },
        }),
      ];
      const duringQuietHours = createTimeUTC(4, 0);

      const selected = selectRemindersForInjection(reminders, quietConfig, duringQuietHours);

      expect(selected).toHaveLength(0);
    });
  });
});

// ============================================================================
// Edge Cases and Special Scenarios
// ============================================================================

describe("quiet hours edge cases", () => {
  describe("same start and end time", () => {
    it("handles quiet hours with same start and end (effectively no quiet hours)", () => {
      const config = createQuietConfig({ quietHoursStart: "12:00", quietHoursEnd: "12:00" });

      // When start equals end, no time is within quiet hours
      expect(isQuietHours(config, createTimeUTC(12, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(0, 0))).toBe(false);
      expect(isQuietHours(config, createTimeUTC(23, 59))).toBe(false);
    });
  });

  describe("partial configuration", () => {
    it("treats missing start as no quiet hours", () => {
      const config = createQuietConfig({ quietHoursStart: undefined, quietHoursEnd: "07:00" });
      expect(isQuietHours(config, createTimeUTC(3, 0))).toBe(false);
    });

    it("treats missing end as no quiet hours", () => {
      const config = createQuietConfig({ quietHoursStart: "22:00", quietHoursEnd: undefined });
      expect(isQuietHours(config, createTimeUTC(23, 0))).toBe(false);
    });
  });

  describe("priority config variations", () => {
    it("uses provided priority config for bypass decision", () => {
      const customConfig: PrioritySystemConfig = {
        ...defaultPriorityConfig,
        urgent: {
          ...defaultPriorityConfig.urgent,
          bypassQuietHours: false,
        },
      };

      const quietConfig = createQuietConfig();
      const reminders = [
        createReminder({ id: "rem-urgent", priority: "urgent", quietHoursExempt: false }),
      ];
      const duringQuietHours = createTimeUTC(23, 0);

      const selected = selectRemindersForInjection(
        reminders,
        quietConfig,
        duringQuietHours,
        customConfig,
      );

      // With custom config, urgent does NOT bypass
      expect(selected).toHaveLength(0);
    });
  });
});
