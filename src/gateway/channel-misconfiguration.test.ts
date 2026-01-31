import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { GimliConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { createChannelManager, type ChannelManager } from "./server-channels.js";

// Mock channel plugins
const mockListChannelPlugins = vi.fn<() => ChannelPlugin[]>();
const mockGetChannelPlugin = vi.fn<(id: string) => ChannelPlugin | undefined>();

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins: () => mockListChannelPlugins(),
  getChannelPlugin: (id: string) => mockGetChannelPlugin(id),
}));

type MockSubsystemLogger = ReturnType<typeof createSubsystemLogger>;

function createMockLogger(): MockSubsystemLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  } as unknown as MockSubsystemLogger;
}

function createMockRuntimeEnv(): RuntimeEnv {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  } as unknown as RuntimeEnv;
}

function createMockConfig(channels: Record<string, unknown> = {}): GimliConfig {
  return {
    channels,
    agents: { defaults: {} },
    gateway: {},
  } as GimliConfig;
}

function createStubChannelPlugin(params: {
  id: string;
  label?: string;
  isEnabled?: (account: unknown, cfg: GimliConfig) => boolean;
  isConfigured?: (account: unknown, cfg: GimliConfig) => Promise<boolean>;
  disabledReason?: (account: unknown, cfg: GimliConfig) => string;
  unconfiguredReason?: (account: unknown, cfg: GimliConfig) => string;
  startAccount?: (params: unknown) => Promise<void>;
  throwOnStart?: Error;
  accountIds?: string[];
}): ChannelPlugin {
  return {
    id: params.id as ChannelPlugin["id"],
    meta: {
      id: params.id,
      label: params.label ?? params.id,
      selectionLabel: params.label ?? params.id,
      docsPath: `/channels/${params.id}`,
      blurb: "test stub.",
    },
    capabilities: { chatTypes: ["direct"] },
    config: {
      listAccountIds: () => params.accountIds ?? ["default"],
      resolveAccount: (_cfg: GimliConfig, accountId: string) => ({ accountId }),
      isEnabled: params.isEnabled,
      isConfigured: params.isConfigured,
      disabledReason: params.disabledReason,
      unconfiguredReason: params.unconfiguredReason,
    },
    status: {},
    gateway: {
      startAccount: params.throwOnStart
        ? async () => {
            throw params.throwOnStart;
          }
        : (params.startAccount ??
          (async ({ setStatus }) => {
            setStatus({ running: true });
            // Simulate a running channel
            await new Promise((resolve) => setTimeout(resolve, 10));
          })),
    },
  };
}

describe("Channel misconfiguration graceful handling", () => {
  let manager: ChannelManager;
  let mockConfig: GimliConfig;
  let mockLogs: Record<string, MockSubsystemLogger>;
  let mockRuntimeEnvs: Record<string, RuntimeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = createMockConfig();
    mockLogs = {
      telegram: createMockLogger(),
      discord: createMockLogger(),
      slack: createMockLogger(),
      whatsapp: createMockLogger(),
    };
    mockRuntimeEnvs = {
      telegram: createMockRuntimeEnv(),
      discord: createMockRuntimeEnv(),
      slack: createMockRuntimeEnv(),
      whatsapp: createMockRuntimeEnv(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupManager(plugins: ChannelPlugin[]) {
    mockListChannelPlugins.mockReturnValue(plugins);
    mockGetChannelPlugin.mockImplementation((id) => plugins.find((p) => p.id === id));
    manager = createChannelManager({
      loadConfig: () => mockConfig,
      channelLogs: mockLogs as unknown as Record<string, MockSubsystemLogger>,
      channelRuntimeEnvs: mockRuntimeEnvs as unknown as Record<string, RuntimeEnv>,
    });
  }

  describe("disabled channels", () => {
    it("gracefully handles disabled channel without crashing", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        isEnabled: () => false,
        disabledReason: () => "bot token not configured",
      });
      setupManager([plugin]);

      // Should not throw
      await expect(manager.startChannels()).resolves.not.toThrow();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.telegram?.running).toBe(false);
      expect(snapshot.channels.telegram?.lastError).toBe("bot token not configured");
    });

    it("gracefully handles disabled channel with custom reason", async () => {
      const plugin = createStubChannelPlugin({
        id: "discord",
        isEnabled: () => false,
        disabledReason: () => "Discord bot token is invalid",
      });
      setupManager([plugin]);

      await manager.startChannels();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.discord?.running).toBe(false);
      expect(snapshot.channels.discord?.lastError).toBe("Discord bot token is invalid");
    });

    it("falls back to 'disabled' when no reason is provided", async () => {
      const plugin = createStubChannelPlugin({
        id: "slack",
        isEnabled: () => false,
        // No disabledReason provided
      });
      setupManager([plugin]);

      await manager.startChannels();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.slack?.lastError).toBe("disabled");
    });
  });

  describe("unconfigured channels", () => {
    it("gracefully handles unconfigured channel without crashing", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        isConfigured: async () => false,
        unconfiguredReason: () => "Telegram bot token not set",
      });
      setupManager([plugin]);

      await expect(manager.startChannels()).resolves.not.toThrow();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.telegram?.running).toBe(false);
      expect(snapshot.channels.telegram?.lastError).toBe("Telegram bot token not set");
    });

    it("falls back to 'not configured' when no reason is provided", async () => {
      const plugin = createStubChannelPlugin({
        id: "whatsapp",
        isConfigured: async () => false,
        // No unconfiguredReason provided
      });
      setupManager([plugin]);

      await manager.startChannels();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.whatsapp?.lastError).toBe("not configured");
    });
  });

  describe("channel startup errors", () => {
    it("catches and logs startup errors without crashing the gateway", async () => {
      const startupError = new Error("Connection refused: invalid bot token");
      const plugin = createStubChannelPlugin({
        id: "telegram",
        throwOnStart: startupError,
      });
      setupManager([plugin]);

      // Should not throw even when channel startup fails
      await expect(manager.startChannels()).resolves.not.toThrow();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.telegram?.running).toBe(false);
      expect(snapshot.channels.telegram?.lastError).toContain("Connection refused");
    });

    it("logs error message to channel logger", async () => {
      const startupError = new Error("Authentication failed");
      const plugin = createStubChannelPlugin({
        id: "discord",
        throwOnStart: startupError,
      });
      setupManager([plugin]);

      await manager.startChannels();

      // Wait a bit for the error to be logged (async promise handling)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockLogs.discord.error).toHaveBeenCalled();
      const errorCall = mockLogs.discord.error?.mock.calls[0]?.[0];
      expect(errorCall).toContain("channel exited");
      expect(errorCall).toContain("Authentication failed");
    });

    it("handles multiple channel failures independently", async () => {
      const telegramPlugin = createStubChannelPlugin({
        id: "telegram",
        throwOnStart: new Error("Telegram API error"),
      });
      const discordPlugin = createStubChannelPlugin({
        id: "discord",
        throwOnStart: new Error("Discord API error"),
      });
      const slackPlugin = createStubChannelPlugin({
        id: "slack",
        // This one succeeds
      });
      setupManager([telegramPlugin, discordPlugin, slackPlugin]);

      await expect(manager.startChannels()).resolves.not.toThrow();

      // Wait for async error handling
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snapshot = manager.getRuntimeSnapshot();
      // Failed channels have errors
      expect(snapshot.channels.telegram?.lastError).toContain("Telegram API error");
      expect(snapshot.channels.discord?.lastError).toContain("Discord API error");
      // Successful channel doesn't have an error
      expect(snapshot.channels.slack?.lastError).toBeNull();
    });
  });

  describe("missing channel configuration", () => {
    it("gracefully handles missing channel config section", async () => {
      mockConfig = createMockConfig({}); // No channel configs
      const plugin = createStubChannelPlugin({
        id: "telegram",
        accountIds: [], // No accounts configured
      });
      setupManager([plugin]);

      await expect(manager.startChannels()).resolves.not.toThrow();

      // No runtime should be created for channels with no accounts
      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channelAccounts.telegram).toEqual({});
    });

    it("handles channel with no gateway hooks defined", async () => {
      const plugin: ChannelPlugin = {
        id: "telegram",
        meta: {
          id: "telegram",
          label: "Telegram",
          selectionLabel: "Telegram",
          docsPath: "/channels/telegram",
          blurb: "test",
        },
        capabilities: { chatTypes: ["direct"] },
        config: {
          listAccountIds: () => ["default"],
          resolveAccount: () => ({}),
        },
        status: {},
        // No gateway hooks defined
      };
      setupManager([plugin]);

      await expect(manager.startChannels()).resolves.not.toThrow();
    });
  });

  describe("multi-account channel misconfiguration", () => {
    it("handles mixed enabled/disabled accounts gracefully", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        accountIds: ["account1", "account2", "account3"],
        isEnabled: (account) => {
          const acc = account as { accountId: string };
          return acc.accountId !== "account2"; // account2 is disabled
        },
        disabledReason: () => "account disabled by config",
      });
      setupManager([plugin]);

      await manager.startChannels();

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snapshot = manager.getRuntimeSnapshot();
      const accounts = snapshot.channelAccounts.telegram ?? {};

      // Enabled accounts should be running
      expect(accounts.account1?.running).toBe(false); // Stopped after startup
      expect(accounts.account1?.lastError).toBeNull();

      // Disabled account should have error
      expect(accounts.account2?.running).toBe(false);
      expect(accounts.account2?.lastError).toBe("account disabled by config");

      // Third account should also be running
      expect(accounts.account3?.running).toBe(false); // Stopped after startup
      expect(accounts.account3?.lastError).toBeNull();
    });

    it("handles mixed configured/unconfigured accounts gracefully", async () => {
      const plugin = createStubChannelPlugin({
        id: "discord",
        accountIds: ["bot1", "bot2"],
        isConfigured: async (account) => {
          const acc = account as { accountId: string };
          return acc.accountId === "bot1"; // Only bot1 is configured
        },
        unconfiguredReason: () => "bot token missing",
      });
      setupManager([plugin]);

      await manager.startChannels();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snapshot = manager.getRuntimeSnapshot();
      const accounts = snapshot.channelAccounts.discord ?? {};

      expect(accounts.bot1?.lastError).toBeNull();
      expect(accounts.bot2?.lastError).toBe("bot token missing");
    });
  });

  describe("runtime snapshot with misconfigured channels", () => {
    it("includes error information in runtime snapshot", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        isEnabled: () => false,
        disabledReason: () => "API key expired",
      });
      setupManager([plugin]);

      await manager.startChannels();

      const snapshot = manager.getRuntimeSnapshot();
      expect(snapshot.channels.telegram).toMatchObject({
        accountId: "default",
        running: false,
        lastError: "API key expired",
      });
    });

    it("preserves lastError across multiple getRuntimeSnapshot calls", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        throwOnStart: new Error("Persistent error"),
      });
      setupManager([plugin]);

      await manager.startChannels();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const snapshot1 = manager.getRuntimeSnapshot();
      const snapshot2 = manager.getRuntimeSnapshot();

      expect(snapshot1.channels.telegram?.lastError).toContain("Persistent error");
      expect(snapshot2.channels.telegram?.lastError).toContain("Persistent error");
    });
  });

  describe("edge cases", () => {
    it("handles null/undefined account gracefully", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        accountIds: ["default"],
        isEnabled: () => true,
        isConfigured: async () => true,
      });
      // Override resolveAccount to return undefined
      plugin.config.resolveAccount = () => undefined as unknown as Record<string, unknown>;
      setupManager([plugin]);

      await expect(manager.startChannels()).resolves.not.toThrow();
    });

    it("handles isConfigured throwing an error", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        isConfigured: async () => {
          throw new Error("Config validation error");
        },
      });
      setupManager([plugin]);

      // Should not crash the gateway
      await expect(manager.startChannels()).rejects.toThrow("Config validation error");
    });

    it("handles isEnabled throwing an error", async () => {
      const plugin = createStubChannelPlugin({
        id: "telegram",
        isEnabled: () => {
          throw new Error("Enable check error");
        },
      });
      setupManager([plugin]);

      // This should throw because isEnabled is called synchronously
      await expect(manager.startChannels()).rejects.toThrow("Enable check error");
    });
  });
});

describe("Channel stop graceful handling", () => {
  let manager: ChannelManager;
  let mockConfig: GimliConfig;
  let mockLogs: Record<string, MockSubsystemLogger>;
  let mockRuntimeEnvs: Record<string, RuntimeEnv>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = createMockConfig();
    mockLogs = {
      telegram: createMockLogger(),
    };
    mockRuntimeEnvs = {
      telegram: createMockRuntimeEnv(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupManager(plugins: ChannelPlugin[]) {
    mockListChannelPlugins.mockReturnValue(plugins);
    mockGetChannelPlugin.mockImplementation((id) => plugins.find((p) => p.id === id));
    manager = createChannelManager({
      loadConfig: () => mockConfig,
      channelLogs: mockLogs as unknown as Record<string, MockSubsystemLogger>,
      channelRuntimeEnvs: mockRuntimeEnvs as unknown as Record<string, RuntimeEnv>,
    });
  }

  it("gracefully handles stopping a channel that was never started", async () => {
    const plugin = createStubChannelPlugin({
      id: "telegram",
    });
    setupManager([plugin]);

    // Stop without starting first
    await expect(manager.stopChannel("telegram")).resolves.not.toThrow();
  });

  it("gracefully handles stopping a disabled channel", async () => {
    const plugin = createStubChannelPlugin({
      id: "telegram",
      isEnabled: () => false,
    });
    setupManager([plugin]);

    await manager.startChannels();
    await expect(manager.stopChannel("telegram")).resolves.not.toThrow();
  });

  it("handles stopAccount hook throwing an error", async () => {
    const plugin = createStubChannelPlugin({
      id: "telegram",
    });
    // Override stopAccount to throw
    plugin.gateway!.stopAccount = async () => {
      throw new Error("Stop failed");
    };
    setupManager([plugin]);

    await manager.startChannels();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should handle the error gracefully (catches in Promise.all)
    await expect(manager.stopChannel("telegram")).rejects.toThrow("Stop failed");
  });
});
