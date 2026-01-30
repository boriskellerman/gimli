import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";

import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";

import {
  connectOk,
  connectReq,
  installGatewayTestHooks,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: WebSocket;
let port: number;

beforeAll(async () => {
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  port = started.port;
  await connectOk(ws);
});

afterAll(async () => {
  ws.close();
  await server.close();
});

describe("webchat connection via gateway", () => {
  describe("webchat client identification", () => {
    test("webchat client connects with WEBCHAT mode", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.type).toBe("hello-ok");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client connects with WEBCHAT client id", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.type).toBe("hello-ok");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client connects with control-ui id and webchat mode", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.CONTROL_UI,
            version: "dev",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.type).toBe("hello-ok");
      } finally {
        webchatWs.close();
      }
    });
  });

  describe("webchat client authentication", () => {
    test("webchat client authenticates with valid token", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.type).toBe("hello-ok");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client rejected with invalid token", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectReq(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
          token: "invalid-token",
          skipDefaultAuth: true,
          device: null,
        });
        expect(res.ok).toBe(false);
        expect(res.error?.message).toMatch(/auth|token|unauthorized/i);
      } finally {
        webchatWs.close();
      }
    });
  });

  describe("webchat chat.send functionality", () => {
    test("webchat client can send chat message", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "main",
          message: "hello from webchat",
          idempotencyKey: "webchat-test-1",
        });
        expect(sendRes.ok).toBe(true);
        expect(sendRes.payload).toHaveProperty("runId");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client can send message to subagent session", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "agent:main:subagent:test",
          message: "hello subagent",
          idempotencyKey: "webchat-subagent-1",
        });
        expect(sendRes.ok).toBe(true);
        expect(sendRes.payload).toHaveProperty("runId");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client can send message with thinking directive", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "main",
          message: "analyze this problem",
          thinking: "high",
          idempotencyKey: "webchat-thinking-1",
        });
        expect(sendRes.ok).toBe(true);
        expect(sendRes.payload).toHaveProperty("runId");
      } finally {
        webchatWs.close();
      }
    });
  });

  describe("webchat chat.history functionality", () => {
    test("webchat client can retrieve chat history", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-webchat-"));
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        testState.sessionStorePath = path.join(dir, "sessions.json");
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-webchat-history",
              updatedAt: Date.now(),
            },
          },
        });

        // Create a transcript file with test messages
        const lines: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          lines.push(
            JSON.stringify({
              message: {
                role: i % 2 === 0 ? "user" : "assistant",
                content: [{ type: "text", text: `message ${i}` }],
                timestamp: Date.now() + i,
              },
            }),
          );
        }
        await fs.writeFile(path.join(dir, "sess-webchat-history.jsonl"), lines.join("\n"), "utf-8");

        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const historyRes = await rpcReq<{ sessionKey: string; messages: unknown[] }>(
          webchatWs,
          "chat.history",
          {
            sessionKey: "main",
          },
        );
        expect(historyRes.ok).toBe(true);
        expect(historyRes.payload?.sessionKey).toBe("main");
        expect(historyRes.payload?.messages).toHaveLength(5);
      } finally {
        webchatWs.close();
        testState.sessionStorePath = undefined;
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    test("webchat client can retrieve history with limit", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-webchat-"));
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        testState.sessionStorePath = path.join(dir, "sessions.json");
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-webchat-limit",
              updatedAt: Date.now(),
            },
          },
        });

        // Create 10 messages
        const lines: string[] = [];
        for (let i = 0; i < 10; i += 1) {
          lines.push(
            JSON.stringify({
              message: {
                role: "user",
                content: [{ type: "text", text: `message ${i}` }],
                timestamp: Date.now() + i,
              },
            }),
          );
        }
        await fs.writeFile(path.join(dir, "sess-webchat-limit.jsonl"), lines.join("\n"), "utf-8");

        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const historyRes = await rpcReq<{ messages: unknown[] }>(webchatWs, "chat.history", {
          sessionKey: "main",
          limit: 5,
        });
        expect(historyRes.ok).toBe(true);
        expect(historyRes.payload?.messages).toHaveLength(5);
      } finally {
        webchatWs.close();
        testState.sessionStorePath = undefined;
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("webchat chat.abort functionality", () => {
    test("webchat client can abort chat run", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const abortRes = await rpcReq(webchatWs, "chat.abort", {
          sessionKey: "main",
        });
        expect(abortRes.ok).toBe(true);
        expect(abortRes.payload).toHaveProperty("ok");
        expect(abortRes.payload).toHaveProperty("aborted");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client can abort specific run by id", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const abortRes = await rpcReq(webchatWs, "chat.abort", {
          sessionKey: "main",
          runId: "specific-run-id",
        });
        expect(abortRes.ok).toBe(true);
      } finally {
        webchatWs.close();
      }
    });
  });

  describe("webchat multiple concurrent connections", () => {
    test("multiple webchat clients can connect simultaneously", async () => {
      const webchatWs1 = new WebSocket(`ws://127.0.0.1:${port}`);
      const webchatWs2 = new WebSocket(`ws://127.0.0.1:${port}`);
      const webchatWs3 = new WebSocket(`ws://127.0.0.1:${port}`);

      await Promise.all([
        new Promise<void>((resolve) => webchatWs1.once("open", resolve)),
        new Promise<void>((resolve) => webchatWs2.once("open", resolve)),
        new Promise<void>((resolve) => webchatWs3.once("open", resolve)),
      ]);

      try {
        const [res1, res2, res3] = await Promise.all([
          connectOk(webchatWs1, {
            client: {
              id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
              version: "1.0.0",
              platform: "web",
              mode: GATEWAY_CLIENT_MODES.WEBCHAT,
              instanceId: "instance-1",
            },
          }),
          connectOk(webchatWs2, {
            client: {
              id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
              version: "1.0.0",
              platform: "web",
              mode: GATEWAY_CLIENT_MODES.WEBCHAT,
              instanceId: "instance-2",
            },
          }),
          connectOk(webchatWs3, {
            client: {
              id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
              version: "1.0.0",
              platform: "web",
              mode: GATEWAY_CLIENT_MODES.WEBCHAT,
              instanceId: "instance-3",
            },
          }),
        ]);

        expect(res1.type).toBe("hello-ok");
        expect(res2.type).toBe("hello-ok");
        expect(res3.type).toBe("hello-ok");
      } finally {
        webchatWs1.close();
        webchatWs2.close();
        webchatWs3.close();
      }
    });

    test("multiple webchat clients can send messages independently", async () => {
      const webchatWs1 = new WebSocket(`ws://127.0.0.1:${port}`);
      const webchatWs2 = new WebSocket(`ws://127.0.0.1:${port}`);

      await Promise.all([
        new Promise<void>((resolve) => webchatWs1.once("open", resolve)),
        new Promise<void>((resolve) => webchatWs2.once("open", resolve)),
      ]);

      try {
        await Promise.all([
          connectOk(webchatWs1, {
            client: {
              id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
              version: "1.0.0",
              platform: "web",
              mode: GATEWAY_CLIENT_MODES.WEBCHAT,
              instanceId: "multi-1",
            },
          }),
          connectOk(webchatWs2, {
            client: {
              id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
              version: "1.0.0",
              platform: "web",
              mode: GATEWAY_CLIENT_MODES.WEBCHAT,
              instanceId: "multi-2",
            },
          }),
        ]);

        const [sendRes1, sendRes2] = await Promise.all([
          rpcReq(webchatWs1, "chat.send", {
            sessionKey: "main",
            message: "hello from client 1",
            idempotencyKey: "webchat-multi-1",
          }),
          rpcReq(webchatWs2, "chat.send", {
            sessionKey: "main",
            message: "hello from client 2",
            idempotencyKey: "webchat-multi-2",
          }),
        ]);

        expect(sendRes1.ok).toBe(true);
        expect(sendRes2.ok).toBe(true);
        expect(sendRes1.payload).toHaveProperty("runId");
        expect(sendRes2.payload).toHaveProperty("runId");
      } finally {
        webchatWs1.close();
        webchatWs2.close();
      }
    });
  });

  describe("webchat event broadcasting", () => {
    test("webchat client receives chat events", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-webchat-"));
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        testState.sessionStorePath = path.join(dir, "sessions.json");
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-webchat-events",
              updatedAt: Date.now(),
            },
          },
        });

        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        // Send a slash command which generates a direct chat event
        const eventPromise = onceMessage(
          webchatWs,
          (o) =>
            typeof o === "object" &&
            o !== null &&
            (o as Record<string, unknown>).type === "event" &&
            (o as Record<string, unknown>).event === "chat" &&
            ((o as Record<string, unknown>).payload as Record<string, unknown> | undefined)
              ?.runId === "webchat-event-test",
          8000,
        );

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "main",
          message: "/context list",
          idempotencyKey: "webchat-event-test",
        });
        expect(sendRes.ok).toBe(true);

        const evt = await eventPromise;
        expect(evt).toHaveProperty("type", "event");
        expect(evt).toHaveProperty("event", "chat");
      } finally {
        webchatWs.close();
        testState.sessionStorePath = undefined;
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("webchat sessions.list functionality", () => {
    test("webchat client can list sessions", async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-webchat-"));
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        testState.sessionStorePath = path.join(dir, "sessions.json");
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-main",
              updatedAt: Date.now(),
            },
            "agent:main:subagent:test": {
              sessionId: "sess-subagent",
              updatedAt: Date.now(),
            },
          },
        });

        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const listRes = await rpcReq<{ sessions: unknown[] }>(webchatWs, "sessions.list", {});
        expect(listRes.ok).toBe(true);
        expect(Array.isArray(listRes.payload?.sessions)).toBe(true);
      } finally {
        webchatWs.close();
        testState.sessionStorePath = undefined;
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("webchat connection lifecycle", () => {
    test("webchat client can disconnect and reconnect", async () => {
      const webchatWs1 = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs1.once("open", resolve));

      await connectOk(webchatWs1, {
        client: {
          id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
          version: "1.0.0",
          platform: "web",
          mode: GATEWAY_CLIENT_MODES.WEBCHAT,
        },
      });

      webchatWs1.close();
      await new Promise<void>((resolve) => webchatWs1.once("close", resolve));

      // Reconnect
      const webchatWs2 = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs2.once("open", resolve));

      try {
        const res = await connectOk(webchatWs2, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.type).toBe("hello-ok");
      } finally {
        webchatWs2.close();
      }
    });

    test("webchat hello-ok contains expected fields", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        const res = await connectReq(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });
        expect(res.ok).toBe(true);

        const payload = res.payload as Record<string, unknown>;
        expect(payload.type).toBe("hello-ok");
        expect(payload).toHaveProperty("protocol");
        expect(payload).toHaveProperty("server");
        expect(payload).toHaveProperty("features");
      } finally {
        webchatWs.close();
      }
    });
  });

  describe("webchat image attachments", () => {
    test("webchat client can send message with image attachment", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const pngB64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "main",
          message: "analyze this image",
          idempotencyKey: "webchat-image-1",
          attachments: [
            {
              type: "image",
              mimeType: "image/png",
              fileName: "test.png",
              content: `data:image/png;base64,${pngB64}`,
            },
          ],
        });
        expect(sendRes.ok).toBe(true);
        expect(sendRes.payload).toHaveProperty("runId");
      } finally {
        webchatWs.close();
      }
    });

    test("webchat client can send image-only message", async () => {
      const webchatWs = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve) => webchatWs.once("open", resolve));

      try {
        await connectOk(webchatWs, {
          client: {
            id: GATEWAY_CLIENT_NAMES.WEBCHAT_UI,
            version: "1.0.0",
            platform: "web",
            mode: GATEWAY_CLIENT_MODES.WEBCHAT,
          },
        });

        const pngB64 =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/woAAn8B9FD5fHAAAAAASUVORK5CYII=";

        const sendRes = await rpcReq(webchatWs, "chat.send", {
          sessionKey: "main",
          message: "",
          idempotencyKey: "webchat-image-only-1",
          attachments: [
            {
              type: "image",
              mimeType: "image/png",
              fileName: "test.png",
              content: `data:image/png;base64,${pngB64}`,
            },
          ],
        });
        expect(sendRes.ok).toBe(true);
        expect(sendRes.payload).toHaveProperty("runId");
      } finally {
        webchatWs.close();
      }
    });
  });
});
