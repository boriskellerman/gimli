import { type AddressInfo, createServer } from "node:net";
import { fetch as realFetch } from "undici";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Browser Tool Integration Tests
 *
 * These tests verify the browser tool correctly:
 * 1. Launches Chromium via the control server
 * 2. Reports running status after browser starts
 * 3. Takes snapshots (AI and aria formats)
 * 4. Manages tabs (list, open, focus, close)
 * 5. Navigates to URLs
 * 6. Handles screenshot capture
 *
 * The tests validate the full integration flow from agent tool
 * through the browser control server layer.
 */

let testPort = 0;
let cdpBaseUrl = "";
let reachable = false;
let prevGatewayPort: string | undefined;
let launchCallCount = 0;
let stopCallCount = 0;

const cdpMocks = vi.hoisted(() => ({
  createTargetViaCdp: vi.fn(async () => {
    throw new Error("cdp disabled");
  }),
  snapshotAria: vi.fn(async () => ({
    nodes: [
      { ref: "1", role: "document", name: "Example Page", depth: 0 },
      { ref: "2", role: "heading", name: "Welcome", depth: 1 },
      { ref: "3", role: "link", name: "Click me", depth: 1 },
      { ref: "4", role: "button", name: "Submit", depth: 1 },
    ],
  })),
}));

const pwMocks = vi.hoisted(() => ({
  armDialogViaPlaywright: vi.fn(async () => {}),
  armFileUploadViaPlaywright: vi.fn(async () => {}),
  clickViaPlaywright: vi.fn(async () => {}),
  closePageViaPlaywright: vi.fn(async () => {}),
  closePlaywrightBrowserConnection: vi.fn(async () => {}),
  downloadViaPlaywright: vi.fn(async () => ({
    url: "https://example.com/report.pdf",
    suggestedFilename: "report.pdf",
    path: "/tmp/report.pdf",
  })),
  dragViaPlaywright: vi.fn(async () => {}),
  evaluateViaPlaywright: vi.fn(async () => "ok"),
  fillFormViaPlaywright: vi.fn(async () => {}),
  getConsoleMessagesViaPlaywright: vi.fn(async () => []),
  hoverViaPlaywright: vi.fn(async () => {}),
  scrollIntoViewViaPlaywright: vi.fn(async () => {}),
  navigateViaPlaywright: vi.fn(async () => ({ url: "https://example.com" })),
  pdfViaPlaywright: vi.fn(async () => ({ buffer: Buffer.from("pdf") })),
  pressKeyViaPlaywright: vi.fn(async () => {}),
  responseBodyViaPlaywright: vi.fn(async () => ({
    url: "https://example.com/api/data",
    status: 200,
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
  })),
  resizeViewportViaPlaywright: vi.fn(async () => {}),
  selectOptionViaPlaywright: vi.fn(async () => {}),
  setInputFilesViaPlaywright: vi.fn(async () => {}),
  snapshotAiViaPlaywright: vi.fn(async () => ({
    snapshot:
      "- document: Example Page\n  - heading: Welcome\n  - link: Click me [ref=e1]\n  - button: Submit [ref=e2]",
    refs: {
      e1: { role: "link", name: "Click me" },
      e2: { role: "button", name: "Submit" },
    },
    stats: { lines: 4, chars: 120, refs: 2, interactive: 2 },
  })),
  takeScreenshotViaPlaywright: vi.fn(async () => ({
    buffer: Buffer.from("png-data"),
  })),
  typeViaPlaywright: vi.fn(async () => {}),
  waitForDownloadViaPlaywright: vi.fn(async () => ({
    url: "https://example.com/report.pdf",
    suggestedFilename: "report.pdf",
    path: "/tmp/report.pdf",
  })),
  waitForViaPlaywright: vi.fn(async () => {}),
}));

function makeProc(pid = 123) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    pid,
    killed: false,
    exitCode: null as number | null,
    on: (event: string, cb: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return undefined;
    },
    emitExit: () => {
      for (const cb of handlers.get("exit") ?? []) cb(0);
    },
    kill: () => {
      return true;
    },
  };
}

const proc = makeProc();

vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      browser: {
        enabled: true,
        color: "#FF4500",
        attachOnly: false,
        headless: true,
        defaultProfile: "gimli",
        profiles: {
          gimli: { cdpPort: testPort + 1, color: "#FF4500" },
        },
      },
    }),
    writeConfigFile: vi.fn(async () => {}),
  };
});

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => reachable),
  isChromeReachable: vi.fn(async () => reachable),
  launchGimliChrome: vi.fn(async (_resolved: unknown, profile: { cdpPort: number }) => {
    launchCallCount++;
    reachable = true;
    return {
      pid: 123,
      exe: { kind: "chrome", path: "/fake/chrome" },
      userDataDir: "/tmp/gimli",
      cdpPort: profile.cdpPort,
      startedAt: Date.now(),
      proc,
    };
  }),
  resolveGimliUserDataDir: vi.fn(() => "/tmp/gimli"),
  stopGimliChrome: vi.fn(async () => {
    stopCallCount++;
    reachable = false;
  }),
}));

vi.mock("./cdp.js", () => ({
  createTargetViaCdp: cdpMocks.createTargetViaCdp,
  normalizeCdpWsUrl: vi.fn((wsUrl: string) => wsUrl),
  snapshotAria: cdpMocks.snapshotAria,
  captureScreenshot: vi.fn(async () => Buffer.from("screenshot-png-data")),
  getHeadersWithAuth: vi.fn(() => ({})),
  appendCdpPath: vi.fn((cdpUrl: string, path: string) => {
    const base = cdpUrl.replace(/\/$/, "");
    const suffix = path.startsWith("/") ? path : `/${path}`;
    return `${base}${suffix}`;
  }),
}));

vi.mock("./pw-ai.js", () => pwMocks);

vi.mock("../media/store.js", () => ({
  ensureMediaDir: vi.fn(async () => {}),
  saveMediaBuffer: vi.fn(async () => ({ path: "/tmp/fake.png" })),
}));

vi.mock("./screenshot.js", () => ({
  DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES: 128,
  DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE: 64,
  normalizeBrowserScreenshot: vi.fn(async (buf: Buffer) => ({
    buffer: buf,
    contentType: "image/png",
  })),
}));

async function getFreePort(): Promise<number> {
  while (true) {
    const port = await new Promise<number>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const assigned = (s.address() as AddressInfo).port;
        s.close((err) => (err ? reject(err) : resolve(assigned)));
      });
    });
    if (port < 65535) return port;
  }
}

function makeResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number; text?: string },
): Response {
  const ok = init?.ok ?? true;
  const status = init?.status ?? 200;
  const text = init?.text ?? "";
  return {
    ok,
    status,
    json: async () => body,
    text: async () => text,
  } as unknown as Response;
}

describe("browser tool integration - Chromium launch and snapshots", () => {
  beforeEach(async () => {
    reachable = false;
    launchCallCount = 0;
    stopCallCount = 0;

    cdpMocks.createTargetViaCdp.mockImplementation(async () => {
      throw new Error("cdp disabled");
    });

    for (const fn of Object.values(pwMocks)) fn.mockClear();
    for (const fn of Object.values(cdpMocks)) fn.mockClear();

    testPort = await getFreePort();
    cdpBaseUrl = `http://127.0.0.1:${testPort + 1}`;
    prevGatewayPort = process.env.GIMLI_GATEWAY_PORT;
    process.env.GIMLI_GATEWAY_PORT = String(testPort - 2);

    // Mock CDP JSON endpoints used by the browser control server
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, _init?: RequestInit) => {
        const u = String(url);
        if (u.includes("/json/list")) {
          if (!reachable) return makeResponse([]);
          return makeResponse([
            {
              id: "tab-main-1234",
              title: "Example Page",
              url: "https://example.com",
              webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/tab-main-1234",
              type: "page",
            },
            {
              id: "tab-other-5678",
              title: "Other Page",
              url: "https://other.example.com",
              webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/tab-other-5678",
              type: "page",
            },
          ]);
        }
        if (u.includes("/json/new?") || u.includes("/json/new")) {
          return makeResponse({
            id: "new-tab-9999",
            title: "",
            url: "about:blank",
            webSocketDebuggerUrl: "ws://127.0.0.1/devtools/page/new-tab-9999",
            type: "page",
          });
        }
        if (u.includes("/json/activate/")) return makeResponse("ok");
        if (u.includes("/json/close/")) return makeResponse("ok");
        if (u.includes("/json/version")) {
          if (!reachable)
            return makeResponse({}, { ok: false, status: 500, text: "not reachable" });
          return makeResponse({
            Browser: "Chrome/120.0.0.0",
            webSocketDebuggerUrl: "ws://127.0.0.1/devtools/browser",
          });
        }
        return makeResponse({}, { ok: false, status: 500, text: "unexpected" });
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (prevGatewayPort === undefined) {
      delete process.env.GIMLI_GATEWAY_PORT;
    } else {
      process.env.GIMLI_GATEWAY_PORT = prevGatewayPort;
    }
    const { stopBrowserControlServer } = await import("./server.js");
    await stopBrowserControlServer();
  });

  const startServerAndBase = async () => {
    const { startBrowserControlServerFromConfig } = await import("./server.js");
    await startBrowserControlServerFromConfig();
    return `http://127.0.0.1:${testPort}`;
  };

  const postJson = async <T>(url: string, body?: unknown): Promise<T> => {
    const res = await realFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  };

  describe("browser launch flow", () => {
    it("reports not running before browser is started", async () => {
      const base = await startServerAndBase();

      const status = (await realFetch(`${base}/`).then((r) => r.json())) as {
        running: boolean;
        pid: number | null;
      };
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
      expect(launchCallCount).toBe(0);
    });

    it("launches Chromium when start endpoint is called", async () => {
      const base = await startServerAndBase();

      const startResult = (await postJson(`${base}/start`)) as {
        ok: boolean;
        profile: string;
      };
      expect(startResult.ok).toBe(true);
      expect(startResult.profile).toBe("gimli");
      expect(launchCallCount).toBe(1);
    });

    it("reports running status after browser starts", async () => {
      const base = await startServerAndBase();

      await postJson(`${base}/start`);

      const status = (await realFetch(`${base}/`).then((r) => r.json())) as {
        running: boolean;
        pid: number | null;
        chosenBrowser: string | null;
        cdpPort: number;
      };
      expect(status.running).toBe(true);
      expect(status.pid).toBe(123);
      expect(status.chosenBrowser).toBe("chrome");
      expect(typeof status.cdpPort).toBe("number");
    });

    it("stops Chromium when stop endpoint is called", async () => {
      const base = await startServerAndBase();

      await postJson(`${base}/start`);
      expect(launchCallCount).toBe(1);

      await postJson(`${base}/stop`);
      expect(stopCallCount).toBe(1);

      const status = (await realFetch(`${base}/`).then((r) => r.json())) as {
        running: boolean;
        pid: number | null;
      };
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
    });

    it("does not relaunch browser if already running", async () => {
      const base = await startServerAndBase();

      await postJson(`${base}/start`);
      await postJson(`${base}/start`);
      await postJson(`${base}/start`);

      // Should only launch once
      expect(launchCallCount).toBe(1);
    });
  });

  describe("snapshot functionality", () => {
    it("takes AI format snapshot successfully", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const snapshot = (await realFetch(`${base}/snapshot?format=ai`).then((r) => r.json())) as {
        ok: boolean;
        format: string;
        targetId: string;
        url: string;
        snapshot: string;
        refs?: Record<string, unknown>;
        stats?: unknown;
      };

      expect(snapshot.ok).toBe(true);
      expect(snapshot.format).toBe("ai");
      expect(snapshot.targetId).toBe("tab-main-1234");
      expect(typeof snapshot.snapshot).toBe("string");
      expect(snapshot.snapshot).toContain("document");
      expect(pwMocks.snapshotAiViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          cdpUrl: cdpBaseUrl,
          targetId: "tab-main-1234",
        }),
      );
    });

    it("takes aria format snapshot successfully", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const snapshot = (await realFetch(`${base}/snapshot?format=aria`).then((r) => r.json())) as {
        ok: boolean;
        format: string;
        targetId: string;
        nodes: Array<{ ref: string; role: string; name: string }>;
      };

      expect(snapshot.ok).toBe(true);
      expect(snapshot.format).toBe("aria");
      expect(snapshot.targetId).toBe("tab-main-1234");
      expect(Array.isArray(snapshot.nodes)).toBe(true);
      expect(snapshot.nodes.length).toBeGreaterThan(0);
      expect(cdpMocks.snapshotAria).toHaveBeenCalledWith(
        expect.objectContaining({
          wsUrl: "ws://127.0.0.1/devtools/page/tab-main-1234",
        }),
      );
    });

    it("respects maxChars parameter for AI snapshots", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      await realFetch(`${base}/snapshot?format=ai&maxChars=5000`).then((r) => r.json());

      expect(pwMocks.snapshotAiViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          maxChars: 5000,
        }),
      );
    });

    it("snapshots specific targetId when provided", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      await realFetch(`${base}/snapshot?format=ai&targetId=tab-other-5678`).then((r) => r.json());

      expect(pwMocks.snapshotAiViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: "tab-other-5678",
        }),
      );
    });

    it("snapshot auto-starts browser when needed", async () => {
      const base = await startServerAndBase();
      // Don't explicitly start browser - server will auto-start via ensureTabAvailable

      const snapshot = (await realFetch(`${base}/snapshot?format=ai`).then((r) => r.json())) as {
        ok: boolean;
        format: string;
      };
      // The server auto-launches browser when ensureTabAvailable is called
      expect(snapshot.ok).toBe(true);
      expect(snapshot.format).toBe("ai");
      // Browser should have been launched
      expect(launchCallCount).toBe(1);
    });
  });

  describe("tab management", () => {
    it("lists tabs when browser is running", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const tabs = (await realFetch(`${base}/tabs`).then((r) => r.json())) as {
        running: boolean;
        tabs: Array<{ targetId: string; title: string; url: string }>;
      };

      expect(tabs.running).toBe(true);
      expect(Array.isArray(tabs.tabs)).toBe(true);
      expect(tabs.tabs.length).toBe(2);
      expect(tabs.tabs[0]!.targetId).toBe("tab-main-1234");
      expect(tabs.tabs[0]!.title).toBe("Example Page");
      expect(tabs.tabs[1]!.targetId).toBe("tab-other-5678");
    });

    it("opens new tab with URL", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const newTab = (await postJson(`${base}/tabs/open`, {
        url: "https://newsite.example.com",
      })) as { targetId: string; url: string };

      expect(newTab.targetId).toBe("new-tab-9999");
    });

    it("focuses specific tab by targetId", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const response = await realFetch(`${base}/tabs/focus`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: "tab-other-5678" }),
      });

      expect(response.ok).toBe(true);
    });

    it("closes tab by targetId", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const response = await realFetch(`${base}/tabs/tab-other-5678`, {
        method: "DELETE",
      });

      expect(response.ok).toBe(true);
    });
  });

  describe("navigation", () => {
    it("navigates to URL successfully", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/navigate`, {
        url: "https://navigation-test.example.com",
      })) as { ok: boolean; url?: string; targetId?: string };

      expect(result.ok).toBe(true);
      expect(pwMocks.navigateViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          cdpUrl: cdpBaseUrl,
          targetId: "tab-main-1234",
          url: "https://navigation-test.example.com",
        }),
      );
    });

    it("navigates specific tab by targetId", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      await postJson(`${base}/navigate`, {
        url: "https://other-tab-nav.example.com",
        targetId: "tab-other-5678",
      });

      expect(pwMocks.navigateViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: "tab-other-5678",
          url: "https://other-tab-nav.example.com",
        }),
      );
    });
  });

  describe("screenshot", () => {
    it("takes screenshot successfully", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/screenshot`)) as {
        ok: boolean;
        path?: string;
        targetId?: string;
      };

      expect(result.ok).toBe(true);
      expect(typeof result.path).toBe("string");
      expect(result.targetId).toBe("tab-main-1234");
    });

    it("takes screenshot with fullPage option", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/screenshot`, { fullPage: true })) as {
        ok: boolean;
        path?: string;
      };

      // Screenshot succeeds (the actual fullPage param is passed through internally)
      expect(result.ok).toBe(true);
    });
  });

  describe("browser actions", () => {
    it("performs click action", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/act`, {
        kind: "click",
        ref: "e1",
      })) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(pwMocks.clickViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "e1",
        }),
      );
    });

    it("performs type action", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/act`, {
        kind: "type",
        ref: "e2",
        text: "Hello World",
      })) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(pwMocks.typeViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "e2",
          text: "Hello World",
        }),
      );
    });

    it("performs key press action", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/act`, {
        kind: "press",
        key: "Enter",
      })) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(pwMocks.pressKeyViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "Enter",
        }),
      );
    });

    it("performs hover action", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/act`, {
        kind: "hover",
        ref: "e1",
      })) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(pwMocks.hoverViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: "e1",
        }),
      );
    });

    it("performs drag action", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const result = (await postJson(`${base}/act`, {
        kind: "drag",
        startRef: "e1",
        endRef: "e2",
      })) as { ok: boolean };

      expect(result.ok).toBe(true);
      expect(pwMocks.dragViaPlaywright).toHaveBeenCalledWith(
        expect.objectContaining({
          startRef: "e1",
          endRef: "e2",
        }),
      );
    });
  });

  describe("error handling", () => {
    it("action auto-starts browser when needed and succeeds", async () => {
      const base = await startServerAndBase();
      // Don't explicitly start browser - server will auto-start via ensureTabAvailable

      const response = await realFetch(`${base}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "click", ref: "e1" }),
      });

      // Server auto-launches browser when ensureTabAvailable is called
      const result = (await response.json()) as { ok?: boolean };
      expect(result.ok).toBe(true);
      expect(launchCallCount).toBe(1);
    });

    it("returns 400 for invalid action kind", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const response = await realFetch(`${base}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "invalid-action" }),
      });

      expect(response.status).toBe(400);
    });

    it("rejects selector-based actions (ref required)", async () => {
      const base = await startServerAndBase();
      await postJson(`${base}/start`);

      const response = await realFetch(`${base}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "click", selector: "button.submit" }),
      });

      expect(response.status).toBe(400);
      const result = (await response.json()) as { error?: string };
      expect(result.error).toMatch(/selector.*not supported/i);
    });
  });

  describe("profiles", () => {
    it("lists browser profiles", async () => {
      const base = await startServerAndBase();

      const profiles = (await realFetch(`${base}/profiles`).then((r) => r.json())) as {
        profiles: Array<{ name: string; cdpPort: number }>;
      };

      expect(Array.isArray(profiles.profiles)).toBe(true);
      expect(profiles.profiles.length).toBeGreaterThan(0);
      expect(profiles.profiles.some((p) => p.name === "gimli")).toBe(true);
    });
  });
});
