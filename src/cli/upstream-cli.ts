/**
 * CLI commands for OpenClaw upstream sync operations
 *
 * Provides commands to:
 * - check: Check for new upstream commits
 * - preview: Preview a specific upstream change
 * - apply: Apply an upstream change with testing
 * - history: View sync history
 */

import type { Command } from "commander";

import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { renderTable } from "../terminal/table.js";
import {
  checkForNewCommits,
  formatNewCommitsMessage,
  loadState,
  createInitialState,
  type CommitInfo,
} from "../upstream/commit-monitor.js";
import {
  loadHistory,
  queryHistory,
  getHistoryEntry,
  calculateRiskAssessment,
  generateWeeklySummary,
  type SyncHistoryEntry,
  type SyncStatus,
} from "../upstream/sync-history.js";
import { analyzeDiff, type DiffAnalysis } from "../upstream/diff-analyzer.js";
import {
  stageUpstreamChanges,
  testStagedChanges,
  generateRiskReport,
  isAutoApplyable,
  defaultAllowlistConfig,
} from "../upstream/integration.js";
import {
  createNewCommitsNotification,
  formatNotificationForConsole,
} from "../upstream/notifications.js";

export type UpstreamCheckOptions = {
  json?: boolean;
  verbose?: boolean;
};

export type UpstreamPreviewOptions = {
  json?: boolean;
};

export type UpstreamApplyOptions = {
  json?: boolean;
  test?: boolean;
  force?: boolean;
};

export type UpstreamHistoryOptions = {
  json?: boolean;
  limit?: string;
  status?: string;
  security?: boolean;
  breaking?: boolean;
};

/**
 * Format a status badge
 */
function formatStatus(status: SyncStatus): string {
  switch (status) {
    case "pending":
      return theme.warn("pending");
    case "evaluated":
      return theme.accent("evaluated");
    case "staged":
      return theme.accent("staged");
    case "testing":
      return theme.accent("testing");
    case "approved":
      return theme.success("approved");
    case "applied":
      return theme.success("applied");
    case "rejected":
      return theme.error("rejected");
    case "failed":
      return theme.error("failed");
    case "rolled-back":
      return theme.warn("rolled-back");
  }
}

/**
 * Format a priority badge
 */
function formatPriority(priority: string): string {
  switch (priority) {
    case "critical":
      return theme.error("CRITICAL");
    case "high":
      return theme.warn("HIGH");
    case "medium":
      return theme.accent("MEDIUM");
    case "low":
      return theme.muted("LOW");
    default:
      return priority;
  }
}

/**
 * Check for new upstream commits
 */
export async function upstreamCheckCommand(opts: UpstreamCheckOptions): Promise<void> {
  const state = await loadState().catch(() => createInitialState());

  if (opts.verbose && !opts.json) {
    defaultRuntime.log(theme.muted(`Last checked commit: ${state.lastCheckedCommitSha ?? "none"}`));
  }

  try {
    const result = await checkForNewCommits({ state });

    if (opts.json) {
      defaultRuntime.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!result.hasNewCommits) {
      defaultRuntime.log(theme.success("No new upstream commits found."));
      return;
    }

    const notification = createNewCommitsNotification(result);
    if (notification) {
      defaultRuntime.log(formatNotificationForConsole(notification));
    }

    if (opts.verbose && result.newCommits.length > 5) {
      defaultRuntime.log("");
      defaultRuntime.log(theme.heading("All new commits:"));
      for (const commit of result.newCommits) {
        const shortSha = commit.sha.slice(0, 7);
        defaultRuntime.log(`  ${theme.accent(shortSha)} ${commit.message}`);
        defaultRuntime.log(`    ${theme.muted(`by ${commit.author} on ${commit.date}`)}`);
      }
    }
  } catch (error) {
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      defaultRuntime.error(`Failed to check upstream: ${String(error)}`);
    }
    defaultRuntime.exit(1);
  }
}

/**
 * Preview a specific upstream change
 */
export async function upstreamPreviewCommand(
  shaOrId: string,
  opts: UpstreamPreviewOptions,
): Promise<void> {
  try {
    // First check history
    const entry = await getHistoryEntry(shaOrId);

    if (entry) {
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(entry, null, 2));
        return;
      }

      // Show existing entry
      defaultRuntime.log(theme.heading(`Upstream Change: ${entry.commitSha.slice(0, 7)}`));
      defaultRuntime.log("");
      defaultRuntime.log(`${theme.accent("Message:")} ${entry.commitMessage}`);
      defaultRuntime.log(`${theme.accent("Author:")} ${entry.author}`);
      defaultRuntime.log(`${theme.accent("Date:")} ${entry.commitDate}`);
      defaultRuntime.log(`${theme.accent("Status:")} ${formatStatus(entry.status)}`);
      defaultRuntime.log(`${theme.accent("Priority:")} ${formatPriority(entry.priority)}`);
      defaultRuntime.log(`${theme.accent("Category:")} ${entry.category}`);

      if (entry.isSecurity) {
        defaultRuntime.log(theme.warn("Security-related change"));
      }
      if (entry.isBreaking) {
        defaultRuntime.log(theme.warn("Breaking change"));
      }

      if (entry.riskAssessment) {
        defaultRuntime.log("");
        defaultRuntime.log(theme.heading("Risk Assessment:"));
        defaultRuntime.log(`  Score: ${entry.riskAssessment.score}/100`);
        defaultRuntime.log(`  Level: ${entry.riskAssessment.level}`);
        defaultRuntime.log(`  Recommendation: ${entry.riskAssessment.recommendation}`);
        defaultRuntime.log(`  ${theme.muted(entry.riskAssessment.reasoning)}`);
      }

      if (entry.filesAffected.length > 0) {
        defaultRuntime.log("");
        defaultRuntime.log(theme.heading("Files Affected:"));
        for (const file of entry.filesAffected.slice(0, 20)) {
          defaultRuntime.log(`  ${file}`);
        }
        if (entry.filesAffected.length > 20) {
          defaultRuntime.log(theme.muted(`  ... and ${entry.filesAffected.length - 20} more`));
        }
      }

      return;
    }

    // Entry not found - we'd need to fetch and analyze
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: "Entry not found in history" }, null, 2));
    } else {
      defaultRuntime.error(`No history entry found for: ${shaOrId}`);
      defaultRuntime.log(theme.muted("Run `gimli upstream check` to detect new commits first."));
    }
    defaultRuntime.exit(1);
  } catch (error) {
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      defaultRuntime.error(`Failed to preview: ${String(error)}`);
    }
    defaultRuntime.exit(1);
  }
}

/**
 * Apply an upstream change
 */
export async function upstreamApplyCommand(
  shaOrId: string,
  opts: UpstreamApplyOptions,
): Promise<void> {
  try {
    const entry = await getHistoryEntry(shaOrId);

    if (!entry) {
      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ error: "Entry not found" }, null, 2));
      } else {
        defaultRuntime.error(`No history entry found for: ${shaOrId}`);
      }
      defaultRuntime.exit(1);
      return;
    }

    if (!opts.json) {
      defaultRuntime.log(theme.heading(`Applying upstream change: ${entry.commitSha.slice(0, 7)}`));
    }

    // Check if safe to auto-apply
    if (entry.analysis && entry.riskAssessment) {
      const canAutoApply = isAutoApplyable(
        entry.analysis,
        entry.riskAssessment,
        {
          sha: entry.commitSha,
          message: entry.commitMessage,
          author: entry.author,
          date: entry.commitDate,
        },
        defaultAllowlistConfig,
      );

      if (!canAutoApply && !opts.force) {
        if (opts.json) {
          defaultRuntime.log(
            JSON.stringify({
              error: "Manual review required",
              reason: entry.riskAssessment.reasoning,
            }),
          );
        } else {
          defaultRuntime.error("This change requires manual review.");
          defaultRuntime.log(theme.muted(entry.riskAssessment.reasoning));
          defaultRuntime.log("");
          defaultRuntime.log(theme.muted("Use --force to apply anyway."));
        }
        defaultRuntime.exit(1);
        return;
      }
    }

    // Stage the changes
    const commit: CommitInfo = {
      sha: entry.commitSha,
      message: entry.commitMessage,
      author: entry.author,
      date: entry.commitDate,
    };

    const stageResult = await stageUpstreamChanges(commit, entry.analysis ?? ({} as DiffAnalysis));

    if (!stageResult.success) {
      if (opts.json) {
        defaultRuntime.log(JSON.stringify(stageResult, null, 2));
      } else {
        defaultRuntime.error(`Failed to stage changes: ${stageResult.message}`);
        if (stageResult.conflictFiles) {
          defaultRuntime.log(theme.heading("Conflict files:"));
          for (const file of stageResult.conflictFiles) {
            defaultRuntime.log(`  ${file}`);
          }
        }
      }
      defaultRuntime.exit(1);
      return;
    }

    if (!opts.json) {
      defaultRuntime.log(theme.success(`Changes staged on branch: ${stageResult.stagingBranch}`));
    }

    // Run tests if requested
    if (opts.test) {
      if (!opts.json) {
        defaultRuntime.log("");
        defaultRuntime.log(theme.heading("Running tests..."));
      }

      const testResult = await testStagedChanges(entry.id);

      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ stageResult, testResult }, null, 2));
      } else {
        if (testResult.success) {
          defaultRuntime.log(theme.success(testResult.message));
        } else {
          defaultRuntime.error(testResult.message);
          if (testResult.testResults?.failedTests) {
            for (const test of testResult.testResults.failedTests.slice(0, 10)) {
              defaultRuntime.log(`  ${theme.error(test)}`);
            }
          }
        }
      }

      if (!testResult.success) {
        defaultRuntime.exit(1);
        return;
      }
    }

    if (opts.json && !opts.test) {
      defaultRuntime.log(JSON.stringify(stageResult, null, 2));
    }
  } catch (error) {
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      defaultRuntime.error(`Failed to apply: ${String(error)}`);
    }
    defaultRuntime.exit(1);
  }
}

/**
 * View sync history
 */
export async function upstreamHistoryCommand(opts: UpstreamHistoryOptions): Promise<void> {
  try {
    const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
    const statusFilter = opts.status as SyncStatus | undefined;

    const entries = await queryHistory({
      status: statusFilter,
      isSecurity: opts.security,
      isBreaking: opts.breaking,
      limit,
    });

    if (opts.json) {
      defaultRuntime.log(JSON.stringify(entries, null, 2));
      return;
    }

    if (entries.length === 0) {
      defaultRuntime.log(theme.muted("No sync history entries found."));
      return;
    }

    defaultRuntime.log(theme.heading("Upstream Sync History"));
    defaultRuntime.log("");

    const tableWidth = Math.max(100, (process.stdout.columns ?? 120) - 1);
    const rows = entries.map((entry) => ({
      SHA: entry.commitSha.slice(0, 7),
      Message: entry.commitMessage.slice(0, 40) + (entry.commitMessage.length > 40 ? "..." : ""),
      Status: formatStatus(entry.status),
      Priority: formatPriority(entry.priority),
      Flags:
        [entry.isSecurity ? "SEC" : "", entry.isBreaking ? "BRK" : ""].filter(Boolean).join(" ") ||
        "-",
    }));

    defaultRuntime.log(
      renderTable({
        width: tableWidth,
        columns: [
          { key: "SHA", header: "SHA", minWidth: 9 },
          { key: "Message", header: "Message", flex: true, minWidth: 20 },
          { key: "Status", header: "Status", minWidth: 12 },
          { key: "Priority", header: "Priority", minWidth: 10 },
          { key: "Flags", header: "Flags", minWidth: 8 },
        ],
        rows,
      }).trimEnd(),
    );

    defaultRuntime.log("");
    defaultRuntime.log(theme.muted(`Showing ${entries.length} entries. Use --limit to see more.`));
  } catch (error) {
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      defaultRuntime.error(`Failed to load history: ${String(error)}`);
    }
    defaultRuntime.exit(1);
  }
}

/**
 * Show weekly summary
 */
export async function upstreamSummaryCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const summary = await generateWeeklySummary();

    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ summary }, null, 2));
    } else {
      defaultRuntime.log(summary);
    }
  } catch (error) {
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ error: String(error) }, null, 2));
    } else {
      defaultRuntime.error(`Failed to generate summary: ${String(error)}`);
    }
    defaultRuntime.exit(1);
  }
}

/**
 * Register the upstream CLI commands
 */
export function registerUpstreamCli(program: Command) {
  const upstream = program
    .command("upstream")
    .description("Manage OpenClaw upstream sync operations");

  upstream
    .command("check")
    .description("Check for new upstream commits")
    .option("--json", "Output as JSON", false)
    .option("--verbose", "Show detailed output", false)
    .action(async (opts) => {
      await upstreamCheckCommand({
        json: Boolean(opts.json),
        verbose: Boolean(opts.verbose),
      });
    });

  upstream
    .command("preview <sha>")
    .description("Preview a specific upstream change")
    .option("--json", "Output as JSON", false)
    .action(async (sha: string, opts) => {
      await upstreamPreviewCommand(sha, {
        json: Boolean(opts.json),
      });
    });

  upstream
    .command("apply <sha>")
    .description("Apply an upstream change")
    .option("--json", "Output as JSON", false)
    .option("--test", "Run tests after staging", false)
    .option("--force", "Apply even if manual review recommended", false)
    .action(async (sha: string, opts) => {
      await upstreamApplyCommand(sha, {
        json: Boolean(opts.json),
        test: Boolean(opts.test),
        force: Boolean(opts.force),
      });
    });

  upstream
    .command("history")
    .description("View upstream sync history")
    .option("--json", "Output as JSON", false)
    .option("--limit <n>", "Maximum entries to show", "20")
    .option("--status <status>", "Filter by status")
    .option("--security", "Show only security changes", false)
    .option("--breaking", "Show only breaking changes", false)
    .action(async (opts) => {
      await upstreamHistoryCommand({
        json: Boolean(opts.json),
        limit: opts.limit as string,
        status: opts.status as string | undefined,
        security: Boolean(opts.security),
        breaking: Boolean(opts.breaking),
      });
    });

  upstream
    .command("summary")
    .description("Show weekly activity summary")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await upstreamSummaryCommand({
        json: Boolean(opts.json),
      });
    });
}
