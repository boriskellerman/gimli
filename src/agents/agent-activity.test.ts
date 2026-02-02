/**
 * Tests for multi-agent activity tracker.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initAgentActivityTracker,
  resetAgentActivityTrackerForTests,
  getRunSnapshot,
  listRuns,
  getAgentObservabilityStatus,
  getMultiAgentObservabilitySnapshot,
  onAgentActivityEvent,
  registerExternalRun,
  updateRunSnapshot,
  markRunCompleted,
} from "./agent-activity.js";
import { emitAgentEvent, resetAgentRunContextForTest } from "../infra/agent-events.js";
import type { AgentActivityEvent, AgentRunSnapshot } from "./agent-activity.types.js";

describe("agent-activity", () => {
  beforeEach(() => {
    resetAgentActivityTrackerForTests();
    resetAgentRunContextForTest();
    initAgentActivityTracker();
  });

  afterEach(() => {
    resetAgentActivityTrackerForTests();
    resetAgentRunContextForTest();
  });

  describe("lifecycle event tracking", () => {
    it("should track a run from start to end", () => {
      const runId = "test-run-1";
      const sessionKey = "agent:main:dm:user1";

      // Emit start event.
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "start",
          startedAt: Date.now(),
          task: "Test task",
          model: "claude-3",
        },
      });

      // Verify run is tracked.
      const snapshot = getRunSnapshot(runId);
      expect(snapshot).toBeDefined();
      expect(snapshot?.runId).toBe(runId);
      expect(snapshot?.agentId).toBe("main");
      expect(snapshot?.status).toBe("running");
      expect(snapshot?.task).toBe("Test task");
      expect(snapshot?.model).toBe("claude-3");
      expect(snapshot?.isSubagent).toBe(false);

      // Emit end event.
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "end",
          endedAt: Date.now(),
        },
      });

      // Verify run is completed.
      const completed = getRunSnapshot(runId);
      expect(completed?.status).toBe("completed");
      expect(completed?.endedAt).toBeGreaterThan(0);
      expect(completed?.durationMs).toBeGreaterThan(0);
    });

    it("should track subagent runs", () => {
      const runId = "subagent-run-1";
      const sessionKey = "agent:ops:subagent:abc-123";

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "start",
          startedAt: Date.now(),
          task: "Subagent task",
        },
      });

      const snapshot = getRunSnapshot(runId);
      expect(snapshot?.isSubagent).toBe(true);
      expect(snapshot?.agentId).toBe("ops");
      expect(snapshot?.parentSessionKey).toBe("agent:ops:main");
    });

    it("should track failed runs", () => {
      const runId = "failed-run-1";
      const sessionKey = "agent:main:dm:user1";

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "error",
          endedAt: Date.now(),
          error: "Something went wrong",
        },
      });

      const snapshot = getRunSnapshot(runId);
      expect(snapshot?.status).toBe("failed");
      expect(snapshot?.error).toBe("Something went wrong");
    });

    it("should track aborted runs", () => {
      const runId = "aborted-run-1";
      const sessionKey = "agent:main:dm:user1";

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: {
          phase: "end",
          endedAt: Date.now(),
          aborted: true,
        },
      });

      const snapshot = getRunSnapshot(runId);
      expect(snapshot?.status).toBe("aborted");
    });
  });

  describe("tool event tracking", () => {
    it("should track tool calls", () => {
      const runId = "tool-run-1";
      const sessionKey = "agent:main:dm:user1";

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      // Start tool.
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "tool",
        data: { phase: "start", name: "search" },
      });

      let snapshot = getRunSnapshot(runId);
      expect(snapshot?.currentTool).toBe("search");
      expect(snapshot?.toolCallCount).toBe(1);

      // End tool.
      emitAgentEvent({
        runId,
        sessionKey,
        stream: "tool",
        data: { phase: "end", name: "search" },
      });

      snapshot = getRunSnapshot(runId);
      expect(snapshot?.currentTool).toBeUndefined();
      expect(snapshot?.toolCallCount).toBe(1);
    });

    it("should count events", () => {
      const runId = "event-count-run-1";
      const sessionKey = "agent:main:dm:user1";

      emitAgentEvent({
        runId,
        sessionKey,
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      // Emit multiple events.
      for (let i = 0; i < 5; i++) {
        emitAgentEvent({
          runId,
          sessionKey,
          stream: "assistant",
          data: { content: `chunk ${i}` },
        });
      }

      const snapshot = getRunSnapshot(runId);
      // 1 start + 5 assistant events.
      expect(snapshot?.eventCount).toBe(6);
    });
  });

  describe("listRuns", () => {
    it("should list runs by agent", () => {
      // Create runs for different agents.
      const runs = [
        { runId: "run-main-1", sessionKey: "agent:main:dm:user1" },
        { runId: "run-main-2", sessionKey: "agent:main:dm:user2" },
        { runId: "run-ops-1", sessionKey: "agent:ops:dm:user1" },
      ];

      for (const run of runs) {
        emitAgentEvent({
          runId: run.runId,
          sessionKey: run.sessionKey,
          stream: "lifecycle",
          data: { phase: "start", startedAt: Date.now() },
        });
      }

      const mainRuns = listRuns({ agentIds: ["main"] });
      expect(mainRuns).toHaveLength(2);
      expect(mainRuns.every((r) => r.agentId === "main")).toBe(true);

      const opsRuns = listRuns({ agentIds: ["ops"] });
      expect(opsRuns).toHaveLength(1);
      expect(opsRuns[0]?.agentId).toBe("ops");
    });

    it("should filter active runs only", () => {
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

      const activeOnly = listRuns({ activeOnly: true });
      expect(activeOnly).toHaveLength(1);
      expect(activeOnly[0]?.runId).toBe("active-run");
    });

    it("should filter subagents", () => {
      emitAgentEvent({
        runId: "main-run",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId: "subagent-run",
        sessionKey: "agent:main:subagent:abc123",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      const withSubagents = listRuns({ includeSubagents: true });
      expect(withSubagents).toHaveLength(2);

      const withoutSubagents = listRuns({ includeSubagents: false });
      expect(withoutSubagents).toHaveLength(1);
      expect(withoutSubagents[0]?.runId).toBe("main-run");
    });
  });

  describe("getAgentObservabilityStatus", () => {
    it("should aggregate status for an agent", () => {
      // Create multiple runs.
      emitAgentEvent({
        runId: "active-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId: "completed-1",
        sessionKey: "agent:main:dm:user2",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() - 1000 },
      });
      emitAgentEvent({
        runId: "completed-1",
        sessionKey: "agent:main:dm:user2",
        stream: "lifecycle",
        data: { phase: "end", endedAt: Date.now() },
      });

      emitAgentEvent({
        runId: "failed-1",
        sessionKey: "agent:main:dm:user3",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() - 2000 },
      });
      emitAgentEvent({
        runId: "failed-1",
        sessionKey: "agent:main:dm:user3",
        stream: "lifecycle",
        data: { phase: "error", error: "fail" },
      });

      const status = getAgentObservabilityStatus("main");
      expect(status.agentId).toBe("main");
      expect(status.activeRuns).toBe(1);
      expect(status.completedRuns).toBe(1);
      expect(status.failedRuns).toBe(1);
      expect(status.totalRuns).toBe(3);
      expect(status.runs).toHaveLength(3);
    });
  });

  describe("getMultiAgentObservabilitySnapshot", () => {
    it("should provide system-wide snapshot", () => {
      // Create runs for multiple agents.
      emitAgentEvent({
        runId: "main-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId: "ops-1",
        sessionKey: "agent:ops:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      const snapshot = getMultiAgentObservabilitySnapshot();
      expect(snapshot.totalActiveRuns).toBe(2);
      expect(snapshot.totalAgentsWithActivity).toBe(2);
      expect(snapshot.agents).toHaveLength(2);
    });
  });

  describe("activity events", () => {
    it("should emit events on run lifecycle", () => {
      const events: AgentActivityEvent[] = [];
      const unsubscribe = onAgentActivityEvent((evt) => events.push(evt));

      emitAgentEvent({
        runId: "event-run-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      emitAgentEvent({
        runId: "event-run-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "end", endedAt: Date.now() },
      });

      unsubscribe();

      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("run:start");
      expect(events[1]?.type).toBe("run:end");
    });
  });

  describe("external run registration", () => {
    it("should allow registering external runs", () => {
      const externalRun: AgentRunSnapshot = {
        runId: "external-1",
        agentId: "main",
        sessionKey: "agent:main:dm:user1",
        status: "running",
        startedAt: Date.now(),
        isSubagent: false,
        eventCount: 0,
        toolCallCount: 0,
      };

      registerExternalRun(externalRun);

      const snapshot = getRunSnapshot("external-1");
      expect(snapshot).toBeDefined();
      expect(snapshot?.runId).toBe("external-1");
    });

    it("should allow updating run snapshots", () => {
      emitAgentEvent({
        runId: "update-run-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      updateRunSnapshot("update-run-1", { task: "Updated task" });

      const snapshot = getRunSnapshot("update-run-1");
      expect(snapshot?.task).toBe("Updated task");
    });

    it("should allow marking runs as completed", () => {
      emitAgentEvent({
        runId: "mark-complete-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      markRunCompleted("mark-complete-1");

      const snapshot = getRunSnapshot("mark-complete-1");
      expect(snapshot?.status).toBe("completed");
      expect(snapshot?.endedAt).toBeGreaterThan(0);
    });

    it("should allow marking runs as failed", () => {
      emitAgentEvent({
        runId: "mark-failed-1",
        sessionKey: "agent:main:dm:user1",
        stream: "lifecycle",
        data: { phase: "start", startedAt: Date.now() },
      });

      markRunCompleted("mark-failed-1", { error: "Test error" });

      const snapshot = getRunSnapshot("mark-failed-1");
      expect(snapshot?.status).toBe("failed");
      expect(snapshot?.error).toBe("Test error");
    });
  });
});
