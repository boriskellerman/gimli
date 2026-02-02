import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../runtime.js";

const configMocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot: configMocks.readConfigFileSnapshot,
  };
});

const providerMocks = vi.hoisted(() => ({
  buildProviderStatusIndex: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("./agents.providers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agents.providers.js")>();
  return {
    ...actual,
    buildProviderStatusIndex: providerMocks.buildProviderStatusIndex,
  };
});

import { agentsListCommand } from "./agents.js";

const runtime: RuntimeEnv = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const baseSnapshot = {
  path: "/tmp/gimli.json",
  exists: true,
  raw: "{}",
  parsed: {},
  valid: true,
  config: {},
  issues: [],
  legacyIssues: [],
};

describe("agents list command", () => {
  beforeEach(() => {
    configMocks.readConfigFileSnapshot.mockReset();
    providerMocks.buildProviderStatusIndex.mockClear();
    (runtime.log as ReturnType<typeof vi.fn>).mockClear();
    (runtime.error as ReturnType<typeof vi.fn>).mockClear();
    (runtime.exit as ReturnType<typeof vi.fn>).mockClear();
  });

  it("lists agents with default agent when no agents configured", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({ ...baseSnapshot });

    await agentsListCommand({}, runtime);

    expect(runtime.log).toHaveBeenCalled();
    const output = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("Agents:");
    expect(output).toContain("gimli");
    expect(output).toContain("(default)");
  });

  it("lists multiple configured agents", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [
            { id: "main", workspace: "/main-ws" },
            { id: "work", name: "Work Agent", workspace: "/work-ws", default: true },
          ],
        },
        bindings: [{ agentId: "work", match: { channel: "slack" } }],
      },
    });

    await agentsListCommand({}, runtime);

    const output = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("main");
    expect(output).toContain("work");
    expect(output).toContain("Work Agent");
    expect(output).toContain("Routing rules: 1");
  });

  it("outputs JSON when --json flag is set", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "main", workspace: "/main-ws" }],
        },
      },
    });

    await agentsListCommand({ json: true }, runtime);

    const logCall = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logCall) as Array<{ id: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]?.id).toBe("main");
  });

  it("includes binding details with --bindings flag", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "work", workspace: "/work-ws" }],
        },
        bindings: [
          { agentId: "work", match: { channel: "slack", accountId: "team1" } },
          { agentId: "work", match: { channel: "telegram" } },
        ],
      },
    });

    await agentsListCommand({ bindings: true }, runtime);

    const output = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("Routing rules:");
    expect(output).toContain("slack");
  });

  it("shows agent model when configured", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "work", workspace: "/work-ws", model: "anthropic/claude-opus-4" }],
        },
      },
    });

    await agentsListCommand({}, runtime);

    const output = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("Model: anthropic/claude-opus-4");
  });

  it("shows default routing for default agent without explicit bindings", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "gimli", default: true, workspace: "/gimli-ws" }],
        },
      },
    });

    await agentsListCommand({}, runtime);

    const output = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("default (no explicit rules)");
  });
});
