import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { deriveSessionKey, resolveSessionKey } from "./session-key.js";
import { resolveGroupSessionKey } from "./group.js";
import {
  resolveMainSessionKey,
  resolveAgentMainSessionKey,
  canonicalizeMainSessionAlias,
} from "./main-session.js";
import { loadSessionStore, updateSessionStore } from "./store.js";
import type { SessionEntry } from "./types.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox/runtime-status.js";
import type { GimliConfig } from "../config.js";

/**
 * Comprehensive tests for session creation and isolation in Gimli.
 *
 * This test suite verifies:
 * 1. Main session vs group session creation and distinction
 * 2. Session key derivation for different message contexts
 * 3. Session isolation via sandboxing
 * 4. Session store operations with proper isolation
 * 5. Channel-specific session behavior (WhatsApp, Discord, Telegram, etc.)
 */
describe("session creation and isolation", () => {
  let tempDir: string;
  let storePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-session-isolation-"));
    storePath = path.join(tempDir, "sessions.json");
    await fs.writeFile(storePath, "{}", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("main session creation", () => {
    it("creates main session key with default agent id", () => {
      const key = resolveMainSessionKey({});
      expect(key).toBe("agent:main:main");
    });

    it("creates main session key with custom agent id", () => {
      const key = resolveMainSessionKey({
        agents: { list: [{ id: "alice", default: true }] },
      });
      expect(key).toBe("agent:alice:main");
    });

    it("creates main session key with custom main key", () => {
      const key = resolveMainSessionKey({
        session: { mainKey: "work" },
      });
      expect(key).toBe("agent:main:work");
    });

    it("creates global session key when scope is global", () => {
      const key = resolveMainSessionKey({
        session: { scope: "global" },
      });
      expect(key).toBe("global");
    });

    it("resolves agent-specific main session key", () => {
      const key = resolveAgentMainSessionKey({
        cfg: { session: { mainKey: "primary" } },
        agentId: "bob",
      });
      expect(key).toBe("agent:bob:primary");
    });

    it("canonicalizes main session aliases correctly", () => {
      const canonical = canonicalizeMainSessionAlias({
        cfg: { session: { mainKey: "work" } },
        agentId: "alice",
        sessionKey: "main",
      });
      expect(canonical).toBe("agent:alice:work");
    });

    it("canonicalizes to global when scope is global", () => {
      const canonical = canonicalizeMainSessionAlias({
        cfg: { session: { scope: "global", mainKey: "work" } },
        agentId: "alice",
        sessionKey: "main",
      });
      expect(canonical).toBe("global");
    });
  });

  describe("group session creation", () => {
    it("creates group session key for WhatsApp groups", () => {
      const result = resolveGroupSessionKey({
        From: "12345-678@g.us",
        Provider: "whatsapp",
        ChatType: "group",
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe("whatsapp:group:12345-678@g.us");
      expect(result?.channel).toBe("whatsapp");
      expect(result?.chatType).toBe("group");
    });

    it("creates group session key for Discord groups", () => {
      const result = resolveGroupSessionKey({
        From: "discord:group:123456789",
        Provider: "discord",
        ChatType: "group",
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe("discord:group:123456789");
      expect(result?.channel).toBe("discord");
    });

    it("creates channel session key for Discord channels", () => {
      const result = resolveGroupSessionKey({
        From: "discord:channel:987654321",
        Provider: "discord",
        ChatType: "channel",
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe("discord:channel:987654321");
      expect(result?.chatType).toBe("channel");
    });

    it("creates group session key for Telegram groups", () => {
      const result = resolveGroupSessionKey({
        From: "telegram:group:-1001234567890",
        Provider: "telegram",
        ChatType: "group",
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe("telegram:group:-1001234567890");
    });

    it("creates group session key for Slack channels", () => {
      const result = resolveGroupSessionKey({
        From: "slack:channel:C12345678",
        Provider: "slack",
        ChatType: "channel",
      });

      expect(result).not.toBeNull();
      expect(result?.key).toBe("slack:channel:c12345678");
    });

    it("returns null for DM messages", () => {
      const result = resolveGroupSessionKey({
        From: "+15551234567",
        Provider: "whatsapp",
        ChatType: "dm",
      });

      expect(result).toBeNull();
    });

    it("returns null when no group indicators present", () => {
      const result = resolveGroupSessionKey({
        From: "user@example.com",
        Provider: "email",
      });

      expect(result).toBeNull();
    });
  });

  describe("session key derivation", () => {
    it("derives per-sender key for DM", () => {
      const key = deriveSessionKey("per-sender", { From: "+15551234567" });
      expect(key).toBe("+15551234567");
    });

    it("derives group key for WhatsApp group", () => {
      const key = deriveSessionKey("per-sender", { From: "12345@g.us" });
      expect(key).toBe("whatsapp:group:12345@g.us");
    });

    it("derives global key when scope is global", () => {
      const key = deriveSessionKey("global", { From: "+15551234567" });
      expect(key).toBe("global");
    });

    it("falls back to unknown when sender missing", () => {
      const key = deriveSessionKey("per-sender", {});
      expect(key).toBe("unknown");
    });
  });

  describe("session key resolution with main collapse", () => {
    it("collapses DM to main session", () => {
      const key = resolveSessionKey("per-sender", { From: "+15551234567" }, "main");
      expect(key).toBe("agent:main:main");
    });

    it("collapses DM to custom main session key", () => {
      const key = resolveSessionKey("per-sender", { From: "+15551234567" }, "work");
      expect(key).toBe("agent:main:work");
    });

    it("preserves group session key without collapsing", () => {
      const key = resolveSessionKey("per-sender", { From: "12345@g.us" }, "main");
      expect(key).toBe("agent:main:whatsapp:group:12345@g.us");
    });

    it("preserves Discord group session key", () => {
      const key = resolveSessionKey(
        "per-sender",
        { From: "discord:group:123456789", ChatType: "group" },
        "main",
      );
      expect(key).toBe("agent:main:discord:group:123456789");
    });

    it("uses explicit session key when provided", () => {
      const key = resolveSessionKey(
        "per-sender",
        { From: "+15551234567", SessionKey: "custom-session" },
        "main",
      );
      expect(key).toBe("custom-session");
    });

    it("returns global for global scope", () => {
      const key = resolveSessionKey("global", { From: "+15551234567" }, "main");
      expect(key).toBe("global");
    });
  });

  describe("session isolation via sandboxing", () => {
    it("main session is not sandboxed in non-main mode", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "non-main" } },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });

      expect(result.sandboxed).toBe(false);
      expect(result.mainSessionKey).toBe("agent:main:main");
    });

    it("group session is sandboxed in non-main mode", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "non-main" } },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:whatsapp:group:12345@g.us",
      });

      expect(result.sandboxed).toBe(true);
    });

    it("DM session that collapsed to main is not sandboxed", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "non-main" } },
          list: [{ id: "main" }],
        },
      };

      // DMs collapse to main session key
      const sessionKey = resolveSessionKey("per-sender", { From: "+15551234567" }, "main");
      expect(sessionKey).toBe("agent:main:main");

      const result = resolveSandboxRuntimeStatus({ cfg, sessionKey });
      expect(result.sandboxed).toBe(false);
    });

    it("custom named session is sandboxed in non-main mode", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "non-main" } },
          list: [{ id: "main" }],
        },
      };

      const result = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:work-project",
      });

      expect(result.sandboxed).toBe(true);
    });

    it("all sessions sandboxed in all mode", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "all" } },
          list: [{ id: "main" }],
        },
      };

      const mainResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });
      expect(mainResult.sandboxed).toBe(true);

      const groupResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:whatsapp:group:12345@g.us",
      });
      expect(groupResult.sandboxed).toBe(true);
    });

    it("no sessions sandboxed in off mode", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "off" } },
          list: [{ id: "main" }],
        },
      };

      const mainResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:main",
      });
      expect(mainResult.sandboxed).toBe(false);

      const groupResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:main:whatsapp:group:12345@g.us",
      });
      expect(groupResult.sandboxed).toBe(false);
    });
  });

  describe("session store isolation", () => {
    it("stores main and group sessions separately", async () => {
      const mainSessionKey = "agent:main:main";
      const groupSessionKey = "agent:main:whatsapp:group:12345@g.us";

      await updateSessionStore(storePath, (store) => {
        store[mainSessionKey] = {
          sessionId: "main-sess-1",
          updatedAt: Date.now(),
        };
        store[groupSessionKey] = {
          sessionId: "group-sess-1",
          updatedAt: Date.now(),
        };
      });

      const store = loadSessionStore(storePath);
      expect(store[mainSessionKey]?.sessionId).toBe("main-sess-1");
      expect(store[groupSessionKey]?.sessionId).toBe("group-sess-1");
      expect(Object.keys(store)).toHaveLength(2);
    });

    it("updates main session without affecting group sessions", async () => {
      const mainSessionKey = "agent:main:main";
      const groupSessionKey = "agent:main:whatsapp:group:12345@g.us";

      // Create both sessions
      await updateSessionStore(storePath, (store) => {
        store[mainSessionKey] = {
          sessionId: "main-sess-1",
          updatedAt: 1000,
          thinkingLevel: "low",
        };
        store[groupSessionKey] = {
          sessionId: "group-sess-1",
          updatedAt: 1000,
          thinkingLevel: "off",
        };
      });

      // Update only main session
      await updateSessionStore(storePath, (store) => {
        if (store[mainSessionKey]) {
          store[mainSessionKey] = {
            ...store[mainSessionKey],
            thinkingLevel: "high",
            updatedAt: 2000,
          };
        }
      });

      const store = loadSessionStore(storePath);
      expect(store[mainSessionKey]?.thinkingLevel).toBe("high");
      expect(store[groupSessionKey]?.thinkingLevel).toBe("off");
    });

    it("deletes group session without affecting main session", async () => {
      const mainSessionKey = "agent:main:main";
      const groupSessionKey = "agent:main:whatsapp:group:12345@g.us";

      // Create both sessions
      await updateSessionStore(storePath, (store) => {
        store[mainSessionKey] = { sessionId: "main-sess-1", updatedAt: 1000 };
        store[groupSessionKey] = { sessionId: "group-sess-1", updatedAt: 1000 };
      });

      // Delete only group session
      await updateSessionStore(storePath, (store) => {
        delete store[groupSessionKey];
      });

      const store = loadSessionStore(storePath);
      expect(store[mainSessionKey]?.sessionId).toBe("main-sess-1");
      expect(store[groupSessionKey]).toBeUndefined();
    });

    it("isolates multiple group sessions from each other", async () => {
      const group1Key = "agent:main:whatsapp:group:family@g.us";
      const group2Key = "agent:main:discord:group:gaming-123";
      const group3Key = "agent:main:telegram:group:-1001234567890";

      await updateSessionStore(storePath, (store) => {
        store[group1Key] = {
          sessionId: "family-sess",
          updatedAt: Date.now(),
          subject: "Family Chat",
        };
        store[group2Key] = {
          sessionId: "gaming-sess",
          updatedAt: Date.now(),
          subject: "Gaming Discord",
        };
        store[group3Key] = {
          sessionId: "telegram-sess",
          updatedAt: Date.now(),
          subject: "Telegram Group",
        };
      });

      const store = loadSessionStore(storePath);
      expect(store[group1Key]?.subject).toBe("Family Chat");
      expect(store[group2Key]?.subject).toBe("Gaming Discord");
      expect(store[group3Key]?.subject).toBe("Telegram Group");
      expect(Object.keys(store)).toHaveLength(3);
    });
  });

  describe("session metadata isolation", () => {
    it("stores channel-specific metadata per session", async () => {
      const mainSessionKey = "agent:main:main";
      const groupSessionKey = "agent:main:whatsapp:group:12345@g.us";

      await updateSessionStore(storePath, (store) => {
        store[mainSessionKey] = {
          sessionId: "main-sess",
          updatedAt: Date.now(),
          channel: "whatsapp",
          lastTo: "+15551234567",
        } satisfies SessionEntry;
        store[groupSessionKey] = {
          sessionId: "group-sess",
          updatedAt: Date.now(),
          channel: "whatsapp",
          groupId: "12345@g.us",
          subject: "Family",
          chatType: "group",
        } satisfies SessionEntry;
      });

      const store = loadSessionStore(storePath);
      expect(store[mainSessionKey]?.chatType).toBeUndefined();
      expect(store[mainSessionKey]?.groupId).toBeUndefined();
      expect(store[groupSessionKey]?.chatType).toBe("group");
      expect(store[groupSessionKey]?.groupId).toBe("12345@g.us");
    });

    it("preserves model override isolation between sessions", async () => {
      const mainSessionKey = "agent:main:main";
      const groupSessionKey = "agent:main:discord:group:123";

      await updateSessionStore(storePath, (store) => {
        store[mainSessionKey] = {
          sessionId: "main-sess",
          updatedAt: Date.now(),
          modelOverride: "anthropic/claude-opus-4-5",
        };
        store[groupSessionKey] = {
          sessionId: "group-sess",
          updatedAt: Date.now(),
          modelOverride: "anthropic/claude-sonnet-4",
        };
      });

      const store = loadSessionStore(storePath);
      expect(store[mainSessionKey]?.modelOverride).toBe("anthropic/claude-opus-4-5");
      expect(store[groupSessionKey]?.modelOverride).toBe("anthropic/claude-sonnet-4");
    });
  });

  describe("concurrent session operations isolation", () => {
    it("handles concurrent updates to different sessions", async () => {
      await Promise.all([
        updateSessionStore(storePath, (store) => {
          store["agent:main:main"] = { sessionId: "main-sess", updatedAt: 1 };
        }),
        updateSessionStore(storePath, (store) => {
          store["agent:main:whatsapp:group:1@g.us"] = { sessionId: "group1-sess", updatedAt: 2 };
        }),
        updateSessionStore(storePath, (store) => {
          store["agent:main:discord:group:123"] = { sessionId: "group2-sess", updatedAt: 3 };
        }),
      ]);

      const store = loadSessionStore(storePath);
      expect(store["agent:main:main"]?.sessionId).toBe("main-sess");
      expect(store["agent:main:whatsapp:group:1@g.us"]?.sessionId).toBe("group1-sess");
      expect(store["agent:main:discord:group:123"]?.sessionId).toBe("group2-sess");
    });

    it("preserves session isolation during concurrent mixed operations", async () => {
      // Pre-populate with initial data
      await updateSessionStore(storePath, (store) => {
        store["agent:main:main"] = { sessionId: "main-orig", updatedAt: 1 };
        store["agent:main:whatsapp:group:old@g.us"] = { sessionId: "old-group", updatedAt: 1 };
      });

      await Promise.all([
        // Update main session
        updateSessionStore(storePath, (store) => {
          if (store["agent:main:main"]) {
            store["agent:main:main"] = {
              ...store["agent:main:main"],
              updatedAt: 100,
              thinkingLevel: "high",
            };
          }
        }),
        // Delete old group session
        updateSessionStore(storePath, (store) => {
          delete store["agent:main:whatsapp:group:old@g.us"];
        }),
        // Add new group session
        updateSessionStore(storePath, (store) => {
          store["agent:main:whatsapp:group:new@g.us"] = { sessionId: "new-group", updatedAt: 200 };
        }),
      ]);

      const store = loadSessionStore(storePath);
      expect(store["agent:main:main"]?.thinkingLevel).toBe("high");
      expect(store["agent:main:whatsapp:group:old@g.us"]).toBeUndefined();
      expect(store["agent:main:whatsapp:group:new@g.us"]?.sessionId).toBe("new-group");
    });
  });

  describe("multi-agent session isolation", () => {
    it("isolates sessions across different agents", () => {
      const aliceMain = resolveAgentMainSessionKey({
        cfg: {},
        agentId: "alice",
      });
      const bobMain = resolveAgentMainSessionKey({
        cfg: {},
        agentId: "bob",
      });

      expect(aliceMain).toBe("agent:alice:main");
      expect(bobMain).toBe("agent:bob:main");
      expect(aliceMain).not.toBe(bobMain);
    });

    it("maintains agent-specific sandbox policies", () => {
      const cfg: GimliConfig = {
        agents: {
          defaults: { sandbox: { mode: "off" } },
          list: [{ id: "trusted-agent" }, { id: "untrusted-agent", sandbox: { mode: "all" } }],
        },
      };

      const trustedResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:trusted-agent:main",
      });
      expect(trustedResult.sandboxed).toBe(false);

      const untrustedResult = resolveSandboxRuntimeStatus({
        cfg,
        sessionKey: "agent:untrusted-agent:main",
      });
      expect(untrustedResult.sandboxed).toBe(true);
    });

    it("stores sessions for multiple agents separately", async () => {
      const aliceMain = "agent:alice:main";
      const bobMain = "agent:bob:main";
      const aliceGroup = "agent:alice:whatsapp:group:123@g.us";

      await updateSessionStore(storePath, (store) => {
        store[aliceMain] = { sessionId: "alice-main-sess", updatedAt: 1 };
        store[bobMain] = { sessionId: "bob-main-sess", updatedAt: 2 };
        store[aliceGroup] = { sessionId: "alice-group-sess", updatedAt: 3 };
      });

      const store = loadSessionStore(storePath);
      expect(store[aliceMain]?.sessionId).toBe("alice-main-sess");
      expect(store[bobMain]?.sessionId).toBe("bob-main-sess");
      expect(store[aliceGroup]?.sessionId).toBe("alice-group-sess");
    });
  });
});
