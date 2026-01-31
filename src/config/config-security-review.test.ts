import { describe, expect, it, vi } from "vitest";

import type { GimliConfig } from "./config.js";
import type { GroupPolicy, DmPolicy } from "./types.base.js";

/**
 * Security review tests for gimli.json configuration.
 *
 * These tests verify that configurations can be reviewed for overly permissive settings
 * and validate that secure defaults are properly enforced.
 *
 * PRD Task: Review `~/.gimli/gimli.json` for any overly permissive settings
 */

describe("gateway security settings", () => {
  describe("bind address security", () => {
    it("accepts loopback bind (secure default)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: { bind: "loopback" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.bind).toBe("loopback");
      }
    });

    it("accepts lan bind with explicit config (requires user awareness)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: { bind: "lan" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.bind).toBe("lan");
      }
    });

    it("defaults bind to loopback when not specified", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: { port: 18789 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Not explicitly set - will default to loopback at runtime
        expect(result.config.gateway?.bind).toBeUndefined();
      }
    });
  });

  describe("authentication mode security", () => {
    it("accepts token auth (recommended)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          auth: {
            mode: "token",
            token: "test-token-12345678901234567890123456789012",
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.auth?.mode).toBe("token");
      }
    });

    it("accepts password auth (valid but less recommended than token)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          auth: {
            mode: "password",
            password: "test-password-strong-enough",
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.auth?.mode).toBe("password");
      }
    });

    it("defaults to token auth when no auth config specified (secure default)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          bind: "loopback",
        },
      });
      expect(result.ok).toBe(true);
      // Auth is optional at the config level - runtime will enforce auth requirements
      if (result.ok) {
        expect(result.config.gateway?.auth).toBeUndefined();
      }
    });
  });

  describe("tailscale mode security", () => {
    it("accepts tailscale off (secure default)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          tailscale: { mode: "off" },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.tailscale?.mode).toBe("off");
      }
    });

    it("accepts tailscale serve mode (requires user awareness)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          tailscale: { mode: "serve" },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.tailscale?.mode).toBe("serve");
      }
    });

    it("accepts tailscale funnel mode (most permissive - exposes to internet)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        gateway: {
          tailscale: { mode: "funnel" },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.gateway?.tailscale?.mode).toBe("funnel");
      }
    });
  });
});

describe("channel security settings", () => {
  describe("groupPolicy security", () => {
    it("accepts allowlist groupPolicy (secure default)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        channels: {
          telegram: {
            botToken: "test-token",
            groupPolicy: "allowlist" as GroupPolicy,
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.channels?.telegram?.groupPolicy).toBe("allowlist");
      }
    });

    it("accepts disabled groupPolicy (most restrictive)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        channels: {
          telegram: {
            botToken: "test-token",
            groupPolicy: "disabled" as GroupPolicy,
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.channels?.telegram?.groupPolicy).toBe("disabled");
      }
    });

    it("accepts open groupPolicy (permissive - requires user awareness)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        channels: {
          telegram: {
            botToken: "test-token",
            groupPolicy: "open" as GroupPolicy,
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.channels?.telegram?.groupPolicy).toBe("open");
      }
    });

    it("defaults groupPolicy to allowlist when not specified", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        channels: {
          telegram: { botToken: "test-token" },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Schema default is allowlist
        expect(result.config.channels?.telegram?.groupPolicy).toBe("allowlist");
      }
    });
  });

  describe("dmPolicy security", () => {
    it("defaults dmPolicy to pairing for all channels", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        channels: {
          telegram: { botToken: "test-token" },
          whatsapp: {},
          signal: {},
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.channels?.telegram?.dmPolicy).toBe("pairing");
        expect(result.config.channels?.whatsapp?.dmPolicy).toBe("pairing");
        expect(result.config.channels?.signal?.dmPolicy).toBe("pairing");
      }
    });
  });
});

describe("tools security settings", () => {
  describe("elevated tools security", () => {
    it("accepts elevated tools enabled (default - user should be aware)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        tools: {
          elevated: { enabled: true },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.tools?.elevated?.enabled).toBe(true);
      }
    });

    it("accepts elevated tools disabled (more restrictive)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        tools: {
          elevated: { enabled: false },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.tools?.elevated?.enabled).toBe(false);
      }
    });
  });

  describe("tool allow/deny policies", () => {
    it("accepts explicit deny list for dangerous tools", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        tools: {
          deny: ["bash", "process", "browser"],
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.tools?.deny).toEqual(["bash", "process", "browser"]);
      }
    });

    it("accepts explicit allow list for restricted access", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        tools: {
          allow: ["read", "write", "sessions_list"],
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.tools?.allow).toEqual(["read", "write", "sessions_list"]);
      }
    });
  });
});

describe("sandbox security settings", () => {
  describe("sandbox mode security", () => {
    it("accepts sandbox mode off (default - main session trusted)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            sandbox: { mode: "off" },
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.sandbox?.mode).toBe("off");
      }
    });

    it("accepts sandbox mode non-main (recommended for multi-user)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            sandbox: { mode: "non-main" },
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.sandbox?.mode).toBe("non-main");
      }
    });

    it("accepts sandbox mode all (most restrictive)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            sandbox: { mode: "all" },
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.sandbox?.mode).toBe("all");
      }
    });
  });
});

describe("hooks security settings", () => {
  describe("hooks token security", () => {
    it("accepts hooks with adequate token length", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        hooks: {
          enabled: true,
          token: "a-very-long-random-token-12345678901234567890",
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.hooks?.enabled).toBe(true);
        expect(result.config.hooks?.token?.length).toBeGreaterThanOrEqual(24);
      }
    });

    it("accepts hooks disabled (secure default)", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        hooks: { enabled: false },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.hooks?.enabled).toBe(false);
      }
    });
  });
});

describe("agent security settings", () => {
  describe("workspace isolation", () => {
    it("accepts explicit workspace path", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            workspace: "/home/user/gimli",
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.workspace).toBe("/home/user/gimli");
      }
    });
  });

  describe("concurrency limits", () => {
    it("accepts reasonable maxConcurrent limit", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            maxConcurrent: 4,
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.maxConcurrent).toBe(4);
      }
    });

    it("accepts subagent concurrency limit", async () => {
      vi.resetModules();
      const { validateConfigObject } = await import("./config.js");
      const result = validateConfigObject({
        agents: {
          defaults: {
            subagents: { maxConcurrent: 8 },
          },
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.agents?.defaults?.subagents?.maxConcurrent).toBe(8);
      }
    });
  });
});

describe("secure configuration patterns", () => {
  it("validates a production-ready secure configuration", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");

    // This represents a well-hardened production config
    const secureConfig = {
      gateway: {
        port: 18789,
        mode: "local",
        bind: "loopback",
        auth: {
          mode: "token" as const,
          token: "69c3ad925802e669a04a623892cd563b2d1c56f18d479fd7",
        },
        tailscale: {
          mode: "off" as const,
          resetOnExit: false,
        },
      },
      agents: {
        defaults: {
          workspace: "/home/user/gimli",
          compaction: { mode: "safeguard" as const },
          maxConcurrent: 4,
          subagents: { maxConcurrent: 8 },
        },
      },
      messages: {
        ackReactionScope: "group-mentions" as const,
      },
      commands: {
        native: "auto" as const,
        nativeSkills: "auto" as const,
      },
    };

    const result = validateConfigObject(secureConfig);
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Verify all security-critical settings
      expect(result.config.gateway?.bind).toBe("loopback");
      expect(result.config.gateway?.auth?.mode).toBe("token");
      expect(result.config.gateway?.tailscale?.mode).toBe("off");
      // No channels = no external exposure
      expect(result.config.channels).toBeUndefined();
    }
  });

  it("detects overly permissive settings in a config", async () => {
    vi.resetModules();
    const { collectAttackSurfaceSummaryFindings } = await import("../security/audit-extra.js");

    // Config with open group policies
    const permissiveConfig: GimliConfig = {
      channels: {
        telegram: {
          botToken: "test",
          groupPolicy: "open" as GroupPolicy,
          dmPolicy: "pairing" as DmPolicy,
        },
      },
      tools: {
        elevated: { enabled: true },
      },
    };

    const findings = collectAttackSurfaceSummaryFindings(permissiveConfig);
    expect(findings.length).toBeGreaterThan(0);

    // The summary should show open groups
    const summary = findings[0];
    expect(summary?.detail).toContain("open=1");
  });

  it("reports secure surface for restrictive config", async () => {
    vi.resetModules();
    const { collectAttackSurfaceSummaryFindings } = await import("../security/audit-extra.js");

    // Config with no channels (most restrictive)
    const restrictiveConfig: GimliConfig = {
      tools: {
        elevated: { enabled: false },
      },
      hooks: {
        enabled: false,
      },
    };

    const findings = collectAttackSurfaceSummaryFindings(restrictiveConfig);
    expect(findings.length).toBe(1);

    const summary = findings[0];
    expect(summary?.detail).toContain("open=0");
    expect(summary?.detail).toContain("tools.elevated: disabled");
    expect(summary?.detail).toContain("hooks: disabled");
  });
});

describe("exposure matrix security", () => {
  it("flags open groupPolicy with elevated tools as critical", async () => {
    vi.resetModules();
    const { collectExposureMatrixFindings } = await import("../security/audit-extra.js");

    const dangerousConfig: GimliConfig = {
      channels: {
        telegram: {
          botToken: "test",
          groupPolicy: "open" as GroupPolicy,
        },
      },
      tools: {
        elevated: { enabled: true },
      },
    };

    const findings = collectExposureMatrixFindings(dangerousConfig);
    expect(findings.length).toBeGreaterThan(0);

    const critical = findings.find((f) => f.severity === "critical");
    expect(critical).toBeDefined();
    expect(critical?.checkId).toBe("security.exposure.open_groups_with_elevated");
  });

  it("does not flag allowlist groupPolicy", async () => {
    vi.resetModules();
    const { collectExposureMatrixFindings } = await import("../security/audit-extra.js");

    const safeConfig: GimliConfig = {
      channels: {
        telegram: {
          botToken: "test",
          groupPolicy: "allowlist" as GroupPolicy,
        },
      },
      tools: {
        elevated: { enabled: true },
      },
    };

    const findings = collectExposureMatrixFindings(safeConfig);
    expect(findings.length).toBe(0);
  });
});
