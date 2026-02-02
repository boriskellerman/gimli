import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createHookRunStore,
  getHookRunStore,
  resetHookRunStore,
  type HookRunStore,
} from "./hooks-runs.js";

describe("HookRunStore", () => {
  let store: HookRunStore;

  beforeEach(() => {
    store = createHookRunStore();
  });

  test("createRun creates a pending run with generated ID", () => {
    const runId = store.createRun({ name: "Test", sessionKey: "test:123" });
    expect(runId).toBeTruthy();

    const run = store.getRun(runId);
    expect(run).toBeDefined();
    expect(run?.name).toBe("Test");
    expect(run?.sessionKey).toBe("test:123");
    expect(run?.status).toBe("pending");
    expect(run?.createdAt).toBeGreaterThan(0);
  });

  test("createRun accepts a custom runId", () => {
    const runId = store.createRun({
      name: "Test",
      sessionKey: "test:123",
      runId: "custom-id",
    });
    expect(runId).toBe("custom-id");

    const run = store.getRun("custom-id");
    expect(run).toBeDefined();
  });

  test("startRun updates status to running", () => {
    const runId = store.createRun({ name: "Test", sessionKey: "test:123" });
    expect(store.getRun(runId)?.status).toBe("pending");

    store.startRun(runId);
    const run = store.getRun(runId);
    expect(run?.status).toBe("running");
    expect(run?.startedAt).toBeGreaterThan(0);
  });

  test("completeRun stores result for successful run", () => {
    const runId = store.createRun({ name: "Test", sessionKey: "test:123" });
    store.startRun(runId);

    store.completeRun(runId, {
      status: "ok",
      summary: "Done!",
      outputText: "Output text here",
    });

    const run = store.getRun(runId);
    expect(run?.status).toBe("completed");
    expect(run?.summary).toBe("Done!");
    expect(run?.outputText).toBe("Output text here");
    expect(run?.completedAt).toBeGreaterThan(0);
  });

  test("completeRun stores result for error run", () => {
    const runId = store.createRun({ name: "Test", sessionKey: "test:123" });
    store.startRun(runId);

    store.completeRun(runId, {
      status: "error",
      error: "Something went wrong",
    });

    const run = store.getRun(runId);
    expect(run?.status).toBe("error");
    expect(run?.error).toBe("Something went wrong");
  });

  test("listRuns returns runs sorted by newest first", () => {
    vi.useFakeTimers();

    vi.setSystemTime(1000);
    store.createRun({ name: "First", sessionKey: "test:1", runId: "run-1" });

    vi.setSystemTime(2000);
    store.createRun({ name: "Second", sessionKey: "test:2", runId: "run-2" });

    vi.setSystemTime(3000);
    store.createRun({ name: "Third", sessionKey: "test:3", runId: "run-3" });

    const result = store.listRuns();
    expect(result.total).toBe(3);
    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].runId).toBe("run-3");
    expect(result.runs[2].runId).toBe("run-1");

    vi.useRealTimers();
  });

  test("listRuns filters by status", () => {
    const id1 = store.createRun({ name: "Run1", sessionKey: "test:1" });
    store.createRun({ name: "Run2", sessionKey: "test:2" });
    store.startRun(id1);
    store.completeRun(id1, { status: "ok" });

    const completed = store.listRuns({ status: "completed" });
    expect(completed.total).toBe(1);
    expect(completed.runs[0].runId).toBe(id1);

    const pending = store.listRuns({ status: "pending" });
    expect(pending.total).toBe(1);
  });

  test("listRuns filters by name (case-insensitive)", () => {
    store.createRun({ name: "GitHub Hook", sessionKey: "test:1" });
    store.createRun({ name: "Gmail Hook", sessionKey: "test:2" });
    store.createRun({ name: "Custom", sessionKey: "test:3" });

    const hooks = store.listRuns({ name: "hook" });
    expect(hooks.total).toBe(2);

    const github = store.listRuns({ name: "GitHub" });
    expect(github.total).toBe(1);
  });

  test("listRuns supports pagination", () => {
    for (let i = 0; i < 10; i++) {
      store.createRun({ name: `Run${i}`, sessionKey: `test:${i}` });
    }

    const page1 = store.listRuns({ limit: 3, offset: 0 });
    expect(page1.runs).toHaveLength(3);
    expect(page1.total).toBe(10);

    const page2 = store.listRuns({ limit: 3, offset: 3 });
    expect(page2.runs).toHaveLength(3);
    expect(page2.total).toBe(10);
    expect(page2.runs[0].runId).not.toBe(page1.runs[0].runId);
  });

  test("deleteRun removes a run", () => {
    const runId = store.createRun({ name: "Test", sessionKey: "test:123" });
    expect(store.getRun(runId)).toBeDefined();

    const deleted = store.deleteRun(runId);
    expect(deleted).toBe(true);
    expect(store.getRun(runId)).toBeUndefined();

    const deletedAgain = store.deleteRun(runId);
    expect(deletedAgain).toBe(false);
  });

  test("getStats returns correct counts", () => {
    const id1 = store.createRun({ name: "Run1", sessionKey: "test:1" });
    store.createRun({ name: "Run2", sessionKey: "test:2" });
    const id3 = store.createRun({ name: "Run3", sessionKey: "test:3" });

    store.startRun(id1);
    store.completeRun(id1, { status: "ok" });

    store.startRun(id3);
    store.completeRun(id3, { status: "error", error: "failed" });

    const stats = store.getStats();
    expect(stats.total).toBe(3);
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(1);
    expect(stats.error).toBe(1);
  });

  test("evicts expired entries based on TTL", () => {
    vi.useFakeTimers();
    const shortTtlStore = createHookRunStore({ ttlMs: 1000 });

    shortTtlStore.createRun({ name: "Test", sessionKey: "test:123", runId: "old-run" });
    expect(shortTtlStore.getRun("old-run")).toBeDefined();

    vi.advanceTimersByTime(1500);

    // Access triggers eviction
    expect(shortTtlStore.getRun("old-run")).toBeUndefined();

    vi.useRealTimers();
  });

  test("evicts oldest entries when max is exceeded", () => {
    const smallStore = createHookRunStore({ maxRuns: 3 });

    smallStore.createRun({ name: "Run1", sessionKey: "test:1", runId: "run-1" });
    smallStore.createRun({ name: "Run2", sessionKey: "test:2", runId: "run-2" });
    smallStore.createRun({ name: "Run3", sessionKey: "test:3", runId: "run-3" });
    smallStore.createRun({ name: "Run4", sessionKey: "test:4", runId: "run-4" });

    // Oldest should be evicted
    expect(smallStore.getRun("run-1")).toBeUndefined();
    expect(smallStore.getRun("run-4")).toBeDefined();

    const stats = smallStore.getStats();
    expect(stats.total).toBe(3);
  });

  test("clear removes all runs", () => {
    store.createRun({ name: "Run1", sessionKey: "test:1" });
    store.createRun({ name: "Run2", sessionKey: "test:2" });

    expect(store.getStats().total).toBe(2);

    store.clear();

    expect(store.getStats().total).toBe(0);
  });
});

describe("global HookRunStore singleton", () => {
  afterEach(() => {
    resetHookRunStore();
  });

  test("getHookRunStore returns same instance", () => {
    const store1 = getHookRunStore();
    const store2 = getHookRunStore();
    expect(store1).toBe(store2);
  });

  test("resetHookRunStore creates new instance", () => {
    const store1 = getHookRunStore();
    store1.createRun({ name: "Test", sessionKey: "test" });

    resetHookRunStore();

    const store2 = getHookRunStore();
    expect(store2).not.toBe(store1);
    expect(store2.getStats().total).toBe(0);
  });
});
