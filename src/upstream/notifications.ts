/**
 * Notification system for upstream changes
 *
 * Sends notifications when significant upstream changes are detected.
 * Supports multiple notification channels and configurable thresholds.
 */

import type { CommitCheckResult, CommitInfo } from "./commit-monitor.js";
import type { DiffAnalysis, ChangePriority } from "./diff-analyzer.js";
import type { RiskAssessment, SyncHistoryEntry } from "./sync-history.js";

/**
 * Notification priority levels
 */
export type NotificationPriority = "urgent" | "high" | "normal" | "low";

/**
 * Notification channel types
 */
export type NotificationChannel = "console" | "gateway" | "session" | "webhook";

/**
 * A notification to be sent
 */
export interface Notification {
  /** Unique notification ID */
  id: string;
  /** Title/subject */
  title: string;
  /** Body content */
  body: string;
  /** Priority level */
  priority: NotificationPriority;
  /** Target channels */
  channels: NotificationChannel[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
}

/**
 * Notification configuration
 */
export interface NotificationConfig {
  /** Enabled channels */
  enabledChannels: NotificationChannel[];
  /** Minimum priority to send notifications */
  minPriority: NotificationPriority;
  /** Webhook URL (if webhook channel enabled) */
  webhookUrl?: string;
  /** Whether to batch notifications */
  batchNotifications: boolean;
  /** Quiet hours (don't send during these times) */
  quietHours?: {
    start: number; // Hour (0-23)
    end: number;
    timezone: string;
  };
}

/**
 * Default notification configuration
 */
export const defaultNotificationConfig: NotificationConfig = {
  enabledChannels: ["console", "session"],
  minPriority: "normal",
  batchNotifications: true,
};

/**
 * Priority ordering (lower = more important)
 */
const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/**
 * Generate a unique notification ID
 */
function generateNotificationId(): string {
  return `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Map change priority to notification priority
 */
export function mapChangePriorityToNotification(
  changePriority: ChangePriority,
): NotificationPriority {
  switch (changePriority) {
    case "critical":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "normal";
    case "low":
      return "low";
  }
}

/**
 * Check if notification should be sent based on priority
 */
export function shouldNotify(
  priority: NotificationPriority,
  minPriority: NotificationPriority,
): boolean {
  return PRIORITY_ORDER[priority] <= PRIORITY_ORDER[minPriority];
}

/**
 * Check if currently in quiet hours
 */
export function isQuietHours(config: NotificationConfig): boolean {
  if (!config.quietHours) return false;

  const now = new Date();
  // Simple hour-based check (ignoring timezone for simplicity)
  const currentHour = now.getUTCHours();
  const { start, end } = config.quietHours;

  if (start <= end) {
    return currentHour >= start && currentHour < end;
  } else {
    // Spans midnight
    return currentHour >= start || currentHour < end;
  }
}

/**
 * Create a notification for new upstream commits
 */
export function createNewCommitsNotification(result: CommitCheckResult): Notification | null {
  if (!result.hasNewCommits || result.newCommits.length === 0) {
    return null;
  }

  const count = result.newCommits.length;
  const title = `${count} new upstream commit${count === 1 ? "" : "s"} detected`;

  const lines = [`Found ${count} new commit${count === 1 ? "" : "s"} in OpenClaw upstream:`, ""];

  for (const commit of result.newCommits.slice(0, 5)) {
    const shortSha = commit.sha.slice(0, 7);
    lines.push(`• ${shortSha}: ${commit.message}`);
  }

  if (count > 5) {
    lines.push(`... and ${count - 5} more`);
  }

  lines.push("");
  lines.push("Run `gimli upstream check` for details.");

  return {
    id: generateNotificationId(),
    title,
    body: lines.join("\n"),
    priority: "normal",
    channels: ["console", "session"],
    metadata: {
      commitCount: count,
      latestSha: result.latestCommitSha,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a notification for a security-related change
 */
export function createSecurityNotification(
  commit: CommitInfo,
  analysis: DiffAnalysis,
  riskAssessment: RiskAssessment,
): Notification {
  const shortSha = commit.sha.slice(0, 7);
  const title = `Security change detected in upstream: ${shortSha}`;

  const lines = [
    `**Commit**: ${commit.message}`,
    `**Author**: ${commit.author}`,
    "",
    `**Security Impact**: ${riskAssessment.securityImpact}`,
    `**Risk Score**: ${riskAssessment.score}/100 (${riskAssessment.level})`,
    "",
  ];

  if (analysis.securitySignals.length > 0) {
    lines.push("**Security Signals**:");
    for (const signal of analysis.securitySignals) {
      lines.push(`• ${signal.type}: ${signal.description} (${signal.severity})`);
    }
    lines.push("");
  }

  lines.push(`**Recommendation**: ${riskAssessment.recommendation}`);
  lines.push(`> ${riskAssessment.reasoning}`);

  const priority: NotificationPriority =
    riskAssessment.securityImpact === "critical"
      ? "urgent"
      : riskAssessment.securityImpact === "high"
        ? "high"
        : "normal";

  return {
    id: generateNotificationId(),
    title,
    body: lines.join("\n"),
    priority,
    channels: ["console", "session", "gateway"],
    metadata: {
      commitSha: commit.sha,
      securityImpact: riskAssessment.securityImpact,
      riskScore: riskAssessment.score,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a notification for a breaking change
 */
export function createBreakingChangeNotification(
  commit: CommitInfo,
  analysis: DiffAnalysis,
  riskAssessment: RiskAssessment,
): Notification {
  const shortSha = commit.sha.slice(0, 7);
  const title = `Breaking change detected in upstream: ${shortSha}`;

  const lines = [
    `**Commit**: ${commit.message}`,
    `**Author**: ${commit.author}`,
    "",
    `**Risk Score**: ${riskAssessment.score}/100 (${riskAssessment.level})`,
    "",
  ];

  if (analysis.breakingSignals.length > 0) {
    lines.push("**Breaking Signals**:");
    for (const signal of analysis.breakingSignals) {
      lines.push(`• ${signal.type}: ${signal.description}`);
    }
    lines.push("");
  }

  if (riskAssessment.compatibilityIssues.length > 0) {
    lines.push("**Compatibility Issues**:");
    for (const issue of riskAssessment.compatibilityIssues) {
      lines.push(`• ${issue}`);
    }
    lines.push("");
  }

  lines.push(`**Recommendation**: ${riskAssessment.recommendation}`);
  lines.push(`> ${riskAssessment.reasoning}`);

  return {
    id: generateNotificationId(),
    title,
    body: lines.join("\n"),
    priority: "high",
    channels: ["console", "session"],
    metadata: {
      commitSha: commit.sha,
      breakingSignals: analysis.breakingSignals.length,
      riskScore: riskAssessment.score,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a notification for integration result
 */
export function createIntegrationResultNotification(
  entry: SyncHistoryEntry,
  success: boolean,
  details?: string,
): Notification {
  const shortSha = entry.commitSha.slice(0, 7);
  const title = success
    ? `Successfully integrated upstream change: ${shortSha}`
    : `Failed to integrate upstream change: ${shortSha}`;

  const lines = [
    `**Commit**: ${entry.commitMessage}`,
    `**Status**: ${success ? "✅ Applied" : "❌ Failed"}`,
  ];

  if (details) {
    lines.push("");
    lines.push(details);
  }

  if (entry.testResults) {
    lines.push("");
    lines.push("**Test Results**:");
    lines.push(`• Passed: ${entry.testResults.passed}`);
    lines.push(`• Failed: ${entry.testResults.failed}`);
    lines.push(`• Skipped: ${entry.testResults.skipped}`);
  }

  return {
    id: generateNotificationId(),
    title,
    body: lines.join("\n"),
    priority: success ? "low" : "high",
    channels: ["console"],
    metadata: {
      entryId: entry.id,
      commitSha: entry.commitSha,
      success,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a weekly summary notification
 */
export function createWeeklySummaryNotification(summary: string): Notification {
  return {
    id: generateNotificationId(),
    title: "OpenClaw Upstream Weekly Summary",
    body: summary,
    priority: "low",
    channels: ["session"],
    metadata: {
      type: "weekly-summary",
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format a notification for console output
 */
export function formatNotificationForConsole(notification: Notification): string {
  const priorityPrefix = {
    urgent: "🚨 URGENT",
    high: "⚠️  HIGH",
    normal: "📢",
    low: "ℹ️ ",
  }[notification.priority];

  return `
${priorityPrefix} ${notification.title}
${"─".repeat(60)}
${notification.body}
${"─".repeat(60)}
`.trim();
}

/**
 * Format a notification for gateway/session output
 */
export function formatNotificationForSession(notification: Notification): string {
  return `**${notification.title}**\n\n${notification.body}`;
}

/**
 * Batch multiple notifications into a single summary
 */
export function batchNotifications(notifications: Notification[]): Notification | null {
  if (notifications.length === 0) return null;
  if (notifications.length === 1) return notifications[0];

  // Find highest priority
  const priority = notifications.reduce(
    (highest, n) => (PRIORITY_ORDER[n.priority] < PRIORITY_ORDER[highest] ? n.priority : highest),
    "low" as NotificationPriority,
  );

  const title = `${notifications.length} upstream notifications`;
  const lines = ["Multiple upstream changes detected:", ""];

  for (const n of notifications) {
    lines.push(`• **${n.title}**`);
  }

  lines.push("");
  lines.push("Run `gimli upstream status` for details.");

  // Merge channels
  const channels = new Set<NotificationChannel>();
  for (const n of notifications) {
    for (const c of n.channels) {
      channels.add(c);
    }
  }

  return {
    id: generateNotificationId(),
    title,
    body: lines.join("\n"),
    priority,
    channels: Array.from(channels),
    metadata: {
      batchedCount: notifications.length,
      originalIds: notifications.map((n) => n.id),
    },
    timestamp: new Date().toISOString(),
  };
}
