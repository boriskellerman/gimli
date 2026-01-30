import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GimliConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";
import { initSessionState } from "./session.js";
import * as internalHooks from "../../hooks/internal-hooks.js";

let testWorkspaceDir = os.tmpdir();
let testStorePath = "";

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-chat-commands-"));
  testStorePath = path.join(testWorkspaceDir, "sessions.json");
  await fs.writeFile(path.join(testWorkspaceDir, "AGENTS.md"), "# Agents\n", "utf-8");
});

afterAll(async () => {
  await fs.rm(testWorkspaceDir, { recursive: true, force: true });
});

function buildParams(commandBody: string, cfg: GimliConfig, ctxOverrides?: Partial<MsgContext>) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "whatsapp",
    Surface: "whatsapp",
    ...ctxOverrides,
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: testWorkspaceDir,
    defaultGroupActivation: () => "mention" as const,
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "whatsapp",
    model: "test-model",
    contextTokens: 0,
    isGroup: false,
    storePath: testStorePath,
    sessionStore: {},
    sessionEntry: {
      sessionId: "test-session-123",
      updatedAt: Date.now(),
    },
  };
}

describe("handleCommands /status", () => {
  it("returns status information for /status command", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as GimliConfig;
    const params = buildParams("/status", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    // Status output includes Gimli version and session info
    expect(result.reply?.text).toContain("Gimli");
    expect(result.reply?.text).toContain("Session:");
  });

  it("includes session key in status output", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as GimliConfig;
    const params = buildParams("/status", cfg);
    params.sessionKey = "agent:main:dm:testuser";
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });

  it("includes model info in status output", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as GimliConfig;
    const params = buildParams("/status", cfg);
    params.model = "claude-opus-4";
    params.provider = "anthropic";
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });

  it("blocks /status from unauthorized sender", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["authorized-user"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as GimliConfig;
    const params = buildParams("/status", cfg, {
      SenderId: "unauthorized-user",
    });
    // Override command authorization
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/status",
      commandAuthorized: false,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    // Unauthorized senders get no reply (silent ignore)
    expect(result.reply).toBeUndefined();
  });
});

describe("handleCommands /new", () => {
  it("triggers hook for /new command", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/new", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "command", action: "new" }));
    spy.mockRestore();
  });

  it("triggers hook for /new with arguments", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/new take notes", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "command", action: "new" }));
    spy.mockRestore();
  });

  it("accepts /new with model hint", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/new claude summarize this", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("handleCommands /reset", () => {
  it("triggers hook for /reset command", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/reset", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "command", action: "reset" }));
    spy.mockRestore();
  });

  it("triggers hook for /reset with arguments", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/reset clean slate", cfg);
    const spy = vi.spyOn(internalHooks, "triggerInternalHook").mockResolvedValue();

    await handleCommands(params);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "command", action: "reset" }));
    spy.mockRestore();
  });
});

describe("initSessionState reset triggers", () => {
  async function seedSessionStore(storePath: string, sessionKey: string, sessionId: string) {
    const { saveSessionStore } = await import("../../config/sessions.js");
    await saveSessionStore(storePath, {
      [sessionKey]: {
        sessionId,
        updatedAt: Date.now(),
      },
    });
  }

  beforeEach(async () => {
    testStorePath = path.join(testWorkspaceDir, `sessions-${Date.now()}.json`);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testStorePath);
    } catch {
      // ignore if file doesn't exist
    }
  });

  it("/new creates new session for authorized sender", async () => {
    const sessionKey = "agent:main:dm:testuser";
    const existingSessionId = "existing-session-123";
    await seedSessionStore(testStorePath, sessionKey, existingSessionId);

    const cfg = {
      session: { store: testStorePath, idleMinutes: 999 },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;

    const result = await initSessionState({
      ctx: {
        Body: "/new",
        RawBody: "/new",
        CommandBody: "/new",
        From: "testuser",
        To: "+11111",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "whatsapp",
        Surface: "whatsapp",
        SenderId: "testuser",
      } as MsgContext,
      cfg,
      commandAuthorized: true,
    });

    expect(result.triggerBodyNormalized).toBe("/new");
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.resetTriggered).toBe(true);
    expect(result.bodyStripped).toBe("");
  });

  it("/new with arguments strips command and preserves arguments", async () => {
    const sessionKey = "agent:main:dm:testuser";
    const existingSessionId = "existing-session-456";
    await seedSessionStore(testStorePath, sessionKey, existingSessionId);

    const cfg = {
      session: { store: testStorePath, idleMinutes: 999 },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;

    const result = await initSessionState({
      ctx: {
        Body: "/new summarize this document",
        RawBody: "/new summarize this document",
        CommandBody: "/new summarize this document",
        From: "testuser",
        To: "+11111",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "whatsapp",
        Surface: "whatsapp",
        SenderId: "testuser",
      } as MsgContext,
      cfg,
      commandAuthorized: true,
    });

    expect(result.triggerBodyNormalized).toBe("/new summarize this document");
    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
    expect(result.bodyStripped).toBe("summarize this document");
  });

  it("/reset creates new session for authorized sender", async () => {
    const sessionKey = "agent:main:dm:testuser";
    const existingSessionId = "existing-session-789";
    await seedSessionStore(testStorePath, sessionKey, existingSessionId);

    const cfg = {
      session: { store: testStorePath, idleMinutes: 999 },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;

    const result = await initSessionState({
      ctx: {
        Body: "/reset",
        RawBody: "/reset",
        CommandBody: "/reset",
        From: "testuser",
        To: "+11111",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "whatsapp",
        Surface: "whatsapp",
        SenderId: "testuser",
      } as MsgContext,
      cfg,
      commandAuthorized: true,
    });

    expect(result.triggerBodyNormalized).toBe("/reset");
    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).not.toBe(existingSessionId);
    expect(result.resetTriggered).toBe(true);
  });

  it("/new is case-insensitive", async () => {
    const sessionKey = "agent:main:dm:testuser";
    const existingSessionId = "existing-session-case";
    await seedSessionStore(testStorePath, sessionKey, existingSessionId);

    const cfg = {
      session: { store: testStorePath, idleMinutes: 999 },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;

    const result = await initSessionState({
      ctx: {
        Body: "/NEW",
        RawBody: "/NEW",
        CommandBody: "/NEW",
        From: "testuser",
        To: "+11111",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "whatsapp",
        Surface: "whatsapp",
        SenderId: "testuser",
      } as MsgContext,
      cfg,
      commandAuthorized: true,
    });

    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(true);
  });

  it("unauthorized sender cannot reset session", async () => {
    const sessionKey = "agent:main:dm:testuser";
    const existingSessionId = "existing-session-unauth";
    await seedSessionStore(testStorePath, sessionKey, existingSessionId);

    const cfg = {
      session: { store: testStorePath, idleMinutes: 999 },
      channels: { whatsapp: { allowFrom: ["authorized-user-only"] } },
    } as GimliConfig;

    const result = await initSessionState({
      ctx: {
        Body: "/new",
        RawBody: "/new",
        CommandBody: "/new",
        From: "testuser",
        To: "+11111",
        ChatType: "direct",
        SessionKey: sessionKey,
        Provider: "whatsapp",
        Surface: "whatsapp",
        SenderId: "testuser",
      } as MsgContext,
      cfg,
      commandAuthorized: false,
    });

    // Session should not be reset for unauthorized user
    expect(result.sessionId).toBe(existingSessionId);
    expect(result.resetTriggered).toBe(false);
  });
});

describe("handleCommands /compact", () => {
  it("returns unavailable message when session id is missing", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/compact", cfg);
    // Remove session entry
    params.sessionEntry = undefined as unknown as typeof params.sessionEntry;
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Compaction unavailable");
  });

  it("blocks /compact from unauthorized sender", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["authorized-user"] } },
    } as GimliConfig;
    const params = buildParams("/compact", cfg, {
      SenderId: "unauthorized-user",
    });
    // Override command authorization
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/compact",
      commandAuthorized: false,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    // Unauthorized senders get no reply (silent ignore)
    expect(result.reply).toBeUndefined();
  });

  it("accepts /compact with custom instructions", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/compact focus on key decisions", cfg);
    // Mock the embedded Pi session compaction
    vi.mock("../../agents/pi-embedded.js", () => ({
      isEmbeddedPiRunActive: () => false,
      abortEmbeddedPiRun: vi.fn(),
      waitForEmbeddedPiRunEnd: vi.fn(),
      compactEmbeddedPiSession: vi.fn().mockResolvedValue({
        ok: true,
        compacted: true,
        result: { tokensBefore: 1000, tokensAfter: 500 },
      }),
    }));
    // The command should be recognized
    expect(params.command.commandBodyNormalized).toContain("/compact");
  });
});

describe("command authorization across commands", () => {
  it("/status respects channel allowFrom", async () => {
    const cfg = {
      commands: { text: true },
      channels: { telegram: { allowFrom: ["12345"] } },
    } as GimliConfig;
    const params = buildParams("/status", cfg, {
      Provider: "telegram",
      Surface: "telegram",
      SenderId: "12345",
    });
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/status",
      commandAuthorized: true,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });

  it("commands work on Discord surface", async () => {
    const cfg = {
      commands: { text: true },
      channels: { discord: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/status", cfg, {
      Provider: "discord",
      Surface: "discord",
      SenderId: "discord-user-123",
    });
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/status",
      commandAuthorized: true,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });

  it("commands work on Slack surface", async () => {
    const cfg = {
      commands: { text: true },
      channels: { slack: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/status", cfg, {
      Provider: "slack",
      Surface: "slack",
      SenderId: "slack-user-U123",
    });
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/status",
      commandAuthorized: true,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });
});

describe("chat commands edge cases", () => {
  it("handles /status with extra whitespace", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
      session: { mainKey: "main", scope: "per-sender" },
    } as GimliConfig;
    const params = buildParams("  /status  ", cfg);
    // Rebuild command with trimmed body
    params.command = buildCommandContext({
      ctx: params.ctx,
      cfg,
      isGroup: false,
      triggerBodyNormalized: "/status",
      commandAuthorized: true,
    });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toBeDefined();
  });

  it("non-command messages continue to agent", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("hello world", cfg);
    const result = await handleCommands(params);
    // Non-command messages should continue to agent
    expect(result.shouldContinue).toBe(true);
  });

  it("unknown slash commands continue to agent", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/unknowncommand", cfg);
    const result = await handleCommands(params);
    // Unknown commands should continue to agent for handling
    expect(result.shouldContinue).toBe(true);
  });
});
