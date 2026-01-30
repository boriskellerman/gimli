/**
 * Tests for session store lock timeout error messages.
 *
 * Verifies that lock timeout errors provide actionable guidance.
 * Tests use updateSessionStore which internally uses withSessionStoreLock.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { updateSessionStore } from "./store.js";

describe("Session Store Lock Timeout Error", () => {
  let tempDir: string;
  let storePath: string;
  let lockPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gimli-store-lock-test-"));
    storePath = path.join(tempDir, "sessions.json");
    lockPath = `${storePath}.lock`;
    fs.writeFileSync(storePath, "{}");
    // Set very short timeouts for testing via environment
    vi.stubEnv("GIMLI_SESSION_LOCK_TIMEOUT_MS", "100");
    vi.stubEnv("GIMLI_SESSION_LOCK_POLL_MS", "10");
    vi.stubEnv("GIMLI_SESSION_LOCK_STALE_MS", "60000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("includes elapsed time in timeout error", async () => {
    // Create a lock file that won't be released (simulating stuck process)
    fs.writeFileSync(lockPath, "locked");
    // Touch it to make it "fresh" (not stale)
    const now = new Date();
    fs.utimesSync(lockPath, now, now);

    try {
      await updateSessionStore(storePath, (store) => {
        store["test"] = { sessionId: "123", createdAt: Date.now(), updatedAt: Date.now() };
        return store["test"];
      });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      // Should mention the timeout duration
      expect(message).toMatch(/timeout after \d+s/i);
    }
  });

  it("includes lock file path in error", async () => {
    fs.writeFileSync(lockPath, "locked");
    const now = new Date();
    fs.utimesSync(lockPath, now, now);

    try {
      await updateSessionStore(storePath, () => null);
      expect.fail("Should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain(lockPath);
    }
  });

  it("explains possible causes", async () => {
    fs.writeFileSync(lockPath, "locked");
    const now = new Date();
    fs.utimesSync(lockPath, now, now);

    try {
      await updateSessionStore(storePath, () => null);
      expect.fail("Should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("another process");
      expect(message).toContain("crashed");
    }
  });

  it("provides recovery instructions", async () => {
    fs.writeFileSync(lockPath, "locked");
    const now = new Date();
    fs.utimesSync(lockPath, now, now);

    try {
      await updateSessionStore(storePath, () => null);
      expect.fail("Should have thrown");
    } catch (err) {
      const message = (err as Error).message;
      // Should suggest checking for processes
      expect(message).toContain("ps aux");
      expect(message).toContain("grep gimli");
      // Should suggest removing the lock file
      expect(message).toContain("rm");
      expect(message).toContain(lockPath);
      // Should suggest gateway restart
      expect(message).toContain("gimli gateway restart");
    }
  });

  it("successfully acquires lock when no contention", async () => {
    const result = await updateSessionStore(storePath, (store) => {
      store["test"] = { sessionId: "123", createdAt: Date.now(), updatedAt: Date.now() };
      return store["test"];
    });

    expect(result).toBeDefined();
    expect(result?.sessionId).toBe("123");
    // Lock should be released
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases lock after function completes", async () => {
    await updateSessionStore(storePath, (store) => {
      // Lock should exist during execution
      expect(fs.existsSync(lockPath)).toBe(true);
      store["test"] = { sessionId: "456", createdAt: Date.now(), updatedAt: Date.now() };
      return store["test"];
    });

    // Lock should be released after completion
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("releases lock even when function throws", async () => {
    try {
      await updateSessionStore(storePath, () => {
        throw new Error("inner error");
      });
    } catch {
      // Expected
    }

    // Lock should still be released
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
