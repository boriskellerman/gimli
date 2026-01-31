import { createServer } from "node:net";
import http from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { rawDataToString } from "../infra/ws.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";

// Find a free localhost port for ad-hoc WS servers.
async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe("WebSocket accessibility", () => {
  let wss: WebSocketServer | null = null;
  let httpServer: http.Server | null = null;

  afterEach(async () => {
    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss?.close(() => resolve()));
      wss = null;
    }
    if (httpServer) {
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
      httpServer = null;
    }
  });

  test("accepts WebSocket upgrade on loopback address", async () => {
    const port = await getFreePort();
    httpServer = http.createServer();
    wss = new WebSocketServer({ server: httpServer });

    await new Promise<void>((resolve) => {
      httpServer!.listen(port, "127.0.0.1", resolve);
    });

    // Test WebSocket upgrade via raw HTTP request
    const upgradeResult = await new Promise<{
      statusCode: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        path: "/",
        method: "GET",
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": "13",
        },
        timeout: 5000,
      });

      req.on("upgrade", (res, socket) => {
        socket.end();
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timed out"));
      });

      req.end();
    });

    expect(upgradeResult.statusCode).toBe(101);
    expect(upgradeResult.headers.upgrade?.toLowerCase()).toBe("websocket");
    expect(upgradeResult.headers.connection?.toLowerCase()).toBe("upgrade");
    expect(upgradeResult.headers["sec-websocket-accept"]).toBeDefined();
  });

  test("WebSocket connection opens on 127.0.0.1", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  test("multiple concurrent WebSocket connections on loopback", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });

    const connections: WebSocket[] = [];
    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      connections.push(ws);
    }

    // All connections should be open
    for (const ws of connections) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    }

    // Server should track all clients
    expect(wss.clients.size).toBe(3);

    // Clean up
    for (const ws of connections) {
      ws.close();
    }
  });

  test("WebSocket can send and receive messages", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });

    // Echo server
    wss.on("connection", (socket) => {
      socket.on("message", (data) => {
        const msg = JSON.parse(rawDataToString(data)) as { type?: string; id?: string };
        if (msg.type === "req") {
          socket.send(JSON.stringify({ type: "res", id: msg.id, ok: true }));
        }
      });
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    // Send request and await response
    const responsePromise = new Promise<{ type: string; id: string; ok: boolean }>((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(rawDataToString(data)));
      });
    });

    ws.send(JSON.stringify({ type: "req", id: "test-1", method: "ping" }));

    const response = await responsePromise;
    expect(response.type).toBe("res");
    expect(response.id).toBe("test-1");
    expect(response.ok).toBe(true);

    ws.close();
  });

  test("WebSocket closes gracefully", async () => {
    const port = await getFreePort();
    wss = new WebSocketServer({ port, host: "127.0.0.1" });

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const closePromise = new Promise<number>((resolve) => {
      ws.once("close", resolve);
    });

    ws.close(1000, "Normal closure");
    const closeCode = await closePromise;

    expect([1000, 1001, 1005]).toContain(closeCode);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  test("WebSocket protocol version is current", () => {
    // Verify the protocol version constant is defined and reasonable
    expect(PROTOCOL_VERSION).toBeDefined();
    expect(typeof PROTOCOL_VERSION).toBe("number");
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
