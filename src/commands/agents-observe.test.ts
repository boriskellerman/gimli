/**
 * Tests for the agents observe command.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getAgentsObserveData } from "./agents-observe.js";
import {
  initAgentActivityTracker,
  resetAgentActivityTrackerForTests,
} from "../agents/agent-activity.js";
import { emitAgentEvent, resetAgentRunContextForTest } from "../infra/agent-events.js";

// Mock config loading.
vi.mock("../config/config.js", () => ({
  loadConfig: () => ({
    session: { scope: "per-sender" },
    agents: {
      defaults: {},
      list: [
        { id: "main", name: "Main Agent" },
        { id: "ops", name: "Operations Agent" },
      ],
    },
  }),
}));

// Mock session store loading to avoid file system dependencies.
vi.mock("../config/sessions.js", async (importOriginal) => {
  const original = (await importOriginal()) as object;
  return {
    ...original,
    loadSessionStore: () => ({}),
    resolveStorePath: () => "/mock/sessions.json",
  };
});

describe("agents-observe command", () => {
  beforeEach(() => {
    resetAgentActivityTrackerForTests();
    resetAgentRunContextForTest();
    initAgentActivityTracker();
  });

  it("should return summary with no active runs", async () => {
    const data = await getAgentsObserveData();

    expect(data.totalActiveRuns).toBe(0);
    expect(data.agents).toBeInstanceOf(Array);
  });

  it("should track active runs in summary", async () => {
    // Create an active run.
    emitAgentEvent({
      runId: "test-run-1",
      sessionKey: "agent:main:dm:user1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now(), task: "Test task" },
    });

    const data = await getAgentsObserveData();

    expect(data.totalActiveRuns).toBe(1);
    const mainAgent = data.agents.find((a) => a.id === "main");
    expect(mainAgent?.activeRuns).toBe(1);
    expect(mainAgent?.runs).toHaveLength(1);
    expect(mainAgent?.runs[0]?.task).toBe("Test task");
  });

  it("should filter by agent", async () => {
    // Create runs for different agents.
    emitAgentEvent({
      runId: "main-run",
      sessionKey: "agent:main:dm:user1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });

    emitAgentEvent({
      runId: "ops-run",
      sessionKey: "agent:ops:dm:user1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });

    const data = await getAgentsObserveData({ agent: "main" });

    // Should only include the main agent.
    const mainAgent = data.agents.find((a) => a.id === "main");
    expect(mainAgent).toBeDefined();
    expect(mainAgent?.activeRuns).toBe(1);
  });

  it("should filter active only", async () => {
    // Create active and completed runs.
    emitAgentEvent({
      runId: "active-run",
      sessionKey: "agent:main:dm:user1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });

    emitAgentEvent({
      runId: "completed-run",
      sessionKey: "agent:main:dm:user2",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });
    emitAgentEvent({
      runId: "completed-run",
      sessionKey: "agent:main:dm:user2",
      stream: "lifecycle",
      data: { phase: "end", endedAt: Date.now() },
    });

    const data = await getAgentsObserveData({ active: true });

    const mainAgent = data.agents.find((a) => a.id === "main");
    expect(mainAgent?.runs).toHaveLength(1);
    expect(mainAgent?.runs[0]?.status).toBe("running");
  });

  it("should respect limit option", async () => {
    // Create multiple runs.
    for (let i = 0; i < 5; i++) {
      emitAgentEvent({
        runId: `run-${i}`,
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() - i * 1000 },
      });
    }

    const data = await getAgentsObserveData({ limit: 2 });

    const mainAgent = data.agents.find((a) => a.id === "main");
    expect(mainAgent?.runs).toHaveLength(2);
  });

  it("should track completed and failed counts", async () => {
    // Create various runs.
    emitAgentEvent({
      runId: "completed-1",
      sessionKey: "agent:main:dm:user1",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });
    emitAgentEvent({
      runId: "completed-1",
      sessionKey: "agent:main:dm:user1",
      stream: "lifecycle",
      data: { phase: "end", endedAt: Date.now() },
    });

    emitAgentEvent({
      runId: "failed-1",
      sessionKey: "agent:main:dm:user2",
      stream: "lifecycle",
      data: { phase: "start", startedAt: Date.now() },
    });
    emitAgentEvent({
      runId: "failed-1",
      sessionKey: "agent:main:dm:user2",
      stream: "lifecycle",
      data: { phase: "error", error: "Test error" },
    });

    const data = await getAgentsObserveData();

    const mainAgent = data.agents.find((a) => a.id === "main");
    expect(mainAgent?.completedRuns).toBe(1);
    expect(mainAgent?.failedRuns).toBe(1);
  });
});
