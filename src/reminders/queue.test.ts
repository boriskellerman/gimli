/**
 * Reminder queue unit tests
 *
 * Tests for the priority-aware reminder queue including:
 * - Priority-based ordering
 * - Quiet hours handling
 * - Context coalescing for low-priority reminders
 * - Batching for normal-priority reminders
 */

import { describe, expect, it, beforeEach } from "vitest";

import {
  createReminderQueue,
  formatBatch,
  formatCoalescedGroup,
  getDeliveryOrder,
  processRemindersForDelivery,
  ReminderQueue,
  type QueueProcessResult,
  type ReminderQueueConfig,
} from "./queue.js";
import {
  defaultPriorityConfig,
  defaultReminderInjectionConfig,
  type Reminder,
  type ReminderInjectionConfig,
} from "./types.js";

// Helper to create test reminders
function createReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: `rem-${Math.random().toString(36).slice(2, 8)}`,
    agentId: "main",
    title: "Test reminder",
    trigger: { type: "scheduled", datetime: new Date("2026-02-01T10:00:00.000Z") },
    status: "pending",
    priority: "normal",
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    quietHoursExempt: false,
    ...overrides,
  };
}

describe("ReminderQueue", () => {
  let queue: ReminderQueue;

  beforeEach(() => {
    queue = new ReminderQueue();
  });

  describe("basic operations", () => {
    it("adds a reminder to the queue", () => {
      const reminder = createReminder({ id: "rem-001" });
      queue.add(reminder);

      expect(queue.size).toBe(1);
      expect(queue.has("rem-001")).toBe(true);
    });

    it("adds multiple reminders", () => {
      const reminders = [
        createReminder({ id: "rem-001" }),
        createReminder({ id: "rem-002" }),
        createReminder({ id: "rem-003" }),
      ];
      queue.addAll(reminders);

      expect(queue.size).toBe(3);
    });

    it("removes a reminder from the queue", () => {
      const reminder = createReminder({ id: "rem-001" });
      queue.add(reminder);
      expect(queue.has("rem-001")).toBe(true);

      const removed = queue.remove("rem-001");
      expect(removed).toBe(true);
      expect(queue.has("rem-001")).toBe(false);
    });

    it("returns false when removing non-existent reminder", () => {
      expect(queue.remove("non-existent")).toBe(false);
    });

    it("gets a reminder by ID", () => {
      const reminder = createReminder({ id: "rem-001", title: "Test" });
      queue.add(reminder);

      const queued = queue.get("rem-001");
      expect(queued).toBeDefined();
      expect(queued?.reminder.title).toBe("Test");
    });

    it("returns undefined for non-existent reminder", () => {
      expect(queue.get("non-existent")).toBeUndefined();
    });

    it("clears all reminders", () => {
      queue.addAll([createReminder({ id: "rem-001" }), createReminder({ id: "rem-002" })]);
      expect(queue.size).toBe(2);

      queue.clear();
      expect(queue.size).toBe(0);
    });

    it("gets all queued reminders", () => {
      queue.addAll([createReminder({ id: "rem-001" }), createReminder({ id: "rem-002" })]);

      const all = queue.getAll();
      expect(all).toHaveLength(2);
    });

    it("gets reminders by priority", () => {
      queue.addAll([
        createReminder({ id: "rem-urgent", priority: "urgent" }),
        createReminder({ id: "rem-normal-1", priority: "normal" }),
        createReminder({ id: "rem-normal-2", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ]);

      expect(queue.getByPriority("urgent")).toHaveLength(1);
      expect(queue.getByPriority("normal")).toHaveLength(2);
      expect(queue.getByPriority("low")).toHaveLength(1);
    });

    it("sets queue metadata on add", () => {
      const reminder = createReminder({ id: "rem-001" });
      queue.add(reminder);

      const queued = queue.get("rem-001");
      expect(queued?.queuedAt).toBeInstanceOf(Date);
      expect(queued?.deliveryAttempts).toBe(0);
      expect(queued?.batched).toBe(false);
      expect(queued?.coalesced).toBe(false);
    });
  });

  describe("process - priority ordering", () => {
    it("returns urgent reminders in immediate", () => {
      queue.addAll([
        createReminder({ id: "rem-urgent-1", priority: "urgent" }),
        createReminder({ id: "rem-urgent-2", priority: "urgent" }),
      ]);

      const result = queue.process();

      expect(result.immediate).toHaveLength(2);
      expect(result.immediate.every((r) => r.priority === "urgent")).toBe(true);
    });

    it("returns normal reminders in batches", () => {
      queue.addAll([
        createReminder({ id: "rem-normal-1", priority: "normal" }),
        createReminder({ id: "rem-normal-2", priority: "normal" }),
      ]);

      const result = queue.process();

      expect(result.immediate).toHaveLength(0);
      expect(result.batches).toHaveLength(1);
      expect(result.batches[0].reminders).toHaveLength(2);
    });

    it("returns low reminders in coalesced groups", () => {
      queue.addAll([
        createReminder({ id: "rem-low-1", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-low-2", priority: "low", contextTags: ["health"] }),
      ]);

      const result = queue.process();

      expect(result.immediate).toHaveLength(0);
      expect(result.batches).toHaveLength(0);
      expect(result.coalesced).toHaveLength(1);
      expect(result.coalesced[0].reminders).toHaveLength(2);
    });

    it("filters out non-eligible reminders", () => {
      queue.addAll([
        createReminder({ id: "rem-pending", status: "pending" }),
        createReminder({ id: "rem-completed", status: "completed" }),
        createReminder({ id: "rem-dismissed", status: "dismissed" }),
      ]);

      const result = queue.process();

      // Only pending should be processed
      const allProcessed = [
        ...result.immediate,
        ...result.batches.flatMap((b) => b.reminders),
        ...result.coalesced.flatMap((c) => c.reminders),
      ];
      expect(allProcessed).toHaveLength(1);
      expect(allProcessed[0].id).toBe("rem-pending");
    });

    it("handles snoozed reminders based on snooze time", () => {
      const now = new Date("2026-01-20T10:00:00.000Z");

      queue.addAll([
        // Snooze expired - should be eligible
        createReminder({
          id: "rem-snooze-expired",
          status: "snoozed",
          snoozeUntil: new Date("2026-01-19T10:00:00.000Z"),
        }),
        // Snooze still active - should not be eligible
        createReminder({
          id: "rem-snooze-active",
          status: "snoozed",
          snoozeUntil: new Date("2026-01-21T10:00:00.000Z"),
        }),
      ]);

      const result = queue.process(now);

      const allProcessed = [
        ...result.immediate,
        ...result.batches.flatMap((b) => b.reminders),
        ...result.coalesced.flatMap((c) => c.reminders),
      ];
      expect(allProcessed).toHaveLength(1);
      expect(allProcessed[0].id).toBe("rem-snooze-expired");
    });
  });

  describe("process - quiet hours", () => {
    const quietConfig: ReminderQueueConfig = {
      injection: {
        ...defaultReminderInjectionConfig,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
      },
      priority: defaultPriorityConfig,
    };

    it("holds non-urgent reminders during quiet hours", () => {
      const queue = new ReminderQueue(quietConfig);
      queue.addAll([
        createReminder({ id: "rem-normal", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ]);

      // 11:00 PM is during quiet hours (22:00 - 07:00)
      const now = new Date("2026-01-15T23:00:00.000Z");
      const result = queue.process(now);

      expect(result.held).toHaveLength(2);
      expect(result.immediate).toHaveLength(0);
      expect(result.batches).toHaveLength(0);
      expect(result.coalesced).toHaveLength(0);
    });

    it("delivers urgent reminders during quiet hours", () => {
      const queue = new ReminderQueue(quietConfig);
      queue.addAll([
        createReminder({ id: "rem-urgent", priority: "urgent" }),
        createReminder({ id: "rem-normal", priority: "normal" }),
      ]);

      const now = new Date("2026-01-15T23:00:00.000Z");
      const result = queue.process(now);

      expect(result.immediate).toHaveLength(1);
      expect(result.immediate[0].priority).toBe("urgent");
      expect(result.held).toHaveLength(1);
      expect(result.held[0].priority).toBe("normal");
    });

    it("delivers quiet hours exempt reminders during quiet hours", () => {
      const queue = new ReminderQueue(quietConfig);
      queue.addAll([
        createReminder({
          id: "rem-exempt",
          priority: "low",
          quietHoursExempt: true,
        }),
        createReminder({ id: "rem-normal", priority: "normal" }),
      ]);

      const now = new Date("2026-01-15T23:00:00.000Z");
      const result = queue.process(now);

      // Exempt low-priority should be in coalesced (not held)
      expect(result.coalesced.flatMap((c) => c.reminders)).toHaveLength(1);
      expect(result.held).toHaveLength(1);
    });

    it("delivers all reminders outside quiet hours", () => {
      const queue = new ReminderQueue(quietConfig);
      queue.addAll([
        createReminder({ id: "rem-normal", priority: "normal" }),
        createReminder({ id: "rem-low", priority: "low" }),
      ]);

      // 12:00 PM is outside quiet hours
      const now = new Date("2026-01-15T12:00:00.000Z");
      const result = queue.process(now);

      expect(result.held).toHaveLength(0);
      expect(result.batches.flatMap((b) => b.reminders)).toHaveLength(1);
      expect(result.coalesced.flatMap((c) => c.reminders)).toHaveLength(1);
    });
  });

  describe("process - batching normal reminders", () => {
    it("batches normal reminders up to maxBatchSize", () => {
      const config: ReminderQueueConfig = {
        injection: defaultReminderInjectionConfig,
        priority: {
          ...defaultPriorityConfig,
          normal: { ...defaultPriorityConfig.normal, maxBatchSize: 2 },
        },
      };
      const queue = new ReminderQueue(config);

      queue.addAll([
        createReminder({ id: "rem-1", priority: "normal", createdAt: new Date("2026-01-01") }),
        createReminder({ id: "rem-2", priority: "normal", createdAt: new Date("2026-01-02") }),
        createReminder({ id: "rem-3", priority: "normal", createdAt: new Date("2026-01-03") }),
        createReminder({ id: "rem-4", priority: "normal", createdAt: new Date("2026-01-04") }),
        createReminder({ id: "rem-5", priority: "normal", createdAt: new Date("2026-01-05") }),
      ]);

      const result = queue.process();

      // 5 reminders / batch size 2 = 3 batches (2, 2, 1)
      expect(result.batches).toHaveLength(3);
      expect(result.batches[0].reminders).toHaveLength(2);
      expect(result.batches[1].reminders).toHaveLength(2);
      expect(result.batches[2].reminders).toHaveLength(1);
    });

    it("marks reminders as batched with batch ID", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-1", priority: "normal" }),
        createReminder({ id: "rem-2", priority: "normal" }),
      ]);

      const result = queue.process();

      const queued1 = queue.get("rem-1");
      const queued2 = queue.get("rem-2");

      expect(queued1?.batched).toBe(true);
      expect(queued2?.batched).toBe(true);
      expect(queued1?.batchId).toBe(result.batches[0].id);
      expect(queued2?.batchId).toBe(result.batches[0].id);
    });

    it("batches in creation order", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-late", priority: "normal", createdAt: new Date("2026-01-03") }),
        createReminder({ id: "rem-early", priority: "normal", createdAt: new Date("2026-01-01") }),
        createReminder({ id: "rem-mid", priority: "normal", createdAt: new Date("2026-01-02") }),
      ]);

      const result = queue.process();

      const batchedIds = result.batches[0].reminders.map((r) => r.id);
      expect(batchedIds).toEqual(["rem-early", "rem-mid", "rem-late"]);
    });
  });

  describe("process - coalescing low reminders", () => {
    it("coalesces low reminders by context tag", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-health-1", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-health-2", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-work-1", priority: "low", contextTags: ["work"] }),
      ]);

      const result = queue.process();

      expect(result.coalesced).toHaveLength(2);

      const healthGroup = result.coalesced.find((c) => c.contextTag === "health");
      const workGroup = result.coalesced.find((c) => c.contextTag === "work");

      expect(healthGroup?.reminders).toHaveLength(2);
      expect(workGroup?.reminders).toHaveLength(1);
    });

    it("uses 'general' tag for reminders without context tags", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-no-tags", priority: "low" }),
        createReminder({ id: "rem-tagged", priority: "low", contextTags: ["health"] }),
      ]);

      const result = queue.process();

      const generalGroup = result.coalesced.find((c) => c.contextTag === "general");
      expect(generalGroup).toBeDefined();
      expect(generalGroup?.reminders).toHaveLength(1);
    });

    it("generates summary for coalesced groups", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({
          id: "rem-1",
          priority: "low",
          contextTags: ["health"],
          title: "Take meds",
        }),
        createReminder({
          id: "rem-2",
          priority: "low",
          contextTags: ["health"],
          title: "Exercise",
        }),
      ]);

      const result = queue.process();

      const healthGroup = result.coalesced.find((c) => c.contextTag === "health");
      expect(healthGroup?.summary).toBe("2 health reminders");
    });

    it("uses title as summary for single-reminder groups", () => {
      const queue = new ReminderQueue();
      queue.add(
        createReminder({
          id: "rem-1",
          priority: "low",
          contextTags: ["health"],
          title: "Take meds",
        }),
      );

      const result = queue.process();

      const healthGroup = result.coalesced.find((c) => c.contextTag === "health");
      expect(healthGroup?.summary).toBe("Take meds");
    });

    it("marks reminders as coalesced with coalescedIds", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-1", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-2", priority: "low", contextTags: ["health"] }),
      ]);

      queue.process();

      const queued1 = queue.get("rem-1");
      const queued2 = queue.get("rem-2");

      expect(queued1?.coalesced).toBe(true);
      expect(queued2?.coalesced).toBe(true);
      expect(queued1?.coalescedIds).toContain("rem-2");
      expect(queued2?.coalescedIds).toContain("rem-1");
    });

    it("skips coalescing when disabled", () => {
      const config: ReminderQueueConfig = {
        injection: defaultReminderInjectionConfig,
        priority: {
          ...defaultPriorityConfig,
          low: { ...defaultPriorityConfig.low, coalesceByContext: false },
        },
      };
      const queue = new ReminderQueue(config);

      queue.addAll([
        createReminder({ id: "rem-1", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-2", priority: "low", contextTags: ["health"] }),
      ]);

      const result = queue.process();

      // Each reminder should be its own group
      expect(result.coalesced).toHaveLength(2);
      expect(result.coalesced[0].reminders).toHaveLength(1);
      expect(result.coalesced[1].reminders).toHaveLength(1);
    });
  });

  describe("getNextDeliveryTime", () => {
    it("returns now when quiet hours not configured", () => {
      const queue = new ReminderQueue();
      const now = new Date("2026-01-15T10:00:00.000Z");

      const nextDelivery = queue.getNextDeliveryTime(now);

      expect(nextDelivery).toEqual(now);
    });

    it("returns now when outside quiet hours", () => {
      const config: ReminderQueueConfig = {
        injection: {
          ...defaultReminderInjectionConfig,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00",
        },
        priority: defaultPriorityConfig,
      };
      const queue = new ReminderQueue(config);

      // 12:00 PM is outside quiet hours
      const now = new Date("2026-01-15T12:00:00.000Z");
      const nextDelivery = queue.getNextDeliveryTime(now);

      expect(nextDelivery).toEqual(now);
    });

    it("returns end of quiet hours when inside quiet hours", () => {
      const config: ReminderQueueConfig = {
        injection: {
          ...defaultReminderInjectionConfig,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00",
        },
        priority: defaultPriorityConfig,
      };
      const queue = new ReminderQueue(config);

      // 11:00 PM is during quiet hours
      const now = new Date("2026-01-15T23:00:00.000Z");
      const nextDelivery = queue.getNextDeliveryTime(now);

      // Should be 07:00 the next day
      expect(nextDelivery.getHours()).toBe(7);
      expect(nextDelivery.getMinutes()).toBe(0);
    });

    it("handles early morning quiet hours correctly", () => {
      const config: ReminderQueueConfig = {
        injection: {
          ...defaultReminderInjectionConfig,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00",
        },
        priority: defaultPriorityConfig,
      };
      const queue = new ReminderQueue(config);

      // 3:00 AM is during quiet hours
      const now = new Date("2026-01-15T03:00:00.000Z");
      const nextDelivery = queue.getNextDeliveryTime(now);

      // Should be 07:00 same day
      expect(nextDelivery.getHours()).toBe(7);
      expect(nextDelivery.getDate()).toBe(now.getDate());
    });
  });

  describe("delivery attempts", () => {
    it("increments delivery attempts", () => {
      const queue = new ReminderQueue();
      queue.add(createReminder({ id: "rem-001" }));

      expect(queue.get("rem-001")?.deliveryAttempts).toBe(0);

      queue.incrementDeliveryAttempts("rem-001");
      expect(queue.get("rem-001")?.deliveryAttempts).toBe(1);

      queue.incrementDeliveryAttempts("rem-001");
      expect(queue.get("rem-001")?.deliveryAttempts).toBe(2);
    });

    it("returns 0 for non-existent reminder", () => {
      const queue = new ReminderQueue();
      expect(queue.incrementDeliveryAttempts("non-existent")).toBe(0);
    });

    it("gets failed deliveries by max attempts", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-1" }),
        createReminder({ id: "rem-2" }),
        createReminder({ id: "rem-3" }),
      ]);

      queue.incrementDeliveryAttempts("rem-1");
      queue.incrementDeliveryAttempts("rem-1");
      queue.incrementDeliveryAttempts("rem-1"); // 3 attempts

      queue.incrementDeliveryAttempts("rem-2"); // 1 attempt

      const failed = queue.getFailedDeliveries(3);
      expect(failed).toHaveLength(1);
      expect(failed[0].reminder.id).toBe("rem-1");
    });
  });

  describe("configuration", () => {
    it("updates configuration", () => {
      const queue = new ReminderQueue();
      const originalConfig = queue.getConfig();

      queue.updateConfig({
        injection: { ...originalConfig.injection, maxReminders: 5 },
      });

      expect(queue.getConfig().injection.maxReminders).toBe(5);
    });

    it("preserves unmodified config values", () => {
      const queue = new ReminderQueue();

      queue.updateConfig({
        injection: { ...defaultReminderInjectionConfig, maxReminders: 5 },
      });

      expect(queue.getConfig().priority).toEqual(defaultPriorityConfig);
    });
  });

  describe("getStats", () => {
    it("returns correct queue statistics", () => {
      const queue = new ReminderQueue();
      queue.addAll([
        createReminder({ id: "rem-urgent-1", priority: "urgent" }),
        createReminder({ id: "rem-urgent-2", priority: "urgent" }),
        createReminder({ id: "rem-normal-1", priority: "normal" }),
        createReminder({ id: "rem-low-1", priority: "low", contextTags: ["health"] }),
        createReminder({ id: "rem-low-2", priority: "low", contextTags: ["health"] }),
      ]);

      // Process to set batched/coalesced flags
      queue.process();

      const stats = queue.getStats();

      expect(stats.total).toBe(5);
      expect(stats.byPriority.urgent).toBe(2);
      expect(stats.byPriority.normal).toBe(1);
      expect(stats.byPriority.low).toBe(2);
      expect(stats.batched).toBe(1); // Normal reminder is batched
      expect(stats.coalesced).toBe(2); // Low reminders are coalesced
    });
  });
});

describe("createReminderQueue", () => {
  it("creates a queue with default config", () => {
    const queue = createReminderQueue();
    expect(queue).toBeInstanceOf(ReminderQueue);
    expect(queue.getConfig().injection).toEqual(defaultReminderInjectionConfig);
  });

  it("creates a queue with custom config", () => {
    const customInjection: ReminderInjectionConfig = {
      ...defaultReminderInjectionConfig,
      maxReminders: 10,
    };
    const queue = createReminderQueue({ injection: customInjection });

    expect(queue.getConfig().injection.maxReminders).toBe(10);
  });
});

describe("processRemindersForDelivery", () => {
  it("processes reminders without maintaining state", () => {
    const reminders = [
      createReminder({ id: "rem-urgent", priority: "urgent" }),
      createReminder({ id: "rem-normal", priority: "normal" }),
      createReminder({ id: "rem-low", priority: "low" }),
    ];

    const result = processRemindersForDelivery(reminders);

    expect(result.immediate).toHaveLength(1);
    expect(result.batches).toHaveLength(1);
    expect(result.coalesced).toHaveLength(1);
  });

  it("respects custom configuration", () => {
    const reminders = [createReminder({ id: "rem-normal", priority: "normal" })];

    const config: ReminderQueueConfig = {
      injection: {
        ...defaultReminderInjectionConfig,
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
      },
      priority: defaultPriorityConfig,
    };

    // During quiet hours
    const now = new Date("2026-01-15T23:00:00.000Z");
    const result = processRemindersForDelivery(reminders, config, now);

    expect(result.held).toHaveLength(1);
  });
});

describe("getDeliveryOrder", () => {
  it("returns reminders in priority order", () => {
    const result: QueueProcessResult = {
      immediate: [createReminder({ id: "rem-urgent", priority: "urgent" })],
      batches: [
        {
          id: "batch-1",
          reminders: [
            createReminder({ id: "rem-normal-1", priority: "normal" }),
            createReminder({ id: "rem-normal-2", priority: "normal" }),
          ],
          priority: "normal",
          createdAt: new Date(),
        },
      ],
      coalesced: [
        {
          contextTag: "health",
          reminders: [createReminder({ id: "rem-low", priority: "low" })],
          summary: "1 health reminder",
        },
      ],
      held: [],
    };

    const order = getDeliveryOrder(result);

    expect(order).toHaveLength(4);
    expect(order[0].id).toBe("rem-urgent");
    expect(order[1].id).toBe("rem-normal-1");
    expect(order[2].id).toBe("rem-normal-2");
    expect(order[3].id).toBe("rem-low");
  });

  it("handles empty results", () => {
    const result: QueueProcessResult = {
      immediate: [],
      batches: [],
      coalesced: [],
      held: [],
    };

    const order = getDeliveryOrder(result);
    expect(order).toHaveLength(0);
  });

  it("includes only first batch of normal reminders", () => {
    const result: QueueProcessResult = {
      immediate: [],
      batches: [
        {
          id: "batch-1",
          reminders: [createReminder({ id: "rem-1" })],
          priority: "normal",
          createdAt: new Date(),
        },
        {
          id: "batch-2",
          reminders: [createReminder({ id: "rem-2" })],
          priority: "normal",
          createdAt: new Date(),
        },
      ],
      coalesced: [],
      held: [],
    };

    const order = getDeliveryOrder(result);

    expect(order).toHaveLength(1);
    expect(order[0].id).toBe("rem-1");
  });
});

describe("formatCoalescedGroup", () => {
  it("formats single-reminder group", () => {
    const group = {
      contextTag: "health",
      reminders: [createReminder({ title: "Take medication" })],
      summary: "Take medication",
    };

    const formatted = formatCoalescedGroup(group);
    expect(formatted).toBe("Take medication");
  });

  it("formats multi-reminder group", () => {
    const group = {
      contextTag: "health",
      reminders: [
        createReminder({ title: "Take medication" }),
        createReminder({ title: "Exercise" }),
      ],
      summary: "2 health reminders",
    };

    const formatted = formatCoalescedGroup(group);

    expect(formatted).toContain("2 health reminders:");
    expect(formatted).toContain("- Take medication");
    expect(formatted).toContain("- Exercise");
  });
});

describe("formatBatch", () => {
  it("formats single-reminder batch", () => {
    const batch = {
      id: "batch-1",
      reminders: [createReminder({ title: "Single task" })],
      priority: "normal" as const,
      createdAt: new Date(),
    };

    const formatted = formatBatch(batch);
    expect(formatted).toBe("Single task");
  });

  it("formats multi-reminder batch", () => {
    const batch = {
      id: "batch-1",
      reminders: [
        createReminder({ title: "Task 1" }),
        createReminder({ title: "Task 2" }),
        createReminder({ title: "Task 3" }),
      ],
      priority: "normal" as const,
      createdAt: new Date(),
    };

    const formatted = formatBatch(batch);

    expect(formatted).toContain("3 reminders:");
    expect(formatted).toContain("- Task 1");
    expect(formatted).toContain("- Task 2");
    expect(formatted).toContain("- Task 3");
  });
});
