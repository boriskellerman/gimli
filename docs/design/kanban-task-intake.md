# Kanban Task Intake Design

> **PRD Phase 6 Task**: Design task intake from Kanban sources (GitHub Issues, local markdown)

## Overview

This document describes the architecture for ingesting tasks from external Kanban sources into Gimli's autonomous agent system. The design uses an adapter pattern to support multiple sources while normalizing tasks to a common internal format.

## Goals

1. **Adapter Pattern**: Pluggable architecture for different task sources
2. **GitHub Issues First**: Primary adapter using `gh` CLI for GitHub Issues
3. **Local Markdown**: Secondary adapter for `TASKS.md` file format
4. **Common Schema**: Normalized task format across all sources
5. **Bi-directional Sync**: Read tasks and update status back to source
6. **Offline Support**: Local cache for resilience against API failures

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Task Intake Pipeline                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  External Sources                    Adapters                   Internal    │
│  ───────────────                    ─────────                   ────────    │
│                                                                             │
│  ┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐     │
│  │ GitHub Issues│────▶│ GitHubIssuesAdapter │────▶│                  │     │
│  └──────────────┘     └─────────────────────┘     │                  │     │
│                                                   │   Normalized     │     │
│  ┌──────────────┐     ┌─────────────────────┐     │   Task Queue     │     │
│  │  TASKS.md    │────▶│ MarkdownTaskAdapter │────▶│   (SQLite)       │     │
│  └──────────────┘     └─────────────────────┘     │                  │     │
│                                                   │                  │     │
│  ┌──────────────┐     ┌─────────────────────┐     │                  │     │
│  │ Linear (*)   │────▶│   LinearAdapter     │────▶│                  │     │
│  └──────────────┘     └─────────────────────┘     └──────────────────┘     │
│                                                            │               │
│  (*) Future adapters                                       ▼               │
│                                                   ┌──────────────────┐     │
│                                                   │  Kanban Agent    │     │
│                                                   │  (Task Runner)   │     │
│                                                   └──────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Adapter Interface

The core adapter interface provides a consistent API across all task sources:

```typescript
/**
 * Unique identifier for a task source
 */
export interface TaskSourceId {
  /** Adapter type (e.g., "github", "markdown", "linear") */
  adapter: string;
  /** Source-specific identifier (e.g., "owner/repo", file path) */
  source: string;
}

/**
 * Filter options for listing tasks
 */
export interface TaskListFilter {
  /** Task status filter */
  status?: "open" | "closed" | "all";
  /** Label/tag filter */
  labels?: string[];
  /** Assignee filter (use "@me" for current user) */
  assignee?: string;
  /** Search query (source-specific syntax) */
  query?: string;
  /** Maximum tasks to return */
  limit?: number;
  /** Sort order */
  sort?: "created" | "updated" | "priority";
  /** Sort direction */
  direction?: "asc" | "desc";
}

/**
 * Task adapter interface - implemented by each source type
 */
export interface TaskAdapter {
  /** Adapter type identifier */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /** Whether this adapter supports write operations */
  readonly supportsWrite: boolean;

  /**
   * List tasks from the source
   */
  listTasks(filter?: TaskListFilter): Promise<ExternalTask[]>;

  /**
   * Get a single task by ID
   */
  getTask(taskId: string): Promise<ExternalTask | null>;

  /**
   * Update task status (move columns)
   * @throws if supportsWrite is false
   */
  updateStatus(taskId: string, status: TaskStatus): Promise<void>;

  /**
   * Add a comment to a task
   * @throws if supportsWrite is false
   */
  addComment(taskId: string, comment: string): Promise<void>;

  /**
   * Get comments on a task
   */
  getComments(taskId: string): Promise<TaskComment[]>;

  /**
   * Check if adapter is properly configured
   */
  isConfigured(): Promise<boolean>;

  /**
   * Get configuration instructions for this adapter
   */
  getConfigInstructions(): string;
}

/**
 * Adapter factory function type
 */
export type TaskAdapterFactory = (config: AdapterConfig) => TaskAdapter;
```

### External Task Schema

Tasks from external sources are normalized to this schema:

```typescript
/**
 * Task status (maps to Kanban columns)
 */
export type TaskStatus =
  | "open"          // New, not started (backlog)
  | "in_progress"   // Being worked on
  | "blocked"       // Waiting for external input
  | "review"        // Waiting for review/feedback
  | "closed"        // Completed
  | "wont_do";      // Abandoned/rejected

/**
 * Task priority level
 */
export type TaskPriority = "critical" | "high" | "medium" | "low" | "none";

/**
 * External task representation (from any source)
 */
export interface ExternalTask {
  /** Source-specific task ID */
  id: string;

  /** Task source identifier */
  source: TaskSourceId;

  /** Task title */
  title: string;

  /** Task description/body (markdown) */
  body?: string;

  /** Current status */
  status: TaskStatus;

  /** Priority level */
  priority: TaskPriority;

  /** Labels/tags */
  labels: string[];

  /** Assignees (usernames) */
  assignees: string[];

  /** Author/creator */
  author?: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Due date (if set) */
  dueDate?: Date;

  /** Milestone/sprint */
  milestone?: string;

  /** Number of comments */
  commentCount: number;

  /** Source-specific URL */
  url?: string;

  /** Source-specific metadata */
  metadata: Record<string, unknown>;
}

/**
 * Task comment
 */
export interface TaskComment {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
  updatedAt?: Date;
}
```

### Normalized Internal Task

Tasks are stored internally with additional tracking fields:

```typescript
/**
 * Internal task representation with tracking metadata
 */
export interface NormalizedTask extends ExternalTask {
  /** Internal unique ID */
  internalId: string;

  /** Agent ID this task is assigned to */
  agentId?: string;

  /** When the task was imported */
  importedAt: Date;

  /** When the task was last synced */
  lastSyncedAt: Date;

  /** Local notes/context added by agent */
  agentNotes?: string;

  /** Execution state */
  executionState: TaskExecutionState;

  /** Linked session IDs where work was done */
  linkedSessions: string[];

  /** Estimated complexity (1-10) */
  estimatedComplexity?: number;

  /** Actual time spent (seconds) */
  timeSpent: number;
}

/**
 * Task execution state tracking
 */
export interface TaskExecutionState {
  /** Current phase */
  phase: "queued" | "analyzing" | "planning" | "executing" | "reviewing" | "done" | "failed";

  /** Attempts made */
  attempts: number;

  /** Last attempt timestamp */
  lastAttemptAt?: Date;

  /** Error message if failed */
  error?: string;

  /** Generated plan (if any) */
  plan?: TaskPlan;
}

/**
 * Task execution plan
 */
export interface TaskPlan {
  /** Plan summary */
  summary: string;

  /** Ordered steps */
  steps: TaskPlanStep[];

  /** Current step index */
  currentStep: number;

  /** Created timestamp */
  createdAt: Date;
}

/**
 * Single step in a task plan
 */
export interface TaskPlanStep {
  /** Step description */
  description: string;

  /** Step status */
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";

  /** Result/output of the step */
  result?: string;
}
```

## GitHub Issues Adapter

The primary adapter using `gh` CLI for GitHub Issues:

### Configuration

```typescript
export interface GitHubAdapterConfig {
  /** Repository in owner/repo format */
  repo: string;

  /** Optional: filter by project (GitHub Projects v2) */
  project?: string;

  /** Optional: filter by milestone */
  milestone?: string;

  /** Optional: custom label mappings */
  labelMappings?: {
    /** Labels that indicate "in progress" status */
    inProgress?: string[];
    /** Labels that indicate "blocked" status */
    blocked?: string[];
    /** Labels that indicate high priority */
    highPriority?: string[];
    /** Labels to exclude from import */
    exclude?: string[];
  };
}
```

### Implementation

```typescript
export class GitHubIssuesAdapter implements TaskAdapter {
  readonly type = "github";
  readonly name = "GitHub Issues";
  readonly supportsWrite = true;

  constructor(private config: GitHubAdapterConfig) {}

  async listTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const args = ["issue", "list", "-R", this.config.repo, "--json", GITHUB_JSON_FIELDS];

    // Apply filters
    if (filter?.status === "closed") args.push("--state", "closed");
    else if (filter?.status === "all") args.push("--state", "all");
    else args.push("--state", "open");

    if (filter?.labels?.length) {
      filter.labels.forEach((l) => args.push("--label", l));
    }
    if (filter?.assignee) args.push("--assignee", filter.assignee);
    if (filter?.query) args.push("--search", filter.query);
    if (filter?.limit) args.push("--limit", String(filter.limit));

    const result = await execGh(args);
    const issues: GitHubIssue[] = JSON.parse(result.stdout);
    return issues.map((issue) => this.mapIssueToTask(issue));
  }

  async getTask(taskId: string): Promise<ExternalTask | null> {
    try {
      const result = await execGh([
        "issue",
        "view",
        taskId,
        "-R",
        this.config.repo,
        "--json",
        GITHUB_JSON_FIELDS,
      ]);
      const issue: GitHubIssue = JSON.parse(result.stdout);
      return this.mapIssueToTask(issue);
    } catch {
      return null;
    }
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    if (status === "closed" || status === "wont_do") {
      await execGh(["issue", "close", taskId, "-R", this.config.repo]);
    } else if (status === "open") {
      await execGh(["issue", "reopen", taskId, "-R", this.config.repo]);
    }

    // Update labels for other statuses
    const labelsToAdd = this.getLabelsForStatus(status);
    const labelsToRemove = this.getLabelsToRemoveForStatus(status);

    if (labelsToAdd.length) {
      await execGh([
        "issue",
        "edit",
        taskId,
        "-R",
        this.config.repo,
        "--add-label",
        labelsToAdd.join(","),
      ]);
    }
    if (labelsToRemove.length) {
      await execGh([
        "issue",
        "edit",
        taskId,
        "-R",
        this.config.repo,
        "--remove-label",
        labelsToRemove.join(","),
      ]);
    }
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    await execGh(["issue", "comment", taskId, "-R", this.config.repo, "-b", comment]);
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    const result = await execGh([
      "issue",
      "view",
      taskId,
      "-R",
      this.config.repo,
      "--json",
      "comments",
    ]);
    const data = JSON.parse(result.stdout);
    return (data.comments ?? []).map(mapGitHubComment);
  }

  async isConfigured(): Promise<boolean> {
    try {
      await execGh(["auth", "status"]);
      return true;
    } catch {
      return false;
    }
  }

  getConfigInstructions(): string {
    return [
      "To configure GitHub Issues adapter:",
      "1. Install GitHub CLI: https://cli.github.com/",
      "2. Authenticate: gh auth login",
      "3. Set repository: gimli config set kanban.github.repo owner/repo",
    ].join("\n");
  }

  private mapIssueToTask(issue: GitHubIssue): ExternalTask {
    return {
      id: String(issue.number),
      source: { adapter: "github", source: this.config.repo },
      title: issue.title,
      body: issue.body ?? undefined,
      status: this.inferStatus(issue),
      priority: this.inferPriority(issue),
      labels: issue.labels?.map((l) => l.name) ?? [],
      assignees: issue.assignees?.map((a) => a.login) ?? [],
      author: issue.author?.login,
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
      milestone: issue.milestone?.title,
      commentCount: issue.comments?.length ?? 0,
      url: issue.url,
      metadata: {
        isPinned: issue.isPinned,
        stateReason: issue.stateReason,
        projectItems: issue.projectItems,
      },
    };
  }

  private inferStatus(issue: GitHubIssue): TaskStatus {
    if (issue.state === "CLOSED") {
      return issue.stateReason === "NOT_PLANNED" ? "wont_do" : "closed";
    }

    const labelNames = issue.labels?.map((l) => l.name.toLowerCase()) ?? [];
    const mappings = this.config.labelMappings ?? {};

    if (mappings.blocked?.some((l) => labelNames.includes(l.toLowerCase()))) {
      return "blocked";
    }
    if (mappings.inProgress?.some((l) => labelNames.includes(l.toLowerCase()))) {
      return "in_progress";
    }

    return "open";
  }

  private inferPriority(issue: GitHubIssue): TaskPriority {
    const labelNames = issue.labels?.map((l) => l.name.toLowerCase()) ?? [];
    const mappings = this.config.labelMappings ?? {};

    if (mappings.highPriority?.some((l) => labelNames.includes(l.toLowerCase()))) {
      return "high";
    }

    // Common priority label patterns
    if (labelNames.some((l) => l.includes("critical") || l.includes("urgent"))) {
      return "critical";
    }
    if (labelNames.some((l) => l.includes("high") || l.includes("p1"))) {
      return "high";
    }
    if (labelNames.some((l) => l.includes("low") || l.includes("p3"))) {
      return "low";
    }

    return "medium";
  }

  private getLabelsForStatus(status: TaskStatus): string[] {
    const mappings = this.config.labelMappings ?? {};
    switch (status) {
      case "in_progress":
        return mappings.inProgress ?? ["in-progress"];
      case "blocked":
        return mappings.blocked ?? ["blocked"];
      default:
        return [];
    }
  }

  private getLabelsToRemoveForStatus(status: TaskStatus): string[] {
    const mappings = this.config.labelMappings ?? {};
    const allStatusLabels = [
      ...(mappings.inProgress ?? []),
      ...(mappings.blocked ?? []),
    ];

    // Remove all status labels except the ones for the current status
    return allStatusLabels.filter(
      (l) => !this.getLabelsForStatus(status).includes(l),
    );
  }
}

const GITHUB_JSON_FIELDS = [
  "number",
  "title",
  "body",
  "state",
  "stateReason",
  "labels",
  "assignees",
  "author",
  "createdAt",
  "updatedAt",
  "milestone",
  "comments",
  "url",
  "isPinned",
  "projectItems",
].join(",");

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: "OPEN" | "CLOSED";
  stateReason: "COMPLETED" | "NOT_PLANNED" | "REOPENED" | null;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  milestone: { title: string } | null;
  comments: Array<{ author: { login: string }; body: string; createdAt: string }>;
  url: string;
  isPinned: boolean;
  projectItems: unknown;
}

async function execGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  // Use Bun.spawn or child_process.spawn
  // Implementation handles errors and timeouts
}

function mapGitHubComment(c: GitHubIssue["comments"][0]): TaskComment {
  return {
    id: c.createdAt, // GitHub comments don't have stable IDs in this context
    author: c.author.login,
    body: c.body,
    createdAt: new Date(c.createdAt),
  };
}
```

## Markdown Task Adapter

The local markdown adapter for `TASKS.md` files:

### TASKS.md Format

```markdown
# Project Tasks

## Backlog

### [TASK-001] Implement user authentication
- **Priority**: high
- **Labels**: auth, security
- **Created**: 2026-01-15
- **Due**: 2026-02-01

Implement OAuth2 authentication with GitHub and Google providers.
Support both web and CLI flows.

---

### [TASK-002] Add rate limiting to API
- **Priority**: medium
- **Labels**: api, performance
- **Created**: 2026-01-16

Implement token bucket rate limiting for all API endpoints.

---

## In Progress

### [TASK-003] Database migration script
- **Priority**: high
- **Labels**: database, ops
- **Assignee**: @alice
- **Created**: 2026-01-10
- **Started**: 2026-01-20

Create migration scripts for PostgreSQL to SQLite transition.

---

## Blocked

### [TASK-004] Third-party API integration
- **Priority**: medium
- **Labels**: integration
- **Blocked**: Waiting for API credentials from vendor

---

## Completed

### [TASK-005] Setup CI/CD pipeline
- **Priority**: high
- **Completed**: 2026-01-18

Configured GitHub Actions for automated testing and deployment.

---
```

### Implementation

```typescript
export interface MarkdownAdapterConfig {
  /** Path to TASKS.md file (absolute or relative to cwd) */
  filePath: string;

  /** Whether to create file if missing */
  createIfMissing?: boolean;
}

export class MarkdownTaskAdapter implements TaskAdapter {
  readonly type = "markdown";
  readonly name = "Local TASKS.md";
  readonly supportsWrite = true;

  constructor(private config: MarkdownAdapterConfig) {}

  async listTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const content = await this.readFile();
    if (!content) return [];

    const tasks = parseTasksMarkdown(content);

    return tasks
      .filter((task) => {
        if (filter?.status && filter.status !== "all") {
          const isOpen = task.status !== "closed" && task.status !== "wont_do";
          if (filter.status === "open" && !isOpen) return false;
          if (filter.status === "closed" && isOpen) return false;
        }
        if (filter?.labels?.length) {
          if (!filter.labels.some((l) => task.labels.includes(l))) return false;
        }
        if (filter?.assignee) {
          const normalizedAssignee = filter.assignee.replace("@", "");
          if (!task.assignees.includes(normalizedAssignee)) return false;
        }
        return true;
      })
      .slice(0, filter?.limit ?? 100);
  }

  async getTask(taskId: string): Promise<ExternalTask | null> {
    const tasks = await this.listTasks({ status: "all" });
    return tasks.find((t) => t.id === taskId) ?? null;
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<void> {
    const content = await this.readFile();
    if (!content) throw new Error("TASKS.md not found");

    const updated = updateTaskStatusInMarkdown(content, taskId, status);
    await this.writeFile(updated);
  }

  async addComment(taskId: string, comment: string): Promise<void> {
    const content = await this.readFile();
    if (!content) throw new Error("TASKS.md not found");

    const updated = addCommentToTaskInMarkdown(content, taskId, comment);
    await this.writeFile(updated);
  }

  async getComments(taskId: string): Promise<TaskComment[]> {
    const task = await this.getTask(taskId);
    if (!task) return [];

    // Comments are embedded in the task body as a "Comments" section
    return parseCommentsFromBody(task.body ?? "");
  }

  async isConfigured(): Promise<boolean> {
    try {
      await fs.access(this.resolveFilePath());
      return true;
    } catch {
      return this.config.createIfMissing ?? false;
    }
  }

  getConfigInstructions(): string {
    return [
      "To configure local markdown adapter:",
      "1. Create a TASKS.md file in your project root",
      "2. Use the format documented in docs/design/kanban-task-intake.md",
      "3. Set path: gimli config set kanban.markdown.filePath ./TASKS.md",
    ].join("\n");
  }

  private resolveFilePath(): string {
    const p = this.config.filePath;
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  }

  private async readFile(): Promise<string | null> {
    try {
      return await fs.readFile(this.resolveFilePath(), "utf8");
    } catch {
      if (this.config.createIfMissing) {
        await this.writeFile(INITIAL_TASKS_TEMPLATE);
        return INITIAL_TASKS_TEMPLATE;
      }
      return null;
    }
  }

  private async writeFile(content: string): Promise<void> {
    await fs.writeFile(this.resolveFilePath(), content, "utf8");
  }
}

const INITIAL_TASKS_TEMPLATE = `# Project Tasks

## Backlog

<!-- Add tasks here using the format:
### [TASK-ID] Task title
- **Priority**: high | medium | low
- **Labels**: label1, label2
- **Created**: YYYY-MM-DD

Task description goes here.
-->

## In Progress

## Blocked

## Completed
`;

/**
 * Parse TASKS.md content into ExternalTask objects
 */
function parseTasksMarkdown(content: string): ExternalTask[] {
  const tasks: ExternalTask[] = [];
  const sections = content.split(/^## /m).slice(1);

  for (const section of sections) {
    const [header, ...rest] = section.split("\n");
    const sectionName = header.trim().toLowerCase();
    const status = sectionNameToStatus(sectionName);
    const sectionContent = rest.join("\n");

    // Split by task headers (### [TASK-ID] Title)
    const taskBlocks = sectionContent.split(/^### /m).slice(1);

    for (const block of taskBlocks) {
      const task = parseTaskBlock(block, status);
      if (task) tasks.push(task);
    }
  }

  return tasks;
}

function sectionNameToStatus(name: string): TaskStatus {
  if (name.includes("backlog") || name.includes("todo")) return "open";
  if (name.includes("progress")) return "in_progress";
  if (name.includes("blocked") || name.includes("waiting")) return "blocked";
  if (name.includes("review")) return "review";
  if (name.includes("complete") || name.includes("done")) return "closed";
  if (name.includes("abandon") || name.includes("wont")) return "wont_do";
  return "open";
}

function parseTaskBlock(block: string, status: TaskStatus): ExternalTask | null {
  const lines = block.split("\n");
  const titleLine = lines[0];

  // Parse [TASK-ID] Title
  const titleMatch = titleLine.match(/^\[([^\]]+)\]\s*(.+)$/);
  if (!titleMatch) return null;

  const [, id, title] = titleMatch;
  const metadata: Record<string, string> = {};
  let bodyStart = 1;

  // Parse metadata lines (- **Key**: value)
  for (let i = 1; i < lines.length; i++) {
    const metaMatch = lines[i].match(/^-\s*\*\*([^*]+)\*\*:\s*(.+)$/);
    if (metaMatch) {
      metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim();
      bodyStart = i + 1;
    } else if (lines[i].trim() === "" || lines[i].startsWith("---")) {
      bodyStart = i + 1;
      break;
    }
  }

  // Rest is body (until --- separator)
  const bodyLines = [];
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    bodyLines.push(lines[i]);
  }
  const body = bodyLines.join("\n").trim();

  return {
    id,
    source: { adapter: "markdown", source: "TASKS.md" },
    title: title.trim(),
    body: body || undefined,
    status,
    priority: parsePriority(metadata.priority),
    labels: parseLabels(metadata.labels),
    assignees: parseAssignees(metadata.assignee),
    author: undefined,
    createdAt: parseDate(metadata.created) ?? new Date(),
    updatedAt: parseDate(metadata.updated ?? metadata.completed ?? metadata.started) ?? new Date(),
    dueDate: parseDate(metadata.due),
    milestone: metadata.milestone,
    commentCount: 0,
    url: undefined,
    metadata: {
      blocked: metadata.blocked,
      started: metadata.started,
      completed: metadata.completed,
    },
  };
}

function parsePriority(value?: string): TaskPriority {
  const v = value?.toLowerCase();
  if (v === "critical" || v === "urgent") return "critical";
  if (v === "high" || v === "p1") return "high";
  if (v === "medium" || v === "p2") return "medium";
  if (v === "low" || v === "p3") return "low";
  return "medium";
}

function parseLabels(value?: string): string[] {
  if (!value) return [];
  return value.split(",").map((l) => l.trim()).filter(Boolean);
}

function parseAssignees(value?: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((a) => a.trim().replace(/^@/, ""))
    .filter(Boolean);
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}
```

## Task Store (SQLite)

Internal storage for normalized tasks:

### Schema

```sql
CREATE TABLE IF NOT EXISTS kanban_tasks (
  internal_id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL,
  adapter_type TEXT NOT NULL,
  source_id TEXT NOT NULL,

  -- Task content
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  labels TEXT, -- JSON array
  assignees TEXT, -- JSON array
  author TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  due_date INTEGER,
  imported_at INTEGER NOT NULL,
  last_synced_at INTEGER NOT NULL,

  -- Additional metadata
  milestone TEXT,
  comment_count INTEGER DEFAULT 0,
  url TEXT,
  metadata TEXT, -- JSON object

  -- Agent tracking
  agent_id TEXT,
  agent_notes TEXT,
  execution_state TEXT, -- JSON object
  linked_sessions TEXT, -- JSON array
  estimated_complexity INTEGER,
  time_spent INTEGER DEFAULT 0,

  UNIQUE(adapter_type, source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_kanban_tasks_status ON kanban_tasks(status);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_priority ON kanban_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_agent ON kanban_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_kanban_tasks_source ON kanban_tasks(adapter_type, source_id);
```

### Store Interface

```typescript
export interface TaskStore {
  // Import/sync
  importTask(task: ExternalTask): Promise<NormalizedTask>;
  syncTask(internalId: string, external: ExternalTask): Promise<NormalizedTask>;
  syncAll(adapter: TaskAdapter, filter?: TaskListFilter): Promise<SyncResult>;

  // Queries
  get(internalId: string): Promise<NormalizedTask | null>;
  getByExternalId(source: TaskSourceId, externalId: string): Promise<NormalizedTask | null>;
  list(filter?: InternalTaskFilter): Promise<NormalizedTask[]>;
  getNextTask(agentId: string): Promise<NormalizedTask | null>;

  // Updates
  update(internalId: string, updates: Partial<NormalizedTask>): Promise<NormalizedTask>;
  updateExecutionState(internalId: string, state: Partial<TaskExecutionState>): Promise<void>;
  linkSession(internalId: string, sessionId: string): Promise<void>;
  addTimeSpent(internalId: string, seconds: number): Promise<void>;

  // Agent assignment
  assignToAgent(internalId: string, agentId: string): Promise<void>;
  unassign(internalId: string): Promise<void>;
}

export interface SyncResult {
  imported: number;
  updated: number;
  unchanged: number;
  errors: Array<{ taskId: string; error: string }>;
}

export interface InternalTaskFilter extends TaskListFilter {
  agentId?: string;
  executionPhase?: TaskExecutionState["phase"];
  hasAgent?: boolean;
  importedAfter?: Date;
}
```

## Adapter Registry

Central registry for managing adapters:

```typescript
export class AdapterRegistry {
  private adapters = new Map<string, TaskAdapter>();
  private factories = new Map<string, TaskAdapterFactory>();

  constructor() {
    // Register built-in factories
    this.registerFactory("github", (config) => new GitHubIssuesAdapter(config));
    this.registerFactory("markdown", (config) => new MarkdownTaskAdapter(config));
  }

  registerFactory(type: string, factory: TaskAdapterFactory): void {
    this.factories.set(type, factory);
  }

  createAdapter(type: string, config: AdapterConfig): TaskAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`Unknown adapter type: ${type}`);
    }
    const adapter = factory(config);
    this.adapters.set(`${type}:${config.source}`, adapter);
    return adapter;
  }

  getAdapter(type: string, source: string): TaskAdapter | undefined {
    return this.adapters.get(`${type}:${source}`);
  }

  listAdapters(): TaskAdapter[] {
    return Array.from(this.adapters.values());
  }

  async listAllTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const results = await Promise.all(
      this.listAdapters().map((a) => a.listTasks(filter).catch(() => [])),
    );
    return results.flat();
  }
}
```

## Configuration

### Config Schema

```typescript
export interface KanbanConfig {
  /** Enabled adapters */
  adapters: AdapterConfig[];

  /** Default adapter for new tasks */
  defaultAdapter?: string;

  /** Sync settings */
  sync: {
    /** Auto-sync interval in minutes (0 = disabled) */
    intervalMinutes: number;
    /** Sync on startup */
    onStartup: boolean;
  };

  /** Task selection settings */
  selection: {
    /** Prioritize tasks with due dates */
    prioritizeDueDates: boolean;
    /** Priority weight (higher = more weight) */
    priorityWeight: number;
    /** Prefer tasks with fewer comments (less complex) */
    preferSimpler: boolean;
  };
}

export interface AdapterConfig {
  type: string;
  source: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
```

### Default Config

```yaml
kanban:
  adapters:
    - type: github
      source: owner/repo
      enabled: false
      config:
        labelMappings:
          inProgress: ["in-progress", "wip"]
          blocked: ["blocked", "waiting"]
          highPriority: ["priority:high", "urgent"]
          exclude: ["duplicate", "invalid"]

    - type: markdown
      source: ./TASKS.md
      enabled: true
      config:
        createIfMissing: true

  sync:
    intervalMinutes: 30
    onStartup: true

  selection:
    prioritizeDueDates: true
    priorityWeight: 2
    preferSimpler: true
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Task Intake Flow                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SYNC TRIGGER                                                            │
│     - Startup sync (if enabled)                                             │
│     - Periodic sync (cron)                                                  │
│     - Manual sync (CLI: gimli kanban sync)                                  │
│                 │                                                           │
│                 ▼                                                           │
│  2. ADAPTER FETCH                                                           │
│     ┌────────────────────────────────────────┐                              │
│     │  For each enabled adapter:             │                              │
│     │  - adapter.listTasks(filter)           │                              │
│     │  - Handle errors gracefully            │                              │
│     │  - Log sync status                     │                              │
│     └────────────────────────────────────────┘                              │
│                 │                                                           │
│                 ▼                                                           │
│  3. NORMALIZATION                                                           │
│     ┌────────────────────────────────────────┐                              │
│     │  For each external task:               │                              │
│     │  - Map to NormalizedTask schema        │                              │
│     │  - Detect new vs existing              │                              │
│     │  - Merge updates (preserve local data) │                              │
│     └────────────────────────────────────────┘                              │
│                 │                                                           │
│                 ▼                                                           │
│  4. STORAGE                                                                 │
│     ┌────────────────────────────────────────┐                              │
│     │  store.importTask() or store.syncTask()│                              │
│     │  - Upsert into SQLite                  │                              │
│     │  - Update last_synced_at               │                              │
│     │  - Preserve execution_state            │                              │
│     └────────────────────────────────────────┘                              │
│                 │                                                           │
│                 ▼                                                           │
│  5. TASK QUEUE                                                              │
│     ┌────────────────────────────────────────┐                              │
│     │  Tasks available for agent pickup:     │                              │
│     │  - store.getNextTask(agentId)          │                              │
│     │  - Ordered by priority, due date       │                              │
│     │  - Filtered by agent preferences       │                              │
│     └────────────────────────────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         Task Update Flow                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Agent completes task                                                       │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────┐                               │
│  │ 1. Update internal state                 │                               │
│  │    store.updateExecutionState(id, {      │                               │
│  │      phase: "done",                      │                               │
│  │      ...                                 │                               │
│  │    })                                    │                               │
│  └──────────────────────────────────────────┘                               │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────┐                               │
│  │ 2. Sync back to source                   │                               │
│  │    adapter.updateStatus(id, "closed")    │                               │
│  │    adapter.addComment(id, summary)       │                               │
│  └──────────────────────────────────────────┘                               │
│         │                                                                   │
│         ▼                                                                   │
│  ┌──────────────────────────────────────────┐                               │
│  │ 3. Link session for audit trail          │                               │
│  │    store.linkSession(id, sessionId)      │                               │
│  └──────────────────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## CLI Commands

```bash
# Sync tasks from all adapters
gimli kanban sync

# Sync specific adapter
gimli kanban sync --adapter github

# List tasks
gimli kanban list
gimli kanban list --status open --priority high
gimli kanban list --adapter markdown

# View task details
gimli kanban view TASK-001

# Start working on next task
gimli kanban next

# Update task status
gimli kanban move TASK-001 in_progress
gimli kanban close TASK-001 --comment "Completed via PR #123"

# Configure adapters
gimli kanban config github --repo owner/repo
gimli kanban config markdown --file ./TASKS.md
```

## Security Considerations

1. **Credential Storage**: GitHub tokens managed by `gh auth`, not stored by Gimli
2. **Rate Limiting**: Respect GitHub API rate limits (5000/hour authenticated)
3. **Input Validation**: Sanitize task content before storage
4. **Access Control**: Tasks inherit permissions from source (e.g., private repos)
5. **Local Only**: All task data stored locally in `~/.gimli/kanban/`

## File Locations

```
src/
├── kanban/
│   ├── types.ts              # Type definitions
│   ├── adapters/
│   │   ├── interface.ts      # TaskAdapter interface
│   │   ├── github.ts         # GitHub Issues adapter
│   │   ├── markdown.ts       # TASKS.md adapter
│   │   └── index.ts          # Adapter exports
│   ├── store.ts              # SQLite task store
│   ├── schema.ts             # Database schema
│   ├── registry.ts           # Adapter registry
│   ├── config.ts             # Configuration handling
│   ├── sync.ts               # Sync orchestration
│   └── index.ts              # Public exports
├── commands/
│   └── kanban.ts             # CLI commands
└── hooks/
    └── kanban-sync-hook.ts   # Startup/cron sync hook
```

## Testing Strategy

1. **Unit Tests**: Each adapter tested with mocked responses
2. **Integration Tests**: Full sync flow with test fixtures
3. **Markdown Parser Tests**: Comprehensive format coverage
4. **GitHub API Tests**: Mocked `gh` CLI responses
5. **Store Tests**: SQLite operations and queries

## Implementation Order

1. `src/kanban/types.ts` - Type definitions
2. `src/kanban/adapters/interface.ts` - Adapter interface
3. `src/kanban/schema.ts` - SQLite schema
4. `src/kanban/store.ts` - Task store implementation
5. `src/kanban/adapters/markdown.ts` - Markdown adapter (simpler)
6. `src/kanban/adapters/github.ts` - GitHub adapter
7. `src/kanban/registry.ts` - Adapter registry
8. `src/kanban/sync.ts` - Sync orchestration
9. `src/commands/kanban.ts` - CLI commands
10. Tests for each component

## Future Adapters

| Adapter | API Type | Priority |
|---------|----------|----------|
| Linear | GraphQL | Medium |
| Jira | REST | Low |
| Notion | REST | Low |
| Asana | REST | Low |
| Trello | REST | Low |

## References

- AGI Research: `docs/AGI_RESEARCH.md` (Section 4: Project Management API Integrations)
- Existing Kanban: `src/dashboard/kanban-store.ts`
- Memory Integration: `docs/design/reminder-memory-integration.md`
- Pattern Types: `docs/design/pattern-types.md`
- GitHub CLI: https://cli.github.com/manual
