/**
 * Kanban task picker
 *
 * Selects the next best task based on priority, dependencies, and scoring.
 * Uses a weighted scoring algorithm to rank available tasks.
 */

// Re-export types from design doc for external consumers
export type TaskStatus = "open" | "in_progress" | "blocked" | "review" | "closed" | "wont_do";

export type TaskPriority = "critical" | "high" | "medium" | "low" | "none";

/**
 * Task representation for the picker
 */
export interface PickableTask {
  /** Unique task identifier */
  id: string;

  /** Task title */
  title: string;

  /** Current status */
  status: TaskStatus;

  /** Priority level */
  priority: TaskPriority;

  /** Labels/tags */
  labels: string[];

  /** Assigned users */
  assignees: string[];

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;

  /** Due date (optional) */
  dueDate?: Date;

  /** Number of comments (indicator of complexity) */
  commentCount: number;

  /** IDs of tasks this depends on */
  dependsOn?: string[];

  /** Estimated complexity (1-10) */
  estimatedComplexity?: number;
}

/**
 * Filter options for task selection
 */
export interface TaskPickerFilter {
  /** Filter by labels (tasks must have at least one) */
  labels?: string[];

  /** Filter by assignee */
  assignee?: string;

  /** Exclude tasks with these labels */
  excludeLabels?: string[];

  /** Only include tasks without assignees */
  unassignedOnly?: boolean;

  /** Maximum complexity to consider */
  maxComplexity?: number;
}

/**
 * Configuration for task scoring
 */
export interface TaskScoringConfig {
  /** Weight for priority (default: 100) */
  priorityWeight: number;

  /** Weight for due date urgency (default: 50) */
  dueDateWeight: number;

  /** Weight for age (older = higher, default: 10) */
  ageWeight: number;

  /** Weight for simplicity (fewer comments, default: 5) */
  simplicityWeight: number;

  /** Bonus for tasks matching preferred labels */
  labelMatchBonus: number;

  /** Penalty for high complexity */
  complexityPenalty: number;
}

/**
 * Result of task picking with scoring details
 */
export interface TaskPickResult {
  /** Selected task (null if none available) */
  task: PickableTask | null;

  /** Score of the selected task */
  score: number;

  /** Reason for selection */
  reason: string;

  /** Number of tasks considered */
  consideredCount: number;

  /** IDs of blocked tasks */
  blockedTaskIds: string[];
}

/**
 * Detailed task score breakdown
 */
export interface TaskScoreBreakdown {
  taskId: string;
  totalScore: number;
  priorityScore: number;
  dueDateScore: number;
  ageScore: number;
  simplicityScore: number;
  labelBonus: number;
  complexityPenalty: number;
}

/**
 * Default scoring configuration
 */
export const DEFAULT_SCORING_CONFIG: TaskScoringConfig = {
  priorityWeight: 100,
  dueDateWeight: 50,
  ageWeight: 10,
  simplicityWeight: 5,
  labelMatchBonus: 20,
  complexityPenalty: 15,
};

/**
 * Priority score values (higher = more important)
 */
const PRIORITY_SCORES: Record<TaskPriority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
};

/**
 * Check if a task is blocked by unresolved dependencies
 */
export function isTaskBlocked(task: PickableTask, allTasks: PickableTask[]): boolean {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return false;
  }

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  return task.dependsOn.some((depId) => {
    const dependency = taskMap.get(depId);
    // Blocked if dependency exists and is not closed/wont_do
    return dependency && dependency.status !== "closed" && dependency.status !== "wont_do";
  });
}

/**
 * Get all blocked task IDs from a list
 */
export function getBlockedTaskIds(tasks: PickableTask[]): string[] {
  return tasks.filter((task) => isTaskBlocked(task, tasks)).map((task) => task.id);
}

/**
 * Filter tasks based on criteria
 */
export function filterTasks(tasks: PickableTask[], filter: TaskPickerFilter): PickableTask[] {
  return tasks.filter((task) => {
    // Skip closed/wont_do tasks
    if (task.status === "closed" || task.status === "wont_do") {
      return false;
    }

    // Skip blocked tasks (status-based)
    if (task.status === "blocked") {
      return false;
    }

    // Label filter - task must have at least one matching label
    if (filter.labels && filter.labels.length > 0) {
      const hasMatchingLabel = filter.labels.some((label) => task.labels.includes(label));
      if (!hasMatchingLabel) {
        return false;
      }
    }

    // Exclude labels filter
    if (filter.excludeLabels && filter.excludeLabels.length > 0) {
      const hasExcludedLabel = filter.excludeLabels.some((label) => task.labels.includes(label));
      if (hasExcludedLabel) {
        return false;
      }
    }

    // Assignee filter
    if (filter.assignee) {
      const normalizedFilter = filter.assignee.replace(/^@/, "").toLowerCase();
      const hasAssignee = task.assignees.some((a) => a.toLowerCase() === normalizedFilter);
      if (!hasAssignee) {
        return false;
      }
    }

    // Unassigned only filter
    if (filter.unassignedOnly && task.assignees.length > 0) {
      return false;
    }

    // Complexity filter
    if (
      filter.maxComplexity !== undefined &&
      task.estimatedComplexity !== undefined &&
      task.estimatedComplexity > filter.maxComplexity
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Calculate the score for a single task
 */
export function calculateTaskScore(
  task: PickableTask,
  config: TaskScoringConfig,
  preferredLabels?: string[],
): TaskScoreBreakdown {
  const now = Date.now();

  // Priority score
  const priorityScore = PRIORITY_SCORES[task.priority] * config.priorityWeight;

  // Due date urgency score
  let dueDateScore = 0;
  if (task.dueDate) {
    const dueTime = task.dueDate.getTime();
    const daysUntilDue = (dueTime - now) / (1000 * 60 * 60 * 24);

    if (daysUntilDue < 0) {
      // Overdue - highest urgency
      dueDateScore = config.dueDateWeight * 5;
    } else if (daysUntilDue <= 1) {
      // Due today or tomorrow
      dueDateScore = config.dueDateWeight * 4;
    } else if (daysUntilDue <= 3) {
      // Due within 3 days
      dueDateScore = config.dueDateWeight * 3;
    } else if (daysUntilDue <= 7) {
      // Due within a week
      dueDateScore = config.dueDateWeight * 2;
    } else if (daysUntilDue <= 14) {
      // Due within 2 weeks
      dueDateScore = config.dueDateWeight * 1;
    }
    // No score for tasks due later
  }

  // Age score (older tasks get slight priority boost)
  const taskAgeHours = (now - task.createdAt.getTime()) / (1000 * 60 * 60);
  const ageFactor = Math.min(taskAgeHours / 168, 5); // Cap at 5 weeks worth
  const ageScore = ageFactor * config.ageWeight;

  // Simplicity score (fewer comments = simpler)
  const simplicityFactor = Math.max(0, 10 - task.commentCount) / 10;
  const simplicityScore = simplicityFactor * config.simplicityWeight;

  // Label match bonus
  let labelBonus = 0;
  if (preferredLabels && preferredLabels.length > 0) {
    const matchCount = preferredLabels.filter((label) => task.labels.includes(label)).length;
    labelBonus = matchCount * config.labelMatchBonus;
  }

  // Complexity penalty
  let complexityPenalty = 0;
  if (task.estimatedComplexity !== undefined) {
    // Penalty increases with complexity (1-10 scale)
    complexityPenalty = (task.estimatedComplexity - 1) * config.complexityPenalty;
  }

  const totalScore =
    priorityScore + dueDateScore + ageScore + simplicityScore + labelBonus - complexityPenalty;

  return {
    taskId: task.id,
    totalScore: Math.max(0, totalScore), // Don't go negative
    priorityScore,
    dueDateScore,
    ageScore,
    simplicityScore,
    labelBonus,
    complexityPenalty,
  };
}

/**
 * Score and rank all tasks
 */
export function rankTasks(
  tasks: PickableTask[],
  config: TaskScoringConfig = DEFAULT_SCORING_CONFIG,
  preferredLabels?: string[],
): Array<{ task: PickableTask; breakdown: TaskScoreBreakdown }> {
  const scoredTasks = tasks.map((task) => ({
    task,
    breakdown: calculateTaskScore(task, config, preferredLabels),
  }));

  // Sort by score descending
  scoredTasks.sort((a, b) => b.breakdown.totalScore - a.breakdown.totalScore);

  return scoredTasks;
}

/**
 * Pick the next best task to work on
 */
export function pickNextTask(
  tasks: PickableTask[],
  options: {
    filter?: TaskPickerFilter;
    config?: TaskScoringConfig;
    preferredLabels?: string[];
  } = {},
): TaskPickResult {
  const { filter = {}, config = DEFAULT_SCORING_CONFIG, preferredLabels } = options;

  // Find blocked tasks due to dependencies
  const blockedTaskIds = getBlockedTaskIds(tasks);

  // Filter out tasks that don't match criteria
  let candidates = filterTasks(tasks, filter);

  // Also filter out dependency-blocked tasks
  candidates = candidates.filter((task) => !blockedTaskIds.includes(task.id));

  if (candidates.length === 0) {
    return {
      task: null,
      score: 0,
      reason: "No tasks available matching criteria",
      consideredCount: 0,
      blockedTaskIds,
    };
  }

  // Rank and pick the best task
  const ranked = rankTasks(candidates, config, preferredLabels);
  const best = ranked[0];

  // Determine the reason for selection
  let reason = "Highest scoring task";
  if (best.breakdown.dueDateScore > 0) {
    reason =
      best.task.dueDate && best.task.dueDate.getTime() < Date.now()
        ? "Overdue task with highest priority"
        : "Upcoming due date with high priority";
  } else if (best.task.priority === "critical") {
    reason = "Critical priority task";
  } else if (best.task.priority === "high") {
    reason = "High priority task";
  } else if (best.breakdown.labelBonus > 0) {
    reason = "Matches preferred labels";
  }

  return {
    task: best.task,
    score: best.breakdown.totalScore,
    reason,
    consideredCount: candidates.length,
    blockedTaskIds,
  };
}

/**
 * Pick multiple tasks (for batch processing or suggestions)
 */
export function pickTopTasks(
  tasks: PickableTask[],
  count: number,
  options: {
    filter?: TaskPickerFilter;
    config?: TaskScoringConfig;
    preferredLabels?: string[];
  } = {},
): Array<{ task: PickableTask; score: number; reason: string }> {
  const { filter = {}, config = DEFAULT_SCORING_CONFIG, preferredLabels } = options;

  const blockedTaskIds = getBlockedTaskIds(tasks);
  let candidates = filterTasks(tasks, filter);
  candidates = candidates.filter((task) => !blockedTaskIds.includes(task.id));

  const ranked = rankTasks(candidates, config, preferredLabels);

  return ranked.slice(0, count).map(({ task, breakdown }) => {
    let reason = "High score";
    if (breakdown.dueDateScore > 0) {
      reason = "Due date urgency";
    } else if (task.priority === "critical" || task.priority === "high") {
      reason = `${task.priority} priority`;
    }
    return { task, score: breakdown.totalScore, reason };
  });
}

/**
 * Resolve dependency chain for a task
 */
export function resolveDependencyChain(
  task: PickableTask,
  allTasks: PickableTask[],
  visited: Set<string> = new Set(),
): PickableTask[] {
  if (!task.dependsOn || task.dependsOn.length === 0) {
    return [];
  }

  // Prevent circular dependencies
  if (visited.has(task.id)) {
    return [];
  }
  visited.add(task.id);

  const taskMap = new Map(allTasks.map((t) => [t.id, t]));
  const dependencies: PickableTask[] = [];

  for (const depId of task.dependsOn) {
    const dep = taskMap.get(depId);
    if (dep && dep.status !== "closed" && dep.status !== "wont_do") {
      // Add transitive dependencies first
      const transitive = resolveDependencyChain(dep, allTasks, visited);
      for (const t of transitive) {
        if (!dependencies.some((d) => d.id === t.id)) {
          dependencies.push(t);
        }
      }
      // Then add the direct dependency
      if (!dependencies.some((d) => d.id === dep.id)) {
        dependencies.push(dep);
      }
    }
  }

  return dependencies;
}

/**
 * Suggest the order to complete tasks based on dependencies
 */
export function suggestTaskOrder(
  tasks: PickableTask[],
  options: {
    filter?: TaskPickerFilter;
    config?: TaskScoringConfig;
  } = {},
): PickableTask[] {
  const { filter = {}, config = DEFAULT_SCORING_CONFIG } = options;

  // Filter and rank tasks
  const candidates = filterTasks(tasks, filter);
  const ranked = rankTasks(candidates, config);

  // Build dependency graph
  const result: PickableTask[] = [];
  const added = new Set<string>();

  function addWithDependencies(task: PickableTask): void {
    if (added.has(task.id)) return;

    // Add dependencies first
    const deps = resolveDependencyChain(task, tasks);
    for (const dep of deps) {
      if (!added.has(dep.id)) {
        added.add(dep.id);
        result.push(dep);
      }
    }

    // Add the task itself
    added.add(task.id);
    result.push(task);
  }

  // Process tasks in score order, respecting dependencies
  for (const { task } of ranked) {
    addWithDependencies(task);
  }

  return result;
}
