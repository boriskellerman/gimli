import { describe, expect, it } from "vitest";
import {
  calculateTaskScore,
  DEFAULT_SCORING_CONFIG,
  filterTasks,
  getBlockedTaskIds,
  isTaskBlocked,
  pickNextTask,
  pickTopTasks,
  type PickableTask,
  rankTasks,
  resolveDependencyChain,
  suggestTaskOrder,
  type TaskScoringConfig,
} from "./picker.js";

function makeTask(overrides: Partial<PickableTask> = {}): PickableTask {
  return {
    id: overrides.id ?? `task-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? "Test Task",
    status: overrides.status ?? "open",
    priority: overrides.priority ?? "medium",
    labels: overrides.labels ?? [],
    assignees: overrides.assignees ?? [],
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    dueDate: overrides.dueDate,
    commentCount: overrides.commentCount ?? 0,
    dependsOn: overrides.dependsOn,
    estimatedComplexity: overrides.estimatedComplexity,
  };
}

describe("isTaskBlocked", () => {
  it("returns false for task without dependencies", () => {
    const task = makeTask({ id: "task-1" });
    const allTasks = [task];

    expect(isTaskBlocked(task, allTasks)).toBe(false);
  });

  it("returns false for task with empty dependencies", () => {
    const task = makeTask({ id: "task-1", dependsOn: [] });
    const allTasks = [task];

    expect(isTaskBlocked(task, allTasks)).toBe(false);
  });

  it("returns true when dependency is open", () => {
    const dep = makeTask({ id: "dep-1", status: "open" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1"] });
    const allTasks = [dep, task];

    expect(isTaskBlocked(task, allTasks)).toBe(true);
  });

  it("returns true when dependency is in_progress", () => {
    const dep = makeTask({ id: "dep-1", status: "in_progress" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1"] });
    const allTasks = [dep, task];

    expect(isTaskBlocked(task, allTasks)).toBe(true);
  });

  it("returns false when dependency is closed", () => {
    const dep = makeTask({ id: "dep-1", status: "closed" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1"] });
    const allTasks = [dep, task];

    expect(isTaskBlocked(task, allTasks)).toBe(false);
  });

  it("returns false when dependency is wont_do", () => {
    const dep = makeTask({ id: "dep-1", status: "wont_do" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1"] });
    const allTasks = [dep, task];

    expect(isTaskBlocked(task, allTasks)).toBe(false);
  });

  it("returns false when dependency does not exist", () => {
    const task = makeTask({ id: "task-1", dependsOn: ["nonexistent"] });
    const allTasks = [task];

    expect(isTaskBlocked(task, allTasks)).toBe(false);
  });

  it("returns true if any dependency is unresolved", () => {
    const dep1 = makeTask({ id: "dep-1", status: "closed" });
    const dep2 = makeTask({ id: "dep-2", status: "open" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1", "dep-2"] });
    const allTasks = [dep1, dep2, task];

    expect(isTaskBlocked(task, allTasks)).toBe(true);
  });
});

describe("getBlockedTaskIds", () => {
  it("returns empty array for tasks without dependencies", () => {
    const tasks = [makeTask({ id: "task-1" }), makeTask({ id: "task-2" })];

    expect(getBlockedTaskIds(tasks)).toEqual([]);
  });

  it("returns IDs of blocked tasks", () => {
    const dep = makeTask({ id: "dep-1", status: "open" });
    const blocked = makeTask({ id: "blocked-1", dependsOn: ["dep-1"] });
    const unblocked = makeTask({ id: "unblocked-1" });
    const tasks = [dep, blocked, unblocked];

    expect(getBlockedTaskIds(tasks)).toEqual(["blocked-1"]);
  });
});

describe("filterTasks", () => {
  it("excludes closed tasks", () => {
    const tasks = [
      makeTask({ id: "open", status: "open" }),
      makeTask({ id: "closed", status: "closed" }),
    ];

    const result = filterTasks(tasks, {});
    expect(result.map((t) => t.id)).toEqual(["open"]);
  });

  it("excludes wont_do tasks", () => {
    const tasks = [
      makeTask({ id: "open", status: "open" }),
      makeTask({ id: "wont_do", status: "wont_do" }),
    ];

    const result = filterTasks(tasks, {});
    expect(result.map((t) => t.id)).toEqual(["open"]);
  });

  it("excludes blocked status tasks", () => {
    const tasks = [
      makeTask({ id: "open", status: "open" }),
      makeTask({ id: "blocked", status: "blocked" }),
    ];

    const result = filterTasks(tasks, {});
    expect(result.map((t) => t.id)).toEqual(["open"]);
  });

  it("filters by labels - includes matching", () => {
    const tasks = [
      makeTask({ id: "bug", labels: ["bug", "urgent"] }),
      makeTask({ id: "feature", labels: ["feature"] }),
    ];

    const result = filterTasks(tasks, { labels: ["bug"] });
    expect(result.map((t) => t.id)).toEqual(["bug"]);
  });

  it("filters by labels - any match works", () => {
    const tasks = [
      makeTask({ id: "both", labels: ["bug", "feature"] }),
      makeTask({ id: "bug-only", labels: ["bug"] }),
      makeTask({ id: "other", labels: ["docs"] }),
    ];

    const result = filterTasks(tasks, { labels: ["bug", "feature"] });
    expect(result.map((t) => t.id)).toContain("both");
    expect(result.map((t) => t.id)).toContain("bug-only");
    expect(result.map((t) => t.id)).not.toContain("other");
  });

  it("filters by excludeLabels", () => {
    const tasks = [
      makeTask({ id: "keep", labels: ["feature"] }),
      makeTask({ id: "exclude", labels: ["wontfix"] }),
    ];

    const result = filterTasks(tasks, { excludeLabels: ["wontfix"] });
    expect(result.map((t) => t.id)).toEqual(["keep"]);
  });

  it("filters by assignee", () => {
    const tasks = [
      makeTask({ id: "alice", assignees: ["alice"] }),
      makeTask({ id: "bob", assignees: ["bob"] }),
    ];

    const result = filterTasks(tasks, { assignee: "alice" });
    expect(result.map((t) => t.id)).toEqual(["alice"]);
  });

  it("filters by assignee with @ prefix", () => {
    const tasks = [
      makeTask({ id: "alice", assignees: ["alice"] }),
      makeTask({ id: "bob", assignees: ["bob"] }),
    ];

    const result = filterTasks(tasks, { assignee: "@alice" });
    expect(result.map((t) => t.id)).toEqual(["alice"]);
  });

  it("filters by unassignedOnly", () => {
    const tasks = [
      makeTask({ id: "assigned", assignees: ["alice"] }),
      makeTask({ id: "unassigned", assignees: [] }),
    ];

    const result = filterTasks(tasks, { unassignedOnly: true });
    expect(result.map((t) => t.id)).toEqual(["unassigned"]);
  });

  it("filters by maxComplexity", () => {
    const tasks = [
      makeTask({ id: "simple", estimatedComplexity: 2 }),
      makeTask({ id: "complex", estimatedComplexity: 8 }),
      makeTask({ id: "unknown" }), // No complexity set
    ];

    const result = filterTasks(tasks, { maxComplexity: 5 });
    expect(result.map((t) => t.id)).toContain("simple");
    expect(result.map((t) => t.id)).toContain("unknown");
    expect(result.map((t) => t.id)).not.toContain("complex");
  });
});

describe("calculateTaskScore", () => {
  const config: TaskScoringConfig = DEFAULT_SCORING_CONFIG;

  it("scores critical priority highest", () => {
    const critical = makeTask({ priority: "critical" });
    const low = makeTask({ priority: "low" });

    const criticalScore = calculateTaskScore(critical, config);
    const lowScore = calculateTaskScore(low, config);

    expect(criticalScore.priorityScore).toBeGreaterThan(lowScore.priorityScore);
  });

  it("adds due date score for urgent tasks", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const urgent = makeTask({ dueDate: tomorrow });
    const notUrgent = makeTask({ dueDate: nextMonth });
    const noDue = makeTask({});

    const urgentScore = calculateTaskScore(urgent, config);
    const notUrgentScore = calculateTaskScore(notUrgent, config);
    const noDueScore = calculateTaskScore(noDue, config);

    expect(urgentScore.dueDateScore).toBeGreaterThan(notUrgentScore.dueDateScore);
    expect(noDueScore.dueDateScore).toBe(0);
  });

  it("gives highest due date score for overdue tasks", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const overdue = makeTask({ dueDate: yesterday });
    const dueSoon = makeTask({ dueDate: tomorrow });

    const overdueScore = calculateTaskScore(overdue, config);
    const dueSoonScore = calculateTaskScore(dueSoon, config);

    expect(overdueScore.dueDateScore).toBeGreaterThan(dueSoonScore.dueDateScore);
  });

  it("adds age score for older tasks", () => {
    const oldDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 1 week old
    const newDate = new Date();

    const oldTask = makeTask({ createdAt: oldDate });
    const newTask = makeTask({ createdAt: newDate });

    const oldScore = calculateTaskScore(oldTask, config);
    const newScore = calculateTaskScore(newTask, config);

    expect(oldScore.ageScore).toBeGreaterThan(newScore.ageScore);
  });

  it("adds simplicity score for tasks with few comments", () => {
    const simple = makeTask({ commentCount: 0 });
    const complex = makeTask({ commentCount: 15 });

    const simpleScore = calculateTaskScore(simple, config);
    const complexScore = calculateTaskScore(complex, config);

    expect(simpleScore.simplicityScore).toBeGreaterThan(complexScore.simplicityScore);
  });

  it("adds label bonus for preferred labels", () => {
    const matching = makeTask({ labels: ["preferred", "other"] });
    const nonMatching = makeTask({ labels: ["other"] });

    const matchingScore = calculateTaskScore(matching, config, ["preferred"]);
    const nonMatchingScore = calculateTaskScore(nonMatching, config, ["preferred"]);

    expect(matchingScore.labelBonus).toBeGreaterThan(0);
    expect(nonMatchingScore.labelBonus).toBe(0);
  });

  it("applies complexity penalty", () => {
    const simple = makeTask({ estimatedComplexity: 1 });
    const complex = makeTask({ estimatedComplexity: 10 });

    const simpleScore = calculateTaskScore(simple, config);
    const complexScore = calculateTaskScore(complex, config);

    expect(simpleScore.complexityPenalty).toBeLessThan(complexScore.complexityPenalty);
  });

  it("total score is never negative", () => {
    // Create a task that would have negative score
    const task = makeTask({
      priority: "none",
      estimatedComplexity: 10,
      commentCount: 20,
      createdAt: new Date(),
    });

    const score = calculateTaskScore(task, {
      ...config,
      complexityPenalty: 1000, // Very high penalty
    });

    expect(score.totalScore).toBeGreaterThanOrEqual(0);
  });
});

describe("rankTasks", () => {
  it("ranks tasks by score descending", () => {
    const tasks = [
      makeTask({ id: "low", priority: "low" }),
      makeTask({ id: "critical", priority: "critical" }),
      makeTask({ id: "medium", priority: "medium" }),
    ];

    const ranked = rankTasks(tasks);

    expect(ranked[0].task.id).toBe("critical");
    expect(ranked[ranked.length - 1].task.id).toBe("low");
  });

  it("includes score breakdown for each task", () => {
    const tasks = [makeTask({ id: "test" })];

    const ranked = rankTasks(tasks);

    expect(ranked[0].breakdown).toHaveProperty("taskId", "test");
    expect(ranked[0].breakdown).toHaveProperty("totalScore");
    expect(ranked[0].breakdown).toHaveProperty("priorityScore");
  });
});

describe("pickNextTask", () => {
  it("returns null when no tasks available", () => {
    const result = pickNextTask([]);

    expect(result.task).toBeNull();
    expect(result.consideredCount).toBe(0);
  });

  it("returns null when all tasks are closed", () => {
    const tasks = [makeTask({ status: "closed" }), makeTask({ status: "wont_do" })];

    const result = pickNextTask(tasks);

    expect(result.task).toBeNull();
  });

  it("returns highest priority task", () => {
    const tasks = [
      makeTask({ id: "low", priority: "low" }),
      makeTask({ id: "high", priority: "high" }),
      makeTask({ id: "medium", priority: "medium" }),
    ];

    const result = pickNextTask(tasks);

    expect(result.task?.id).toBe("high");
  });

  it("excludes dependency-blocked tasks", () => {
    const dep = makeTask({ id: "dep", status: "open", priority: "low" });
    const blocked = makeTask({ id: "blocked", priority: "critical", dependsOn: ["dep"] });
    const available = makeTask({ id: "available", priority: "medium" });
    const tasks = [dep, blocked, available];

    const result = pickNextTask(tasks);

    expect(result.task?.id).toBe("available");
    expect(result.blockedTaskIds).toContain("blocked");
  });

  it("applies filter criteria", () => {
    const tasks = [
      makeTask({ id: "bug", labels: ["bug"], priority: "high" }),
      makeTask({ id: "feature", labels: ["feature"], priority: "critical" }),
    ];

    const result = pickNextTask(tasks, { filter: { labels: ["bug"] } });

    expect(result.task?.id).toBe("bug");
  });

  it("applies preferred labels for scoring", () => {
    const tasks = [
      makeTask({ id: "preferred", labels: ["urgent"], priority: "low" }),
      makeTask({ id: "normal", labels: ["normal"], priority: "low" }),
    ];

    const result = pickNextTask(tasks, { preferredLabels: ["urgent"] });

    expect(result.task?.id).toBe("preferred");
  });

  it("provides reason for selection", () => {
    const tasks = [makeTask({ id: "critical", priority: "critical" })];

    const result = pickNextTask(tasks);

    expect(result.reason).toContain("Critical");
  });

  it("counts considered tasks", () => {
    const tasks = [
      makeTask({ status: "open" }),
      makeTask({ status: "open" }),
      makeTask({ status: "closed" }),
    ];

    const result = pickNextTask(tasks);

    expect(result.consideredCount).toBe(2);
  });
});

describe("pickTopTasks", () => {
  it("returns requested number of tasks", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask({ id: `task-${i}` }));

    const result = pickTopTasks(tasks, 3);

    expect(result.length).toBe(3);
  });

  it("returns fewer tasks when not enough available", () => {
    const tasks = [makeTask({ id: "task-1" }), makeTask({ id: "task-2" })];

    const result = pickTopTasks(tasks, 5);

    expect(result.length).toBe(2);
  });

  it("returns tasks in score order", () => {
    const tasks = [
      makeTask({ id: "low", priority: "low" }),
      makeTask({ id: "high", priority: "high" }),
      makeTask({ id: "medium", priority: "medium" }),
    ];

    const result = pickTopTasks(tasks, 3);

    expect(result[0].task.id).toBe("high");
    expect(result[1].task.id).toBe("medium");
    expect(result[2].task.id).toBe("low");
  });

  it("includes scores and reasons", () => {
    const tasks = [makeTask({ id: "test", priority: "critical" })];

    const result = pickTopTasks(tasks, 1);

    expect(result[0].score).toBeGreaterThan(0);
    expect(result[0].reason).toBeTruthy();
  });
});

describe("resolveDependencyChain", () => {
  it("returns empty array for task without dependencies", () => {
    const task = makeTask({ id: "task-1" });

    const result = resolveDependencyChain(task, [task]);

    expect(result).toEqual([]);
  });

  it("returns direct dependencies", () => {
    const dep = makeTask({ id: "dep-1", status: "open" });
    const task = makeTask({ id: "task-1", dependsOn: ["dep-1"] });
    const allTasks = [dep, task];

    const result = resolveDependencyChain(task, allTasks);

    expect(result.length).toBe(1);
    expect(result[0].id).toBe("dep-1");
  });

  it("excludes closed dependencies", () => {
    const closedDep = makeTask({ id: "closed", status: "closed" });
    const openDep = makeTask({ id: "open", status: "open" });
    const task = makeTask({ id: "task-1", dependsOn: ["closed", "open"] });
    const allTasks = [closedDep, openDep, task];

    const result = resolveDependencyChain(task, allTasks);

    expect(result.map((t) => t.id)).toEqual(["open"]);
  });

  it("returns transitive dependencies in order", () => {
    const root = makeTask({ id: "root", status: "open" });
    const middle = makeTask({ id: "middle", status: "open", dependsOn: ["root"] });
    const leaf = makeTask({ id: "leaf", dependsOn: ["middle"] });
    const allTasks = [root, middle, leaf];

    const result = resolveDependencyChain(leaf, allTasks);

    // Root should come before middle
    const rootIndex = result.findIndex((t) => t.id === "root");
    const middleIndex = result.findIndex((t) => t.id === "middle");
    expect(rootIndex).toBeLessThan(middleIndex);
  });

  it("handles circular dependencies gracefully", () => {
    const task1 = makeTask({ id: "task-1", status: "open", dependsOn: ["task-2"] });
    const task2 = makeTask({ id: "task-2", status: "open", dependsOn: ["task-1"] });
    const allTasks = [task1, task2];

    // Should not throw or loop infinitely
    const result1 = resolveDependencyChain(task1, allTasks);
    const result2 = resolveDependencyChain(task2, allTasks);

    // Each task should only include the other as dependency (no infinite loop)
    // task-1's chain includes task-2 (task-2 tries to include task-1 but visited prevents it)
    expect(result1.some((t) => t.id === "task-2")).toBe(true);
    expect(result1.length).toBeLessThanOrEqual(2); // Limited by visited set

    // task-2's chain includes task-1
    expect(result2.some((t) => t.id === "task-1")).toBe(true);
    expect(result2.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates shared dependencies", () => {
    const shared = makeTask({ id: "shared", status: "open" });
    const dep1 = makeTask({ id: "dep-1", status: "open", dependsOn: ["shared"] });
    const dep2 = makeTask({ id: "dep-2", status: "open", dependsOn: ["shared"] });
    const task = makeTask({ id: "task", dependsOn: ["dep-1", "dep-2"] });
    const allTasks = [shared, dep1, dep2, task];

    const result = resolveDependencyChain(task, allTasks);

    // shared should appear only once
    const sharedCount = result.filter((t) => t.id === "shared").length;
    expect(sharedCount).toBe(1);
  });
});

describe("suggestTaskOrder", () => {
  it("returns empty array for empty input", () => {
    const result = suggestTaskOrder([]);

    expect(result).toEqual([]);
  });

  it("orders by score when no dependencies", () => {
    const tasks = [
      makeTask({ id: "low", priority: "low" }),
      makeTask({ id: "high", priority: "high" }),
    ];

    const result = suggestTaskOrder(tasks);

    expect(result[0].id).toBe("high");
    expect(result[1].id).toBe("low");
  });

  it("places dependencies before dependent tasks", () => {
    const dep = makeTask({ id: "dep", priority: "low" });
    const dependent = makeTask({ id: "dependent", priority: "high", dependsOn: ["dep"] });
    const tasks = [dependent, dep];

    const result = suggestTaskOrder(tasks);

    const depIndex = result.findIndex((t) => t.id === "dep");
    const dependentIndex = result.findIndex((t) => t.id === "dependent");
    expect(depIndex).toBeLessThan(dependentIndex);
  });

  it("applies filters", () => {
    const tasks = [
      makeTask({ id: "bug", labels: ["bug"] }),
      makeTask({ id: "feature", labels: ["feature"] }),
    ];

    const result = suggestTaskOrder(tasks, { filter: { labels: ["bug"] } });

    expect(result.map((t) => t.id)).toEqual(["bug"]);
  });

  it("handles complex dependency graphs", () => {
    // Create a diamond dependency pattern:
    //       A
    //      / \
    //     B   C
    //      \ /
    //       D
    const taskA = makeTask({ id: "A", priority: "low" });
    const taskB = makeTask({ id: "B", priority: "medium", dependsOn: ["A"] });
    const taskC = makeTask({ id: "C", priority: "medium", dependsOn: ["A"] });
    const taskD = makeTask({ id: "D", priority: "critical", dependsOn: ["B", "C"] });
    const tasks = [taskD, taskC, taskB, taskA];

    const result = suggestTaskOrder(tasks);

    // A must come before B and C
    const aIndex = result.findIndex((t) => t.id === "A");
    const bIndex = result.findIndex((t) => t.id === "B");
    const cIndex = result.findIndex((t) => t.id === "C");
    const dIndex = result.findIndex((t) => t.id === "D");

    expect(aIndex).toBeLessThan(bIndex);
    expect(aIndex).toBeLessThan(cIndex);
    expect(bIndex).toBeLessThan(dIndex);
    expect(cIndex).toBeLessThan(dIndex);
  });
});

describe("integration scenarios", () => {
  it("sprint planning: pick tasks for an assignee with capacity", () => {
    const tasks = [
      makeTask({
        id: "critical-bug",
        priority: "critical",
        labels: ["bug"],
        assignees: ["alice"],
        estimatedComplexity: 3,
      }),
      makeTask({
        id: "feature",
        priority: "high",
        labels: ["feature"],
        assignees: ["alice"],
        estimatedComplexity: 8,
      }),
      makeTask({
        id: "small-fix",
        priority: "medium",
        labels: ["bug"],
        assignees: ["alice"],
        estimatedComplexity: 2,
      }),
      makeTask({
        id: "bobs-task",
        priority: "critical",
        assignees: ["bob"],
      }),
    ];

    // Alice wants max complexity 5 tasks
    const result = pickTopTasks(tasks, 3, {
      filter: { assignee: "alice", maxComplexity: 5 },
    });

    expect(result.length).toBe(2);
    expect(result.map((r) => r.task.id)).toContain("critical-bug");
    expect(result.map((r) => r.task.id)).toContain("small-fix");
    expect(result.map((r) => r.task.id)).not.toContain("feature");
    expect(result.map((r) => r.task.id)).not.toContain("bobs-task");
  });

  it("urgent bug triage: find overdue bugs", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const tasks = [
      makeTask({
        id: "overdue-bug",
        priority: "high",
        labels: ["bug"],
        dueDate: yesterday,
      }),
      makeTask({
        id: "future-feature",
        priority: "critical",
        labels: ["feature"],
        dueDate: nextWeek,
      }),
    ];

    const result = pickNextTask(tasks, { filter: { labels: ["bug"] } });

    expect(result.task?.id).toBe("overdue-bug");
    expect(result.reason).toContain("Overdue");
  });

  it("new contributor: suggest simple unassigned tasks", () => {
    const tasks = [
      makeTask({
        id: "complex-assigned",
        assignees: ["senior-dev"],
        estimatedComplexity: 9,
        labels: ["good-first-issue"],
      }),
      makeTask({
        id: "simple-unassigned",
        assignees: [],
        estimatedComplexity: 2,
        labels: ["good-first-issue"],
      }),
      makeTask({
        id: "medium-unassigned",
        assignees: [],
        estimatedComplexity: 5,
        labels: ["good-first-issue"],
      }),
    ];

    const result = pickTopTasks(tasks, 2, {
      filter: {
        labels: ["good-first-issue"],
        unassignedOnly: true,
        maxComplexity: 5,
      },
    });

    expect(result.length).toBe(2);
    expect(result.every((r) => r.task.assignees.length === 0)).toBe(true);
    expect(result.every((r) => (r.task.estimatedComplexity ?? 0) <= 5)).toBe(true);
  });
});
