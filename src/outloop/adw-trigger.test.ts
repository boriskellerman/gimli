import { describe, expect, test, beforeEach, afterEach } from "vitest";
import type { GimliConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry, createIMessageTestPlugin } from "../test-utils/channel-plugins.js";
import { resolveADWConfig, normalizeADWPayload } from "./adw-trigger.js";
import type { ADWTriggerConfig } from "./types.js";

describe("ADW trigger helpers", () => {
  const emptyRegistry = createTestRegistry([]);

  beforeEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  afterEach(() => {
    setActivePluginRegistry(emptyRegistry);
  });

  describe("resolveADWConfig", () => {
    test("returns null when adw not enabled", () => {
      const cfg = {} as GimliConfig;
      expect(resolveADWConfig(cfg)).toBeNull();
    });

    test("returns null when adw.enabled is false", () => {
      const cfg = { adw: { enabled: false } } as GimliConfig;
      expect(resolveADWConfig(cfg)).toBeNull();
    });

    test("throws when enabled but no token", () => {
      const cfg = { adw: { enabled: true } } as GimliConfig;
      expect(() => resolveADWConfig(cfg)).toThrow("adw.enabled requires adw.token");
    });

    test("throws when enabled with empty token", () => {
      const cfg = { adw: { enabled: true, token: "  " } } as GimliConfig;
      expect(() => resolveADWConfig(cfg)).toThrow("adw.enabled requires adw.token");
    });

    test("normalizes path with trailing slashes", () => {
      const cfg = { adw: { enabled: true, token: "secret", path: "adw///" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.basePath).toBe("/adw");
    });

    test("adds leading slash if missing", () => {
      const cfg = { adw: { enabled: true, token: "secret", path: "my-endpoint" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.basePath).toBe("/my-endpoint");
    });

    test("rejects root path", () => {
      const cfg = { adw: { enabled: true, token: "x", path: "/" } } as GimliConfig;
      expect(() => resolveADWConfig(cfg)).toThrow("adw.path may not be '/'");
    });

    test("uses default path when not specified", () => {
      const cfg = { adw: { enabled: true, token: "secret" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.basePath).toBe("/adw");
    });

    test("uses default maxBodyBytes when not specified", () => {
      const cfg = { adw: { enabled: true, token: "secret" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.maxBodyBytes).toBe(512 * 1024);
    });

    test("uses custom maxBodyBytes when specified", () => {
      const cfg = { adw: { enabled: true, token: "secret", maxBodyBytes: 1024 } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.maxBodyBytes).toBe(1024);
    });

    test("uses default timeout when not specified", () => {
      const cfg = { adw: { enabled: true, token: "secret" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.defaultTimeoutSeconds).toBe(300);
    });

    test("uses custom timeout when specified", () => {
      const cfg = {
        adw: { enabled: true, token: "secret", defaultTimeoutSeconds: 600 },
      } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.defaultTimeoutSeconds).toBe(600);
    });

    test("storeResults defaults to true", () => {
      const cfg = { adw: { enabled: true, token: "secret" } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.storeResults).toBe(true);
    });

    test("storeResults can be disabled", () => {
      const cfg = { adw: { enabled: true, token: "secret", storeResults: false } } as GimliConfig;
      const resolved = resolveADWConfig(cfg);
      expect(resolved?.storeResults).toBe(false);
    });
  });

  describe("normalizeADWPayload", () => {
    const defaultConfig: ADWTriggerConfig = {
      enabled: true,
      token: "secret",
      basePath: "/adw",
      maxBodyBytes: 512 * 1024,
      defaultTimeoutSeconds: 300,
      storeResults: true,
    };

    const gimliConfig = {} as GimliConfig;

    test("requires message", () => {
      const result = normalizeADWPayload({}, defaultConfig, gimliConfig);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("message required");
        expect(result.code).toBe("MISSING_MESSAGE");
      }
    });

    test("requires non-empty message", () => {
      const result = normalizeADWPayload({ message: "   " }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("message required");
      }
    });

    test("trims message", () => {
      const result = normalizeADWPayload(
        { message: "  hello world  " },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.message).toBe("hello world");
      }
    });

    test("generates default name from timestamp", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toMatch(/^ADW-\d+$/);
      }
    });

    test("uses custom name", () => {
      const result = normalizeADWPayload(
        { message: "test", name: "My Workflow" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("My Workflow");
      }
    });

    test("generates unique session key", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sessionKey).toMatch(/^adw:[0-9a-f-]+$/);
      }
    });

    test("uses custom session key", () => {
      const result = normalizeADWPayload(
        { message: "test", sessionKey: "my-session" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.sessionKey).toBe("my-session");
      }
    });

    test("validates model must be non-empty string", () => {
      const result = normalizeADWPayload(
        { message: "test", model: "  " },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("model must be a non-empty string");
        expect(result.code).toBe("INVALID_MODEL");
      }
    });

    test("accepts valid model", () => {
      const result = normalizeADWPayload(
        { message: "test", model: "claude-sonnet-4-20250514" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.model).toBe("claude-sonnet-4-20250514");
      }
    });

    test("uses config default thinking", () => {
      const configWithThinking: ADWTriggerConfig = {
        ...defaultConfig,
        defaultThinking: "high",
      };
      const result = normalizeADWPayload({ message: "test" }, configWithThinking, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thinking).toBe("high");
      }
    });

    test("overrides thinking from payload", () => {
      const configWithThinking: ADWTriggerConfig = {
        ...defaultConfig,
        defaultThinking: "low",
      };
      const result = normalizeADWPayload(
        { message: "test", thinking: "xhigh" },
        configWithThinking,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.thinking).toBe("xhigh");
      }
    });

    test("uses config default timeout", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timeoutSeconds).toBe(300);
      }
    });

    test("overrides timeout from payload", () => {
      const result = normalizeADWPayload(
        { message: "test", timeoutSeconds: 60 },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timeoutSeconds).toBe(60);
      }
    });

    test("floors timeout to integer", () => {
      const result = normalizeADWPayload(
        { message: "test", timeoutSeconds: 60.7 },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.timeoutSeconds).toBe(60);
      }
    });

    test("defaults deliver to true", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deliver).toBe(true);
      }
    });

    test("deliver can be set to false", () => {
      const result = normalizeADWPayload(
        { message: "test", deliver: false },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.deliver).toBe(false);
      }
    });

    test("defaults channel to last", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channel).toBe("last");
      }
    });

    test("validates channel", () => {
      const result = normalizeADWPayload(
        { message: "test", channel: "invalid-channel" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_CHANNEL");
      }
    });

    test("accepts registered channel", () => {
      setActivePluginRegistry(
        createTestRegistry([
          {
            pluginId: "imessage",
            source: "test",
            plugin: createIMessageTestPlugin(),
          },
        ]),
      );
      const result = normalizeADWPayload(
        { message: "test", channel: "imessage" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.channel).toBe("imessage");
      }
    });

    test("defaults wakeMode to now", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wakeMode).toBe("now");
      }
    });

    test("wakeMode can be set to next-heartbeat", () => {
      const result = normalizeADWPayload(
        { message: "test", wakeMode: "next-heartbeat" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.wakeMode).toBe("next-heartbeat");
      }
    });

    test("defaults allowUnsafeExternalContent to false", () => {
      const result = normalizeADWPayload({ message: "test" }, defaultConfig, gimliConfig);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.allowUnsafeExternalContent).toBe(false);
      }
    });

    test("allowUnsafeExternalContent can be enabled", () => {
      const result = normalizeADWPayload(
        { message: "test", allowUnsafeExternalContent: true },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.allowUnsafeExternalContent).toBe(true);
      }
    });

    test("parses metadata", () => {
      const result = normalizeADWPayload(
        {
          message: "test",
          metadata: {
            source: "github-issue",
            externalId: "123",
            tags: ["bug", "high-priority"],
          },
        },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.metadata).toEqual({
          source: "github-issue",
          externalId: "123",
          tags: ["bug", "high-priority"],
        });
      }
    });

    test("ignores invalid metadata", () => {
      const result = normalizeADWPayload(
        { message: "test", metadata: "not-an-object" },
        defaultConfig,
        gimliConfig,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.metadata).toBeUndefined();
      }
    });
  });
});
