/**
 * Integration tests for Kanban task pickup from configured sources
 *
 * Tests the full pipeline: adapter configuration -> task listing -> picker selection
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdapterRegistry,
  createAdapterRegistry,
  type ExternalTask,
  GitHubIssuesAdapter,
  MarkdownTaskAdapter,
  type TaskAdapter,
} from "../adapter.js";
import { pickNextTask, pickTopTasks, type PickableTask } from "../picker.js";

// ============================================================================
// Mock utilities
// ============================================================================

// Mock spawn for gh CLI
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual("node:child_process");
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

/**
 * Create a mock spawn that returns the given stdout/stderr
 */
function mockGhCommand(stdout: string, stderr = "", exitCode = 0): ReturnType<typeof spawn> {
  const mockProc = {
    stdout: {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb(Buffer.from(stdout));
        }
      }),
    },
    stderr: {
      on: vi.fn((event, cb) => {
        if (event === "data" && stderr) {
          cb(Buffer.from(stderr));
        }
      }),
    },
    on: vi.fn((event, cb) => {
      if (event === "close") {
        setTimeout(() => cb(exitCode), 0);
      }
    }),
  };
  return mockProc as unknown as ReturnType<typeof spawn>;
}

/**
 * Set up gh CLI mock to return specific issues
 */
function setupGhMock(
  issues: Array<{
    number: number;
    title: string;
    body?: string;
    state?: "OPEN" | "CLOSED";
    stateReason?: "COMPLETED" | "NOT_PLANNED" | null;
    labels?: Array<{ name: string }>;
    assignees?: Array<{ login: string }>;
    author?: { login: string };
    createdAt?: string;
    updatedAt?: string;
    milestone?: { title: string } | null;
    comments?: Array<{ author: { login: string }; body: string; createdAt: string }>;
    url?: string;
    isPinned?: boolean;
  }>,
): void {
  const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
  mockSpawn.mockImplementation((cmd: string, args: string[]) => {
    if (cmd !== "gh") {
      throw new Error(`Unexpected command: ${cmd}`);
    }

    // Handle gh auth status
    if (args[0] === "auth" && args[1] === "status") {
      return mockGhCommand("", "", 0);
    }

    // Handle gh issue list
    if (args[0] === "issue" && args[1] === "list") {
      const fullIssues = issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        state: issue.state ?? "OPEN",
        stateReason: issue.stateReason ?? null,
        labels: issue.labels ?? [],
        assignees: issue.assignees ?? [],
        author: issue.author ?? { login: "unknown" },
        createdAt: issue.createdAt ?? new Date().toISOString(),
        updatedAt: issue.updatedAt ?? new Date().toISOString(),
        milestone: issue.milestone ?? null,
        comments: issue.comments ?? [],
        url: issue.url ?? `https://github.com/test/repo/issues/${issue.number}`,
        isPinned: issue.isPinned ?? false,
        projectItems: null,
      }));
      return mockGhCommand(JSON.stringify(fullIssues));
    }

    // Handle gh issue view
    if (args[0] === "issue" && args[1] === "view") {
      const issueNumber = Number.parseInt(args[2], 10);
      const issue = issues.find((i) => i.number === issueNumber);
      if (issue) {
        const fullIssue = {
          number: issue.number,
          title: issue.title,
          body: issue.body ?? null,
          state: issue.state ?? "OPEN",
          stateReason: issue.stateReason ?? null,
          labels: issue.labels ?? [],
          assignees: issue.assignees ?? [],
          author: issue.author ?? { login: "unknown" },
          createdAt: issue.createdAt ?? new Date().toISOString(),
          updatedAt: issue.updatedAt ?? new Date().toISOString(),
          milestone: issue.milestone ?? null,
          comments: issue.comments ?? [],
          url: issue.url ?? `https://github.com/test/repo/issues/${issue.number}`,
          isPinned: issue.isPinned ?? false,
          projectItems: null,
        };
        return mockGhCommand(JSON.stringify(fullIssue));
      }
      return mockGhCommand("", "Issue not found", 1);
    }

    throw new Error(`Unhandled gh command: ${args.join(" ")}`);
  });
}

/**
 * Set up gh CLI mock to fail (not authenticated)
 */
function setupGhMockNotAuthenticated(): void {
  const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
  mockSpawn.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "gh" && args[0] === "auth" && args[1] === "status") {
      return mockGhCommand("", "You are not logged into any GitHub hosts.", 1);
    }
    return mockGhCommand("", "gh: not authenticated", 1);
  });
}

/**
 * Convert ExternalTask to PickableTask for picker integration
 */
function externalToPickable(task: ExternalTask): PickableTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    labels: task.labels,
    assignees: task.assignees,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    dueDate: task.dueDate,
    commentCount: task.commentCount,
  };
}

// ============================================================================
// GitHub Issues Adapter Task Pickup Tests
// ============================================================================

describe("GitHub Issues adapter task pickup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("picks up tasks from GitHub Issues", async () => {
    setupGhMock([
      {
        number: 1,
        title: "Fix critical bug",
        body: "This is urgent",
        labels: [{ name: "bug" }, { name: "critical" }],
        assignees: [{ login: "alice" }],
      },
      {
        number: 2,
        title: "Add new feature",
        body: "Feature request",
        labels: [{ name: "feature" }],
      },
      {
        number: 3,
        title: "Update docs",
        labels: [{ name: "documentation" }],
      },
    ]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const tasks = await adapter.listTasks();

    expect(tasks).toHaveLength(3);
    expect(tasks[0].id).toBe("1");
    expect(tasks[0].title).toBe("Fix critical bug");
    expect(tasks[0].labels).toContain("bug");
    expect(tasks[0].labels).toContain("critical");
    expect(tasks[0].assignees).toContain("alice");
    expect(tasks[0].source.adapter).toBe("github");
    expect(tasks[0].source.source).toBe("test/repo");
  });

  it("filters tasks by status", async () => {
    setupGhMock([
      { number: 1, title: "Open issue", state: "OPEN" },
      { number: 2, title: "Closed issue", state: "CLOSED", stateReason: "COMPLETED" },
    ]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    // The mock returns all issues regardless of state filter (gh CLI would filter server-side)
    // Verify that the adapter correctly maps CLOSED state to "closed" status
    const allTasks = await adapter.listTasks({ status: "all" });
    expect(allTasks).toHaveLength(2);

    const openTask = allTasks.find((t) => t.id === "1");
    const closedTask = allTasks.find((t) => t.id === "2");

    expect(openTask?.status).toBe("open");
    expect(closedTask?.status).toBe("closed");
  });

  it("maps GitHub labels to priority", async () => {
    setupGhMock([
      { number: 1, title: "Critical bug", labels: [{ name: "critical" }] },
      { number: 2, title: "High priority", labels: [{ name: "P1" }] },
      { number: 3, title: "Normal task", labels: [{ name: "feature" }] },
      { number: 4, title: "Low priority", labels: [{ name: "low" }] },
    ]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const tasks = await adapter.listTasks();

    expect(tasks.find((t) => t.id === "1")?.priority).toBe("critical");
    expect(tasks.find((t) => t.id === "2")?.priority).toBe("high");
    expect(tasks.find((t) => t.id === "3")?.priority).toBe("medium");
    expect(tasks.find((t) => t.id === "4")?.priority).toBe("low");
  });

  it("uses custom label mappings for status", async () => {
    setupGhMock([
      { number: 1, title: "WIP task", labels: [{ name: "wip" }] },
      { number: 2, title: "Blocked task", labels: [{ name: "waiting-on-external" }] },
      { number: 3, title: "In review", labels: [{ name: "needs-review" }] },
    ]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {
        labelMappings: {
          inProgress: ["wip"],
          blocked: ["waiting-on-external"],
          review: ["needs-review"],
        },
      },
    });

    const tasks = await adapter.listTasks();

    expect(tasks.find((t) => t.id === "1")?.status).toBe("in_progress");
    expect(tasks.find((t) => t.id === "2")?.status).toBe("blocked");
    expect(tasks.find((t) => t.id === "3")?.status).toBe("review");
  });

  it("gets single task by ID", async () => {
    setupGhMock([
      {
        number: 42,
        title: "Specific issue",
        body: "Details here",
        labels: [{ name: "bug" }],
      },
    ]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const task = await adapter.getTask("42");

    expect(task).not.toBeNull();
    expect(task?.id).toBe("42");
    expect(task?.title).toBe("Specific issue");
  });

  it("returns null for non-existent task", async () => {
    setupGhMock([]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const task = await adapter.getTask("999");

    expect(task).toBeNull();
  });

  it("reports unconfigured when gh auth fails", async () => {
    setupGhMockNotAuthenticated();

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const configured = await adapter.isConfigured();

    expect(configured).toBe(false);
  });

  it("reports configured when gh auth succeeds", async () => {
    setupGhMock([]);

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    const configured = await adapter.isConfigured();

    expect(configured).toBe(true);
  });
});

// ============================================================================
// TASKS.md Adapter Task Pickup Tests
// ============================================================================

describe("TASKS.md adapter task pickup", () => {
  let tempDir: string;
  let tasksFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-integration-"));
    tasksFile = path.join(tempDir, "TASKS.md");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("picks up tasks from TASKS.md file", async () => {
    const content = `# Project Tasks

## Backlog

### [TASK-001] Implement authentication
- **Priority**: high
- **Labels**: feature, security
- **Assignee**: @alice
- **Created**: 2024-06-01

Add OAuth2 authentication support.

---

### [TASK-002] Fix login bug
- **Priority**: critical
- **Labels**: bug
- **Created**: 2024-06-02

Users can't log in with special characters.

---

## In Progress

### [TASK-003] Refactor database layer
- **Priority**: medium
- **Assignee**: @bob
- **Started**: 2024-06-05

---

## Completed

### [TASK-004] Set up CI/CD
- **Priority**: high
- **Completed**: 2024-06-10

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

    // Should return only open tasks by default
    expect(tasks.length).toBeGreaterThanOrEqual(2);

    const task1 = tasks.find((t) => t.id === "TASK-001");
    expect(task1).toBeDefined();
    expect(task1?.title).toBe("Implement authentication");
    expect(task1?.priority).toBe("high");
    expect(task1?.labels).toContain("feature");
    expect(task1?.labels).toContain("security");
    expect(task1?.assignees).toContain("alice");
    expect(task1?.status).toBe("open");
    expect(task1?.source.adapter).toBe("markdown");

    const task3 = tasks.find((t) => t.id === "TASK-003");
    expect(task3).toBeDefined();
    expect(task3?.status).toBe("in_progress");
  });

  it("handles various task statuses", async () => {
    const content = `# Tasks

## Backlog

### [T1] Open task

---

## In Progress

### [T2] Working

---

## Blocked

### [T3] Waiting

---

## Review

### [T4] In review

---

## Completed

### [T5] Done

---

## Abandoned

### [T6] Cancelled

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const allTasks = await adapter.listTasks({ status: "all" });

    expect(allTasks.find((t) => t.id === "T1")?.status).toBe("open");
    expect(allTasks.find((t) => t.id === "T2")?.status).toBe("in_progress");
    expect(allTasks.find((t) => t.id === "T3")?.status).toBe("blocked");
    expect(allTasks.find((t) => t.id === "T4")?.status).toBe("review");
    expect(allTasks.find((t) => t.id === "T5")?.status).toBe("closed");
    expect(allTasks.find((t) => t.id === "T6")?.status).toBe("wont_do");
  });

  it("filters by labels", async () => {
    const content = `# Tasks

## Backlog

### [BUG1] Critical bug
- **Labels**: bug, critical

---

### [FEAT1] New feature
- **Labels**: feature, enhancement

---

### [DOCS1] Update docs
- **Labels**: docs

---
`;

    await fs.writeFile(tasksFile, content);

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const bugTasks = await adapter.listTasks({ labels: ["bug"] });
    expect(bugTasks).toHaveLength(1);
    expect(bugTasks[0].id).toBe("BUG1");

    const featureTasks = await adapter.listTasks({ labels: ["feature"] });
    expect(featureTasks).toHaveLength(1);
    expect(featureTasks[0].id).toBe("FEAT1");
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

    const aliceTasks = await adapter.listTasks({ assignee: "alice" });
    expect(aliceTasks).toHaveLength(1);
    expect(aliceTasks[0].id).toBe("T1");

    // Should also work with @ prefix
    const aliceTasksWithAt = await adapter.listTasks({ assignee: "@alice" });
    expect(aliceTasksWithAt).toHaveLength(1);
  });

  it("handles non-existent file gracefully", async () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: path.join(tempDir, "nonexistent.md"),
      enabled: true,
      config: {},
    });

    const tasks = await adapter.listTasks();
    expect(tasks).toEqual([]);
  });

  it("creates file when createIfMissing is enabled", async () => {
    const newFile = path.join(tempDir, "new-tasks.md");

    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: newFile,
      enabled: true,
      config: { createIfMissing: true },
    });

    // First access should create the file
    const tasks = await adapter.listTasks();
    expect(tasks).toEqual([]);

    // File should now exist
    const exists = await fs
      .access(newFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);

    // isConfigured should return true even before file exists
    const adapter2 = new MarkdownTaskAdapter({
      type: "markdown",
      source: path.join(tempDir, "another.md"),
      enabled: true,
      config: { createIfMissing: true },
    });
    expect(await adapter2.isConfigured()).toBe(true);
  });
});

// ============================================================================
// Adapter Registry Aggregation Tests
// ============================================================================

describe("adapter registry aggregation", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-registry-"));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("aggregates tasks from multiple adapters", async () => {
    // Set up GitHub mock
    setupGhMock([
      { number: 1, title: "GitHub Issue 1", labels: [{ name: "bug" }] },
      { number: 2, title: "GitHub Issue 2", labels: [{ name: "feature" }] },
    ]);

    // Set up TASKS.md
    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] Markdown Task 1
- **Labels**: docs

---

### [MD-002] Markdown Task 2
- **Labels**: test

---
`,
    );

    const registry = createAdapterRegistry();

    registry.createAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    const allTasks = await registry.listAllTasks();

    expect(allTasks.length).toBe(4);

    // Check GitHub tasks
    const githubTasks = allTasks.filter((t) => t.source.adapter === "github");
    expect(githubTasks).toHaveLength(2);
    expect(githubTasks.map((t) => t.id).sort()).toEqual(["1", "2"]);

    // Check Markdown tasks
    const mdTasks = allTasks.filter((t) => t.source.adapter === "markdown");
    expect(mdTasks).toHaveLength(2);
    expect(mdTasks.map((t) => t.id).sort()).toEqual(["MD-001", "MD-002"]);
  });

  it("handles mixed adapter errors gracefully", async () => {
    // GitHub mock will fail
    setupGhMockNotAuthenticated();

    // But TASKS.md works
    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] Markdown Task

---
`,
    );

    const registry = createAdapterRegistry();

    registry.createAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    // Should not throw and should return tasks from working adapter
    const allTasks = await registry.listAllTasks();

    expect(allTasks.length).toBeGreaterThanOrEqual(1);
    expect(allTasks.some((t) => t.id === "MD-001")).toBe(true);
  });

  it("supports multiple adapters of the same type", async () => {
    const tasks1File = path.join(tempDir, "team1/TASKS.md");
    const tasks2File = path.join(tempDir, "team2/TASKS.md");

    await fs.mkdir(path.dirname(tasks1File), { recursive: true });
    await fs.mkdir(path.dirname(tasks2File), { recursive: true });

    await fs.writeFile(
      tasks1File,
      `# Team 1 Tasks

## Backlog

### [T1-001] Team 1 Task

---
`,
    );

    await fs.writeFile(
      tasks2File,
      `# Team 2 Tasks

## Backlog

### [T2-001] Team 2 Task

---
`,
    );

    const registry = createAdapterRegistry();

    registry.createAdapter({
      type: "markdown",
      source: tasks1File,
      enabled: true,
      config: {},
    });

    registry.createAdapter({
      type: "markdown",
      source: tasks2File,
      enabled: true,
      config: {},
    });

    const allTasks = await registry.listAllTasks();

    expect(allTasks).toHaveLength(2);
    expect(allTasks.some((t) => t.id === "T1-001")).toBe(true);
    expect(allTasks.some((t) => t.id === "T2-001")).toBe(true);
  });

  it("retrieves specific adapter by type and source", () => {
    const registry = createAdapterRegistry();

    const adapter1 = registry.createAdapter({
      type: "markdown",
      source: "/path/to/project1/TASKS.md",
      enabled: true,
      config: {},
    });

    const adapter2 = registry.createAdapter({
      type: "markdown",
      source: "/path/to/project2/TASKS.md",
      enabled: true,
      config: {},
    });

    const retrieved1 = registry.getAdapter("markdown", "/path/to/project1/TASKS.md");
    const retrieved2 = registry.getAdapter("markdown", "/path/to/project2/TASKS.md");

    expect(retrieved1).toBe(adapter1);
    expect(retrieved2).toBe(adapter2);
    expect(retrieved1).not.toBe(retrieved2);
  });

  it("supports custom adapter factories", async () => {
    const registry = new AdapterRegistry();

    // Register a custom "linear" adapter factory
    const mockTasks: ExternalTask[] = [
      {
        id: "LIN-001",
        source: { adapter: "linear", source: "team/project" },
        title: "Linear Task",
        status: "open",
        priority: "high",
        labels: ["backend"],
        assignees: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        commentCount: 0,
        metadata: {},
      },
    ];

    registry.registerFactory("linear", (_config) => ({
      type: "linear",
      name: "Linear",
      supportsWrite: true,
      listTasks: async () => mockTasks,
      getTask: async (id) => mockTasks.find((t) => t.id === id) ?? null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "Configure Linear API key",
    }));

    registry.createAdapter({
      type: "linear",
      source: "team/project",
      enabled: true,
      config: {},
    });

    const tasks = await registry.listAllTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("LIN-001");
    expect(tasks[0].source.adapter).toBe("linear");
  });
});

// ============================================================================
// Picker Integration with Adapters
// ============================================================================

describe("picker integration with adapters", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-picker-"));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("picks highest priority task from aggregated sources", async () => {
    // GitHub has a high priority task
    setupGhMock([
      {
        number: 1,
        title: "GitHub Critical Bug",
        labels: [{ name: "critical" }, { name: "bug" }],
      },
      { number: 2, title: "GitHub Feature", labels: [{ name: "feature" }] },
    ]);

    // Markdown has medium priority tasks
    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] Medium Task
- **Priority**: medium

---

### [MD-002] Low Task
- **Priority**: low

---
`,
    );

    const registry = createAdapterRegistry();
    registry.createAdapter({ type: "github", source: "test/repo", enabled: true, config: {} });
    registry.createAdapter({ type: "markdown", source: tasksFile, enabled: true, config: {} });

    const allTasks = await registry.listAllTasks();
    const pickableTasks = allTasks.map(externalToPickable);

    const result = pickNextTask(pickableTasks);

    expect(result.task).not.toBeNull();
    expect(result.task?.id).toBe("1"); // GitHub critical bug
    expect(result.reason).toContain("Critical");
  });

  it("picks top N tasks across all sources", async () => {
    setupGhMock([
      { number: 1, title: "GH High", labels: [{ name: "high" }] },
      { number: 2, title: "GH Medium" },
    ]);

    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] MD Critical
- **Priority**: critical

---

### [MD-002] MD Low
- **Priority**: low

---
`,
    );

    const registry = createAdapterRegistry();
    registry.createAdapter({ type: "github", source: "test/repo", enabled: true, config: {} });
    registry.createAdapter({ type: "markdown", source: tasksFile, enabled: true, config: {} });

    const allTasks = await registry.listAllTasks();
    const pickableTasks = allTasks.map(externalToPickable);

    const topTasks = pickTopTasks(pickableTasks, 3);

    expect(topTasks).toHaveLength(3);
    // MD Critical should be first (critical priority)
    expect(topTasks[0].task.id).toBe("MD-001");
    // GH High should be second
    expect(topTasks[1].task.id).toBe("1");
  });

  it("applies filters when picking from aggregated tasks", async () => {
    setupGhMock([
      {
        number: 1,
        title: "GH Bug",
        labels: [{ name: "bug" }, { name: "critical" }],
      },
      { number: 2, title: "GH Feature", labels: [{ name: "feature" }] },
    ]);

    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] MD Bug
- **Priority**: high
- **Labels**: bug

---

### [MD-002] MD Feature
- **Priority**: critical
- **Labels**: feature

---
`,
    );

    const registry = createAdapterRegistry();
    registry.createAdapter({ type: "github", source: "test/repo", enabled: true, config: {} });
    registry.createAdapter({ type: "markdown", source: tasksFile, enabled: true, config: {} });

    const allTasks = await registry.listAllTasks();
    const pickableTasks = allTasks.map(externalToPickable);

    // Filter only bugs
    const result = pickNextTask(pickableTasks, {
      filter: { labels: ["bug"] },
    });

    expect(result.task).not.toBeNull();
    // GH Bug is critical, MD Bug is high
    expect(result.task?.labels).toContain("bug");
  });

  it("handles empty results gracefully", async () => {
    // GitHub returns nothing
    setupGhMock([]);

    // TASKS.md is also empty
    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

## Completed
`,
    );

    const registry = createAdapterRegistry();
    registry.createAdapter({ type: "github", source: "test/repo", enabled: true, config: {} });
    registry.createAdapter({ type: "markdown", source: tasksFile, enabled: true, config: {} });

    const allTasks = await registry.listAllTasks();
    const pickableTasks = allTasks.map(externalToPickable);

    const result = pickNextTask(pickableTasks);

    expect(result.task).toBeNull();
    expect(result.consideredCount).toBe(0);
    expect(result.reason).toContain("No tasks available");
  });

  it("handles assignee-based task selection", async () => {
    setupGhMock([
      {
        number: 1,
        title: "Alice's GH Task",
        assignees: [{ login: "alice" }],
        labels: [{ name: "high" }],
      },
      {
        number: 2,
        title: "Bob's GH Task",
        assignees: [{ login: "bob" }],
        labels: [{ name: "critical" }],
      },
    ]);

    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Tasks

## Backlog

### [MD-001] Alice's MD Task
- **Priority**: critical
- **Assignee**: @alice

---

### [MD-002] Unassigned Task
- **Priority**: high

---
`,
    );

    const registry = createAdapterRegistry();
    registry.createAdapter({ type: "github", source: "test/repo", enabled: true, config: {} });
    registry.createAdapter({ type: "markdown", source: tasksFile, enabled: true, config: {} });

    const allTasks = await registry.listAllTasks();
    const pickableTasks = allTasks.map(externalToPickable);

    const result = pickNextTask(pickableTasks, {
      filter: { assignee: "alice" },
    });

    expect(result.task).not.toBeNull();
    expect(result.task?.assignees).toContain("alice");
  });
});

// ============================================================================
// Error Handling for Misconfigured Sources
// ============================================================================

describe("error handling for misconfigured sources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports configuration status for GitHub adapter", async () => {
    setupGhMockNotAuthenticated();

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    expect(await adapter.isConfigured()).toBe(false);

    const instructions = adapter.getConfigInstructions();
    expect(instructions).toContain("gh auth login");
    expect(instructions).toContain("cli.github.com");
  });

  it("provides configuration instructions for markdown adapter", async () => {
    const adapter = new MarkdownTaskAdapter({
      type: "markdown",
      source: "/nonexistent/TASKS.md",
      enabled: true,
      config: {},
    });

    expect(await adapter.isConfigured()).toBe(false);

    const instructions = adapter.getConfigInstructions();
    expect(instructions).toContain("TASKS.md");
    expect(instructions).toContain("gimli config set");
  });

  it("throws error for unknown adapter type", () => {
    const registry = createAdapterRegistry();

    expect(() =>
      registry.createAdapter({
        type: "jira", // Not registered
        source: "project/board",
        enabled: true,
        config: {},
      }),
    ).toThrow("Unknown adapter type: jira");
  });

  it("handles gh CLI spawn errors gracefully", async () => {
    const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>;
    mockSpawn.mockImplementation(() => {
      const mockProc = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, cb) => {
          if (event === "error") {
            setTimeout(() => cb(new Error("spawn ENOENT")), 0);
          }
        }),
      };
      return mockProc;
    });

    const adapter = new GitHubIssuesAdapter({
      type: "github",
      source: "test/repo",
      enabled: true,
      config: {},
    });

    await expect(adapter.listTasks()).rejects.toThrow("spawn");
  });

  it("continues working when one adapter fails in registry", async () => {
    const registry = new AdapterRegistry();

    // Register a failing adapter
    registry.registerFactory("failing", () => ({
      type: "failing",
      name: "Failing Adapter",
      supportsWrite: false,
      listTasks: async () => {
        throw new Error("Network error");
      },
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => false,
      getConfigInstructions: () => "",
    }));

    // Register a working adapter
    registry.registerFactory("working", () => ({
      type: "working",
      name: "Working Adapter",
      supportsWrite: false,
      listTasks: async () => [
        {
          id: "W-001",
          source: { adapter: "working", source: "src" },
          title: "Working Task",
          status: "open" as const,
          priority: "medium" as const,
          labels: [],
          assignees: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          commentCount: 0,
          metadata: {},
        },
      ],
      getTask: async () => null,
      updateStatus: async () => {},
      addComment: async () => {},
      getComments: async () => [],
      isConfigured: async () => true,
      getConfigInstructions: () => "",
    }));

    registry.createAdapter({ type: "failing", source: "fail", enabled: true, config: {} });
    registry.createAdapter({ type: "working", source: "work", enabled: true, config: {} });

    // Should not throw and should return tasks from working adapter
    const tasks = await registry.listAllTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("W-001");
  });

  it("validates adapter configuration on creation", () => {
    const registry = createAdapterRegistry();

    // Valid configs should work
    expect(() =>
      registry.createAdapter({
        type: "github",
        source: "owner/repo",
        enabled: true,
        config: {},
      }),
    ).not.toThrow();

    expect(() =>
      registry.createAdapter({
        type: "markdown",
        source: "/path/to/TASKS.md",
        enabled: true,
        config: {},
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// End-to-end workflow test
// ============================================================================

describe("end-to-end task pickup workflow", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kanban-e2e-"));
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("complete workflow: configure -> list -> pick -> work", async () => {
    // Set up sources
    setupGhMock([
      {
        number: 42,
        title: "Critical production bug",
        body: "Users cannot checkout",
        labels: [{ name: "bug" }, { name: "critical" }, { name: "production" }],
        assignees: [{ login: "oncall" }],
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        number: 43,
        title: "New feature request",
        labels: [{ name: "feature" }, { name: "enhancement" }],
      },
    ]);

    const tasksFile = path.join(tempDir, "TASKS.md");
    await fs.writeFile(
      tasksFile,
      `# Sprint Tasks

## Backlog

### [SPRINT-001] Update documentation
- **Priority**: low
- **Labels**: docs

---

### [SPRINT-002] Write tests
- **Priority**: medium
- **Labels**: test, tech-debt

---

## In Progress

### [SPRINT-003] Refactor auth module
- **Priority**: high
- **Assignee**: @alice
- **Labels**: refactor

---
`,
    );

    // Step 1: Create and configure registry
    const registry = createAdapterRegistry();

    // Step 2: Add adapters
    const githubAdapter = registry.createAdapter({
      type: "github",
      source: "company/monorepo",
      enabled: true,
      config: {
        labelMappings: {
          inProgress: ["in-progress", "wip"],
          blocked: ["blocked", "waiting"],
          // Note: Not setting highPriority here so the default "critical" label detection
          // maps to "critical" priority (highPriority would override to "high")
        },
      },
    });

    const markdownAdapter = registry.createAdapter({
      type: "markdown",
      source: tasksFile,
      enabled: true,
      config: {},
    });

    // Step 3: Verify configuration
    expect(await githubAdapter.isConfigured()).toBe(true);
    expect(await markdownAdapter.isConfigured()).toBe(true);

    // Step 4: List all adapters
    const adapters = registry.listAdapters();
    expect(adapters).toHaveLength(2);

    // Step 5: Aggregate all tasks
    const allTasks = await registry.listAllTasks();
    expect(allTasks.length).toBeGreaterThanOrEqual(4);

    // Step 6: Convert to pickable format
    const pickableTasks = allTasks.map(externalToPickable);

    // Step 7: Pick next task (should be the critical GitHub bug)
    const nextTask = pickNextTask(pickableTasks);
    expect(nextTask.task).not.toBeNull();
    expect(nextTask.task?.id).toBe("42"); // Critical production bug
    expect(nextTask.reason).toContain("Critical");

    // Step 8: Get top tasks for sprint planning
    const topTasks = pickTopTasks(pickableTasks, 3);
    expect(topTasks).toHaveLength(3);

    // Step 9: Filter for specific team member
    const aliceTasks = pickNextTask(pickableTasks, {
      filter: { assignee: "alice" },
    });
    expect(aliceTasks.task?.id).toBe("SPRINT-003");

    // Step 10: Get specific task details
    const bugDetails = await githubAdapter.getTask("42");
    expect(bugDetails?.title).toBe("Critical production bug");
    expect(bugDetails?.body).toBe("Users cannot checkout");
  });
});
