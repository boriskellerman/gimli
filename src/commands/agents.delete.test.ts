import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEnv } from "../runtime.js";

const configMocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  writeConfigFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot: configMocks.readConfigFileSnapshot,
    writeConfigFile: configMocks.writeConfigFile,
  };
});

const helperMocks = vi.hoisted(() => ({
  moveToTrash: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./onboard-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./onboard-helpers.js")>();
  return {
    ...actual,
    moveToTrash: helperMocks.moveToTrash,
  };
});

import { agentsDeleteCommand } from "./agents.js";

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

describe("agents delete command", () => {
  beforeEach(() => {
    configMocks.readConfigFileSnapshot.mockReset();
    configMocks.writeConfigFile.mockClear();
    helperMocks.moveToTrash.mockClear();
    (runtime.log as ReturnType<typeof vi.fn>).mockClear();
    (runtime.error as ReturnType<typeof vi.fn>).mockClear();
    (runtime.exit as ReturnType<typeof vi.fn>).mockClear();
  });

  it("errors when agent id is empty", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({ ...baseSnapshot });

    await agentsDeleteCommand({ id: "", force: true }, runtime);

    expect(runtime.error).toHaveBeenCalledWith("Agent id is required.");
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(configMocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("errors when trying to delete the default agent", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({ ...baseSnapshot });

    await agentsDeleteCommand({ id: "main", force: true }, runtime);

    expect(runtime.error).toHaveBeenCalledWith('"main" cannot be deleted.');
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(configMocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("errors when agent is not found", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "main", workspace: "/main-ws" }],
        },
      },
    });

    await agentsDeleteCommand({ id: "nonexistent", force: true }, runtime);

    expect(runtime.error).toHaveBeenCalledWith('Agent "nonexistent" not found.');
    expect(runtime.exit).toHaveBeenCalledWith(1);
    expect(configMocks.writeConfigFile).not.toHaveBeenCalled();
  });

  it("deletes agent with --force flag", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [
            { id: "main", workspace: "/main-ws" },
            { id: "work", workspace: "/work-ws" },
          ],
        },
        bindings: [
          { agentId: "work", match: { channel: "slack" } },
          { agentId: "main", match: { channel: "telegram" } },
        ],
      },
    });

    await agentsDeleteCommand({ id: "work", force: true }, runtime);

    expect(configMocks.writeConfigFile).toHaveBeenCalledTimes(1);
    const written = configMocks.writeConfigFile.mock.calls[0]?.[0] as {
      agents?: { list?: Array<{ id: string }> };
      bindings?: Array<{ agentId: string }>;
    };
    expect(written.agents?.list?.some((a) => a.id === "work")).toBe(false);
    expect(written.agents?.list?.some((a) => a.id === "main")).toBe(true);
    expect(written.bindings?.some((b) => b.agentId === "work")).toBe(false);
    expect(helperMocks.moveToTrash).toHaveBeenCalledTimes(3); // workspace, agentDir, sessionsDir
    expect(runtime.log).toHaveBeenCalledWith("Deleted agent: work");
  });

  it("outputs JSON when --json flag is set", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "work", workspace: "/work-ws" }],
        },
      },
    });

    await agentsDeleteCommand({ id: "work", force: true, json: true }, runtime);

    expect(configMocks.writeConfigFile).toHaveBeenCalledTimes(1);
    const logCall = (runtime.log as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(logCall).toContain('"agentId": "work"');
    expect(logCall).toContain('"removedBindings"');
    expect(logCall).toContain('"removedAllow"');
  });

  it("normalizes agent id to lowercase", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [{ id: "work", workspace: "/work-ws" }],
        },
      },
    });

    await agentsDeleteCommand({ id: "WORK", force: true }, runtime);

    expect(runtime.log).toHaveBeenCalledWith('Normalized agent id to "work".');
    expect(configMocks.writeConfigFile).toHaveBeenCalledTimes(1);
  });

  it("removes agent from agentToAgent allow list", async () => {
    configMocks.readConfigFileSnapshot.mockResolvedValue({
      ...baseSnapshot,
      config: {
        agents: {
          list: [
            { id: "main", workspace: "/main-ws" },
            { id: "work", workspace: "/work-ws" },
          ],
        },
        tools: {
          agentToAgent: { enabled: true, allow: ["work", "main"] },
        },
      },
    });

    await agentsDeleteCommand({ id: "work", force: true }, runtime);

    const written = configMocks.writeConfigFile.mock.calls[0]?.[0] as {
      tools?: { agentToAgent?: { allow?: string[] } };
    };
    expect(written.tools?.agentToAgent?.allow).toEqual(["main"]);
  });
});
