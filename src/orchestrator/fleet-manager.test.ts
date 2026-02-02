import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetManager, getFleetManager, resetFleetManager } from "./fleet-manager.js";

// Mock dependencies
vi.mock("../config/config.js", () => {
  let mockConfig: Record<string, unknown> = {};

  return {
    loadConfig: vi.fn(() => mockConfig),
    writeConfigFile: vi.fn(async (newConfig: Record<string, unknown>) => {
      mockConfig = newConfig;
    }),
    __setMockConfig: (cfg: Record<string, unknown>) => {
      mockConfig = cfg;
    },
    __getMockConfig: () => mockConfig,
  };
});

vi.mock("../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn((cfg) => {
    const list = cfg?.agents?.list ?? [];
    if (list.length === 0) return ["main"];
    return list.map((a: { id: string }) => a.id.toLowerCase());
  }),
  resolveAgentConfig: vi.fn((cfg, agentId) => {
    const list = cfg?.agents?.list ?? [];
    const agent = list.find((a: { id: string }) => a.id.toLowerCase() === agentId.toLowerCase());
    if (!agent) return undefined;
    return {
      name: agent.name,
      workspace: agent.workspace,
      model: agent.model,
      identity: agent.identity,
      sandbox: agent.sandbox,
      tools: agent.tools,
      subagents: agent.subagents,
      heartbeat: agent.heartbeat,
    };
  }),
  resolveDefaultAgentId: vi.fn((cfg) => {
    const list = cfg?.agents?.list ?? [];
    const defaultAgent = list.find((a: { default?: boolean }) => a.default);
    if (defaultAgent) return (defaultAgent as { id: string }).id.toLowerCase();
    if (list.length > 0) return (list[0] as { id: string }).id.toLowerCase();
    return "main";
  }),
  resolveAgentWorkspaceDir: vi.fn((_cfg, agentId) => `/home/user/gimli-${agentId}`),
  resolveAgentDir: vi.fn((_cfg, agentId) => `/home/user/.gimli/agents/${agentId}/agent`),
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: vi.fn((id: string) => (id ? id.toLowerCase().trim() : "main")),
}));

vi.mock("../infra/agent-events.js", () => {
  const listeners = new Set<(evt: unknown) => void>();
  return {
    onAgentEvent: vi.fn((listener: (evt: unknown) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    registerAgentRunContext: vi.fn(),
    getAgentRunContext: vi.fn(),
    __emitTestEvent: (evt: unknown) => {
      for (const listener of listeners) {
        listener(evt);
      }
    },
    __clearListeners: () => listeners.clear(),
  };
});

vi.mock("../agents/subagent-registry.js", () => ({
  listSubagentRunsForRequester: vi.fn(() => []),
}));

// Import mocked modules for test manipulation
import { __setMockConfig, __getMockConfig } from "../config/config.js";
import { __emitTestEvent, __clearListeners } from "../infra/agent-events.js";

describe("FleetManager", () => {
  let fleet: FleetManager;

  beforeEach(() => {
    vi.clearAllMocks();
    __setMockConfig({});
    __clearListeners();
    resetFleetManager();
    fleet = new FleetManager();
  });

  afterEach(() => {
    fleet.dispose();
    resetFleetManager();
  });

  describe("CRUD Operations (Pillar 1)", () => {
    describe("createAgent", () => {
      it("should create a new agent with minimal options", async () => {
        const agent = await fleet.createAgent({ id: "researcher" });

        expect(agent.id).toBe("researcher");
        expect(agent.workspace).toBe("/home/user/gimli-researcher");
        expect(agent.agentDir).toBe("/home/user/.gimli/agents/researcher/agent");
      });

      it("should create an agent with full configuration", async () => {
        const agent = await fleet.createAgent({
          id: "Analyst",
          name: "Data Analyst",
          isDefault: true,
          workspace: "/custom/workspace",
          model: { primary: "anthropic/claude-3-opus", fallbacks: ["anthropic/claude-3-sonnet"] },
          identity: { name: "Analyst Bot", theme: "dark" },
          sandbox: { mode: "all" },
          tools: { disallow: ["dangerous_tool"] },
          subagents: { allowAgents: ["helper"] },
          heartbeat: { every: "30m" },
        });

        expect(agent.id).toBe("analyst"); // normalized to lowercase
        expect(agent.name).toBe("Data Analyst");
      });

      it("should throw error when creating duplicate agent", async () => {
        await fleet.createAgent({ id: "duplicate" });

        await expect(fleet.createAgent({ id: "duplicate" })).rejects.toThrow(
          'Agent with id "duplicate" already exists',
        );
      });

      it("should handle case-insensitive ID normalization", async () => {
        await fleet.createAgent({ id: "TestAgent" });

        await expect(fleet.createAgent({ id: "testagent" })).rejects.toThrow(
          'Agent with id "testagent" already exists',
        );
      });
    });

    describe("getAgent", () => {
      it("should return agent summary for existing agent", async () => {
        await fleet.createAgent({ id: "worker", name: "Worker Bee" });
        const agent = fleet.getAgent("worker");

        expect(agent).toBeDefined();
        expect(agent?.id).toBe("worker");
        expect(agent?.name).toBe("Worker Bee");
      });

      it("should return undefined for non-existent agent", () => {
        const agent = fleet.getAgent("nonexistent");
        expect(agent).toBeUndefined();
      });

      it("should return the implicit default agent", () => {
        // With no agents configured, 'main' is the implicit default
        const agent = fleet.getAgent("main");
        expect(agent).toBeDefined();
        expect(agent?.id).toBe("main");
        expect(agent?.isDefault).toBe(true);
      });
    });

    describe("updateAgent", () => {
      it("should update agent configuration", async () => {
        await fleet.createAgent({ id: "updatable", name: "Original" });
        const updated = await fleet.updateAgent("updatable", { name: "Updated Name" });

        expect(updated.name).toBe("Updated Name");
      });

      it("should throw error for non-existent agent", async () => {
        await expect(fleet.updateAgent("ghost", { name: "Phantom" })).rejects.toThrow(
          'Agent "ghost" not found',
        );
      });

      it("should allow partial updates", async () => {
        await fleet.createAgent({
          id: "partial",
          name: "Original",
          model: "anthropic/claude-3-sonnet",
        });

        const updated = await fleet.updateAgent("partial", {
          identity: { name: "New Identity" },
        });

        expect(updated.identity?.name).toBe("New Identity");
      });
    });

    describe("deleteAgent", () => {
      it("should delete existing agent", async () => {
        await fleet.createAgent({ id: "deletable" });
        expect(fleet.hasAgent("deletable")).toBe(true);

        const result = await fleet.deleteAgent("deletable");
        expect(result).toBe(true);
        expect(fleet.hasAgent("deletable")).toBe(false);
      });

      it("should return false for non-existent agent", async () => {
        const result = await fleet.deleteAgent("nonexistent");
        expect(result).toBe(false);
      });
    });

    describe("listAgents", () => {
      it("should return empty list with default agent when no agents configured", () => {
        const agents = fleet.listAgents();
        expect(agents.length).toBe(1);
        expect(agents[0].id).toBe("main");
      });

      it("should return all configured agents", async () => {
        await fleet.createAgent({ id: "alpha" });
        await fleet.createAgent({ id: "beta" });
        await fleet.createAgent({ id: "gamma" });

        const agents = fleet.listAgents();
        expect(agents.length).toBe(3);
        expect(agents.map((a) => a.id).sort()).toEqual(["alpha", "beta", "gamma"]);
      });
    });
  });

  describe("Observability (Pillar 2)", () => {
    describe("getFleetStats", () => {
      it("should return fleet statistics", () => {
        const stats = fleet.getFleetStats();

        expect(stats).toMatchObject({
          totalAgents: expect.any(Number),
          activeRuns: expect.any(Number),
          subagentRuns: expect.any(Number),
          defaultAgentId: expect.any(String),
          agentIds: expect.any(Array),
        });
      });

      it("should reflect created agents in stats", async () => {
        await fleet.createAgent({ id: "stats-test" });
        const stats = fleet.getFleetStats();

        expect(stats.totalAgents).toBeGreaterThanOrEqual(1);
        expect(stats.agentIds).toContain("stats-test");
      });
    });

    describe("run tracking", () => {
      it("should track registered runs", () => {
        fleet.registerRun("run-123", {
          sessionKey: "agent:worker:main",
          verboseLevel: "high",
        });

        const state = fleet.getRunState("run-123");
        expect(state).toBeDefined();
        expect(state?.runId).toBe("run-123");
        expect(state?.sessionKey).toBe("agent:worker:main");
        expect(state?.status).toBe("running");
      });

      it("should list active runs", () => {
        fleet.registerRun("run-a", { sessionKey: "agent:alpha:main" });
        fleet.registerRun("run-b", { sessionKey: "agent:beta:main" });

        const runs = fleet.getActiveRuns();
        expect(runs.length).toBe(2);
      });

      it("should filter runs by agent ID", () => {
        fleet.registerRun("run-a", { sessionKey: "agent:alpha:main" });
        fleet.registerRun("run-b", { sessionKey: "agent:beta:main" });
        fleet.registerRun("run-c", { sessionKey: "agent:alpha:other" });

        const alphaRuns = fleet.getActiveRuns("alpha");
        expect(alphaRuns.length).toBe(2);
        expect(alphaRuns.every((r) => r.sessionKey?.includes("agent:alpha:"))).toBe(true);
      });
    });

    describe("event subscription", () => {
      it("should broadcast events to subscribers", () => {
        const received: unknown[] = [];
        fleet.onEvent((event) => received.push(event));

        __emitTestEvent({
          runId: "test-run",
          seq: 1,
          stream: "lifecycle",
          ts: Date.now(),
          data: { phase: "start" },
        });

        expect(received.length).toBe(1);
        expect((received[0] as { runId: string }).runId).toBe("test-run");
      });

      it("should allow unsubscribing from events", () => {
        const received: unknown[] = [];
        const unsubscribe = fleet.onEvent((event) => received.push(event));

        __emitTestEvent({ runId: "first", seq: 1, stream: "test", ts: Date.now(), data: {} });
        expect(received.length).toBe(1);

        unsubscribe();

        __emitTestEvent({ runId: "second", seq: 2, stream: "test", ts: Date.now(), data: {} });
        expect(received.length).toBe(1); // Still 1, unsubscribed
      });

      it("should track run lifecycle from events", async () => {
        // Simulate lifecycle start event
        __emitTestEvent({
          runId: "lifecycle-test",
          seq: 1,
          stream: "lifecycle",
          ts: Date.now(),
          sessionKey: "agent:test:main",
          data: { phase: "start", startedAt: Date.now() },
        });

        // Give time for event processing
        await new Promise((r) => setTimeout(r, 10));

        const state = fleet.getRunState("lifecycle-test");
        expect(state).toBeDefined();
        expect(state?.status).toBe("running");

        // Simulate lifecycle end event
        __emitTestEvent({
          runId: "lifecycle-test",
          seq: 2,
          stream: "lifecycle",
          ts: Date.now(),
          data: { phase: "end" },
        });

        await new Promise((r) => setTimeout(r, 10));

        const endState = fleet.getRunState("lifecycle-test");
        expect(endState?.status).toBe("completed");
      });
    });
  });

  describe("Orchestration (Pillar 3)", () => {
    describe("getDefaultAgentId", () => {
      it("should return default agent ID", () => {
        const defaultId = fleet.getDefaultAgentId();
        expect(typeof defaultId).toBe("string");
        expect(defaultId.length).toBeGreaterThan(0);
      });
    });

    describe("setDefaultAgent", () => {
      it("should set a new default agent", async () => {
        await fleet.createAgent({ id: "new-default" });
        await fleet.setDefaultAgent("new-default");

        // The mock should now return this as default
        const cfg = __getMockConfig();
        const list = cfg.agents?.list ?? [];
        const newDefault = list.find((a: { id: string }) => a.id === "new-default");
        expect(newDefault?.default).toBe(true);
      });

      it("should throw error for non-existent agent", async () => {
        await expect(fleet.setDefaultAgent("nonexistent")).rejects.toThrow(
          'Agent "nonexistent" not found',
        );
      });

      it("should clear default from other agents", async () => {
        await fleet.createAgent({ id: "first", isDefault: true });
        await fleet.createAgent({ id: "second" });

        await fleet.setDefaultAgent("second");

        const cfg = __getMockConfig();
        const list = cfg.agents?.list ?? [];
        const first = list.find((a: { id: string }) => a.id === "first");
        const second = list.find((a: { id: string }) => a.id === "second");

        expect(first?.default).toBe(false);
        expect(second?.default).toBe(true);
      });
    });

    describe("hasAgent", () => {
      it("should return true for existing agent", async () => {
        await fleet.createAgent({ id: "exists" });
        expect(fleet.hasAgent("exists")).toBe(true);
      });

      it("should return false for non-existent agent", () => {
        expect(fleet.hasAgent("ghost")).toBe(false);
      });

      it("should handle case-insensitive check", async () => {
        await fleet.createAgent({ id: "CaseSensitive" });
        expect(fleet.hasAgent("casesensitive")).toBe(true);
        expect(fleet.hasAgent("CASESENSITIVE")).toBe(true);
      });
    });

    describe("directory helpers", () => {
      it("should return workspace directory", () => {
        const dir = fleet.getWorkspaceDir("test-agent");
        expect(dir).toContain("gimli-test-agent");
      });

      it("should return agent state directory", () => {
        const dir = fleet.getAgentDir("test-agent");
        expect(dir).toContain(".gimli/agents/test-agent");
      });
    });
  });

  describe("Singleton pattern", () => {
    it("should return same instance from getFleetManager", () => {
      const first = getFleetManager();
      const second = getFleetManager();
      expect(first).toBe(second);
    });

    it("should create new instance after reset", () => {
      const first = getFleetManager();
      resetFleetManager();
      const second = getFleetManager();
      expect(first).not.toBe(second);
    });
  });

  describe("dispose", () => {
    it("should clean up resources on dispose", () => {
      fleet.registerRun("cleanup-test", { sessionKey: "test:main" });
      expect(fleet.getActiveRuns().length).toBe(1);

      fleet.dispose();

      expect(fleet.getActiveRuns().length).toBe(0);
    });

    it("should stop receiving events after dispose", () => {
      const received: unknown[] = [];
      fleet.onEvent((event) => received.push(event));

      fleet.dispose();

      __emitTestEvent({ runId: "post-dispose", seq: 1, stream: "test", ts: Date.now(), data: {} });
      expect(received.length).toBe(0);
    });
  });
});
