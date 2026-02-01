/**
 * Upstream commit monitor for OpenClaw repository.
 * Periodically checks for new commits and stores the last checked state.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { CONFIG_DIR } from "../utils.js";

export const UPSTREAM_REPO_URL = "https://github.com/openclaw/openclaw.ai";
export const UPSTREAM_REPO_OWNER = "openclaw";
export const UPSTREAM_REPO_NAME = "openclaw.ai";
export const UPSTREAM_DEFAULT_BRANCH = "main";

export const DEFAULT_UPSTREAM_DIR = path.join(CONFIG_DIR, "upstream");
export const DEFAULT_STATE_PATH = path.join(DEFAULT_UPSTREAM_DIR, "commit-state.json");

/** Cron expression for daily check at 6 AM UTC */
export const DAILY_CRON_EXPRESSION = "0 6 * * *";
/** Cron expression for weekly check on Sunday at 6 AM UTC */
export const WEEKLY_CRON_EXPRESSION = "0 6 * * 0";

export type CommitInfo = {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
};

export type CommitMonitorState = {
  version: 1;
  lastCheckedAtMs: number;
  lastCommitSha: string | null;
  upstreamRepo: string;
  branch: string;
};

export type CommitCheckResult = {
  hasNewCommits: boolean;
  newCommits: CommitInfo[];
  latestCommitSha: string | null;
  checkedAtMs: number;
  error?: string;
};

export type CommitMonitorDeps = {
  statePath?: string;
  branch?: string;
  /** Function to fetch commits from GitHub API. Defaults to fetchGitHubCommits. */
  fetchCommits?: (
    owner: string,
    repo: string,
    branch: string,
    since?: string,
  ) => Promise<CommitInfo[]>;
  /** Custom time function for testing. */
  nowMs?: () => number;
  /** Logger for debug/info output. */
  log?: {
    debug: (obj: unknown, msg?: string) => void;
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
};

type GitHubCommitResponse = {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  html_url: string;
};

/**
 * Fetches commits from GitHub API.
 * Uses the public API endpoint which has rate limits (60 req/hour unauthenticated).
 */
export async function fetchGitHubCommits(
  owner: string,
  repo: string,
  branch: string,
  since?: string,
): Promise<CommitInfo[]> {
  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/commits`);
  url.searchParams.set("sha", branch);
  url.searchParams.set("per_page", "30");
  if (since) {
    url.searchParams.set("since", since);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "gimli-upstream-monitor",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${text}`);
  }

  const data = (await response.json()) as GitHubCommitResponse[];

  return data.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message.split("\n")[0], // First line only
    author: commit.commit.author.name,
    date: commit.commit.author.date,
    url: commit.html_url,
  }));
}

/**
 * Loads the commit monitor state from disk.
 */
export async function loadState(statePath: string): Promise<CommitMonitorState | null> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw) as CommitMonitorState;
    if (parsed.version !== 1) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Saves the commit monitor state to disk.
 */
export async function saveState(statePath: string, state: CommitMonitorState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(state, null, 2);
  await fs.writeFile(tmp, json, "utf-8");
  await fs.rename(tmp, statePath);
}

/**
 * Creates a new commit monitor state with defaults.
 */
export function createInitialState(branch: string): CommitMonitorState {
  return {
    version: 1,
    lastCheckedAtMs: 0,
    lastCommitSha: null,
    upstreamRepo: UPSTREAM_REPO_URL,
    branch,
  };
}

/**
 * Checks for new commits in the upstream repository.
 */
export async function checkForNewCommits(deps: CommitMonitorDeps = {}): Promise<CommitCheckResult> {
  const statePath = deps.statePath ?? DEFAULT_STATE_PATH;
  const branch = deps.branch ?? UPSTREAM_DEFAULT_BRANCH;
  const fetchCommitsFn = deps.fetchCommits ?? fetchGitHubCommits;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const log = deps.log;

  const checkedAtMs = nowMs();

  // Load existing state or create new
  let state = await loadState(statePath);
  if (!state) {
    state = createInitialState(branch);
    log?.debug({ statePath }, "upstream: created new state");
  }

  try {
    // Fetch commits since last check (or all recent if first check)
    const sinceDate =
      state.lastCheckedAtMs > 0 ? new Date(state.lastCheckedAtMs).toISOString() : undefined;

    log?.debug({ branch, since: sinceDate }, "upstream: fetching commits");

    const commits = await fetchCommitsFn(
      UPSTREAM_REPO_OWNER,
      UPSTREAM_REPO_NAME,
      branch,
      sinceDate,
    );

    // Filter out commits we've already seen
    const newCommits: CommitInfo[] = [];
    let foundLastSeen = false;

    for (const commit of commits) {
      if (state.lastCommitSha && commit.sha === state.lastCommitSha) {
        foundLastSeen = true;
        break;
      }
      newCommits.push(commit);
    }

    // If this is first check, consider all commits as "current state" (not new)
    const isFirstCheck = state.lastCommitSha === null;
    const hasNewCommits = !isFirstCheck && newCommits.length > 0;

    // Update state with latest commit
    const latestCommitSha = commits.length > 0 ? commits[0].sha : state.lastCommitSha;

    state.lastCheckedAtMs = checkedAtMs;
    state.lastCommitSha = latestCommitSha;

    await saveState(statePath, state);

    log?.info(
      {
        hasNewCommits,
        newCount: hasNewCommits ? newCommits.length : 0,
        latestSha: latestCommitSha?.slice(0, 7),
        foundLastSeen,
      },
      "upstream: check complete",
    );

    return {
      hasNewCommits,
      newCommits: hasNewCommits ? newCommits : [],
      latestCommitSha,
      checkedAtMs,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log?.error({ error: errorMessage }, "upstream: failed to check commits");

    return {
      hasNewCommits: false,
      newCommits: [],
      latestCommitSha: state.lastCommitSha,
      checkedAtMs,
      error: errorMessage,
    };
  }
}

/**
 * Creates a cron job configuration for commit monitoring.
 * Returns the job definition to be added to the cron service.
 */
export function createCommitMonitorCronJob(schedule: "daily" | "weekly" = "daily") {
  const cronExpr = schedule === "weekly" ? WEEKLY_CRON_EXPRESSION : DAILY_CRON_EXPRESSION;

  return {
    name: "upstream-commit-monitor",
    description: `Check OpenClaw upstream for new commits (${schedule})`,
    enabled: true,
    schedule: { kind: "cron" as const, expr: cronExpr, tz: "UTC" },
    sessionTarget: "isolated" as const,
    wakeMode: "now" as const,
    payload: {
      kind: "systemEvent" as const,
      text: "[Upstream Monitor] Checking for new commits in OpenClaw repository...",
    },
    isolation: {
      postToMainPrefix: "[Upstream]",
      postToMainMode: "summary" as const,
    },
  };
}

/**
 * Formats new commits for display or notification.
 */
export function formatNewCommitsMessage(result: CommitCheckResult): string {
  if (!result.hasNewCommits || result.newCommits.length === 0) {
    return "No new upstream commits found.";
  }

  const lines = [
    `Found ${result.newCommits.length} new upstream commit${result.newCommits.length === 1 ? "" : "s"}:`,
    "",
  ];

  for (const commit of result.newCommits.slice(0, 10)) {
    const shortSha = commit.sha.slice(0, 7);
    const date = new Date(commit.date).toLocaleDateString();
    lines.push(`- ${shortSha}: ${commit.message} (${commit.author}, ${date})`);
  }

  if (result.newCommits.length > 10) {
    lines.push(`... and ${result.newCommits.length - 10} more`);
  }

  lines.push("");
  lines.push(`View all: ${UPSTREAM_REPO_URL}/commits/${UPSTREAM_DEFAULT_BRANCH}`);

  return lines.join("\n");
}
