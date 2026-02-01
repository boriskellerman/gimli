/**
 * /kanban command for Kanban board management
 *
 * Provides CLI interface for managing the autonomous kanban agent:
 * - status: Display board status overview
 * - pick: Pick the next best task to work on
 * - review: Review solution iterations
 * - approve: Approve and merge a solution
 */

import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import {
  loadTasks,
  type KanbanTask,
  type KanbanColumn,
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
} from "../dashboard/kanban-store.js";
import { createAdapterRegistry, type AdapterConfig, type ExternalTask } from "../kanban/index.js";
import {
  pickNextTask,
  pickTopTasks,
  type PickableTask,
  type TaskPickerFilter,
} from "../kanban/picker.js";
import {
  formatRankingAsMarkdown,
  shouldAutoAccept,
  type SolutionRanking,
  type RankedSolution,
  DEFAULT_AUTO_ACCEPTANCE_CONFIG,
} from "../kanban/comparator.js";
import { type IterationResult, type IterationPlan } from "../kanban/iteration-runner.js";

/**
 * Options for the kanban command
 */
export interface KanbanCommandOpts {
  /** Subcommand: status, pick, review, approve */
  subcommand?: string;

  /** Task ID (for review/approve) */
  taskId?: string;

  /** Solution ID (for approve) */
  solutionId?: string;

  /** Filter by labels */
  labels?: string;

  /** Show only unassigned tasks */
  unassigned?: boolean;

  /** Number of tasks to suggest (for pick) */
  count?: number;

  /** Force approval without checks (for approve) */
  force?: boolean;

  /** Output as JSON */
  json?: boolean;

  /** State directory override */
  stateDir?: string;
}

/**
 * Convert KanbanTask to PickableTask format
 */
function toPickableTask(task: KanbanTask): PickableTask {
  return {
    id: task.id,
    title: task.title,
    status:
      task.column === "backlog" || task.column === "wishlist"
        ? "open"
        : task.column === "in_progress"
          ? "in_progress"
          : task.column === "waiting_feedback"
            ? "review"
            : task.column === "completed"
              ? "closed"
              : task.column === "abandoned"
                ? "wont_do"
                : "open",
    priority: task.priority === "high" ? "high" : task.priority === "low" ? "low" : "medium",
    labels: task.labels ?? [],
    assignees: [],
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    commentCount: 0,
  };
}

/**
 * Convert ExternalTask to PickableTask format
 */
function externalToPickableTask(task: ExternalTask): PickableTask {
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

/**
 * Format a column summary line
 */
function formatColumnSummary(column: KanbanColumn, count: number, rich: boolean): string {
  const label = KANBAN_COLUMN_LABELS[column];
  const countStr = String(count).padStart(3);

  if (!rich) {
    return `  ${label.padEnd(20)} ${countStr}`;
  }

  const coloredCount =
    column === "in_progress"
      ? theme.warn(countStr)
      : column === "completed"
        ? theme.success(countStr)
        : column === "waiting_feedback"
          ? theme.info(countStr)
          : theme.muted(countStr);

  return `  ${theme.muted(label.padEnd(20))} ${coloredCount}`;
}

/**
 * Format a task for display
 */
function formatTask(task: PickableTask, score: number | undefined, rich: boolean): string {
  const priorityLabel =
    task.priority === "high" || task.priority === "critical"
      ? rich
        ? theme.error(`[${task.priority.toUpperCase()}]`)
        : `[${task.priority.toUpperCase()}]`
      : task.priority === "low"
        ? rich
          ? theme.muted("[LOW]")
          : "[LOW]"
        : "";

  const idShort = task.id.slice(0, 12);
  const idDisplay = rich ? theme.muted(`[${idShort}]`) : `[${idShort}]`;

  const scoreDisplay =
    score !== undefined
      ? rich
        ? theme.accent(`(${score.toFixed(0)} pts)`)
        : `(${score.toFixed(0)} pts)`
      : "";

  return `${idDisplay} ${priorityLabel} ${task.title} ${scoreDisplay}`.trim();
}

/**
 * Format a ranked solution for display
 */
function formatRankedSolution(solution: RankedSolution, rich: boolean): string {
  const rankDisplay = rich ? theme.accent(`#${solution.rank}`) : `#${solution.rank}`;
  const scoreDisplay = rich
    ? theme.info(`${(solution.score * 100).toFixed(1)}%`)
    : `${(solution.score * 100).toFixed(1)}%`;

  return `${rankDisplay} ${solution.solutionId} - Score: ${scoreDisplay}`;
}

/**
 * Handle 'status' subcommand
 */
async function handleStatus(opts: KanbanCommandOpts, runtime: RuntimeEnv): Promise<void> {
  const tasks = await loadTasks(opts.stateDir);

  // Count tasks by column
  const counts = new Map<KanbanColumn, number>();
  for (const col of KANBAN_COLUMNS) {
    counts.set(col, 0);
  }
  for (const task of tasks) {
    counts.set(task.column, (counts.get(task.column) ?? 0) + 1);
  }

  if (opts.json) {
    const status = {
      totalTasks: tasks.length,
      columns: Object.fromEntries(counts),
      recentTasks: tasks.slice(0, 5).map((t) => ({
        id: t.id,
        title: t.title,
        column: t.column,
        priority: t.priority,
      })),
    };
    runtime.log(JSON.stringify(status, null, 2));
    return;
  }

  const rich = isRich();

  runtime.log(info("Kanban Board Status"));
  runtime.log("");

  // Column summary
  runtime.log(rich ? theme.accent("Columns:") : "Columns:");
  for (const col of KANBAN_COLUMNS) {
    runtime.log(formatColumnSummary(col, counts.get(col) ?? 0, rich));
  }

  runtime.log("");
  runtime.log(rich ? theme.muted(`Total tasks: ${tasks.length}`) : `Total tasks: ${tasks.length}`);

  // Show high priority in-progress tasks
  const inProgress = tasks.filter((t) => t.column === "in_progress");
  if (inProgress.length > 0) {
    runtime.log("");
    runtime.log(rich ? theme.warn("In Progress:") : "In Progress:");
    for (const task of inProgress.slice(0, 5)) {
      const pickable = toPickableTask(task);
      runtime.log(`  ${formatTask(pickable, undefined, rich)}`);
    }
  }

  // Show tasks waiting for feedback
  const waitingFeedback = tasks.filter((t) => t.column === "waiting_feedback");
  if (waitingFeedback.length > 0) {
    runtime.log("");
    runtime.log(rich ? theme.info("Waiting Feedback:") : "Waiting Feedback:");
    for (const task of waitingFeedback.slice(0, 5)) {
      const pickable = toPickableTask(task);
      runtime.log(`  ${formatTask(pickable, undefined, rich)}`);
    }
  }
}

/**
 * Handle 'pick' subcommand
 */
async function handlePick(opts: KanbanCommandOpts, runtime: RuntimeEnv): Promise<void> {
  const tasks = await loadTasks(opts.stateDir);
  const pickableTasks = tasks.map(toPickableTask);

  // Build filter
  const filter: TaskPickerFilter = {};
  if (opts.labels) {
    filter.labels = opts.labels.split(",").map((l) => l.trim());
  }
  if (opts.unassigned) {
    filter.unassignedOnly = true;
  }

  const count = opts.count ?? 1;

  if (count === 1) {
    const result = pickNextTask(pickableTasks, { filter });

    if (opts.json) {
      runtime.log(
        JSON.stringify(
          {
            task: result.task,
            score: result.score,
            reason: result.reason,
            consideredCount: result.consideredCount,
            blockedTaskIds: result.blockedTaskIds,
          },
          null,
          2,
        ),
      );
      return;
    }

    const rich = isRich();

    if (!result.task) {
      runtime.log(info("No tasks available matching criteria."));
      if (result.blockedTaskIds.length > 0) {
        runtime.log(
          rich
            ? theme.muted(`(${result.blockedTaskIds.length} tasks blocked by dependencies)`)
            : `(${result.blockedTaskIds.length} tasks blocked by dependencies)`,
        );
      }
      return;
    }

    runtime.log(info("Recommended task:"));
    runtime.log("");
    runtime.log(formatTask(result.task, result.score, rich));
    runtime.log("");
    runtime.log(rich ? theme.muted(`Reason: ${result.reason}`) : `Reason: ${result.reason}`);
    runtime.log(
      rich
        ? theme.muted(`Considered: ${result.consideredCount} tasks`)
        : `Considered: ${result.consideredCount} tasks`,
    );
  } else {
    const results = pickTopTasks(pickableTasks, count, { filter });

    if (opts.json) {
      runtime.log(JSON.stringify({ tasks: results }, null, 2));
      return;
    }

    const rich = isRich();

    if (results.length === 0) {
      runtime.log(info("No tasks available matching criteria."));
      return;
    }

    runtime.log(info(`Top ${results.length} recommended tasks:`));
    runtime.log("");

    for (let i = 0; i < results.length; i++) {
      const { task, score, reason } = results[i];
      const rankDisplay = rich ? theme.accent(`${i + 1}.`) : `${i + 1}.`;
      runtime.log(`${rankDisplay} ${formatTask(task, score, rich)}`);
      runtime.log(rich ? theme.muted(`   ${reason}`) : `   ${reason}`);
    }
  }
}

/**
 * Handle 'review' subcommand
 */
async function handleReview(opts: KanbanCommandOpts, runtime: RuntimeEnv): Promise<void> {
  const taskId = opts.taskId?.trim();

  if (!taskId) {
    runtime.error("Error: Task ID is required. Usage: /kanban review TASK_ID");
    runtime.exit(1);
    return;
  }

  // Find the task
  const tasks = await loadTasks(opts.stateDir);
  const task = tasks.find((t) => t.id.startsWith(taskId));

  if (!task) {
    runtime.error(`Error: No task found with ID starting with "${taskId}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    // In a full implementation, we would load iteration results from storage
    runtime.log(
      JSON.stringify(
        {
          taskId: task.id,
          title: task.title,
          column: task.column,
          iterations: [],
          message: "No iterations found. Run iterations first with the kanban agent.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const rich = isRich();

  runtime.log(info(`Review: ${task.title}`));
  runtime.log("");
  runtime.log(rich ? theme.muted(`Task ID: ${task.id}`) : `Task ID: ${task.id}`);
  runtime.log(
    rich
      ? theme.muted(`Column: ${KANBAN_COLUMN_LABELS[task.column]}`)
      : `Column: ${KANBAN_COLUMN_LABELS[task.column]}`,
  );

  if (task.description) {
    runtime.log("");
    runtime.log(rich ? theme.muted("Description:") : "Description:");
    runtime.log(task.description);
  }

  runtime.log("");
  runtime.log(
    rich
      ? theme.info("No iteration results found. Run iterations with the kanban agent first.")
      : "No iteration results found. Run iterations with the kanban agent first.",
  );
  runtime.log("");
  runtime.log("To start iterations, use the kanban agent with a task prompt.");
}

/**
 * Handle 'approve' subcommand
 */
async function handleApprove(opts: KanbanCommandOpts, runtime: RuntimeEnv): Promise<void> {
  const taskId = opts.taskId?.trim();
  const solutionId = opts.solutionId?.trim();

  if (!taskId) {
    runtime.error("Error: Task ID is required. Usage: /kanban approve TASK_ID [SOLUTION_ID]");
    runtime.exit(1);
    return;
  }

  // Find the task
  const tasks = await loadTasks(opts.stateDir);
  const task = tasks.find((t) => t.id.startsWith(taskId));

  if (!task) {
    runtime.error(`Error: No task found with ID starting with "${taskId}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          taskId: task.id,
          title: task.title,
          approved: false,
          message: "No solution to approve. Run iterations and review first.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const rich = isRich();

  // In a full implementation, we would:
  // 1. Load the solution results
  // 2. Run auto-acceptance checks
  // 3. Apply the approved solution

  runtime.log(info(`Approve: ${task.title}`));
  runtime.log("");

  if (!solutionId) {
    runtime.log(
      rich
        ? theme.warn("No solution ID specified. Would auto-select the best solution.")
        : "No solution ID specified. Would auto-select the best solution.",
    );
  } else {
    runtime.log(rich ? theme.muted(`Solution ID: ${solutionId}`) : `Solution ID: ${solutionId}`);
  }

  runtime.log("");
  runtime.log(
    rich
      ? theme.info("No solution results found. Run iterations with the kanban agent first.")
      : "No solution results found. Run iterations with the kanban agent first.",
  );

  if (opts.force) {
    runtime.log("");
    runtime.log(
      rich
        ? theme.warn("--force flag set, but no solution available to force-approve.")
        : "--force flag set, but no solution available to force-approve.",
    );
  }
}

/**
 * Show help for the kanban command
 */
function showHelp(runtime: RuntimeEnv): void {
  runtime.log("Usage: /kanban <subcommand> [options]");
  runtime.log("");
  runtime.log("Subcommands:");
  runtime.log("  status                    Show Kanban board status");
  runtime.log("  pick [--count N]          Pick next task(s) to work on");
  runtime.log("  review TASK_ID            Review solution iterations for a task");
  runtime.log("  approve TASK_ID [SOL_ID]  Approve and apply a solution");
  runtime.log("");
  runtime.log("Options:");
  runtime.log("  --labels LABELS      Filter by comma-separated labels");
  runtime.log("  --unassigned         Show only unassigned tasks");
  runtime.log("  --count N            Number of tasks to suggest (default: 1)");
  runtime.log("  --force              Force approval without checks");
  runtime.log("  --json               Output as JSON");
  runtime.log("");
  runtime.log("Examples:");
  runtime.log("  /kanban status");
  runtime.log("  /kanban pick --count 3");
  runtime.log("  /kanban pick --labels bug,urgent");
  runtime.log("  /kanban review task_abc123");
  runtime.log("  /kanban approve task_abc123");
  runtime.log("  /kanban approve task_abc123 solution_xyz --force");
}

/**
 * Main kanban command handler
 */
export async function kanbanCommand(
  opts: KanbanCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const subcommand = opts.subcommand?.trim().toLowerCase();

  if (!subcommand || subcommand === "help") {
    showHelp(runtime);
    return;
  }

  switch (subcommand) {
    case "status":
      await handleStatus(opts, runtime);
      break;

    case "pick":
      await handlePick(opts, runtime);
      break;

    case "review":
      await handleReview(opts, runtime);
      break;

    case "approve":
      await handleApprove(opts, runtime);
      break;

    default:
      runtime.error(`Unknown subcommand: ${subcommand}`);
      runtime.log("");
      showHelp(runtime);
      runtime.exit(1);
  }
}
