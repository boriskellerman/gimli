/**
 * Kanban task management module
 *
 * Provides adapters for ingesting tasks from external sources
 * (GitHub Issues, local TASKS.md) and a unified interface
 * for the Kanban agent system.
 */

export {
  // Types
  type TaskStatus,
  type TaskPriority,
  type TaskSourceId,
  type TaskListFilter,
  type ExternalTask,
  type TaskComment,
  type TaskAdapter,
  type AdapterConfig,
  type TaskAdapterFactory,
  type GitHubAdapterConfig,
  type MarkdownAdapterConfig,
  // Adapters
  GitHubIssuesAdapter,
  MarkdownTaskAdapter,
  // Registry
  AdapterRegistry,
  createAdapterRegistry,
  // Utilities
  parseTasksMarkdown,
  updateTaskStatusInMarkdown,
  addCommentToTaskInMarkdown,
  parseCommentsFromBody,
} from "./adapter.js";
