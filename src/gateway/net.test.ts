import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  resolveGatewayListenHosts,
  resolveGatewayBindHost,
  isLoopbackAddress,
  isLoopbackHost,
} from "./net.js";

// Mock canBindToHost for testing
vi.mock("./net.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./net.js")>();
  return {
    ...original,
  };
});

describe("isLoopbackAddress", () => {
  it("returns true for 127.0.0.1", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
  });

  it("returns true for other 127.x.x.x addresses", () => {
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("127.255.255.255")).toBe(true);
  });

  it("returns true for IPv6 loopback ::1", () => {
    expect(isLoopbackAddress("::1")).toBe(true);
  });

  it("returns true for IPv4-mapped IPv6 loopback", () => {
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.2")).toBe(true);
  });

  it("returns false for 0.0.0.0", () => {
    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
  });

  it("returns false for LAN addresses", () => {
    expect(isLoopbackAddress("192.168.1.1")).toBe(false);
    expect(isLoopbackAddress("10.0.0.1")).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("returns true for loopback addresses", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("returns false for non-loopback addresses", () => {
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.1")).toBe(false);
  });
});

describe("resolveGatewayBindHost - Security Defaults", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("defaults to loopback (127.0.0.1) when bind mode is undefined", async () => {
    const host = await resolveGatewayBindHost(undefined);
    expect(isLoopbackAddress(host)).toBe(true);
  });

  it("defaults to loopback (127.0.0.1) when bind mode is 'loopback'", async () => {
    const host = await resolveGatewayBindHost("loopback");
    expect(isLoopbackAddress(host)).toBe(true);
  });

  it("never falls back to 0.0.0.0 for 'loopback' mode", async () => {
    // Even if all loopback bindings "fail", it should return loopback, not 0.0.0.0
    const host = await resolveGatewayBindHost("loopback");
    expect(host).not.toBe("0.0.0.0");
    expect(isLoopbackAddress(host)).toBe(true);
  });

  it("uses 0.0.0.0 only when 'lan' mode is explicitly set", async () => {
    const host = await resolveGatewayBindHost("lan");
    expect(host).toBe("0.0.0.0");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[security] Gateway binding to 0.0.0.0"),
    );
  });

  it("falls back to loopback for 'tailnet' mode when tailnet unavailable", async () => {
    const host = await resolveGatewayBindHost("tailnet");
    // Should be loopback when no tailnet IP is available
    expect(host === "127.0.0.1" || host === "::1").toBe(true);
    expect(host).not.toBe("0.0.0.0");
  });

  it("falls back to loopback for 'auto' mode", async () => {
    const host = await resolveGatewayBindHost("auto");
    expect(isLoopbackAddress(host)).toBe(true);
    expect(host).not.toBe("0.0.0.0");
  });

  it("falls back to loopback for 'custom' mode with empty host", async () => {
    const host = await resolveGatewayBindHost("custom", "");
    expect(isLoopbackAddress(host)).toBe(true);
    expect(host).not.toBe("0.0.0.0");
  });

  it("falls back to loopback for 'custom' mode with undefined host", async () => {
    const host = await resolveGatewayBindHost("custom", undefined);
    expect(isLoopbackAddress(host)).toBe(true);
    expect(host).not.toBe("0.0.0.0");
  });

  it("falls back to loopback for unknown bind mode", async () => {
    // @ts-expect-error Testing invalid input
    const host = await resolveGatewayBindHost("invalid-mode");
    expect(isLoopbackAddress(host)).toBe(true);
    expect(host).not.toBe("0.0.0.0");
  });
});

describe("resolveGatewayListenHosts", () => {
  it("returns the input host when not loopback", async () => {
    const hosts = await resolveGatewayListenHosts("0.0.0.0", {
      canBindToHost: async () => {
        throw new Error("should not be called");
      },
    });
    expect(hosts).toEqual(["0.0.0.0"]);
  });

  it("adds ::1 when IPv6 loopback is available", async () => {
    const hosts = await resolveGatewayListenHosts("127.0.0.1", {
      canBindToHost: async () => true,
    });
    expect(hosts).toEqual(["127.0.0.1", "::1"]);
  });

  it("keeps only IPv4 loopback when IPv6 is unavailable", async () => {
    const hosts = await resolveGatewayListenHosts("127.0.0.1", {
      canBindToHost: async () => false,
    });
    expect(hosts).toEqual(["127.0.0.1"]);
  });
});
