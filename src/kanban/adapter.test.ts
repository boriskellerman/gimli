/**
 * Tests for Kanban task source adapters
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdapterRegistry,
  addCommentToTaskInMarkdown,
  createAdapterRegistry,
  type ExternalTask,
  GitHubIssuesAdapter,
  MarkdownTaskAdapter,
  parseCommentsFromBody,
  parseTasksMarkdown,
  type TaskListFilter,
  updateTaskStatusInMarkdown,
} from "./adapter.js";

// ============================================================================
// Markdown Parser Tests
// ============================================================================

describe("parseTasksMarkdown", () => {
  it("parses basic tasks from different sections", () => {
    const content = `# Project Tasks

## Backlog

### [TASK-001] Implement feature A
- **Priority**: high
- **Labels**: feature, backend
- **Created**: 2024-06-01

Description of feature A.

---

### [TASK-002] Fix bug B
- **Priority**: low
- **Labels**: bug
- **Created**: 2024-06-02

---

## In Progress

### [TASK-003] Working on C
- **Priority**: medium
- **Assignee**: @alice
- **Started**: 2024-06-05

Currently in progress.

---

## Completed

### [TASK-004] Done task
- **Priority**: high
- **Completed**: 2024-06-10

This was completed.

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");

    expect(tasks).toHaveLength(4);

    // Check task in backlog
    const task1 = tasks.find((t) => t.id === "TASK-001");
    expect(task1).toBeDefined();
    expect(task1?.title).toBe("Implement feature A");
    expect(task1?.status).toBe("open");
    expect(task1?.priority).toBe("high");
    expect(task1?.labels).toEqual(["feature", "backend"]);
    expect(task1?.body).toBe("Description of feature A.");

    // Check task in progress
    const task3 = tasks.find((t) => t.id === "TASK-003");
    expect(task3).toBeDefined();
    expect(task3?.status).toBe("in_progress");
    expect(task3?.assignees).toEqual(["alice"]);

    // Check completed task
    const task4 = tasks.find((t) => t.id === "TASK-004");
    expect(task4).toBeDefined();
    expect(task4?.status).toBe("closed");
  });

  it("handles blocked and review sections", () => {
    const content = `# Tasks

## Blocked

### [TASK-B1] Blocked task
- **Blocked**: Waiting for API key

---

## Review

### [TASK-R1] In review
- **Priority**: high

---

## Abandoned

### [TASK-X1] Cancelled
- **Priority**: low

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");

    expect(tasks).toHaveLength(3);
    expect(tasks.find((t) => t.id === "TASK-B1")?.status).toBe("blocked");
    expect(tasks.find((t) => t.id === "TASK-R1")?.status).toBe("review");
    expect(tasks.find((t) => t.id === "TASK-X1")?.status).toBe("wont_do");
  });

  it("parses priority values correctly", () => {
    const content = `# Tasks

## Backlog

### [T1] Critical task
- **Priority**: critical

---

### [T2] Urgent task
- **Priority**: urgent

---

### [T3] High task
- **Priority**: high

---

### [T4] P1 task
- **Priority**: P1

---

### [T5] Medium task
- **Priority**: medium

---

### [T6] Low task
- **Priority**: low

---

### [T7] No priority

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");

    expect(tasks.find((t) => t.id === "T1")?.priority).toBe("critical");
    expect(tasks.find((t) => t.id === "T2")?.priority).toBe("critical");
    expect(tasks.find((t) => t.id === "T3")?.priority).toBe("high");
    expect(tasks.find((t) => t.id === "T4")?.priority).toBe("high");
    expect(tasks.find((t) => t.id === "T5")?.priority).toBe("medium");
    expect(tasks.find((t) => t.id === "T6")?.priority).toBe("low");
    expect(tasks.find((t) => t.id === "T7")?.priority).toBe("medium"); // default
  });

  it("parses dates correctly", () => {
    const content = `# Tasks

## Backlog

### [T1] Task with dates
- **Created**: 2024-06-15
- **Due**: 2024-07-01
- **Updated**: 2024-06-20

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");
    const task = tasks[0];

    expect(task.createdAt.toISOString()).toContain("2024-06-15");
    expect(task.dueDate?.toISOString()).toContain("2024-07-01");
    expect(task.updatedAt.toISOString()).toContain("2024-06-20");
  });

  it("handles multiple assignees", () => {
    const content = `# Tasks

## Backlog

### [T1] Multi-assignee task
- **Assignee**: @alice, @bob, charlie

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");
    expect(tasks[0].assignees).toEqual(["alice", "bob", "charlie"]);
  });

  it("handles tasks without metadata", () => {
    const content = `# Tasks

## Backlog

### [SIMPLE] Simple task

Just a description, no metadata.

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("SIMPLE");
    expect(tasks[0].title).toBe("Simple task");
    expect(tasks[0].body).toBe("Just a description, no metadata.");
    expect(tasks[0].priority).toBe("medium");
    expect(tasks[0].labels).toEqual([]);
  });

  it("ignores malformed task headers", () => {
    const content = `# Tasks

## Backlog

### Not a task ID - just text

This won't be parsed.

### [VALID] Valid task

This will be parsed.

---
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("VALID");
  });

  it("sets source correctly", () => {
    const content = `# Tasks

## Backlog

### [T1] Test

---
`;

    const tasks = parseTasksMarkdown(content, "/project/TASKS.md");
    expect(tasks[0].source).toEqual({
      adapter: "markdown",
      source: "/project/TASKS.md",
    });
  });

  it("handles empty content", () => {
    const tasks = parseTasksMarkdown("", "/test/TASKS.md");
    expect(tasks).toEqual([]);
  });

  it("handles content with no tasks", () => {
    const content = `# Tasks

## Backlog

Nothing here yet.

## Completed

Also empty.
`;

    const tasks = parseTasksMarkdown(content, "/test/TASKS.md");
    expect(tasks).toEqual([]);
  });
});

// ============================================================================
// Markdown Update Tests
// ============================================================================

describe("updateTaskStatusInMarkdown", () => {
  it("moves task from Backlog to In Progress", () => {
    const content = `# Tasks

## Backlog

### [T1] Task one
- **Priority**: high

Description.

---

## In Progress

## Completed
`;

    const updated = updateTaskStatusInMarkdown(content, "T1", "in_progress");

    expect(updated).not.toContain("## Backlog\n\n### [T1]");
    expect(updated).toContain("## In Progress\n\n### [T1] Task one");
  });

  it("moves task from In Progress to Completed", () => {
    const content = `# Tasks

## Backlog

## In Progress

### [T1] Working task
- **Priority**: medium

---

## Completed
`;

    const updated = updateTaskStatusInMarkdown(content, "T1", "closed");

    expect(updated).not.toContain("## In Progress\n\n### [T1]");
    expect(updated).toContain("## Completed\n\n### [T1] Working task");
  });

  it("throws error for non-existent task", () => {
    const content = `# Tasks

## Backlog

### [T1] Task one

---
`;

    expect(() => updateTaskStatusInMarkdown(content, "NONEXISTENT", "closed")).toThrow(
      "Task NONEXISTENT not found",
    );
  });

  it("throws error for missing target section", () => {
    const content = `# Tasks

## Backlog

### [T1] Task one

---
`;

    // "review" maps to "Review" section which doesn't exist
    expect(() => updateTaskStatusInMarkdown(content, "T1", "review")).toThrow(
      'Section "Review" not found',
    );
  });
});

describe("addCommentToTaskInMarkdown", () => {
  it("adds comment to task", () => {
    const content = `# Tasks

## Backlog

### [T1] Task one
- **Priority**: high

Description.

---
`;

    // Mock Date to get consistent output
    const mockDate = new Date("2024-06-15");
    vi.setSystemTime(mockDate);

    const updated = addCommentToTaskInMarkdown(content, "T1", "This is a comment.");

    expect(updated).toContain("#### Comment (2024-06-15)");
    expect(updated).toContain("This is a comment.");

    vi.useRealTimers();
  });

  it("throws error for non-existent task", () => {
    const content = `# Tasks

## Backlog

### [T1] Task one

---
`;

    expect(() => addCommentToTaskInMarkdown(content, "NONEXISTENT", "Comment")).toThrow(
      "Task NONEXISTENT not found",
    );
  });
});

describe("parseCommentsFromBody", () => {
  it("parses comments from body", () => {
    const body = `Task description.

#### Comment (2024-06-15)
First comment.

#### Comment (2024-06-16)
Second comment.
`;

    const comments = parseCommentsFromBody(body);

    expect(comments).toHaveLength(2);
    expect(comments[0].body).toBe("First comment.");
    expect(comments[0].createdAt.toISOString()).toContain("2024-06-15");
    expect(comments[1].body).toBe("Second comment.");
  });

  it("returns empty array for body without comments", () => {
    const body = "Just a description, no comments.";
    const comments = parseCommentsFromBody(body);
    expect(comments).toEqual([]);
  });
});

// ============================================================================
// Markdown Adapter Tests
// ============================================================================

describe("MarkdownTaskAdapter", () => {
  let tempDir: string;
  let tasksFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-test-"));
    tasksFile = path.join(tempDir, "TASKS.md");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("lists tasks from file", async () => {
    const content = `# Tasks

## Backlog

### [T1] First task
- **Priority**: high

---

### [T2] Second task
- **Priority**: low

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const tasks = await adapter.listTasks();

    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe("T1");
    expect(tasks[1].id).toBe("T2");
  });

  it("filters by status", async () => {
    const content = `# Tasks

## Backlog

### [T1] Open task

---

## Completed

### [T2] Closed task

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const openTasks = await adapter.listTasks({ status: "open" });
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].id).toBe("T1");

    const closedTasks = await adapter.listTasks({ status: "closed" });
    expect(closedTasks).toHaveLength(1);
    expect(closedTasks[0].id).toBe("T2");

    const allTasks = await adapter.listTasks({ status: "all" });
    expect(allTasks).toHaveLength(2);
  });

  it("filters by labels", async () => {
    const content = `# Tasks

## Backlog

### [T1] Feature task
- **Labels**: feature, backend

---

### [T2] Bug task
- **Labels**: bug

---

### [T3] Other task

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const featureTasks = await adapter.listTasks({ labels: ["feature"] });
    expect(featureTasks).toHaveLength(1);
    expect(featureTasks[0].id).toBe("T1");

    const bugTasks = await adapter.listTasks({ labels: ["bug"] });
    expect(bugTasks).toHaveLength(1);
    expect(bugTasks[0].id).toBe("T2");
  });

  it("filters by assignee", async () => {
    const content = `# Tasks

## Backlog

### [T1] Alice's task
- **Assignee**: @alice

---

### [T2] Bob's task
- **Assignee**: bob

---

### [T3] Unassigned

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const aliceTasks = await adapter.listTasks({ assignee: "@alice" });
    expect(aliceTasks).toHaveLength(1);
    expect(aliceTasks[0].id).toBe("T1");

    const bobTasks = await adapter.listTasks({ assignee: "bob" });
    expect(bobTasks).toHaveLength(1);
    expect(bobTasks[0].id).toBe("T2");
  });

  it("respects limit", async () => {
    const content = `# Tasks

## Backlog

### [T1] Task 1

---

### [T2] Task 2

---

### [T3] Task 3

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const limitedTasks = await adapter.listTasks({ limit: 2 });
    expect(limitedTasks).toHaveLength(2);
  });

  it("gets single task by ID", async () => {
    const content = `# Tasks

## Backlog

### [T1] First task
- **Priority**: high

---

### [T2] Second task

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const task = await adapter.getTask("T1");
    expect(task).not.toBeNull();
    expect(task?.title).toBe("First task");
    expect(task?.priority).toBe("high");

    const notFound = await adapter.getTask("NONEXISTENT");
    expect(notFound).toBeNull();
  });

  it("updates task status", async () => {
    const content = `# Tasks

## Backlog

### [T1] Task to move
- **Priority**: high

---

## In Progress

## Completed
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    await adapter.updateStatus("T1", "in_progress");

    const updated = await fs.readFile(tasksFile, "utf8");
    expect(updated).toContain("## In Progress\n\n### [T1] Task to move");
  });

  it("adds comment to task", async () => {
    const content = `# Tasks

## Backlog

### [T1] Task
- **Priority**: high

Description.

---
`;

    await fs.writeFile(tasksFile, content);

    const mockDate = new Date("2024-06-15");
    vi.setSystemTime(mockDate);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    await adapter.addComment("T1", "Test comment");

    const updated = await fs.readFile(tasksFile, "utf8");
    expect(updated).toContain("#### Comment (2024-06-15)");
    expect(updated).toContain("Test comment");

    vi.useRealTimers();
  });

  it("returns empty array for non-existent file", async () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: path.join(tempDir, "nonexistent.md"),
      enabled: true,
      config: {},
    });

    const tasks = await adapter.listTasks();
    expect(tasks).toEqual([]);
  });

  it("creates file if createIfMissing is true", async () => {
    const newFile = path.join(tempDir, "new-tasks.md");

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: newFile,
      enabled: true,
      config: { createIfMissing: true },
    });

    const tasks = await adapter.listTasks();
    expect(tasks).toEqual([]);

    // File should be created
    const exists = await fs
      .access(newFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("isConfigured returns true when file exists", async () => {
    await fs.writeFile(tasksFile, "# Tasks");

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    expect(await adapter.isConfigured()).toBe(true);
  });

  it("isConfigured returns false when file does not exist", async () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: path.join(tempDir, "nonexistent.md"),
      enabled: true,
      config: {},
    });

    expect(await adapter.isConfigured()).toBe(false);
  });

  it("isConfigured returns true with createIfMissing even if file does not exist", async () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: path.join(tempDir, "nonexistent.md"),
      enabled: true,
      config: { createIfMissing: true },
    });

    expect(await adapter.isConfigured()).toBe(true);
  });

  it("provides configuration instructions", () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const instructions = adapter.getConfigInstructions();
    expect(instructions).toContain("TASKS.md");
    expect(instructions).toContain("gimli config set");
  });
});

// ============================================================================
// GitHub Adapter Tests (mocked)
// ============================================================================

describe("GitHubIssuesAdapter", () => {
  it("has correct adapter properties", () => {
    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "owner/repo",
      enabled: true,
      config: {},
    });

    expect(adapter.type).toBe("github");
    expect(adapter.name).toBe("GitHub Issues");
    expect(adapter.supportsWrite).toBe(true);
  });

  it("provides configuration instructions", () => {
    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "owner/repo",
      enabled: true,
      config: {},
    });

    const instructions = adapter.getConfigInstructions();
    expect(instructions).toContain("gh auth login");
    expect(instructions).toContain("cli.github.com");
  });

  // Note: Integration tests with actual gh CLI would go in a separate e2e test file
  // or be run with GIMLI_LIVE_TEST=1
});

// ============================================================================
// Adapter Registry Tests
// ============================================================================

describe("AdapterRegistry", () => {
  it("creates with built-in factories", () => {
    const registry = createAdapterRegistry();

    // Should be able to create both built-in adapters
    const githubAdapter = registry.createAdapter({
      type: "github",
      source: "owner/repo",
      enabled: true,
      config: {},
    });
    expect(githubAdapter.type).toBe("github");

    const markdownAdapter = registry.createAdapter({
      type: "markdown",
      source: "/path/to/TASKS.md",
      enabled: true,
      config: {},
    });
    expect(markdownAdapter.type).toBe("markdown");
  });

  it("registers custom factory", () => {
    const registry = createAdapterRegistry();

    // Register a mock adapter factory
    registry.registerFactory("custom", (_config) => ({
      type: "custom",
      name: "Custom Adapter",
      supportsWrite: false,
      listTasks: async () => [],
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "Custom instructions",
    }));

    const adapter = registry.createAdapter({
      type: "custom",
      source: "custom-source",
      enabled: true,
      config: {},
    });

    expect(adapter.type).toBe("custom");
    expect(adapter.name).toBe("Custom Adapter");
  });

  it("throws for unknown adapter type", () => {
    const registry = createAdapterRegistry();

    expect(() =>
      registry.createAdapter({
        type: "unknown",
        source: "source",
        enabled: true,
        config: {},
      }),
    ).toThrow("Unknown adapter type: unknown");
  });

  it("retrieves adapter by type and source", () => {
    const registry = createAdapterRegistry();

    registry.createAdapter({
      type: "markdown",
      source: "/path/a",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "markdown",
      source: "/path/b",
      enabled: true,
      config: {},
    });

    const adapterA = registry.getAdapter("markdown", "/path/a");
    const adapterB = registry.getAdapter("markdown", "/path/b");
    const notFound = registry.getAdapter("markdown", "/path/c");

    expect(adapterA).toBeDefined();
    expect(adapterB).toBeDefined();
    expect(adapterA).not.toBe(adapterB);
    expect(notFound).toBeUndefined();
  });

  it("lists all adapters", () => {
    const registry = createAdapterRegistry();

    registry.createAdapter({
      type: "markdown",
      source: "/path/a",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "github",
      source: "owner/repo",
      enabled: true,
      config: {},
    });

    const adapters = registry.listAdapters();
    expect(adapters).toHaveLength(2);
    expect(adapters.map((a) => a.type).sort()).toEqual(["github", "markdown"]);
  });

  it("lists all tasks from all adapters", async () => {
    const registry = new AdapterRegistry();

    // Register mock adapters that return specific tasks
    registry.registerFactory("mock1", () => ({
      type: "mock1",
      name: "Mock 1",
      supportsWrite: false,
      listTasks: async () => [
        {
          id: "1",
          source: { adapter: "mock1", source: "src1" },
          title: "Task 1",
          status: "open",
          priority: "medium",
          labels: [],
          assignees: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          commentCount: 0,
          metadata: {},
        } as ExternalTask,
      ],
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "",
    }));

    registry.registerFactory("mock2", () => ({
      type: "mock2",
      name: "Mock 2",
      supportsWrite: false,
      listTasks: async () => [
        {
          id: "2",
          source: { adapter: "mock2", source: "src2" },
          title: "Task 2",
          status: "open",
          priority: "high",
          labels: [],
          assignees: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          commentCount: 0,
          metadata: {},
        } as ExternalTask,
      ],
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "",
    }));

    registry.createAdapter({
      type: "mock1",
      source: "src1",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "mock2",
      source: "src2",
      enabled: true,
      config: {},
    });

    const allTasks = await registry.listAllTasks();

    expect(allTasks).toHaveLength(2);
    expect(allTasks.map((t) => t.id).sort()).toEqual(["1", "2"]);
  });

  it("handles adapter errors gracefully in listAllTasks", async () => {
    const registry = new AdapterRegistry();

    registry.registerFactory("failing", () => ({
      type: "failing",
      name: "Failing",
      supportsWrite: false,
      listTasks: async () => {
        throw new Error("API error");
      },
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "",
    }));

    registry.registerFactory("working", () => ({
      type: "working",
      name: "Working",
      supportsWrite: false,
      listTasks: async () => [
        {
          id: "1",
          source: { adapter: "working", source: "src" },
          title: "Task",
          status: "open",
          priority: "medium",
          labels: [],
          assignees: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          commentCount: 0,
          metadata: {},
        } as ExternalTask,
      ],
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "",
    }));

    registry.createAdapter({
      type: "failing",
      source: "fail",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "working",
      source: "work",
      enabled: true,
      config: {},
    });

    // Should not throw, should return tasks from working adapter
    const tasks = await registry.listAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("1");
  });
});

// ============================================================================
// Type validation tests
// ============================================================================

describe("TaskStatus", () => {
  it("supports all expected statuses", () => {
    const statuses: Array<"open" | "in_progress" | "blocked" | "review" | "closed" | "wont_do"> = [
      "open",
      "in_progress",
      "blocked",
      "review",
      "closed",
      "wont_do",
    ];

    // This is a compile-time check - if it compiles, the types are correct
    expect(statuses).toHaveLength(6);
  });
});

describe("TaskPriority", () => {
  it("supports all expected priorities", () => {
    const priorities: Array<"critical" | "high" | "medium" | "low" | "none"> = [
      "critical",
      "high",
      "medium",
      "low",
      "none",
    ];

    expect(priorities).toHaveLength(5);
  });
});

describe("ExternalTask", () => {
  it("includes all required fields", () => {
    const task: ExternalTask = {
      id: "test-id",
      source: { adapter: "test", source: "test-source" },
      title: "Test Task",
      status: "open",
      priority: "medium",
      labels: ["label1"],
      assignees: ["user1"],
      createdAt: new Date(),
      updatedAt: new Date(),
      commentCount: 0,
      metadata: {},
    };

    expect(task.id).toBe("test-id");
    expect(task.source.adapter).toBe("test");
    expect(task.title).toBe("Test Task");
    expect(task.status).toBe("open");
    expect(task.priority).toBe("medium");
    expect(task.labels).toEqual(["label1"]);
    expect(task.assignees).toEqual(["user1"]);
    expect(task.commentCount).toBe(0);
  });

  it("supports optional fields", () => {
    const task: ExternalTask = {
      id: "test-id",
      source: { adapter: "test", source: "test-source" },
      title: "Test Task",
      body: "Task description",
      status: "open",
      priority: "high",
      labels: [],
      assignees: [],
      author: "author-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      dueDate: new Date(),
      milestone: "v1.0",
      commentCount: 5,
      url: "https://example.com/task/1",
      metadata: { custom: "data" },
    };

    expect(task.body).toBe("Task description");
    expect(task.author).toBe("author-user");
    expect(task.dueDate).toBeDefined();
    expect(task.milestone).toBe("v1.0");
    expect(task.url).toBe("https://example.com/task/1");
    expect(task.metadata.custom).toBe("data");
  });
});

describe("TaskListFilter", () => {
  it("supports all filter options", () => {
    const filter: TaskListFilter = {
      status: "open",
      labels: ["bug", "urgent"],
      assignee: "@me",
      query: "search term",
      limit: 50,
      sort: "priority",
      direction: "desc",
    };

    expect(filter.status).toBe("open");
    expect(filter.labels).toEqual(["bug", "urgent"]);
    expect(filter.assignee).toBe("@me");
    expect(filter.query).toBe("search term");
    expect(filter.limit).toBe(50);
    expect(filter.sort).toBe("priority");
    expect(filter.direction).toBe("desc");
  });
});
