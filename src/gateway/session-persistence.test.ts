import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  rpcReq,
  startGatewayServer,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let previousToken: string | undefined;

beforeAll(async () => {
  previousToken = process.env.GIMLI_GATEWAY_TOKEN;
  delete process.env.GIMLI_GATEWAY_TOKEN;
  port = await getFreePort();
  server = await startGatewayServer(port);
});

afterAll(async () => {
  await server.close();
  if (previousToken === undefined) delete process.env.GIMLI_GATEWAY_TOKEN;
  else process.env.GIMLI_GATEWAY_TOKEN = previousToken;
});

const openClient = async (opts?: Parameters<typeof connectOk>[1]) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  const hello = await connectOk(ws, opts);
  return { ws, hello };
};

describe("session persistence across gateway restarts", () => {
  let testDir: string;
  let storePath: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-session-persist-"));
    storePath = path.join(testDir, "sessions.json");
    testState.sessionStorePath = storePath;
  });

  afterEach(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  test("sessions persist to disk and survive gateway restart", async () => {
    const now = Date.now();

    // Create initial session data with comprehensive metadata
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-persist-main",
          updatedAt: now,
          inputTokens: 100,
          outputTokens: 200,
          thinkingLevel: "medium",
          verboseLevel: "on",
          lastChannel: "telegram",
          lastTo: "chat123",
          lastAccountId: "bot-1",
        },
        "discord:group:test-server": {
          sessionId: "sess-persist-group",
          updatedAt: now - 60_000,
          totalTokens: 500,
          channel: "discord",
          chatType: "group",
          subject: "Test Server",
        },
        "whatsapp:group:family": {
          sessionId: "sess-persist-wa",
          updatedAt: now - 120_000,
          totalTokens: 300,
          channel: "whatsapp",
          chatType: "group",
        },
      },
    });

    // Create transcript files to simulate real session data
    await fs.writeFile(
      path.join(testDir, "sess-persist-main.jsonl"),
      [
        JSON.stringify({ type: "session", version: 1, id: "sess-persist-main" }),
        JSON.stringify({ message: { role: "user", content: "Hello before restart" } }),
        JSON.stringify({ message: { role: "assistant", content: "Hi! How can I help?" } }),
      ].join("\n") + "\n",
      "utf-8",
    );

    // First connection - verify initial state
    const { ws: ws1 } = await openClient();

    const list1 = await rpcReq<{
      sessions: Array<{
        key: string;
        sessionId?: string;
        totalTokens?: number;
        thinkingLevel?: string;
        channel?: string;
      }>;
    }>(ws1, "sessions.list", { includeGlobal: false, includeUnknown: false });

    expect(list1.ok).toBe(true);
    expect(list1.payload?.sessions.length).toBeGreaterThanOrEqual(3);

    const mainSession = list1.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainSession?.sessionId).toBe("sess-persist-main");
    expect(mainSession?.totalTokens).toBe(300); // 100 + 200
    expect(mainSession?.thinkingLevel).toBe("medium");

    const discordGroup = list1.payload?.sessions.find(
      (s) => s.key === "agent:main:discord:group:test-server",
    );
    expect(discordGroup?.sessionId).toBe("sess-persist-group");
    expect(discordGroup?.channel).toBe("discord");

    ws1.close();

    // Simulate gateway restart - close and reopen server
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect after restart
    const { ws: ws2 } = await openClient();

    // Verify sessions survived the restart
    const list2 = await rpcReq<{
      sessions: Array<{
        key: string;
        sessionId?: string;
        totalTokens?: number;
        thinkingLevel?: string;
        channel?: string;
        subject?: string;
      }>;
    }>(ws2, "sessions.list", { includeGlobal: false, includeUnknown: false });

    expect(list2.ok).toBe(true);

    // Verify main session persisted with all metadata
    const mainAfterRestart = list2.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainAfterRestart?.sessionId).toBe("sess-persist-main");
    expect(mainAfterRestart?.totalTokens).toBe(300);
    expect(mainAfterRestart?.thinkingLevel).toBe("medium");

    // Verify group session persisted
    const discordAfterRestart = list2.payload?.sessions.find(
      (s) => s.key === "agent:main:discord:group:test-server",
    );
    expect(discordAfterRestart?.sessionId).toBe("sess-persist-group");
    expect(discordAfterRestart?.subject).toBe("Test Server");

    // Verify WhatsApp group persisted
    const waAfterRestart = list2.payload?.sessions.find(
      (s) => s.key === "agent:main:whatsapp:group:family",
    );
    expect(waAfterRestart?.sessionId).toBe("sess-persist-wa");

    ws2.close();
  });

  test("session patches persist across gateway restart", async () => {
    const now = Date.now();

    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-patch-persist",
          updatedAt: now,
          thinkingLevel: "low",
          verboseLevel: "off",
        },
      },
    });

    // First connection - apply patches
    const { ws: ws1 } = await openClient();

    // Patch thinking level
    const patchResult = await rpcReq<{ ok: true; key: string }>(ws1, "sessions.patch", {
      key: "agent:main:main",
      thinkingLevel: "high",
      verboseLevel: "on",
    });
    expect(patchResult.ok).toBe(true);

    // Verify patch applied
    const list1 = await rpcReq<{
      sessions: Array<{ key: string; thinkingLevel?: string; verboseLevel?: string }>;
    }>(ws1, "sessions.list", {});

    const mainPatched = list1.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainPatched?.thinkingLevel).toBe("high");
    expect(mainPatched?.verboseLevel).toBe("on");

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify patches persisted
    const { ws: ws2 } = await openClient();

    const list2 = await rpcReq<{
      sessions: Array<{ key: string; thinkingLevel?: string; verboseLevel?: string }>;
    }>(ws2, "sessions.list", {});

    const mainAfterRestart = list2.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainAfterRestart?.thinkingLevel).toBe("high");
    expect(mainAfterRestart?.verboseLevel).toBe("on");

    ws2.close();
  });

  test("session reset creates new session ID that persists", async () => {
    const now = Date.now();
    const originalSessionId = "sess-to-reset";

    await writeSessionStore({
      entries: {
        main: {
          sessionId: originalSessionId,
          updatedAt: now,
          totalTokens: 1000,
        },
      },
    });

    // Create transcript file
    await fs.writeFile(
      path.join(testDir, `${originalSessionId}.jsonl`),
      JSON.stringify({ type: "session", version: 1, id: originalSessionId }) + "\n",
      "utf-8",
    );

    // First connection - reset the session
    const { ws: ws1 } = await openClient();

    const resetResult = await rpcReq<{
      ok: true;
      key: string;
      entry: { sessionId: string };
    }>(ws1, "sessions.reset", { key: "agent:main:main" });

    expect(resetResult.ok).toBe(true);
    expect(resetResult.payload?.entry.sessionId).not.toBe(originalSessionId);
    const newSessionId = resetResult.payload?.entry.sessionId;

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify reset persisted
    const { ws: ws2 } = await openClient();

    const list = await rpcReq<{
      sessions: Array<{ key: string; sessionId?: string }>;
    }>(ws2, "sessions.list", {});

    const mainAfterRestart = list.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainAfterRestart?.sessionId).toBe(newSessionId);
    expect(mainAfterRestart?.sessionId).not.toBe(originalSessionId);

    ws2.close();
  });

  test("session deletion persists across gateway restart", async () => {
    const now = Date.now();

    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-main-keep",
          updatedAt: now,
        },
        "discord:group:to-delete": {
          sessionId: "sess-to-delete",
          updatedAt: now - 60_000,
        },
      },
    });

    // Create transcript for session to be deleted
    await fs.writeFile(
      path.join(testDir, "sess-to-delete.jsonl"),
      JSON.stringify({ type: "session", version: 1, id: "sess-to-delete" }) + "\n",
      "utf-8",
    );

    // First connection - delete the group session
    const { ws: ws1 } = await openClient();

    const deleteResult = await rpcReq<{ ok: true; deleted: boolean }>(ws1, "sessions.delete", {
      key: "agent:main:discord:group:to-delete",
    });
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.payload?.deleted).toBe(true);

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify deletion persisted
    const { ws: ws2 } = await openClient();

    const list = await rpcReq<{
      sessions: Array<{ key: string }>;
    }>(ws2, "sessions.list", { includeGlobal: false, includeUnknown: false });

    expect(list.ok).toBe(true);

    // Main session should still exist
    expect(list.payload?.sessions.some((s) => s.key === "agent:main:main")).toBe(true);

    // Deleted session should not exist
    expect(list.payload?.sessions.some((s) => s.key === "agent:main:discord:group:to-delete")).toBe(
      false,
    );

    ws2.close();
  });

  test("multiple sessions persist independently across restart", async () => {
    const now = Date.now();

    // Create multiple sessions across different channels
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-multi-main",
          updatedAt: now,
          thinkingLevel: "high",
        },
        "telegram:group:family": {
          sessionId: "sess-multi-tg",
          updatedAt: now - 30_000,
          channel: "telegram",
          chatType: "group",
        },
        "discord:group:gaming": {
          sessionId: "sess-multi-discord",
          updatedAt: now - 60_000,
          channel: "discord",
          chatType: "group",
        },
        "slack:channel:engineering": {
          sessionId: "sess-multi-slack",
          updatedAt: now - 90_000,
          channel: "slack",
          chatType: "channel",
        },
      },
    });

    // First connection - verify all sessions exist
    const { ws: ws1 } = await openClient();

    const list1 = await rpcReq<{
      sessions: Array<{ key: string; sessionId?: string; channel?: string }>;
    }>(ws1, "sessions.list", { includeGlobal: false, includeUnknown: false });

    expect(list1.ok).toBe(true);
    expect(list1.payload?.sessions.length).toBeGreaterThanOrEqual(4);

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify all sessions persisted
    const { ws: ws2 } = await openClient();

    const list2 = await rpcReq<{
      sessions: Array<{ key: string; sessionId?: string; channel?: string }>;
    }>(ws2, "sessions.list", { includeGlobal: false, includeUnknown: false });

    expect(list2.ok).toBe(true);

    // Verify each session persisted with correct channel info
    const mainSession = list2.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(mainSession?.sessionId).toBe("sess-multi-main");

    const tgSession = list2.payload?.sessions.find(
      (s) => s.key === "agent:main:telegram:group:family",
    );
    expect(tgSession?.sessionId).toBe("sess-multi-tg");
    expect(tgSession?.channel).toBe("telegram");

    const discordSession = list2.payload?.sessions.find(
      (s) => s.key === "agent:main:discord:group:gaming",
    );
    expect(discordSession?.sessionId).toBe("sess-multi-discord");

    const slackSession = list2.payload?.sessions.find(
      (s) => s.key === "agent:main:slack:channel:engineering",
    );
    expect(slackSession?.sessionId).toBe("sess-multi-slack");
    expect(slackSession?.channel).toBe("slack");

    ws2.close();
  });

  test("session store survives corrupt file gracefully on restart", async () => {
    const now = Date.now();

    // First, create valid sessions
    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-before-corrupt",
          updatedAt: now,
        },
      },
    });

    // Verify session exists
    const { ws: ws1 } = await openClient();
    const list1 = await rpcReq<{
      sessions: Array<{ key: string }>;
    }>(ws1, "sessions.list", {});
    expect(list1.payload?.sessions.some((s) => s.key === "agent:main:main")).toBe(true);
    ws1.close();

    // Restart gateway
    await server.close();

    // Corrupt the session store file
    await fs.writeFile(storePath, "{ invalid json here", "utf-8");

    port = await getFreePort();
    server = await startGatewayServer(port);

    // Gateway should start successfully despite corrupt file
    const { ws: ws2 } = await openClient();

    // Sessions list should return empty (graceful degradation)
    const list2 = await rpcReq<{
      sessions: Array<{ key: string }>;
    }>(ws2, "sessions.list", {});

    expect(list2.ok).toBe(true);
    // Should return empty since corrupt file is treated as empty
    expect(list2.payload?.sessions.length).toBe(0);

    ws2.close();
  });

  test("session delivery context persists across restart", async () => {
    const now = Date.now();

    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-delivery-persist",
          updatedAt: now,
          lastChannel: "whatsapp",
          lastTo: "+15551234567",
          lastAccountId: "work-phone",
          lastThreadId: "thread-abc",
        },
      },
    });

    // First connection - verify delivery context
    const { ws: ws1 } = await openClient();

    const list1 = await rpcReq<{
      sessions: Array<{
        key: string;
        deliveryContext?: {
          channel?: string;
          to?: string;
          accountId?: string;
          threadId?: string;
        };
      }>;
    }>(ws1, "sessions.list", {});

    const main1 = list1.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(main1?.deliveryContext?.channel).toBe("whatsapp");
    expect(main1?.deliveryContext?.to).toBe("+15551234567");
    expect(main1?.deliveryContext?.accountId).toBe("work-phone");

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify delivery context persisted
    const { ws: ws2 } = await openClient();

    const list2 = await rpcReq<{
      sessions: Array<{
        key: string;
        deliveryContext?: {
          channel?: string;
          to?: string;
          accountId?: string;
        };
      }>;
    }>(ws2, "sessions.list", {});

    const main2 = list2.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(main2?.deliveryContext?.channel).toBe("whatsapp");
    expect(main2?.deliveryContext?.to).toBe("+15551234567");
    expect(main2?.deliveryContext?.accountId).toBe("work-phone");

    ws2.close();
  });

  test("session token usage accumulates and persists", async () => {
    const now = Date.now();

    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-tokens-persist",
          updatedAt: now,
          inputTokens: 500,
          outputTokens: 1000,
        },
      },
    });

    // First connection - verify token counts
    const { ws: ws1 } = await openClient();

    const list1 = await rpcReq<{
      sessions: Array<{
        key: string;
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }>;
    }>(ws1, "sessions.list", {});

    const main1 = list1.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(main1?.inputTokens).toBe(500);
    expect(main1?.outputTokens).toBe(1000);
    expect(main1?.totalTokens).toBe(1500);

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify token counts persisted
    const { ws: ws2 } = await openClient();

    const list2 = await rpcReq<{
      sessions: Array<{
        key: string;
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
      }>;
    }>(ws2, "sessions.list", {});

    const main2 = list2.payload?.sessions.find((s) => s.key === "agent:main:main");
    expect(main2?.inputTokens).toBe(500);
    expect(main2?.outputTokens).toBe(1000);
    expect(main2?.totalTokens).toBe(1500);

    ws2.close();
  });

  test("spawned session relationships persist across restart", async () => {
    const now = Date.now();

    await writeSessionStore({
      entries: {
        main: {
          sessionId: "sess-parent",
          updatedAt: now,
        },
        "agent:main:subagent:research": {
          sessionId: "sess-child-research",
          updatedAt: now - 30_000,
          spawnedBy: "agent:main:main",
          label: "Research Task",
        },
        "agent:main:subagent:analysis": {
          sessionId: "sess-child-analysis",
          updatedAt: now - 60_000,
          spawnedBy: "agent:main:main",
          label: "Analysis Task",
        },
      },
    });

    // First connection - verify spawned relationships
    const { ws: ws1 } = await openClient();

    const spawnedList = await rpcReq<{
      sessions: Array<{ key: string; label?: string }>;
    }>(ws1, "sessions.list", {
      spawnedBy: "agent:main:main",
    });

    expect(spawnedList.ok).toBe(true);
    expect(spawnedList.payload?.sessions.length).toBe(2);
    expect(spawnedList.payload?.sessions.some((s) => s.label === "Research Task")).toBe(true);
    expect(spawnedList.payload?.sessions.some((s) => s.label === "Analysis Task")).toBe(true);

    ws1.close();

    // Restart gateway
    await server.close();
    port = await getFreePort();
    server = await startGatewayServer(port);

    // Reconnect and verify relationships persisted
    const { ws: ws2 } = await openClient();

    const spawnedList2 = await rpcReq<{
      sessions: Array<{ key: string; label?: string }>;
    }>(ws2, "sessions.list", {
      spawnedBy: "agent:main:main",
    });

    expect(spawnedList2.ok).toBe(true);
    expect(spawnedList2.payload?.sessions.length).toBe(2);
    expect(spawnedList2.payload?.sessions.some((s) => s.label === "Research Task")).toBe(true);
    expect(spawnedList2.payload?.sessions.some((s) => s.label === "Analysis Task")).toBe(true);

    ws2.close();
  });
});
