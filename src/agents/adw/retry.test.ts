import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateRetryDelay,
  isRetryableError,
  sleep,
  withRetry,
  createRetryConfig,
  mergeRetryConfig,
} from "./retry.js";
import { DEFAULT_RETRY_CONFIG } from "./types.js";

describe("calculateRetryDelay", () => {
  it("calculates exponential backoff", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0 };

    expect(calculateRetryDelay(1, config)).toBe(1000); // 1000 * 2^0
    expect(calculateRetryDelay(2, config)).toBe(2000); // 1000 * 2^1
    expect(calculateRetryDelay(3, config)).toBe(4000); // 1000 * 2^2
    expect(calculateRetryDelay(4, config)).toBe(8000); // 1000 * 2^3
  });

  it("caps delay at maxDelayMs", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0, maxDelayMs: 5000 };

    expect(calculateRetryDelay(1, config)).toBe(1000);
    expect(calculateRetryDelay(3, config)).toBe(4000);
    expect(calculateRetryDelay(4, config)).toBe(5000); // Capped
    expect(calculateRetryDelay(10, config)).toBe(5000); // Still capped
  });

  it("applies jitter within expected range", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0.1 };

    // Run multiple times to test jitter variance
    const delays: number[] = [];
    for (let i = 0; i < 100; i++) {
      delays.push(calculateRetryDelay(1, config));
    }

    // All delays should be within 10% of 1000
    const min = Math.min(...delays);
    const max = Math.max(...delays);
    expect(min).toBeGreaterThanOrEqual(900);
    expect(max).toBeLessThanOrEqual(1100);

    // There should be some variance (not all the same)
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(1);
  });

  it("handles custom backoff multiplier", () => {
    const config = { ...DEFAULT_RETRY_CONFIG, jitterFactor: 0, backoffMultiplier: 3 };

    expect(calculateRetryDelay(1, config)).toBe(1000); // 1000 * 3^0
    expect(calculateRetryDelay(2, config)).toBe(3000); // 1000 * 3^1
    expect(calculateRetryDelay(3, config)).toBe(9000); // 1000 * 3^2
  });
});

describe("isRetryableError", () => {
  it("identifies retryable errors by code", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError({ code: "rate_limit" }, config)).toBe(true);
    expect(isRetryableError({ code: "timeout" }, config)).toBe(true);
    expect(isRetryableError({ code: "ETIMEDOUT" }, config)).toBe(true);
    expect(isRetryableError({ code: "ECONNRESET" }, config)).toBe(true);
  });

  it("identifies non-retryable errors by code", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError({ code: "auth" }, config)).toBe(false);
    expect(isRetryableError({ code: "billing" }, config)).toBe(false);
  });

  it("identifies retryable errors by status code", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError({ status: 429 }, config)).toBe(true);
    expect(isRetryableError({ status: 408 }, config)).toBe(true);
    expect(isRetryableError({ status: 503 }, config)).toBe(true);
  });

  it("identifies non-retryable errors by status code", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError({ status: 401 }, config)).toBe(false);
    expect(isRetryableError({ status: 402 }, config)).toBe(false);
    expect(isRetryableError({ status: 403 }, config)).toBe(false);
  });

  it("identifies retryable errors by message content", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError(new Error("rate_limit exceeded"), config)).toBe(true);
    expect(isRetryableError(new Error("Request timed out"), config)).toBe(true);
  });

  it("defaults to retryable for unknown errors", () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(isRetryableError(new Error("Unknown error"), config)).toBe(true);
    expect(isRetryableError("some string error", config)).toBe(true);
  });

  it("handles Error instances", () => {
    const config = DEFAULT_RETRY_CONFIG;

    const timeoutError = new Error("ETIMEDOUT");
    timeoutError.name = "TimeoutError";
    expect(isRetryableError(timeoutError, config)).toBe(true);
  });

  it("respects custom retryable patterns", () => {
    const config = {
      ...DEFAULT_RETRY_CONFIG,
      retryableErrors: ["custom_retry"],
      nonRetryableErrors: [],
    };

    expect(isRetryableError({ code: "custom_retry" }, config)).toBe(true);
    expect(isRetryableError({ code: "rate_limit" }, config)).toBe(true); // Still matches by message
  });
});

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after specified duration", async () => {
    const promise = sleep(1000);
    vi.advanceTimersByTime(999);
    await Promise.resolve(); // Flush microtasks
    vi.advanceTimersByTime(1);
    await expect(promise).resolves.toBeUndefined();
  });

  it("resolves immediately for zero or negative duration", async () => {
    await expect(sleep(0)).resolves.toBeUndefined();
    await expect(sleep(-100)).resolves.toBeUndefined();
  });

  it("rejects when abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(sleep(1000, controller.signal)).rejects.toThrow("Aborted");
  });

  it("rejects when abort signal fires during sleep", async () => {
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);

    vi.advanceTimersByTime(500);
    controller.abort();

    await expect(promise).rejects.toThrow("Aborted");
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns success on first attempt if no error", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3 },
    });

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.result).toBe("success");
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
    });

    // First attempt fails
    await vi.advanceTimersByTimeAsync(0);

    // Wait for retry delay
    await vi.advanceTimersByTimeAsync(100);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.result).toBe("success");
    expect(result.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("fails after max attempts exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent error"));

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
    });

    // First attempt
    await vi.advanceTimersByTimeAsync(0);
    // Retry delay and second attempt
    await vi.advanceTimersByTimeAsync(100);
    // Retry delay and third attempt
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe("persistent error");
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const error = new Error("auth error");
    (error as Error & { code: string }).code = "auth";
    const fn = vi.fn().mockRejectedValue(error);

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3 },
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onRetry callback before each retry", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

    const onRetry = vi.fn();

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3, initialDelayMs: 100, jitterFactor: 0 },
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    await resultPromise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error), 100);
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    // Pre-abort the signal before starting
    controller.abort();
    const fn = vi.fn().mockResolvedValue("success");

    const resultPromise = withRetry({
      fn,
      config: { maxAttempts: 3 },
      abortSignal: controller.signal,
    });

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toBe("Aborted");
    expect(result.retryable).toBe(false);
    // Function should not have been called because abort check happens first
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("createRetryConfig", () => {
  it("uses defaults when no config provided", () => {
    const config = createRetryConfig();

    expect(config.maxAttempts).toBe(DEFAULT_RETRY_CONFIG.maxAttempts);
    expect(config.initialDelayMs).toBe(DEFAULT_RETRY_CONFIG.initialDelayMs);
    expect(config.maxDelayMs).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
    expect(config.backoffMultiplier).toBe(DEFAULT_RETRY_CONFIG.backoffMultiplier);
    expect(config.jitterFactor).toBe(DEFAULT_RETRY_CONFIG.jitterFactor);
  });

  it("merges partial config with defaults", () => {
    const config = createRetryConfig({ maxAttempts: 5, initialDelayMs: 500 });

    expect(config.maxAttempts).toBe(5);
    expect(config.initialDelayMs).toBe(500);
    expect(config.maxDelayMs).toBe(DEFAULT_RETRY_CONFIG.maxDelayMs);
  });
});

describe("mergeRetryConfig", () => {
  it("merges base and override configs", () => {
    const base = { maxAttempts: 3, initialDelayMs: 1000 };
    const override = { maxAttempts: 5 };

    const merged = mergeRetryConfig(base, override);

    expect(merged.maxAttempts).toBe(5);
    expect(merged.initialDelayMs).toBe(1000);
  });

  it("returns base config when no override provided", () => {
    const base = { maxAttempts: 3 };
    const merged = mergeRetryConfig(base);

    expect(merged.maxAttempts).toBe(3);
  });
});
