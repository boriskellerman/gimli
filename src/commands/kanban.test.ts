import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanCommandOpts } from "./kanban.js";
import type { KanbanTask, KanbanColumn } from "../dashboard/kanban-store.js";

const mocks = vi.hoisted(() => ({
  loadTasks: vi.fn(),
  isRich: vi.fn(() => false),
}));

vi.mock("../dashboard/kanban-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dashboard/kanban-store.js")>();
  return {
    ...actual,
    loadTasks: mocks.loadTasks,
  };
});

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

import { kanbanCommand } from "./kanban.js";

describe("kanban command", () => {
  const mockRuntime = {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as (code: number) => never,
  };

  const createTask = (overrides: Partial<KanbanTask> = {}): KanbanTask => ({
    id: "task_abc123_def456",
    title: "Test Task",
    column: "backlog",
    priority: "medium",
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadTasks.mockResolvedValue([]);
    mocks.isRich.mockReturnValue(false);
  });

  describe("help", () => {
    it("shows help when no subcommand provided", async () => {
      await kanbanCommand({}, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });

    it("shows help with help subcommand", async () => {
      await kanbanCommand({ subcommand: "help" }, mockRuntime);
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });
  });

  describe("status subcommand", () => {
    it("shows board status with no tasks", async () => {
      mocks.loadTasks.mockResolvedValue([]);

      await kanbanCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Kanban Board Status"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Total tasks: 0"));
    });

    it("shows column counts", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ column: "backlog" }),
        createTask({ id: "task_2", column: "backlog" }),
        createTask({ id: "task_3", column: "in_progress" }),
        createTask({ id: "task_4", column: "completed" }),
      ]);

      await kanbanCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Columns:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Total tasks: 4"));
    });

    it("shows in-progress tasks", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_ip_1", title: "Working on this", column: "in_progress" }),
      ]);

      await kanbanCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("In Progress:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Working on this"));
    });

    it("shows waiting feedback tasks", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_wf_1", title: "Needs review", column: "waiting_feedback" }),
      ]);

      await kanbanCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Waiting Feedback:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Needs review"));
    });

    it("outputs JSON when --json flag is set", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ column: "backlog" }),
        createTask({ id: "task_2", column: "in_progress" }),
      ]);

      await kanbanCommand({ subcommand: "status", json: true }, mockRuntime);

      const jsonOutput = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.totalTasks).toBe(2);
      expect(parsed.columns).toHaveProperty("backlog");
      expect(parsed.columns).toHaveProperty("in_progress");
    });
  });

  describe("pick subcommand", () => {
    it("picks the best task from backlog", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Low priority", priority: "low", column: "backlog" }),
        createTask({ id: "task_2", title: "High priority", priority: "high", column: "backlog" }),
      ]);

      await kanbanCommand({ subcommand: "pick" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Recommended task:"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("High priority"));
    });

    it("shows no tasks message when empty", async () => {
      mocks.loadTasks.mockResolvedValue([]);

      await kanbanCommand({ subcommand: "pick" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("No tasks available"));
    });

    it("excludes completed and abandoned tasks", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Done task", column: "completed" }),
        createTask({ id: "task_2", title: "Abandoned task", column: "abandoned" }),
      ]);

      await kanbanCommand({ subcommand: "pick" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("No tasks available"));
    });

    it("picks multiple tasks with --count", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Task A", priority: "high", column: "backlog" }),
        createTask({ id: "task_2", title: "Task B", priority: "medium", column: "backlog" }),
        createTask({ id: "task_3", title: "Task C", priority: "low", column: "backlog" }),
      ]);

      await kanbanCommand({ subcommand: "pick", count: 3 }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("Top 3 recommended tasks:"),
      );
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Task A"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Task B"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Task C"));
    });

    it("filters by labels", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Bug fix", labels: ["bug"], column: "backlog" }),
        createTask({ id: "task_2", title: "Feature", labels: ["feature"], column: "backlog" }),
      ]);

      await kanbanCommand({ subcommand: "pick", labels: "bug" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Bug fix"));
    });

    it("outputs JSON when --json flag is set", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Test task", column: "backlog" }),
      ]);

      await kanbanCommand({ subcommand: "pick", json: true }, mockRuntime);

      const jsonOutput = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("task");
      expect(parsed).toHaveProperty("score");
      expect(parsed).toHaveProperty("reason");
    });

    it("outputs JSON for multiple picks", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_1", title: "Task A", column: "backlog" }),
        createTask({ id: "task_2", title: "Task B", column: "backlog" }),
      ]);

      await kanbanCommand({ subcommand: "pick", count: 2, json: true }, mockRuntime);

      const jsonOutput = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed).toHaveProperty("tasks");
      expect(parsed.tasks).toHaveLength(2);
    });
  });

  describe("review subcommand", () => {
    it("requires task ID", async () => {
      await kanbanCommand({ subcommand: "review" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Task ID is required"),
      );
    });

    it("shows error for unknown task ID", async () => {
      mocks.loadTasks.mockResolvedValue([]);

      await kanbanCommand({ subcommand: "review", taskId: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No task found"));
    });

    it("shows task details for review", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({
          id: "task_abc123",
          title: "Review this task",
          description: "Task description here",
          column: "in_progress",
        }),
      ]);

      await kanbanCommand({ subcommand: "review", taskId: "task_abc" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("Review: Review this task"),
      );
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Task ID: task_abc123"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Description:"));
    });

    it("shows no iterations message", async () => {
      mocks.loadTasks.mockResolvedValue([createTask({ id: "task_abc123", title: "Test task" })]);

      await kanbanCommand({ subcommand: "review", taskId: "task_abc" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("No iteration results found"),
      );
    });

    it("outputs JSON when --json flag is set", async () => {
      mocks.loadTasks.mockResolvedValue([createTask({ id: "task_abc123", title: "Test task" })]);

      await kanbanCommand({ subcommand: "review", taskId: "task_abc", json: true }, mockRuntime);

      const jsonOutput = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.taskId).toBe("task_abc123");
      expect(parsed.title).toBe("Test task");
      expect(parsed.iterations).toEqual([]);
    });
  });

  describe("approve subcommand", () => {
    it("requires task ID", async () => {
      await kanbanCommand({ subcommand: "approve" }, mockRuntime);
      expect(mockRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("Task ID is required"),
      );
    });

    it("shows error for unknown task ID", async () => {
      mocks.loadTasks.mockResolvedValue([]);

      await kanbanCommand({ subcommand: "approve", taskId: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("No task found"));
    });

    it("shows approve info without solution ID", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_abc123", title: "Approve this task" }),
      ]);

      await kanbanCommand({ subcommand: "approve", taskId: "task_abc" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("Approve: Approve this task"),
      );
      expect(mockRuntime.log).toHaveBeenCalledWith(
        expect.stringContaining("No solution ID specified"),
      );
    });

    it("shows approve info with solution ID", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_abc123", title: "Approve this task" }),
      ]);

      await kanbanCommand(
        { subcommand: "approve", taskId: "task_abc", solutionId: "sol_xyz" },
        mockRuntime,
      );

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Solution ID: sol_xyz"));
    });

    it("handles force flag", async () => {
      mocks.loadTasks.mockResolvedValue([
        createTask({ id: "task_abc123", title: "Approve this task" }),
      ]);

      await kanbanCommand({ subcommand: "approve", taskId: "task_abc", force: true }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("--force flag set"));
    });

    it("outputs JSON when --json flag is set", async () => {
      mocks.loadTasks.mockResolvedValue([createTask({ id: "task_abc123", title: "Test task" })]);

      await kanbanCommand({ subcommand: "approve", taskId: "task_abc", json: true }, mockRuntime);

      const jsonOutput = mockRuntime.log.mock.calls[0][0];
      const parsed = JSON.parse(jsonOutput);
      expect(parsed.taskId).toBe("task_abc123");
      expect(parsed.approved).toBe(false);
    });
  });

  describe("unknown subcommand", () => {
    it("shows error for unknown subcommand", async () => {
      await kanbanCommand({ subcommand: "unknown" }, mockRuntime);

      expect(mockRuntime.error).toHaveBeenCalledWith(expect.stringContaining("Unknown subcommand"));
      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    });
  });

  describe("rich output", () => {
    it("formats output with colors when rich mode enabled", async () => {
      mocks.isRich.mockReturnValue(true);
      mocks.loadTasks.mockResolvedValue([
        createTask({ column: "in_progress", title: "Colorful task" }),
      ]);

      await kanbanCommand({ subcommand: "status" }, mockRuntime);

      expect(mockRuntime.log).toHaveBeenCalledWith(expect.stringContaining("Kanban Board Status"));
    });
  });
});
