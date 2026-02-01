import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RemindCommandOpts } from "./remind.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  resolveDefaultAgentId: vi.fn(),
  createReminderStore: vi.fn(),
  parseTimeString: vi.fn(),
  parsePriority: vi.fn(),
  parseStatus: vi.fn(),
  isRich: vi.fn(() => false),
  clampSnoozeDuration: vi.fn((m: number) => m),
  getSnoozeConstraints: vi.fn(() => ({ minMinutes: 5, maxMinutes: 60 })),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../reminders/store.js", () => ({
  createReminderStore: mocks.createReminderStore,
  parseTimeString: mocks.parseTimeString,
  parsePriority: mocks.parsePriority,
  parseStatus: mocks.parseStatus,
}));

vi.mock("../reminders/types.js", () => ({
  clampSnoozeDuration: mocks.clampSnoozeDuration,
  getSnoozeConstraints: mocks.getSnoozeConstraints,
}));

vi.mock("../terminal/theme.js", () => ({
  isRich: mocks.isRich,
  theme: {
    error: (s: string) => s,
    warn: (s: string) => s,
    success: (s: string) => s,
    info: (s: string) => s,
    muted: (s: string) => s,
    accent: (s: string) => s,
  },
}));

vi.mock("../globals.js", () => ({
  info: (s: string) => s,
}));

import { remindCommand } from "./remind.js";

describe("remind command", () => {
  const mockRuntime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as (code: number) => never,
  };

  const mockStore = {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
    snooze: vi.fn(),
    delete: vi.fn(),
    getStats: vi.fn(),
    close: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({});
    mocks.resolveDefaultAgentId.mockReturnValue("default");
    mocks.createReminderStore.mockReturnValue(mockStore);
    mockStore.list.mockReturnValue([]);
    mockStore.getStats.mockReturnValue({
      total: 0,
      pending: 0,
      triggered: 0,
      completed: 0,
      dismissed: 0,
      snoozed: 0,
    });
  });

  describe("help", () => {
    it("shows help when no subcommand provided", async () => {
      await remindCommand({}, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });

    it("shows help with help subcommand", async () => {
      await remindCommand({ subcommand: "help" }, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });
  });

  describe("add subcommand", () => {
    it("requires message", async () => {
      await remindCommand({ subcommand: "add" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Message is required"),
      );
    });

    it("requires trigger type", async () => {
      await remindCommand({ subcommand: "add", message: "Test reminder" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Must specify --at, --cron, or --context"),
      );
    });

    it("creates scheduled reminder with --at", async () => {
      const targetDate = new Date("2026-02-01T09:00:00");
      mocks.parseTimeString.mockReturnValue(targetDate);

      mockStore.create.mockReturnValue({
        id: "test-id-123",
        agentId: "default",
        title: "Test reminder",
        trigger: { type: "scheduled", datetime: targetDate },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      });

      await remindCommand(
        { subcommand: "add", message: "Test reminder", at: "9:00 AM" },
        mockRuntime,
      );

      expect(mockStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "default",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: targetDate },
        }),
      );
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Reminder created"));
    });

    it("creates recurring reminder with --cron", async () => {
      mockStore.create.mockReturnValue({
        id: "test-id-123",
        agentId: "default",
        title: "Weekly status",
        trigger: { type: "recurring", cron: "0 16 * * 5" },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      });

      await remindCommand(
        { subcommand: "add", message: "Weekly status", cron: "0 16 * * 5" },
        mockRuntime,
      );

      expect(mockStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Weekly status",
          trigger: { type: "recurring", cron: "0 16 * * 5" },
        }),
      );
    });

    it("creates context reminder with --context", async () => {
      mockStore.create.mockReturnValue({
        id: "test-id-123",
        agentId: "default",
        title: "Check staging",
        trigger: { type: "context", pattern: "deploy,release" },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        contextTags: ["deploy", "release"],
        quietHoursExempt: false,
      });

      await remindCommand(
        { subcommand: "add", message: "Check staging", context: "deploy,release" },
        mockRuntime,
      );

      expect(mockStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Check staging",
          trigger: { type: "context", pattern: "deploy,release" },
          contextTags: ["deploy", "release"],
        }),
      );
    });

    it("respects priority option", async () => {
      const targetDate = new Date("2026-02-01T09:00:00");
      mocks.parseTimeString.mockReturnValue(targetDate);
      mocks.parsePriority.mockReturnValue("urgent");

      mockStore.create.mockReturnValue({
        id: "test-id-123",
        agentId: "default",
        title: "Urgent task",
        trigger: { type: "scheduled", datetime: targetDate },
        status: "pending",
        priority: "urgent",
        createdAt: new Date(),
        quietHoursExempt: false,
      });

      await remindCommand(
        { subcommand: "add", message: "Urgent task", at: "9:00 AM", priority: "urgent" },
        mockRuntime,
      );

      expect(mockStore.create).toHaveBeenCalledWith(
        expect.objectContaining({
          priority: "urgent",
        }),
      );
    });

    it("outputs JSON when --json flag is set", async () => {
      const targetDate = new Date("2026-02-01T09:00:00");
      mocks.parseTimeString.mockReturnValue(targetDate);

      const reminder = {
        id: "test-id-123",
        agentId: "default",
        title: "Test reminder",
        trigger: { type: "scheduled", datetime: targetDate },
        status: "pending",
        priority: "normal",
        createdAt: new Date(),
        quietHoursExempt: false,
      };
      mockStore.create.mockReturnValue(reminder);

      await remindCommand(
        { subcommand: "add", message: "Test reminder", at: "9:00 AM", json: true },
        mockRuntime,
      );

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"id"'));
    });
  });

  describe("list subcommand", () => {
    it("lists all reminders", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "test-id-1",
          agentId: "default",
          title: "Reminder 1",
          trigger: { type: "scheduled", datetime: new Date() },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
      ]);

      await remindCommand({ subcommand: "list" }, mockRuntime);

      expect(mockStore.list).toHaveBeenCalled();
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Reminders (1)"));
    });

    it("shows empty message when no reminders", async () => {
      mockStore.list.mockReturnValue([]);

      await remindCommand({ subcommand: "list" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("No reminders found"));
    });

    it("filters by status", async () => {
      mocks.parseStatus.mockReturnValue("pending");
      mockStore.list.mockReturnValue([]);

      await remindCommand({ subcommand: "list", status: "pending" }, mockRuntime);

      expect(mockStore.list).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    });

    it("filters by priority", async () => {
      mocks.parsePriority.mockReturnValue("urgent");
      mockStore.list.mockReturnValue([]);

      await remindCommand({ subcommand: "list", priority: "urgent" }, mockRuntime);

      expect(mockStore.list).toHaveBeenCalledWith(expect.objectContaining({ priority: "urgent" }));
    });

    it("outputs JSON when --json flag is set", async () => {
      mockStore.list.mockReturnValue([]);

      await remindCommand({ subcommand: "list", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"count"'));
    });
  });

  describe("complete subcommand", () => {
    it("requires ID", async () => {
      await remindCommand({ subcommand: "complete" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("ID is required"));
    });

    it("completes reminder by partial ID", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "abc123-full-id",
          agentId: "default",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: new Date() },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
      ]);
      mockStore.updateStatus.mockReturnValue(true);

      await remindCommand({ subcommand: "complete", id: "abc123" }, mockRuntime);

      expect(mockStore.updateStatus).toHaveBeenCalledWith("abc123-full-id", "completed");
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("completed"));
    });

    it("shows error for unknown ID", async () => {
      mockStore.list.mockReturnValue([]);

      await remindCommand({ subcommand: "complete", id: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No reminder found"));
    });
  });

  describe("dismiss subcommand", () => {
    it("dismisses reminder", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "abc123-full-id",
          agentId: "default",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: new Date() },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
      ]);
      mockStore.updateStatus.mockReturnValue(true);

      await remindCommand({ subcommand: "dismiss", id: "abc123" }, mockRuntime);

      expect(mockStore.updateStatus).toHaveBeenCalledWith("abc123-full-id", "dismissed");
    });
  });

  describe("snooze subcommand", () => {
    it("requires ID", async () => {
      await remindCommand({ subcommand: "snooze" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("ID is required"));
    });

    it("requires minutes", async () => {
      await remindCommand({ subcommand: "snooze", id: "abc123" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("--minutes must be a positive number"),
      );
    });

    it("snoozes reminder", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "abc123-full-id",
          agentId: "default",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: new Date() },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
      ]);
      mockStore.snooze.mockReturnValue(true);

      await remindCommand({ subcommand: "snooze", id: "abc123", minutes: 30 }, mockRuntime);

      expect(mockStore.snooze).toHaveBeenCalledWith("abc123-full-id", 30);
      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("snoozed for 30 minutes"),
      );
    });
  });

  describe("delete subcommand", () => {
    it("deletes reminder", async () => {
      mockStore.list.mockReturnValue([
        {
          id: "abc123-full-id",
          agentId: "default",
          title: "Test reminder",
          trigger: { type: "scheduled", datetime: new Date() },
          status: "pending",
          priority: "normal",
          createdAt: new Date(),
          quietHoursExempt: false,
        },
      ]);
      mockStore.delete.mockReturnValue(true);

      await remindCommand({ subcommand: "delete", id: "abc123" }, mockRuntime);

      expect(mockStore.delete).toHaveBeenCalledWith("abc123-full-id");
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("deleted"));
    });
  });

  describe("stats subcommand", () => {
    it("shows statistics", async () => {
      mockStore.getStats.mockReturnValue({
        total: 10,
        pending: 5,
        triggered: 2,
        completed: 2,
        dismissed: 1,
        snoozed: 0,
      });

      await remindCommand({ subcommand: "stats" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Reminder statistics"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("10"));
    });

    it("outputs JSON when --json flag is set", async () => {
      mockStore.getStats.mockReturnValue({
        total: 10,
        pending: 5,
        triggered: 2,
        completed: 2,
        dismissed: 1,
        snoozed: 0,
      });

      await remindCommand({ subcommand: "stats", json: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining('"total"'));
    });
  });

  describe("patterns subcommand", () => {
    it("shows patterns placeholder", async () => {
      await remindCommand({ subcommand: "patterns" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("Pattern detection is coming"),
      );
    });
  });

  describe("config subcommand", () => {
    it("shows config help when no key provided", async () => {
      await remindCommand({ subcommand: "config" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("configuration options"),
      );
    });

    it("requires value for config key", async () => {
      await remindCommand({ subcommand: "config", configKey: "quiet-start" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Value is required"));
    });

    it("validates time format", async () => {
      await remindCommand(
        { subcommand: "config", configKey: "quiet-start", configValue: "invalid" },
        mockRuntime,
      );

      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Invalid time format"),
      );
    });

    it("shows config instructions for quiet-start", async () => {
      await remindCommand(
        { subcommand: "config", configKey: "quiet-start", configValue: "22:00" },
        mockRuntime,
      );

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("gimli.json"));
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      await remindCommand({ subcommand: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand"));
    });
  });

  describe("store cleanup", () => {
    it("closes store on success", async () => {
      await remindCommand({ subcommand: "stats" }, mockRuntime);

      expect(mockStore.close).toHaveBeenCalled();
    });

    it("closes store on error", async () => {
      await remindCommand({ subcommand: "add" }, mockRuntime);

      expect(mockStore.close).toHaveBeenCalled();
    });
  });
});
