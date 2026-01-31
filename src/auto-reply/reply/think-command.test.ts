import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GimliConfig } from "../../config/config.js";
import { saveSessionStore, type SessionEntry } from "../../config/sessions.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";
import { extractThinkDirective } from "./directives.js";
import { persistInlineDirectives } from "./directive-handling.persist.js";
import { listThinkingLevels, normalizeThinkLevel, type ThinkLevel } from "../thinking.js";

let testWorkspaceDir = os.tmpdir();
let testStorePath = "";

beforeAll(async () => {
  testWorkspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-think-command-"));
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
    provider: "anthropic",
    model: "claude-opus-4",
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

describe("extractThinkDirective - level parsing", () => {
  it("parses /think off", () => {
    const res = extractThinkDirective("/think off");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("off");
    expect(res.cleaned).toBe("");
  });

  it("parses /think minimal", () => {
    const res = extractThinkDirective("/think minimal");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("minimal");
    expect(res.cleaned).toBe("");
  });

  it("parses /think low", () => {
    const res = extractThinkDirective("/think low");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("low");
    expect(res.cleaned).toBe("");
  });

  it("parses /think medium", () => {
    const res = extractThinkDirective("/think medium");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("medium");
    expect(res.cleaned).toBe("");
  });

  it("parses /think high", () => {
    const res = extractThinkDirective("/think high");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("high");
    expect(res.cleaned).toBe("");
  });

  it("parses /think xhigh", () => {
    const res = extractThinkDirective("/think xhigh");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("xhigh");
    expect(res.cleaned).toBe("");
  });
});

describe("extractThinkDirective - aliases", () => {
  it("parses /thinking as an alias for /think", () => {
    const res = extractThinkDirective("/thinking high");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("high");
  });

  it("parses /t as an alias for /think", () => {
    const res = extractThinkDirective("/t low");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("low");
  });

  it("parses /think:high (colon variant)", () => {
    const res = extractThinkDirective("/think:high");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("high");
  });

  it("parses /t: medium (colon with space)", () => {
    const res = extractThinkDirective("/t: medium");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("medium");
  });
});

describe("extractThinkDirective - with message body", () => {
  it("extracts think directive from message start", () => {
    const res = extractThinkDirective("/think high please help me");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("high");
    expect(res.cleaned).toBe("please help me");
  });

  it("extracts think directive from message middle", () => {
    const res = extractThinkDirective("please /think low help me");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("low");
    expect(res.cleaned).toBe("please help me");
  });

  it("extracts think directive from message end", () => {
    const res = extractThinkDirective("help me please /think medium");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBe("medium");
    expect(res.cleaned).toBe("help me please");
  });
});

describe("normalizeThinkLevel - level synonyms", () => {
  it("normalizes on to low", () => {
    expect(normalizeThinkLevel("on")).toBe("low");
  });

  it("normalizes enable to low", () => {
    expect(normalizeThinkLevel("enable")).toBe("low");
  });

  it("normalizes min to minimal", () => {
    expect(normalizeThinkLevel("min")).toBe("minimal");
  });

  it("normalizes mid to medium", () => {
    expect(normalizeThinkLevel("mid")).toBe("medium");
  });

  it("normalizes med to medium", () => {
    expect(normalizeThinkLevel("med")).toBe("medium");
  });

  it("normalizes ultra to high", () => {
    expect(normalizeThinkLevel("ultra")).toBe("high");
  });

  it("normalizes max to high", () => {
    expect(normalizeThinkLevel("max")).toBe("high");
  });

  it("normalizes x-high to xhigh", () => {
    expect(normalizeThinkLevel("x-high")).toBe("xhigh");
  });

  it("returns undefined for invalid level", () => {
    expect(normalizeThinkLevel("invalid")).toBeUndefined();
    expect(normalizeThinkLevel("")).toBeUndefined();
    expect(normalizeThinkLevel(null)).toBeUndefined();
    expect(normalizeThinkLevel(undefined)).toBeUndefined();
  });
});

describe("listThinkingLevels", () => {
  it("returns base levels for standard models", () => {
    const levels = listThinkingLevels("anthropic", "claude-opus-4");
    expect(levels).toContain("off");
    expect(levels).toContain("minimal");
    expect(levels).toContain("low");
    expect(levels).toContain("medium");
    expect(levels).toContain("high");
    expect(levels).not.toContain("xhigh");
  });

  it("includes xhigh for gpt-5.2 model", () => {
    const levels = listThinkingLevels("openai", "gpt-5.2");
    expect(levels).toContain("xhigh");
  });

  it("includes xhigh for gpt-5.2-codex model", () => {
    const levels = listThinkingLevels("openai-codex", "gpt-5.2-codex");
    expect(levels).toContain("xhigh");
  });

  it("includes xhigh for gpt-5.1-codex model", () => {
    const levels = listThinkingLevels("openai-codex", "gpt-5.1-codex");
    expect(levels).toContain("xhigh");
  });
});

describe("parseInlineDirectives - /think command", () => {
  it("detects /think high as a directive", () => {
    const directives = parseInlineDirectives("/think high");
    expect(directives.hasThinkDirective).toBe(true);
    expect(directives.thinkLevel).toBe("high");
    expect(directives.cleaned).toBe("");
  });

  it("detects /think off as a directive", () => {
    const directives = parseInlineDirectives("/think off");
    expect(directives.hasThinkDirective).toBe(true);
    expect(directives.thinkLevel).toBe("off");
    expect(directives.cleaned).toBe("");
  });

  it("detects /t minimal as a directive", () => {
    const directives = parseInlineDirectives("/t minimal");
    expect(directives.hasThinkDirective).toBe(true);
    expect(directives.thinkLevel).toBe("minimal");
    expect(directives.cleaned).toBe("");
  });

  it("preserves message body after stripping think directive", () => {
    const directives = parseInlineDirectives("/think medium please help");
    expect(directives.hasThinkDirective).toBe(true);
    expect(directives.thinkLevel).toBe("medium");
    expect(directives.cleaned).toBe("please help");
  });
});

describe("persistInlineDirectives - thinking level", () => {
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

  async function seedAndPersist(level: ThinkLevel, sessionKey: string, sessionEntry: SessionEntry) {
    const sessionStore: Record<string, SessionEntry> = {
      [sessionKey]: sessionEntry,
    };
    await saveSessionStore(testStorePath, sessionStore);

    const directives = parseInlineDirectives(`/think ${level}`);
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;

    await persistInlineDirectives({
      directives,
      cfg,
      sessionEntry,
      sessionStore,
      sessionKey,
      storePath: testStorePath,
      elevatedEnabled: true,
      elevatedAllowed: true,
      defaultProvider: "anthropic",
      defaultModel: "claude-opus-4",
      aliasIndex: new Map(),
      allowedModelKeys: new Set(),
      provider: "anthropic",
      model: "claude-opus-4",
      initialModelLabel: "anthropic/claude-opus-4",
      formatModelSwitchEvent: (label: string) => `Switched to ${label}`,
      agentCfg: undefined,
    });

    return sessionEntry;
  }

  it("persists /think low to session entry", async () => {
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "test-123", updatedAt: Date.now() };
    await seedAndPersist("low", sessionKey, sessionEntry);
    expect(sessionEntry.thinkingLevel).toBe("low");
  });

  it("persists /think medium to session entry", async () => {
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "test-123", updatedAt: Date.now() };
    await seedAndPersist("medium", sessionKey, sessionEntry);
    expect(sessionEntry.thinkingLevel).toBe("medium");
  });

  it("persists /think high to session entry", async () => {
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = { sessionId: "test-123", updatedAt: Date.now() };
    await seedAndPersist("high", sessionKey, sessionEntry);
    expect(sessionEntry.thinkingLevel).toBe("high");
  });

  it("removes thinking level when set to off", async () => {
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "test-123",
      updatedAt: Date.now(),
      thinkingLevel: "high",
    };
    await seedAndPersist("off", sessionKey, sessionEntry);
    expect(sessionEntry.thinkingLevel).toBeUndefined();
  });

  it("updates existing thinking level", async () => {
    const sessionKey = "agent:main:main";
    const sessionEntry: SessionEntry = {
      sessionId: "test-123",
      updatedAt: Date.now(),
      thinkingLevel: "low",
    };
    await seedAndPersist("high", sessionKey, sessionEntry);
    expect(sessionEntry.thinkingLevel).toBe("high");
  });
});

describe("handleCommands - /think directive-only", () => {
  it("/think high alone continues to agent with directive applied", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/think high", cfg);

    await handleCommands(params);

    // Directive-only messages continue to agent (for acknowledgment)
    // but the directive should be detected
    expect(params.directives.hasThinkDirective).toBe(true);
    expect(params.directives.thinkLevel).toBe("high");
  });

  it("/t low with message body continues to agent", async () => {
    const cfg = {
      commands: { text: true },
      channels: { whatsapp: { allowFrom: ["*"] } },
    } as GimliConfig;
    const params = buildParams("/t low help me think", cfg);

    const result = await handleCommands(params);

    expect(params.directives.hasThinkDirective).toBe(true);
    expect(params.directives.thinkLevel).toBe("low");
    expect(params.directives.cleaned).toBe("help me think");
    // Should continue to agent with the cleaned body
    expect(result.shouldContinue).toBe(true);
  });
});

describe("/think command - edge cases", () => {
  it("handles /think without level argument", () => {
    const res = extractThinkDirective("/think");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBeUndefined();
    expect(res.rawLevel).toBeUndefined();
  });

  it("handles /think: with no level", () => {
    const res = extractThinkDirective("/think:");
    expect(res.hasDirective).toBe(true);
    expect(res.thinkLevel).toBeUndefined();
    expect(res.cleaned).toBe("");
  });

  it("handles /think with invalid level", () => {
    const res = extractThinkDirective("/think invalid");
    expect(res.hasDirective).toBe(true);
    expect(res.rawLevel).toBe("invalid");
    expect(res.thinkLevel).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(extractThinkDirective("/THINK HIGH").thinkLevel).toBe("high");
    expect(extractThinkDirective("/Think Low").thinkLevel).toBe("low");
    expect(extractThinkDirective("/THINKING MEDIUM").thinkLevel).toBe("medium");
  });

  it("does not match /think followed by extra letters", () => {
    const res = extractThinkDirective("/thinkstuff");
    expect(res.hasDirective).toBe(false);
  });

  it("does not match /think inside a URL", () => {
    const res = extractThinkDirective("see https://example.com/path/thinkstuff");
    expect(res.hasDirective).toBe(false);
  });
});

describe("/think levels - full coverage", () => {
  const ALL_LEVELS: ThinkLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

  for (const level of ALL_LEVELS) {
    it(`normalizes and parses /think ${level}`, () => {
      const normalized = normalizeThinkLevel(level);
      expect(normalized).toBe(level);

      const res = extractThinkDirective(`/think ${level}`);
      expect(res.hasDirective).toBe(true);
      expect(res.thinkLevel).toBe(level);
    });
  }
});
