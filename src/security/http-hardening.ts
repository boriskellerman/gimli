/**
 * HTTP security hardening middleware for the Gimli gateway.
 *
 * Provides security headers (similar to helmet), CORS controls,
 * and CSRF protection for the gateway HTTP/WebSocket endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export interface HttpHardeningConfig {
  /** Allowed CORS origins. Default: none (same-origin only) */
  allowedOrigins: string[];
  /** Whether to enable CSRF token validation. Default: true */
  csrfEnabled: boolean;
  /** Bind mode affects CORS behavior */
  bindMode: "loopback" | "lan" | "public";
}

const DEFAULT_CONFIG: HttpHardeningConfig = {
  allowedOrigins: [],
  csrfEnabled: true,
  bindMode: "loopback",
};

/**
 * Apply security headers to every HTTP response.
 * Covers OWASP recommended headers.
 */
export function applySecurityHeaders(res: ServerResponse): void {
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");

  // Enable XSS filter (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Strict transport security (if behind HTTPS)
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

  // Prevent information leakage via referrer
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  );

  // Disable client-side caching for API responses
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  // Remove server identification
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
}

/**
 * CORS middleware for the gateway.
 * Returns true if the request should be allowed, false if blocked.
 */
export function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  config: Partial<HttpHardeningConfig> = {},
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const origin = req.headers.origin;

  // No origin header means same-origin request — always allowed
  if (!origin) return true;

  // In loopback mode, only allow localhost origins
  if (cfg.bindMode === "loopback") {
    const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1|::1)(:\d+)?$/;
    if (!localhostPattern.test(origin)) {
      res.statusCode = 403;
      res.end("Forbidden: Cross-origin request to loopback-bound gateway");
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (cfg.allowedOrigins.length > 0) {
    // Check against explicit allowlist
    if (!cfg.allowedOrigins.includes(origin)) {
      res.statusCode = 403;
      res.end("Forbidden: Origin not in allowlist");
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // No allowed origins configured and not loopback — deny all cross-origin
    res.statusCode = 403;
    res.end("Forbidden: Cross-origin requests not configured");
    return false;
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "600");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return false; // Don't continue processing
  }

  return true;
}

/**
 * CSRF token manager.
 * Generates and validates per-session CSRF tokens.
 */
export class CsrfTokenManager {
  private tokens = new Map<string, { token: string; createdAt: number }>();
  private readonly TOKEN_TTL = 60 * 60 * 1000; // 1 hour

  /**
   * Generate a new CSRF token for a session.
   */
  generateToken(sessionId: string): string {
    const token = randomBytes(32).toString("hex");
    this.tokens.set(sessionId, { token, createdAt: Date.now() });
    this.cleanup();
    return token;
  }

  /**
   * Validate a CSRF token for a session.
   */
  validateToken(sessionId: string, token: string): boolean {
    const entry = this.tokens.get(sessionId);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > this.TOKEN_TTL) {
      this.tokens.delete(sessionId);
      return false;
    }
    // Constant-time comparison to prevent timing attacks
    if (entry.token.length !== token.length) return false;
    const a = Buffer.from(entry.token);
    const b = Buffer.from(token);
    return timingSafeEqual(a, b);
  }

  /**
   * Remove expired tokens.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, entry] of this.tokens) {
      if (now - entry.createdAt > this.TOKEN_TTL) {
        this.tokens.delete(sessionId);
      }
    }
  }
}
