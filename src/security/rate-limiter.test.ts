import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it("allows requests under the limit", () => {
    limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) {
      const result = limiter.checkRequest("client1");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests over the limit", () => {
    limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) {
      limiter.checkRequest("client1");
    }
    const result = limiter.checkRequest("client1");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("tracks clients independently", () => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    limiter.checkRequest("client1");
    limiter.checkRequest("client1");
    const blocked = limiter.checkRequest("client1");
    expect(blocked.allowed).toBe(false);

    // Different client should still be allowed
    const allowed = limiter.checkRequest("client2");
    expect(allowed.allowed).toBe(true);
  });

  it("applies exponential backoff on violations", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.checkRequest("client1");

    // First violation
    const first = limiter.checkRequest("client1");
    expect(first.allowed).toBe(false);
    if (!first.allowed) {
      expect(first.retryAfterMs).toBe(1000); // 2^0 * 1000
    }
  });

  it("passes through when disabled", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000, enabled: false });
    limiter.checkRequest("client1");
    const result = limiter.checkRequest("client1"); // Would be blocked if enabled
    expect(result.allowed).toBe(true);
  });

  it("reports stats", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.checkRequest("client1");
    limiter.checkRequest("client1"); // Triggers violation
    limiter.checkRequest("client2");

    const stats = limiter.getStats();
    expect(stats.totalClients).toBe(2);
    expect(stats.totalViolations).toBe(1);
  });

  it("resets violations", () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.checkRequest("client1");
    limiter.checkRequest("client1"); // Violation

    limiter.resetViolations("client1");
    const stats = limiter.getStats();
    expect(stats.totalViolations).toBe(0);
  });
});
