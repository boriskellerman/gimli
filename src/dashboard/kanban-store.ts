/**
 * Kanban board storage for dashboard
 *
 * Provides storage and retrieval of kanban tasks for the dashboard UI.
 * Tasks can be sourced from external adapters (GitHub, Markdown) or
 * created directly in the dashboard.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { normalizeAgentId } from "../routing/session-key.js";

/**
 * Kanban column types matching the task lifecycle
 */
export type KanbanColumn =
  | "backlog"
  | "wishlist"
  | "todo"
  | "in_progress"
  | "waiting_feedback"
  | "review"
  | "completed"
  | "done"
  | "abandoned"
  | "archived";

/**
 * All available kanban columns in order
 */
export const KANBAN_COLUMNS: KanbanColumn[] = [
  "backlog",
  "wishlist",
  "todo",
  "in_progress",
  "waiting_feedback",
  "review",
  "completed",
  "done",
  "abandoned",
  "archived",
];

/**
 * Human-readable labels for each column
 */
export const KANBAN_COLUMN_LABELS: Record<KanbanColumn, string> = {
  backlog: "Backlog",
  wishlist: "Wishlist",
  todo: "To Do",
  in_progress: "In Progress",
  waiting_feedback: "Waiting Feedback",
  review: "Review",
  completed: "Completed",
  done: "Done",
  abandoned: "Abandoned",
  archived: "Archived",
};

/**
 * Task priority levels
 */
export type KanbanPriority = "critical" | "high" | "medium" | "low" | "none";

/**
 * Source of a kanban task
 */
export type KanbanTaskSource = "github" | "markdown" | "dashboard" | "external";

/**
 * A task on the kanban board
 */
export interface KanbanTask {
  /** Unique task identifier */
  id: string;
  /** Agent ID this task belongs to */
  agentId: string;
  /** Task title */
  title: string;
  /** Task description/body */
  description?: string;
  /** Current column */
  column: KanbanColumn;
  /** Priority level */
  priority: KanbanPriority;
  /** Labels/tags */
  labels: string[];
  /** Assigned users */
  assignees: string[];
  /** Source of the task */
  source: KanbanTaskSource;
  /** External ID (e.g., GitHub issue number) */
  externalId?: string;
  /** External URL */
  externalUrl?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Due date */
  dueDate?: string;
  /** Estimated complexity (1-10) */
  complexity?: number;
  /** IDs of tasks this depends on */
  dependsOn?: string[];
  /** Position in column (for ordering) */
  position: number;
}

/**
 * File format for kanban storage
 */
export interface KanbanStoreFile {
  /** Schema version */
  version: number;
  /** Agent ID */
  agentId: string;
  /** All tasks */
  tasks: KanbanTask[];
  /** Last sync timestamp */
  lastSync?: string;
  /** Last updated timestamp */
  lastUpdated: string;
}

const KANBAN_FILENAME = "kanban.json";
const CURRENT_VERSION = 1;

/**
 * Resolve the kanban storage directory
 * @param stateDir Optional custom state directory
 */
function resolveKanbanDir(stateDir?: string): string {
  const root = stateDir ?? resolveStateDir();
  return path.join(root, "kanban");
}

/**
 * Resolve the path to the kanban file
 * @param stateDir Optional custom state directory
 */
export function resolveKanbanPath(stateDir?: string): string {
  return path.join(resolveKanbanDir(stateDir), KANBAN_FILENAME);
}

/**
 * Generate a unique task ID
 */
function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load all tasks
 * @param stateDir Optional custom state directory
 */
export async function loadTasks(stateDir?: string): Promise<KanbanTask[]> {
  const filePath = resolveKanbanPath(stateDir);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content) as KanbanStoreFile;
    return data.tasks ?? [];
  } catch {
    return [];
  }
}

/**
 * Save tasks
 * @param stateDir Optional custom state directory
 * @param tasks Tasks to save
 */
export async function saveTasks(stateDir: string | undefined, tasks: KanbanTask[]): Promise<void> {
  const filePath = resolveKanbanPath(stateDir);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const data: KanbanStoreFile = {
    version: CURRENT_VERSION,
    agentId: "default",
    tasks,
    lastUpdated: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Get tasks by column
 */
export async function getTasksByColumn(
  agentId: string,
  column: KanbanColumn,
): Promise<KanbanTask[]> {
  const tasks = await loadTasks(agentId);
  return tasks.filter((t) => t.column === column).sort((a, b) => a.position - b.position);
}

/**
 * Create a new task
 */
export async function createTask(
  agentId: string,
  task: Omit<KanbanTask, "id" | "agentId" | "createdAt" | "updatedAt" | "position">,
): Promise<KanbanTask> {
  const tasks = await loadTasks(agentId);
  const columnTasks = tasks.filter((t) => t.column === task.column);
  const maxPosition = columnTasks.reduce((max, t) => Math.max(max, t.position), -1);

  const newTask: KanbanTask = {
    ...task,
    id: generateTaskId(),
    agentId: normalizeAgentId(agentId),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    position: maxPosition + 1,
  };

  tasks.push(newTask);
  await saveTasks(agentId, tasks);

  return newTask;
}

/**
 * Update a task
 */
export async function updateTask(
  agentId: string,
  taskId: string,
  updates: Partial<Omit<KanbanTask, "id" | "agentId" | "createdAt">>,
): Promise<KanbanTask | null> {
  const tasks = await loadTasks(agentId);
  const index = tasks.findIndex((t) => t.id === taskId);

  if (index === -1) {
    return null;
  }

  tasks[index] = {
    ...tasks[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await saveTasks(agentId, tasks);
  return tasks[index];
}

/**
 * Move a task to a different column
 */
export async function moveTask(
  agentId: string,
  taskId: string,
  toColumn: KanbanColumn,
  position?: number,
): Promise<KanbanTask | null> {
  const tasks = await loadTasks(agentId);
  const taskIndex = tasks.findIndex((t) => t.id === taskId);

  if (taskIndex === -1) {
    return null;
  }

  const task = tasks[taskIndex];
  const columnTasks = tasks.filter((t) => t.column === toColumn && t.id !== taskId);

  // Calculate new position
  let newPosition: number;
  if (position !== undefined) {
    newPosition = position;
    // Shift other tasks
    for (const t of columnTasks) {
      if (t.position >= position) {
        t.position++;
      }
    }
  } else {
    newPosition = columnTasks.reduce((max, t) => Math.max(max, t.position), -1) + 1;
  }

  task.column = toColumn;
  task.position = newPosition;
  task.updatedAt = new Date().toISOString();

  await saveTasks(agentId, tasks);
  return task;
}

/**
 * Delete a task
 */
export async function deleteTask(agentId: string, taskId: string): Promise<boolean> {
  const tasks = await loadTasks(agentId);
  const index = tasks.findIndex((t) => t.id === taskId);

  if (index === -1) {
    return false;
  }

  tasks.splice(index, 1);
  await saveTasks(agentId, tasks);
  return true;
}

/**
 * Get task count by column
 */
export async function getColumnCounts(agentId: string): Promise<Record<KanbanColumn, number>> {
  const tasks = await loadTasks(agentId);
  const counts: Record<KanbanColumn, number> = {
    backlog: 0,
    wishlist: 0,
    todo: 0,
    in_progress: 0,
    waiting_feedback: 0,
    review: 0,
    completed: 0,
    done: 0,
    abandoned: 0,
    archived: 0,
  };

  for (const task of tasks) {
    counts[task.column]++;
  }

  return counts;
}
