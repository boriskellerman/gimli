/**
 * Tests for reminder-cron integration
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CronJob, CronJobCreate, CronJobPatch } from "../cron/types.js";
import type { CronService } from "../cron/service.js";
import type { Reminder } from "./types.js";
import {
  REMINDER_JOB_PREFIX,
  getReminderJobId,
  parseReminderJobId,
  isReminderJob,
  buildReminderTriggerText,
  reminderTriggerToCronSchedule,
  reminderToCronJobCreate,
  registerReminderWithCron,
  unregisterReminderFromCron,
  updateReminderCronJob,
  syncRemindersWithCron,
  createReminderJobHandler,
  listReminderCronJobs,
  getReminderCronJob,
} from "./cron-integration.js";

/**
 * Create a mock cron service
 */
function createMockCronService(): CronService & {
  _jobs: CronJob[];
  _addCalls: CronJobCreate[];
  _updateCalls: Array<{ id: string; patch: CronJobPatch }>;
  _removeCalls: string[];
} {
  const jobs: CronJob[] = [];
  const addCalls: CronJobCreate[] = [];
  const updateCalls: Array<{ id: string; patch: CronJobPatch }> = [];
  const removeCalls: string[] = [];
  let idCounter = 0;

  return {
    _jobs: jobs,
    _addCalls: addCalls,
    _updateCalls: updateCalls,
    _removeCalls: removeCalls,

    async start() {},
    stop() {},
    async status() {
      return { enabled: true, storePath: "/tmp/cron.json", jobs: jobs.length, nextWakeAtMs: null };
    },

    async list(opts?: { includeDisabled?: boolean }) {
      if (opts?.includeDisabled) return jobs;
      return jobs.filter((j) => j.enabled);
    },

    async add(input: CronJobCreate) {
      addCalls.push(input);
      const now = Date.now();
      const job: CronJob = {
        id: `job-${++idCounter}`,
        agentId: input.agentId,
        name: input.name,
        description: input.description,
        enabled: input.enabled !== false,
        deleteAfterRun: input.deleteAfterRun,
        createdAtMs: now,
        updatedAtMs: now,
        schedule: input.schedule,
        sessionTarget: input.sessionTarget,
        wakeMode: input.wakeMode,
        payload: input.payload,
        isolation: input.isolation,
        state: input.state ?? {},
      };
      jobs.push(job);
      return job;
    },

    async update(id: string, patch: CronJobPatch) {
      updateCalls.push({ id, patch });
      const job = jobs.find((j) => j.id === id);
      if (!job) throw new Error(`Job not found: ${id}`);
      if (typeof patch.enabled === "boolean") job.enabled = patch.enabled;
      if (patch.schedule) job.schedule = patch.schedule;
      if (patch.payload) {
        if (patch.payload.kind === "systemEvent" && patch.payload.text) {
          job.payload = { kind: "systemEvent", text: patch.payload.text };
        }
      }
      job.updatedAtMs = Date.now();
      return job;
    },

    async remove(id: string) {
      removeCalls.push(id);
      const idx = jobs.findIndex((j) => j.id === id);
      if (idx === -1) return { ok: true, removed: false };
      jobs.splice(idx, 1);
      return { ok: true, removed: true };
    },

    async run() {
      return { ok: true, ran: false, reason: "not-due" as const };
    },

    wake() {
      return { ok: true };
    },
  } as CronService & {
    _jobs: CronJob[];
    _addCalls: CronJobCreate[];
    _updateCalls: Array<{ id: string; patch: CronJobPatch }>;
    _removeCalls: string[];
  };
}

/**
 * Create a test reminder
 */
function createTestReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "reminder-123",
    agentId: "agent-456",
    title: "Test reminder",
    body: "This is a test reminder body",
    trigger: { type: "scheduled", datetime: new Date("2025-06-15T10:00:00Z") },
    status: "pending",
    priority: "normal",
    createdAt: new Date("2025-06-01T00:00:00Z"),
    quietHoursExempt: false,
    ...overrides,
  };
}

describe("cron-integration", () => {
  describe("getReminderJobId", () => {
    it("should create job ID with prefix", () => {
      expect(getReminderJobId("abc-123")).toBe("reminder:abc-123");
    });
  });

  describe("parseReminderJobId", () => {
    it("should extract reminder ID from job ID", () => {
      expect(parseReminderJobId("reminder:abc-123")).toBe("abc-123");
    });

    it("should return undefined for non-reminder jobs", () => {
      expect(parseReminderJobId("other-job")).toBeUndefined();
      expect(parseReminderJobId("")).toBeUndefined();
    });
  });

  describe("isReminderJob", () => {
    it("should identify reminder jobs", () => {
      expect(isReminderJob("reminder:abc")).toBe(true);
      expect(isReminderJob("reminder:")).toBe(true);
    });

    it("should reject non-reminder jobs", () => {
      expect(isReminderJob("other-job")).toBe(false);
      expect(isReminderJob("")).toBe(false);
      expect(isReminderJob("reminders:abc")).toBe(false);
    });
  });

  describe("buildReminderTriggerText", () => {
    it("should format normal priority reminder", () => {
      const reminder = createTestReminder();
      const text = buildReminderTriggerText(reminder);
      expect(text).toContain("[Reminder]");
      expect(text).toContain("Test reminder");
      expect(text).toContain("This is a test reminder body");
    });

    it("should format urgent priority reminder", () => {
      const reminder = createTestReminder({ priority: "urgent" });
      const text = buildReminderTriggerText(reminder);
      expect(text).toContain("[URGENT]");
    });

    it("should format low priority reminder", () => {
      const reminder = createTestReminder({ priority: "low" });
      const text = buildReminderTriggerText(reminder);
      expect(text).toContain("[FYI]");
    });

    it("should include context tags", () => {
      const reminder = createTestReminder({ contextTags: ["work", "meeting"] });
      const text = buildReminderTriggerText(reminder);
      expect(text).toContain("Context: work, meeting");
    });

    it("should handle reminder without body", () => {
      const reminder = createTestReminder({ body: undefined });
      const text = buildReminderTriggerText(reminder);
      expect(text).toBe("[Reminder] Test reminder");
    });
  });

  describe("reminderTriggerToCronSchedule", () => {
    it("should convert scheduled reminder to at-schedule", () => {
      const reminder = createTestReminder({
        trigger: { type: "scheduled", datetime: new Date("2025-06-15T10:00:00Z") },
      });
      const schedule = reminderTriggerToCronSchedule(reminder);
      expect(schedule).toEqual({
        kind: "at",
        atMs: new Date("2025-06-15T10:00:00Z").getTime(),
      });
    });

    it("should convert recurring reminder to cron-schedule", () => {
      const reminder = createTestReminder({
        trigger: { type: "recurring", cron: "0 9 * * MON-FRI" },
      });
      const schedule = reminderTriggerToCronSchedule(reminder);
      expect(schedule).toEqual({
        kind: "cron",
        expr: "0 9 * * MON-FRI",
      });
    });

    it("should return undefined for context reminder", () => {
      const reminder = createTestReminder({
        trigger: { type: "context", pattern: "meeting" },
      });
      const schedule = reminderTriggerToCronSchedule(reminder);
      expect(schedule).toBeUndefined();
    });
  });

  describe("reminderToCronJobCreate", () => {
    it("should create job input for scheduled reminder", () => {
      const reminder = createTestReminder();
      const jobCreate = reminderToCronJobCreate(reminder);

      expect(jobCreate).toBeDefined();
      expect(jobCreate!.name).toBe("reminder:reminder-123");
      expect(jobCreate!.agentId).toBe("agent-456");
      expect(jobCreate!.enabled).toBe(true);
      expect(jobCreate!.deleteAfterRun).toBe(true);
      expect(jobCreate!.sessionTarget).toBe("main");
      expect(jobCreate!.wakeMode).toBe("now");
      expect(jobCreate!.payload.kind).toBe("systemEvent");
    });

    it("should create job input for recurring reminder", () => {
      const reminder = createTestReminder({
        trigger: { type: "recurring", cron: "0 9 * * *" },
      });
      const jobCreate = reminderToCronJobCreate(reminder);

      expect(jobCreate).toBeDefined();
      expect(jobCreate!.deleteAfterRun).toBe(false);
      expect(jobCreate!.schedule).toEqual({ kind: "cron", expr: "0 9 * * *" });
    });

    it("should return undefined for context reminder", () => {
      const reminder = createTestReminder({
        trigger: { type: "context", pattern: "meeting" },
      });
      const jobCreate = reminderToCronJobCreate(reminder);
      expect(jobCreate).toBeUndefined();
    });

    it("should disable job for non-pending reminders", () => {
      const reminder = createTestReminder({ status: "completed" });
      const jobCreate = reminderToCronJobCreate(reminder);
      expect(jobCreate!.enabled).toBe(false);
    });
  });

  describe("registerReminderWithCron", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should register scheduled reminder as cron job", async () => {
      const reminder = createTestReminder();
      const job = await registerReminderWithCron(mockCron, reminder);

      expect(job).toBeDefined();
      expect(job!.name).toBe("reminder:reminder-123");
      expect(mockCron._addCalls).toHaveLength(1);
    });

    it("should update existing job instead of duplicating", async () => {
      const reminder = createTestReminder();

      // Register first time
      await registerReminderWithCron(mockCron, reminder);

      // Register again
      const job = await registerReminderWithCron(mockCron, reminder);

      expect(job).toBeDefined();
      expect(mockCron._addCalls).toHaveLength(1);
      expect(mockCron._updateCalls).toHaveLength(1);
    });

    it("should return undefined for context reminder", async () => {
      const reminder = createTestReminder({
        trigger: { type: "context", pattern: "meeting" },
      });
      const job = await registerReminderWithCron(mockCron, reminder);
      expect(job).toBeUndefined();
      expect(mockCron._addCalls).toHaveLength(0);
    });
  });

  describe("unregisterReminderFromCron", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should remove existing reminder job", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      const removed = await unregisterReminderFromCron(mockCron, reminder.id);

      expect(removed).toBe(true);
      expect(mockCron._removeCalls).toHaveLength(1);
    });

    it("should return false if job does not exist", async () => {
      const removed = await unregisterReminderFromCron(mockCron, "nonexistent-id");
      expect(removed).toBe(false);
    });
  });

  describe("updateReminderCronJob", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should update schedule for snoozed reminder", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      const snoozeTime = new Date("2025-06-15T12:00:00Z");
      reminder.status = "snoozed";
      reminder.snoozeUntil = snoozeTime;

      const job = await updateReminderCronJob(mockCron, reminder);

      expect(job).toBeDefined();
      expect(job!.schedule).toEqual({ kind: "at", atMs: snoozeTime.getTime() });
    });

    it("should disable job for completed reminder", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      reminder.status = "completed";

      const job = await updateReminderCronJob(mockCron, reminder);

      expect(job).toBeDefined();
      expect(job!.enabled).toBe(false);
    });

    it("should create job if it does not exist and reminder is active", async () => {
      const reminder = createTestReminder();
      const job = await updateReminderCronJob(mockCron, reminder);

      expect(job).toBeDefined();
      expect(mockCron._addCalls).toHaveLength(1);
    });

    it("should remove job when converting to context trigger", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      // Change to context trigger
      reminder.trigger = { type: "context", pattern: "meeting" };

      const job = await updateReminderCronJob(mockCron, reminder);

      expect(job).toBeUndefined();
      expect(mockCron._removeCalls).toHaveLength(1);
    });
  });

  describe("syncRemindersWithCron", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should register new reminders", async () => {
      const reminders = [createTestReminder({ id: "r1" }), createTestReminder({ id: "r2" })];

      const result = await syncRemindersWithCron(mockCron, reminders);

      expect(result.registered).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.removed).toBe(0);
    });

    it("should update existing reminders", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      const result = await syncRemindersWithCron(mockCron, [reminder]);

      expect(result.registered).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.removed).toBe(0);
    });

    it("should remove jobs for completed reminders", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      reminder.status = "completed";

      const result = await syncRemindersWithCron(mockCron, [reminder]);

      expect(result.removed).toBe(1);
    });

    it("should remove orphaned jobs", async () => {
      // Register a reminder
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      // Sync with empty list (reminder no longer exists)
      const result = await syncRemindersWithCron(mockCron, []);

      expect(result.removed).toBe(1);
    });

    it("should not register context reminders", async () => {
      const reminders = [
        createTestReminder({ id: "r1", trigger: { type: "context", pattern: "meeting" } }),
      ];

      const result = await syncRemindersWithCron(mockCron, reminders);

      expect(result.registered).toBe(0);
    });
  });

  describe("createReminderJobHandler", () => {
    it("should invoke callback for reminder jobs", async () => {
      const callback = vi.fn();
      const handler = createReminderJobHandler(callback);

      const job: CronJob = {
        id: "job-1",
        name: "reminder:abc-123",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", atMs: Date.now() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "test" },
        state: {},
      };

      await handler(job);

      expect(callback).toHaveBeenCalledWith("abc-123", job);
    });

    it("should not invoke callback for non-reminder jobs", async () => {
      const callback = vi.fn();
      const handler = createReminderJobHandler(callback);

      const job: CronJob = {
        id: "job-1",
        name: "other-job",
        enabled: true,
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
        schedule: { kind: "at", atMs: Date.now() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "test" },
        state: {},
      };

      await handler(job);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("listReminderCronJobs", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should return only reminder jobs", async () => {
      // Add a reminder job
      await mockCron.add({
        name: "reminder:r1",
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "test" },
      });

      // Add a non-reminder job
      await mockCron.add({
        name: "other-job",
        enabled: true,
        schedule: { kind: "at", atMs: Date.now() },
        sessionTarget: "main",
        wakeMode: "now",
        payload: { kind: "systemEvent", text: "test" },
      });

      const reminderJobs = await listReminderCronJobs(mockCron);

      expect(reminderJobs).toHaveLength(1);
      expect(reminderJobs[0].name).toBe("reminder:r1");
    });
  });

  describe("getReminderCronJob", () => {
    let mockCron: ReturnType<typeof createMockCronService>;

    beforeEach(() => {
      mockCron = createMockCronService();
    });

    it("should find job for reminder", async () => {
      const reminder = createTestReminder();
      await registerReminderWithCron(mockCron, reminder);

      const job = await getReminderCronJob(mockCron, reminder.id);

      expect(job).toBeDefined();
      expect(job!.name).toBe("reminder:reminder-123");
    });

    it("should return undefined if job not found", async () => {
      const job = await getReminderCronJob(mockCron, "nonexistent");
      expect(job).toBeUndefined();
    });
  });
});
