import net from "node:net";

import { pickPrimaryTailnetIPv4, pickPrimaryTailnetIPv6 } from "../infra/tailnet.js";

export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:127.")) return true;
  return false;
}

function normalizeIPv4MappedAddress(ip: string): string {
  if (ip.startsWith("::ffff:")) return ip.slice("::ffff:".length);
  return ip;
}

function normalizeIp(ip: string | undefined): string | undefined {
  const trimmed = ip?.trim();
  if (!trimmed) return undefined;
  return normalizeIPv4MappedAddress(trimmed.toLowerCase());
}

function stripOptionalPort(ip: string): string {
  if (ip.startsWith("[")) {
    const end = ip.indexOf("]");
    if (end !== -1) return ip.slice(1, end);
  }
  if (net.isIP(ip)) return ip;
  const lastColon = ip.lastIndexOf(":");
  if (lastColon > -1 && ip.includes(".") && ip.indexOf(":") === lastColon) {
    const candidate = ip.slice(0, lastColon);
    if (net.isIP(candidate) === 4) return candidate;
  }
  return ip;
}

export function parseForwardedForClientIp(forwardedFor?: string): string | undefined {
  const raw = forwardedFor?.split(",")[0]?.trim();
  if (!raw) return undefined;
  return normalizeIp(stripOptionalPort(raw));
}

function parseRealIp(realIp?: string): string | undefined {
  const raw = realIp?.trim();
  if (!raw) return undefined;
  return normalizeIp(stripOptionalPort(raw));
}

export function isTrustedProxyAddress(ip: string | undefined, trustedProxies?: string[]): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized || !trustedProxies || trustedProxies.length === 0) return false;
  return trustedProxies.some((proxy) => normalizeIp(proxy) === normalized);
}

export function resolveGatewayClientIp(params: {
  remoteAddr?: string;
  forwardedFor?: string;
  realIp?: string;
  trustedProxies?: string[];
}): string | undefined {
  const remote = normalizeIp(params.remoteAddr);
  if (!remote) return undefined;
  if (!isTrustedProxyAddress(remote, params.trustedProxies)) return remote;
  return parseForwardedForClientIp(params.forwardedFor) ?? parseRealIp(params.realIp) ?? remote;
}

export function isLocalGatewayAddress(ip: string | undefined): boolean {
  if (isLoopbackAddress(ip)) return true;
  if (!ip) return false;
  const normalized = normalizeIPv4MappedAddress(ip.trim().toLowerCase());
  const tailnetIPv4 = pickPrimaryTailnetIPv4();
  if (tailnetIPv4 && normalized === tailnetIPv4.toLowerCase()) return true;
  const tailnetIPv6 = pickPrimaryTailnetIPv6();
  if (tailnetIPv6 && ip.trim().toLowerCase() === tailnetIPv6.toLowerCase()) return true;
  return false;
}

/**
 * Resolves gateway bind host with fallback strategy.
 *
 * SECURITY: Gimli defaults to loopback (127.0.0.1) and never silently falls
 * back to 0.0.0.0. LAN binding requires explicit opt-in via bind="lan".
 * This prevents accidental exposure of the gateway to the network.
 *
 * Modes:
 * - loopback: 127.0.0.1 (default, safest)
 * - lan: 0.0.0.0 (explicit opt-in for network access)
 * - tailnet: Tailnet IPv4 if available, else loopback
 * - auto: Loopback only (no LAN fallback for security)
 * - custom: User-specified IP, fallback to loopback if unavailable
 *
 * @returns The bind address to use (never null)
 */
export async function resolveGatewayBindHost(
  bind: import("../config/config.js").GatewayBindMode | undefined,
  customHost?: string,
): Promise<string> {
  const mode = bind ?? "loopback";

  if (mode === "loopback") {
    if (await canBindToHost("127.0.0.1")) return "127.0.0.1";
    // SECURITY: Do not fall back to 0.0.0.0 — stay on loopback
    console.warn("[security] Cannot bind to 127.0.0.1, trying ::1");
    if (await canBindToHost("::1")) return "::1";
    console.error("[security] Cannot bind to any loopback address");
    return "127.0.0.1"; // Return loopback anyway; let the server error handle it
  }

  if (mode === "tailnet") {
    const tailnetIP = pickPrimaryTailnetIPv4();
    if (tailnetIP && (await canBindToHost(tailnetIP))) return tailnetIP;
    // SECURITY: Fall back to loopback, not 0.0.0.0
    if (await canBindToHost("127.0.0.1")) return "127.0.0.1";
    return "127.0.0.1";
  }

  if (mode === "lan") {
    // Explicit opt-in for network binding — this is the only mode that uses 0.0.0.0
    console.warn(
      "[security] Gateway binding to 0.0.0.0 (all interfaces). Ensure authentication is configured.",
    );
    return "0.0.0.0";
  }

  if (mode === "custom") {
    const host = customHost?.trim();
    if (!host) {
      // SECURITY: Invalid config falls back to loopback, not 0.0.0.0
      console.warn("[security] No custom bind host specified, falling back to loopback");
      return "127.0.0.1";
    }
    if (isValidIPv4(host) && (await canBindToHost(host))) return host;
    // SECURITY: Custom IP failed → fall back to loopback, not LAN
    console.warn(`[security] Cannot bind to custom host ${host}, falling back to loopback`);
    return "127.0.0.1";
  }

  if (mode === "auto") {
    if (await canBindToHost("127.0.0.1")) return "127.0.0.1";
    // SECURITY: Do not fall back to 0.0.0.0
    return "127.0.0.1";
  }

  // SECURITY: Unknown mode defaults to loopback
  return "127.0.0.1";
}

/**
 * Test if we can bind to a specific host address.
 * Creates a temporary server, attempts to bind, then closes it.
 *
 * @param host - The host address to test
 * @returns True if we can successfully bind to this address
 */
export async function canBindToHost(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.once("error", () => {
      resolve(false);
    });
    testServer.once("listening", () => {
      testServer.close();
      resolve(true);
    });
    // Use port 0 to let OS pick an available port for testing
    testServer.listen(0, host);
  });
}

export async function resolveGatewayListenHosts(
  bindHost: string,
  opts?: { canBindToHost?: (host: string) => Promise<boolean> },
): Promise<string[]> {
  if (bindHost !== "127.0.0.1") return [bindHost];
  const canBind = opts?.canBindToHost ?? canBindToHost;
  if (await canBind("::1")) return [bindHost, "::1"];
  return [bindHost];
}

/**
 * Validate if a string is a valid IPv4 address.
 *
 * @param host - The string to validate
 * @returns True if valid IPv4 format
 */
function isValidIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = parseInt(part, 10);
    return !Number.isNaN(n) && n >= 0 && n <= 255 && part === String(n);
  });
}

export function isLoopbackHost(host: string): boolean {
  return isLoopbackAddress(host);
}
