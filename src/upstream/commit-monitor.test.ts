import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkForNewCommits,
  createCommitMonitorCronJob,
  createInitialState,
  DAILY_CRON_EXPRESSION,
  formatNewCommitsMessage,
  loadState,
  saveState,
  UPSTREAM_DEFAULT_BRANCH,
  UPSTREAM_REPO_URL,
  WEEKLY_CRON_EXPRESSION,
  type CommitCheckResult,
  type CommitInfo,
  type CommitMonitorState,
} from "./commit-monitor.js";

const noopLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-upstream-"));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function createMockCommits(count: number, startSha = "abc"): CommitInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    sha: `${startSha}${i}0000000000000000000000000000000000000`,
    message: `Commit message ${i + 1}`,
    author: `Author ${i + 1}`,
    date: new Date(Date.now() - i * 86400000).toISOString(),
    url: `https://github.com/openclaw/openclaw.ai/commit/${startSha}${i}`,
  }));
}

describe("commit-monitor", () => {
  beforeEach(() => {
    noopLogger.debug.mockClear();
    noopLogger.info.mockClear();
    noopLogger.warn.mockClear();
    noopLogger.error.mockClear();
  });

  describe("loadState / saveState", () => {
    it("returns null for non-existent state file", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "nonexistent.json");
        const state = await loadState(statePath);
        expect(state).toBeNull();
      });
    });

    it("saves and loads state correctly", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const state: CommitMonitorState = {
          version: 1,
          lastCheckedAtMs: 1700000000000,
          lastCommitSha: "abc123",
          upstreamRepo: UPSTREAM_REPO_URL,
          branch: "main",
        };

        await saveState(statePath, state);
        const loaded = await loadState(statePath);

        expect(loaded).toEqual(state);
      });
    });

    it("creates parent directories when saving", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "nested", "deep", "state.json");
        const state: CommitMonitorState = {
          version: 1,
          lastCheckedAtMs: 1700000000000,
          lastCommitSha: null,
          upstreamRepo: UPSTREAM_REPO_URL,
          branch: "main",
        };

        await saveState(statePath, state);
        const loaded = await loadState(statePath);

        expect(loaded).toEqual(state);
      });
    });

    it("returns null for invalid version", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        await fs.writeFile(statePath, JSON.stringify({ version: 99, lastCheckedAtMs: 0 }));

        const state = await loadState(statePath);
        expect(state).toBeNull();
      });
    });
  });

  describe("createInitialState", () => {
    it("creates state with correct defaults", () => {
      const state = createInitialState("main");

      expect(state.version).toBe(1);
      expect(state.lastCheckedAtMs).toBe(0);
      expect(state.lastCommitSha).toBeNull();
      expect(state.upstreamRepo).toBe(UPSTREAM_REPO_URL);
      expect(state.branch).toBe("main");
    });
  });

  describe("checkForNewCommits", () => {
    it("creates initial state on first run", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const mockCommits = createMockCommits(3);
        const fetchCommits = vi.fn().mockResolvedValue(mockCommits);

        const result = await checkForNewCommits({
          statePath,
          fetchCommits,
          log: noopLogger,
        });

        // First run should not report new commits
        expect(result.hasNewCommits).toBe(false);
        expect(result.newCommits).toHaveLength(0);
        expect(result.latestCommitSha).toBe(mockCommits[0].sha);

        // State should be saved
        const state = await loadState(statePath);
        expect(state).not.toBeNull();
        expect(state?.lastCommitSha).toBe(mockCommits[0].sha);
      });
    });

    it("detects new commits on subsequent runs", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const oldCommits = createMockCommits(2, "old");
        const newCommits = createMockCommits(2, "new");

        // First run - establish baseline
        const fetchCommits1 = vi.fn().mockResolvedValue(oldCommits);
        await checkForNewCommits({
          statePath,
          fetchCommits: fetchCommits1,
          log: noopLogger,
        });

        // Second run - with new commits
        const allCommits = [...newCommits, ...oldCommits];
        const fetchCommits2 = vi.fn().mockResolvedValue(allCommits);
        const result = await checkForNewCommits({
          statePath,
          fetchCommits: fetchCommits2,
          log: noopLogger,
        });

        expect(result.hasNewCommits).toBe(true);
        expect(result.newCommits).toHaveLength(2);
        expect(result.newCommits[0].sha).toBe(newCommits[0].sha);
        expect(result.latestCommitSha).toBe(newCommits[0].sha);
      });
    });

    it("reports no new commits when up to date", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const commits = createMockCommits(3);
        const fetchCommits = vi.fn().mockResolvedValue(commits);

        // First run
        await checkForNewCommits({
          statePath,
          fetchCommits,
          log: noopLogger,
        });

        // Second run with same commits
        const result = await checkForNewCommits({
          statePath,
          fetchCommits,
          log: noopLogger,
        });

        expect(result.hasNewCommits).toBe(false);
        expect(result.newCommits).toHaveLength(0);
      });
    });

    it("handles fetch errors gracefully", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const fetchCommits = vi.fn().mockRejectedValue(new Error("Network error"));

        const result = await checkForNewCommits({
          statePath,
          fetchCommits,
          log: noopLogger,
        });

        expect(result.hasNewCommits).toBe(false);
        expect(result.error).toBe("Network error");
        expect(noopLogger.error).toHaveBeenCalled();
      });
    });

    it("uses custom nowMs function", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const mockCommits = createMockCommits(1);
        const fetchCommits = vi.fn().mockResolvedValue(mockCommits);
        const fixedTime = 1700000000000;

        const result = await checkForNewCommits({
          statePath,
          fetchCommits,
          nowMs: () => fixedTime,
          log: noopLogger,
        });

        expect(result.checkedAtMs).toBe(fixedTime);
      });
    });

    it("passes since date to fetch when state exists", async () => {
      await withTempDir(async (dir) => {
        const statePath = path.join(dir, "state.json");
        const commits = createMockCommits(1);
        const fetchCommits = vi.fn().mockResolvedValue(commits);
        const lastCheckedAtMs = 1700000000000;

        // Save initial state
        await saveState(statePath, {
          version: 1,
          lastCheckedAtMs,
          lastCommitSha: "oldsha",
          upstreamRepo: UPSTREAM_REPO_URL,
          branch: "main",
        });

        await checkForNewCommits({
          statePath,
          fetchCommits,
          log: noopLogger,
        });

        expect(fetchCommits).toHaveBeenCalledWith(
          "openclaw",
          "openclaw.ai",
          "main",
          new Date(lastCheckedAtMs).toISOString(),
        );
      });
    });
  });

  describe("createCommitMonitorCronJob", () => {
    it("creates daily cron job by default", () => {
      const job = createCommitMonitorCronJob();

      expect(job.name).toBe("upstream-commit-monitor");
      expect(job.enabled).toBe(true);
      expect(job.schedule.kind).toBe("cron");
      expect(job.schedule.expr).toBe(DAILY_CRON_EXPRESSION);
      expect(job.sessionTarget).toBe("isolated");
    });

    it("creates weekly cron job when specified", () => {
      const job = createCommitMonitorCronJob("weekly");

      expect(job.schedule.expr).toBe(WEEKLY_CRON_EXPRESSION);
      expect(job.description).toContain("weekly");
    });

    it("includes isolation config for main session posting", () => {
      const job = createCommitMonitorCronJob();

      expect(job.isolation).toBeDefined();
      expect(job.isolation?.postToMainPrefix).toBe("[Upstream]");
      expect(job.isolation?.postToMainMode).toBe("summary");
    });
  });

  describe("formatNewCommitsMessage", () => {
    it("returns message for no new commits", () => {
      const result: CommitCheckResult = {
        hasNewCommits: false,
        newCommits: [],
        latestCommitSha: "abc123",
        checkedAtMs: Date.now(),
      };

      const message = formatNewCommitsMessage(result);
      expect(message).toBe("No new upstream commits found.");
    });

    it("formats single new commit", () => {
      const result: CommitCheckResult = {
        hasNewCommits: true,
        newCommits: [
          {
            sha: "abc123456789",
            message: "Fix bug in parser",
            author: "Jane Doe",
            date: "2024-01-15T10:00:00Z",
            url: "https://github.com/openclaw/openclaw.ai/commit/abc123",
          },
        ],
        latestCommitSha: "abc123456789",
        checkedAtMs: Date.now(),
      };

      const message = formatNewCommitsMessage(result);

      expect(message).toContain("Found 1 new upstream commit:");
      expect(message).toContain("abc1234");
      expect(message).toContain("Fix bug in parser");
      expect(message).toContain("Jane Doe");
    });

    it("formats multiple new commits", () => {
      const result: CommitCheckResult = {
        hasNewCommits: true,
        newCommits: createMockCommits(3),
        latestCommitSha: "abc00000",
        checkedAtMs: Date.now(),
      };

      const message = formatNewCommitsMessage(result);

      expect(message).toContain("Found 3 new upstream commits:");
      expect(message).toContain("Commit message 1");
      expect(message).toContain("Commit message 2");
      expect(message).toContain("Commit message 3");
    });

    it("truncates at 10 commits", () => {
      const result: CommitCheckResult = {
        hasNewCommits: true,
        newCommits: createMockCommits(15),
        latestCommitSha: "abc00000",
        checkedAtMs: Date.now(),
      };

      const message = formatNewCommitsMessage(result);

      expect(message).toContain("Found 15 new upstream commits:");
      expect(message).toContain("... and 5 more");
    });

    it("includes link to upstream repo", () => {
      const result: CommitCheckResult = {
        hasNewCommits: true,
        newCommits: createMockCommits(1),
        latestCommitSha: "abc00000",
        checkedAtMs: Date.now(),
      };

      const message = formatNewCommitsMessage(result);

      expect(message).toContain(
        `View all: ${UPSTREAM_REPO_URL}/commits/${UPSTREAM_DEFAULT_BRANCH}`,
      );
    });
  });

  describe("cron expressions", () => {
    it("has valid daily cron expression (6 AM UTC)", () => {
      expect(DAILY_CRON_EXPRESSION).toBe("0 6 * * *");
    });

    it("has valid weekly cron expression (Sunday 6 AM UTC)", () => {
      expect(WEEKLY_CRON_EXPRESSION).toBe("0 6 * * 0");
    });
  });
});
