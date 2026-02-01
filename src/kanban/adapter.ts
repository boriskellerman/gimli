/**
 * Kanban task source adapters
 *
 * Provides pluggable adapters for ingesting tasks from external sources
 * (GitHub Issues, local TASKS.md) into a normalized format.
 *
 * Note: Uses spawn() with argument arrays for safe command execution
 * (no shell injection risk).
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// ============================================================================
// Type definitions
// ============================================================================

/**
 * Task status (maps to Kanban columns)
 */
export type TaskStatus =
  | "open" // New, not started (backlog)
  | "in_progress" // Being worked on
  | "blocked" // Waiting for external input
  | "review" // Waiting for review/feedback
  | "closed" // Completed
  | "wont_do"; // Abandoned/rejected

/**
 * Task priority level
 */
export type TaskPriority = "critical" | "high" | "medium" | "low" | "none";

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
 * Generic adapter configuration
 */
export interface AdapterConfig {
  type: string;
  source: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/**
 * Adapter factory function type
 */
export type TaskAdapterFactory = (config: AdapterConfig) => TaskAdapter;

// ============================================================================
// GitHub Issues Adapter
// ============================================================================

/**
 * Configuration for GitHub Issues adapter
 */
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
    /** Labels that indicate "review" status */
    review?: string[];
    /** Labels that indicate high priority */
    highPriority?: string[];
    /** Labels to exclude from import */
    exclude?: string[];
  };
}

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

/**
 * Execute a gh CLI command using spawn (safe - no shell injection)
 */
async function execGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`gh command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn gh: ${err.message}`));
    });
  });
}

function mapGitHubComment(c: GitHubIssue["comments"][0]): TaskComment {
  return {
    id: c.createdAt,
    author: c.author.login,
    body: c.body,
    createdAt: new Date(c.createdAt),
  };
}

/**
 * GitHub Issues adapter using the gh CLI
 */
export class GitHubIssuesAdapter implements TaskAdapter {
  readonly type = "github";
  readonly name = "GitHub Issues";
  readonly supportsWrite = true;

  private config: GitHubAdapterConfig;

  constructor(adapterConfig: AdapterConfig) {
    this.config = {
      repo: adapterConfig.source,
      ...(adapterConfig.config as Partial<GitHubAdapterConfig>),
    };
  }

  async listTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const args = ["issue", "list", "-R", this.config.repo, "--json", GITHUB_JSON_FIELDS];

    // Apply filters
    if (filter?.status === "closed") {
      args.push("--state", "closed");
    } else if (filter?.status === "all") {
      args.push("--state", "all");
    } else {
      args.push("--state", "open");
    }

    if (filter?.labels?.length) {
      for (const label of filter.labels) {
        args.push("--label", label);
      }
    }
    if (filter?.assignee) {
      args.push("--assignee", filter.assignee);
    }
    if (filter?.query) {
      args.push("--search", filter.query);
    }
    if (filter?.limit) {
      args.push("--limit", String(filter.limit));
    }

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
      const closeArgs = ["issue", "close", taskId, "-R", this.config.repo];
      if (status === "wont_do") {
        closeArgs.push("--reason", "not planned");
      }
      await execGh(closeArgs);
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
    if (mappings.review?.some((l) => labelNames.includes(l.toLowerCase()))) {
      return "review";
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
      case "review":
        return mappings.review ?? ["review"];
      default:
        return [];
    }
  }

  private getLabelsToRemoveForStatus(status: TaskStatus): string[] {
    const mappings = this.config.labelMappings ?? {};
    const allStatusLabels = [
      ...(mappings.inProgress ?? []),
      ...(mappings.blocked ?? []),
      ...(mappings.review ?? []),
    ];

    // Remove all status labels except the ones for the current status
    return allStatusLabels.filter((l) => !this.getLabelsForStatus(status).includes(l));
  }
}

// ============================================================================
// Markdown Task Adapter
// ============================================================================

/**
 * Configuration for Markdown adapter
 */
export interface MarkdownAdapterConfig {
  /** Path to TASKS.md file (absolute or relative to cwd) */
  filePath: string;
  /** Whether to create file if missing */
  createIfMissing?: boolean;
}

const INITIAL_TASKS_TEMPLATE = `# Project Tasks

## Backlog

<!-- Add tasks using the format: ### [ID] Title with priority/labels/created metadata -->

## In Progress

## Blocked

## Completed
`;

/**
 * Parse TASKS.md content into ExternalTask objects
 */
export function parseTasksMarkdown(content: string, sourcePath: string): ExternalTask[] {
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
      const task = parseTaskBlock(block, status, sourcePath);
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
  // Check abandon/wont/cancel before "done" since "abandoned" contains "done"
  if (name.includes("abandon") || name.includes("wont") || name.includes("cancel"))
    return "wont_do";
  if (name.includes("complete") || name.includes("done")) return "closed";
  return "open";
}

function parseTaskBlock(
  block: string,
  status: TaskStatus,
  sourcePath: string,
): ExternalTask | null {
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
    source: { adapter: "markdown", source: sourcePath },
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
  return value
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
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

/**
 * Update task status in markdown content by moving task between sections
 */
export function updateTaskStatusInMarkdown(
  content: string,
  taskId: string,
  newStatus: TaskStatus,
): string {
  const lines = content.split("\n");
  const taskHeaderPrefix = `### [${taskId}]`;

  // Find the task block (from task header to next ### or ## or end)
  let taskStartLine = -1;
  let taskEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(taskHeaderPrefix)) {
      taskStartLine = i;
      // Find where the task block ends
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("### ") || lines[j].startsWith("## ")) {
          taskEndLine = j;
          break;
        }
      }
      if (taskEndLine === -1) {
        taskEndLine = lines.length;
      }
      break;
    }
  }

  if (taskStartLine === -1) {
    throw new Error(`Task ${taskId} not found in markdown`);
  }

  // Extract the task block (trimming trailing empty lines)
  const taskLines = lines.slice(taskStartLine, taskEndLine);
  while (taskLines.length > 0 && taskLines[taskLines.length - 1].trim() === "") {
    taskLines.pop();
  }
  const taskBlock = taskLines.join("\n");

  // Remove task from current location
  lines.splice(taskStartLine, taskEndLine - taskStartLine);

  // Find target section
  const targetSection = statusToSectionName(newStatus);
  const sectionHeader = `## ${targetSection}`;
  let sectionLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionHeader) {
      sectionLine = i;
      break;
    }
  }

  if (sectionLine === -1) {
    throw new Error(`Section "${targetSection}" not found in markdown`);
  }

  // Insert task after section header (with blank line)
  lines.splice(sectionLine + 1, 0, "", taskBlock);

  return lines.join("\n");
}

function statusToSectionName(status: TaskStatus): string {
  switch (status) {
    case "open":
      return "Backlog";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "review":
      return "Review";
    case "closed":
      return "Completed";
    case "wont_do":
      return "Abandoned";
    default:
      return "Backlog";
  }
}

/**
 * Add a comment to a task in markdown content
 */
export function addCommentToTaskInMarkdown(
  content: string,
  taskId: string,
  comment: string,
): string {
  const lines = content.split("\n");
  const taskHeaderPrefix = `### [${taskId}]`;

  // Find the task block
  let taskStartLine = -1;
  let taskEndLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(taskHeaderPrefix)) {
      taskStartLine = i;
      // Find where the task block ends
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("### ") || lines[j].startsWith("## ")) {
          taskEndLine = j;
          break;
        }
      }
      if (taskEndLine === -1) {
        taskEndLine = lines.length;
      }
      break;
    }
  }

  if (taskStartLine === -1) {
    throw new Error(`Task ${taskId} not found in markdown`);
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const commentLines = ["", `#### Comment (${timestamp})`, comment, ""];

  // Insert comment at the end of the task block (before taskEndLine)
  lines.splice(taskEndLine, 0, ...commentLines);

  return lines.join("\n");
}

/**
 * Parse comments from task body (for markdown adapter)
 */
export function parseCommentsFromBody(body: string): TaskComment[] {
  const comments: TaskComment[] = [];
  const commentPattern = /^#### Comment \((\d{4}-\d{2}-\d{2})\)\s*\n([\s\S]*?)(?=^####|$)/gm;

  let match;
  while ((match = commentPattern.exec(body)) !== null) {
    comments.push({
      id: match[1],
      author: "unknown",
      body: match[2].trim(),
      createdAt: new Date(match[1]),
    });
  }

  return comments;
}

/**
 * Markdown task adapter for local TASKS.md files
 */
export class MarkdownTaskAdapter implements TaskAdapter {
  readonly type = "markdown";
  readonly name = "Local TASKS.md";
  readonly supportsWrite = true;

  private config: MarkdownAdapterConfig;

  constructor(adapterConfig: AdapterConfig) {
    this.config = {
      filePath: adapterConfig.source,
      ...(adapterConfig.config as Partial<MarkdownAdapterConfig>),
    };
  }

  async listTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const content = await this.readFile();
    if (!content) return [];

    const tasks = parseTasksMarkdown(content, this.resolveFilePath());

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
    const filePath = this.resolveFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

// ============================================================================
// Adapter Registry
// ============================================================================

/**
 * Central registry for managing task adapters
 */
export class AdapterRegistry {
  private adapters = new Map<string, TaskAdapter>();
  private factories = new Map<string, TaskAdapterFactory>();

  constructor() {
    // Register built-in factories
    this.registerFactory("github", (config) => new GitHubIssuesAdapter(config));
    this.registerFactory("markdown", (config) => new MarkdownTaskAdapter(config));
  }

  /**
   * Register a new adapter factory
   */
  registerFactory(type: string, factory: TaskAdapterFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * Create and register an adapter instance
   */
  createAdapter(config: AdapterConfig): TaskAdapter {
    const factory = this.factories.get(config.type);
    if (!factory) {
      throw new Error(`Unknown adapter type: ${config.type}`);
    }
    const adapter = factory(config);
    this.adapters.set(`${config.type}:${config.source}`, adapter);
    return adapter;
  }

  /**
   * Get an existing adapter by type and source
   */
  getAdapter(type: string, source: string): TaskAdapter | undefined {
    return this.adapters.get(`${type}:${source}`);
  }

  /**
   * List all registered adapters
   */
  listAdapters(): TaskAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * List all tasks from all adapters
   */
  async listAllTasks(filter?: TaskListFilter): Promise<ExternalTask[]> {
    const results = await Promise.all(
      this.listAdapters().map((a) => a.listTasks(filter).catch(() => [])),
    );
    return results.flat();
  }
}

/**
 * Create a default adapter registry with built-in adapters
 */
export function createAdapterRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}
