/**
 * Rate limiter for the Gimli gateway.
 *
 * Implements a sliding-window rate limiter with per-client tracking
 * and exponential backoff on abuse detection.
 */

export interface RateLimiterConfig {
  /** Max requests per window. Default: 100 */
  maxRequests: number;
  /** Window size in milliseconds. Default: 60_000 (1 minute) */
  windowMs: number;
  /** Max concurrent connections per client. Default: 10 */
  maxConcurrent: number;
  /** Whether to enable rate limiting. Default: true */
  enabled: boolean;
}

interface ClientState {
  /** Timestamps of requests within the current window */
  requests: number[];
  /** Active concurrent connections */
  concurrent: number;
  /** Number of times this client has been rate-limited */
  violations: number;
  /** Backoff until timestamp (0 = no backoff) */
  backoffUntil: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 100,
  windowMs: 60_000,
  maxConcurrent: 10,
  enabled: true,
};

export class RateLimiter {
  private clients = new Map<string, ClientState>();
  private config: RateLimiterConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // Clean up stale entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60_000);
    // Allow the timer to not block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if a request from the given client ID should be allowed.
   * Returns { allowed: true } or { allowed: false, retryAfterMs }.
   */
  checkRequest(clientId: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    const now = Date.now();
    let state = this.clients.get(clientId);

    if (!state) {
      state = { requests: [], concurrent: 0, violations: 0, backoffUntil: 0 };
      this.clients.set(clientId, state);
    }

    // Check backoff
    if (state.backoffUntil > now) {
      return { allowed: false, retryAfterMs: state.backoffUntil - now };
    }

    // Prune old requests outside the window
    const windowStart = now - this.config.windowMs;
    state.requests = state.requests.filter((ts) => ts > windowStart);

    // Check rate limit
    if (state.requests.length >= this.config.maxRequests) {
      state.violations++;
      // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 5 minutes
      const backoffMs = Math.min(1000 * Math.pow(2, state.violations - 1), 5 * 60_000);
      state.backoffUntil = now + backoffMs;
      return { allowed: false, retryAfterMs: backoffMs };
    }

    // Check concurrent connections
    if (state.concurrent >= this.config.maxConcurrent) {
      return { allowed: false, retryAfterMs: 1000 };
    }

    // Allow the request
    state.requests.push(now);
    return { allowed: true };
  }

  /** Track a new concurrent connection for a client */
  addConnection(clientId: string): void {
    const state = this.clients.get(clientId);
    if (state) {
      state.concurrent++;
    }
  }

  /** Release a concurrent connection for a client */
  removeConnection(clientId: string): void {
    const state = this.clients.get(clientId);
    if (state && state.concurrent > 0) {
      state.concurrent--;
    }
  }

  /** Reset violation count for a client (e.g., after successful auth) */
  resetViolations(clientId: string): void {
    const state = this.clients.get(clientId);
    if (state) {
      state.violations = 0;
      state.backoffUntil = 0;
    }
  }

  /** Remove stale client entries with no recent activity */
  private cleanup(): void {
    const now = Date.now();
    const staleThreshold = now - this.config.windowMs * 10;
    for (const [clientId, state] of this.clients) {
      const lastRequest = state.requests[state.requests.length - 1] ?? 0;
      if (lastRequest < staleThreshold && state.concurrent === 0) {
        this.clients.delete(clientId);
      }
    }
  }

  /** Shut down the rate limiter and clear timers */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.clients.clear();
  }

  /** Get stats for monitoring */
  getStats(): { totalClients: number; totalViolations: number } {
    let totalViolations = 0;
    for (const state of this.clients.values()) {
      totalViolations += state.violations;
    }
    return { totalClients: this.clients.size, totalViolations };
  }
}
