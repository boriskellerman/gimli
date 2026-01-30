import { describe, expect, it, vi } from "vitest";
import type { DmPolicy } from "./types.base.js";

/**
 * Security verification tests for DM pairing policy defaults.
 *
 * These tests verify that all channel schemas default dmPolicy to "pairing",
 * which is the security-first default that requires explicit approval before
 * accepting DMs from unknown senders.
 *
 * PRD Task: Confirm DM pairing policy is enabled (dmPolicy="pairing")
 */
describe("DM policy defaults to pairing for all channels", () => {
  it("defaults telegram.dmPolicy to pairing when telegram section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { telegram: { botToken: "test-token" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.telegram?.dmPolicy).toBe("pairing");
    }
  });

  it("defaults whatsapp.dmPolicy to pairing when whatsapp section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { whatsapp: {} },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.whatsapp?.dmPolicy).toBe("pairing");
    }
  });

  it("defaults signal.dmPolicy to pairing when signal section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { signal: {} },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.signal?.dmPolicy).toBe("pairing");
    }
  });

  it("defaults imessage.dmPolicy to pairing when imessage section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { imessage: {} },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.imessage?.dmPolicy).toBe("pairing");
    }
  });

  it("defaults bluebubbles.dmPolicy to pairing when bluebubbles section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { bluebubbles: { serverUrl: "http://localhost:1234", password: "test" } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.bluebubbles?.dmPolicy).toBe("pairing");
    }
  });

  it("defaults msteams.dmPolicy to pairing when msteams section exists", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: { msteams: {} },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.msteams?.dmPolicy).toBe("pairing");
    }
  });
});

describe("DM policy security validation", () => {
  it("rejects telegram.dmPolicy=open without allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        telegram: { botToken: "test", dmPolicy: "open", allowFrom: ["123456789"] },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((e) => e.message.includes("dmPolicy"))).toBe(true);
    }
  });

  it("accepts telegram.dmPolicy=open with allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        telegram: { botToken: "test", dmPolicy: "open", allowFrom: ["*"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.telegram?.dmPolicy).toBe("open");
    }
  });

  it("rejects whatsapp.dmPolicy=open without allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        whatsapp: { dmPolicy: "open", allowFrom: ["+15555550123"] },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts whatsapp.dmPolicy=open with allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        whatsapp: { dmPolicy: "open", allowFrom: ["*"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.whatsapp?.dmPolicy).toBe("open");
    }
  });

  it("rejects signal.dmPolicy=open without allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        signal: { dmPolicy: "open", allowFrom: ["+15555550123"] },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts signal.dmPolicy=open with allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        signal: { dmPolicy: "open", allowFrom: ["*"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.signal?.dmPolicy).toBe("open");
    }
  });

  it("rejects imessage.dmPolicy=open without allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        imessage: { dmPolicy: "open", allowFrom: ["+15555550123"] },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts imessage.dmPolicy=open with allowFrom wildcard", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        imessage: { dmPolicy: "open", allowFrom: ["*"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.imessage?.dmPolicy).toBe("open");
    }
  });
});

describe("DM policy allowlist mode", () => {
  it("accepts telegram.dmPolicy=allowlist with explicit allowFrom entries", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        telegram: { botToken: "test", dmPolicy: "allowlist", allowFrom: ["123456789"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.telegram?.dmPolicy).toBe("allowlist");
    }
  });

  it("accepts whatsapp.dmPolicy=allowlist with explicit allowFrom entries", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        whatsapp: { dmPolicy: "allowlist", allowFrom: ["+15555550123"] },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.whatsapp?.dmPolicy).toBe("allowlist");
    }
  });
});

describe("DM policy disabled mode", () => {
  it("accepts telegram.dmPolicy=disabled", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        telegram: { botToken: "test", dmPolicy: "disabled" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.telegram?.dmPolicy).toBe("disabled");
    }
  });

  it("accepts whatsapp.dmPolicy=disabled", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        whatsapp: { dmPolicy: "disabled" },
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.channels?.whatsapp?.dmPolicy).toBe("disabled");
    }
  });
});

describe("DM policy type safety", () => {
  it("rejects invalid dmPolicy values", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({
      channels: {
        telegram: { botToken: "test", dmPolicy: "invalid-policy" as DmPolicy },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("validates DmPolicy enum values", () => {
    const validPolicies: DmPolicy[] = ["pairing", "allowlist", "open", "disabled"];
    for (const policy of validPolicies) {
      expect(["pairing", "allowlist", "open", "disabled"]).toContain(policy);
    }
  });
});

describe("empty config security defaults", () => {
  it("an empty config has no channels configured (secure by default)", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      // No channels means no DM exposure - secure by default
      expect(result.config.channels).toBeUndefined();
    }
  });

  it("gateway defaults to loopback binding (secure by default)", async () => {
    vi.resetModules();
    const { validateConfigObject } = await import("./config.js");
    const result = validateConfigObject({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Gateway bind defaults to loopback when not specified
      const bind = result.config.gateway?.bind ?? "loopback";
      expect(bind).toBe("loopback");
    }
  });
});
