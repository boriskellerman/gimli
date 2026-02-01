/**
 * /remind command for manual reminder management
 *
 * Provides CLI interface to create, list, and manage reminders.
 */

import { loadConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { isRich, theme } from "../terminal/theme.js";
import {
  createReminderStore,
  parsePriority,
  parseStatus,
  parseTimeString,
  type ReminderStore,
} from "../reminders/store.js";
import type {
  Reminder,
  ReminderFilter,
  ReminderPriority,
  ReminderTrigger,
} from "../reminders/types.js";
import { clampSnoozeDuration, getSnoozeConstraints } from "../reminders/types.js";

/**
 * Options for the remind command
 */
export interface RemindCommandOpts {
  /** Subcommand: add, list, complete, dismiss, snooze, delete, stats, patterns, config */
  subcommand?: string;

  /** Reminder message/title */
  message?: string;

  /** Target reminder ID */
  id?: string;

  /** Scheduled time (--at) */
  at?: string;

  /** Cron expression (--cron) */
  cron?: string;

  /** Context keywords (--context) */
  context?: string;

  /** Priority level (--priority) */
  priority?: string;

  /** Filter by status (--status) */
  status?: string;

  /** Minutes to snooze (--minutes) */
  minutes?: number;

  /** Show active patterns only (--active) */
  active?: boolean;

  /** Config key (for config subcommand) */
  configKey?: string;

  /** Config value (for config subcommand) */
  configValue?: string;

  /** Output as JSON */
  json?: boolean;

  /** Agent ID override */
  agentId?: string;
}

/**
 * Format a reminder for display
 */
function formatReminder(reminder: Reminder, rich: boolean): string {
  const priorityLabel = {
    urgent: rich ? theme.error("[URGENT]") : "[URGENT]",
    normal: rich ? theme.muted("[NORMAL]") : "[NORMAL]",
    low: rich ? theme.muted("[LOW]") : "[LOW]",
  }[reminder.priority];

  const statusLabel = {
    pending: rich ? theme.success("pending") : "pending",
    triggered: rich ? theme.warn("triggered") : "triggered",
    completed: rich ? theme.muted("completed") : "completed",
    dismissed: rich ? theme.muted("dismissed") : "dismissed",
    snoozed: rich ? theme.info("snoozed") : "snoozed",
  }[reminder.status];

  let triggerInfo = "";
  switch (reminder.trigger.type) {
    case "scheduled":
      triggerInfo = `at ${reminder.trigger.datetime.toLocaleString()}`;
      break;
    case "recurring":
      triggerInfo = `cron: ${reminder.trigger.cron}`;
      break;
    case "context":
      triggerInfo = `context: ${reminder.trigger.pattern}`;
      break;
  }

  const idShort = reminder.id.slice(0, 8);
  const idDisplay = rich ? theme.muted(`[${idShort}]`) : `[${idShort}]`;

  return `${idDisplay} ${priorityLabel} ${statusLabel} - ${reminder.title} (${triggerInfo})`;
}

/**
 * Format age since a date
 */
function formatAge(date: Date): string {
  const ms = Date.now() - date.getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Handle 'add' subcommand
 */
async function handleAdd(
  opts: RemindCommandOpts,
  store: ReminderStore,
  agentId: string,
  runtime: RuntimeEnv,
): Promise<void> {
  const message = opts.message?.trim();
  if (!message) {
    runtime.error('Error: Message is required. Usage: /remind add "message" --at TIME');
    runtime.exit(1);
    return;
  }

  // Determine trigger type
  let trigger: ReminderTrigger;

  if (opts.at) {
    const datetime = parseTimeString(opts.at);
    if (!datetime) {
      runtime.error(`Error: Invalid time format "${opts.at}". Use ISO 8601 or "HH:MM AM/PM".`);
      runtime.exit(1);
      return;
    }
    trigger = { type: "scheduled", datetime };
  } else if (opts.cron) {
    trigger = { type: "recurring", cron: opts.cron };
  } else if (opts.context) {
    trigger = { type: "context", pattern: opts.context };
  } else {
    runtime.error("Error: Must specify --at, --cron, or --context for the reminder trigger.");
    runtime.exit(1);
    return;
  }

  const priority: ReminderPriority = opts.priority
    ? (parsePriority(opts.priority) ?? "normal")
    : "normal";

  const contextTags = opts.context?.split(",").map((t) => t.trim());

  const reminder = store.create({
    agentId,
    title: message,
    trigger,
    priority,
    contextTags,
  });

  if (opts.json) {
    runtime.log(JSON.stringify(reminder, null, 2));
    return;
  }

  const rich = isRich();
  runtime.log(info("Reminder created:"));
  runtime.log(formatReminder(reminder, rich));
}

/**
 * Handle 'list' subcommand
 */
async function handleList(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const filter: ReminderFilter = {};

  if (opts.status) {
    const status = parseStatus(opts.status);
    if (!status) {
      runtime.error(
        `Error: Invalid status "${opts.status}". Use: pending, triggered, completed, dismissed, snoozed.`,
      );
      runtime.exit(1);
      return;
    }
    filter.status = status;
  }

  if (opts.priority) {
    const priority = parsePriority(opts.priority);
    if (!priority) {
      runtime.error(`Error: Invalid priority "${opts.priority}". Use: urgent, normal, low.`);
      runtime.exit(1);
      return;
    }
    filter.priority = priority;
  }

  const reminders = store.list(filter);

  if (opts.json) {
    runtime.log(JSON.stringify({ count: reminders.length, reminders }, null, 2));
    return;
  }

  const rich = isRich();

  if (reminders.length === 0) {
    runtime.log(info("No reminders found."));
    return;
  }

  runtime.log(info(`Reminders (${reminders.length}):`));
  runtime.log("");

  for (const reminder of reminders) {
    runtime.log(formatReminder(reminder, rich));
    if (reminder.body) {
      const bodyText = rich ? theme.muted(`  ${reminder.body}`) : `  ${reminder.body}`;
      runtime.log(bodyText);
    }
    const createdText = rich
      ? theme.muted(`  Created: ${formatAge(reminder.createdAt)}`)
      : `  Created: ${formatAge(reminder.createdAt)}`;
    runtime.log(createdText);
    runtime.log("");
  }
}

/**
 * Handle 'complete' subcommand
 */
async function handleComplete(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const id = opts.id?.trim();
  if (!id) {
    runtime.error("Error: Reminder ID is required. Usage: /remind complete ID");
    runtime.exit(1);
    return;
  }

  // Support partial ID matching
  const reminders = store.list();
  const match = reminders.find((r) => r.id.startsWith(id));

  if (!match) {
    runtime.error(`Error: No reminder found with ID starting with "${id}".`);
    runtime.exit(1);
    return;
  }

  const success = store.updateStatus(match.id, "completed");

  if (!success) {
    runtime.error(`Error: Failed to complete reminder "${id}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ success: true, id: match.id, status: "completed" }));
    return;
  }

  runtime.log(info(`Reminder completed: ${match.title}`));
}

/**
 * Handle 'dismiss' subcommand
 */
async function handleDismiss(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const id = opts.id?.trim();
  if (!id) {
    runtime.error("Error: Reminder ID is required. Usage: /remind dismiss ID");
    runtime.exit(1);
    return;
  }

  const reminders = store.list();
  const match = reminders.find((r) => r.id.startsWith(id));

  if (!match) {
    runtime.error(`Error: No reminder found with ID starting with "${id}".`);
    runtime.exit(1);
    return;
  }

  const success = store.updateStatus(match.id, "dismissed");

  if (!success) {
    runtime.error(`Error: Failed to dismiss reminder "${id}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ success: true, id: match.id, status: "dismissed" }));
    return;
  }

  runtime.log(info(`Reminder dismissed: ${match.title}`));
}

/**
 * Handle 'snooze' subcommand
 */
async function handleSnooze(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const id = opts.id?.trim();
  if (!id) {
    runtime.error("Error: Reminder ID is required. Usage: /remind snooze ID --minutes N");
    runtime.exit(1);
    return;
  }

  const minutes = opts.minutes;
  if (!minutes || minutes <= 0) {
    runtime.error("Error: --minutes must be a positive number.");
    runtime.exit(1);
    return;
  }

  const reminders = store.list();
  const match = reminders.find((r) => r.id.startsWith(id));

  if (!match) {
    runtime.error(`Error: No reminder found with ID starting with "${id}".`);
    runtime.exit(1);
    return;
  }

  const constraints = getSnoozeConstraints(match.priority);
  const clampedMinutes = clampSnoozeDuration(minutes, match.priority);

  const success = store.snooze(match.id, clampedMinutes);

  if (!success) {
    runtime.error(`Error: Failed to snooze reminder "${id}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    const snoozeUntil = new Date(Date.now() + clampedMinutes * 60 * 1000);
    runtime.log(
      JSON.stringify({
        success: true,
        id: match.id,
        status: "snoozed",
        snoozeMinutes: clampedMinutes,
        snoozeUntil: snoozeUntil.toISOString(),
      }),
    );
    return;
  }

  let note = "";
  if (clampedMinutes !== minutes) {
    note = ` (clamped from ${minutes}m to ${clampedMinutes}m based on ${match.priority} priority constraints: ${constraints.minMinutes}-${constraints.maxMinutes}m)`;
  }

  runtime.log(info(`Reminder snoozed for ${clampedMinutes} minutes: ${match.title}${note}`));
}

/**
 * Handle 'delete' subcommand
 */
async function handleDelete(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const id = opts.id?.trim();
  if (!id) {
    runtime.error("Error: Reminder ID is required. Usage: /remind delete ID");
    runtime.exit(1);
    return;
  }

  const reminders = store.list();
  const match = reminders.find((r) => r.id.startsWith(id));

  if (!match) {
    runtime.error(`Error: No reminder found with ID starting with "${id}".`);
    runtime.exit(1);
    return;
  }

  const success = store.delete(match.id);

  if (!success) {
    runtime.error(`Error: Failed to delete reminder "${id}".`);
    runtime.exit(1);
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ success: true, id: match.id, deleted: true }));
    return;
  }

  runtime.log(info(`Reminder deleted: ${match.title}`));
}

/**
 * Handle 'stats' subcommand
 */
async function handleStats(
  opts: RemindCommandOpts,
  store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const stats = store.getStats();

  if (opts.json) {
    runtime.log(JSON.stringify(stats, null, 2));
    return;
  }

  const rich = isRich();

  runtime.log(info("Reminder statistics:"));
  runtime.log("");

  const format = (label: string, value: number) => {
    const labelText = rich ? theme.muted(label.padEnd(12)) : label.padEnd(12);
    const valueText = rich ? theme.accent(String(value)) : String(value);
    return `${labelText} ${valueText}`;
  };

  runtime.log(format("Total:", stats.total));
  runtime.log(format("Pending:", stats.pending));
  runtime.log(format("Triggered:", stats.triggered));
  runtime.log(format("Completed:", stats.completed));
  runtime.log(format("Dismissed:", stats.dismissed));
  runtime.log(format("Snoozed:", stats.snoozed));
}

/**
 * Handle 'patterns' subcommand
 *
 * Displays detected patterns from the anticipation system.
 */
async function handlePatterns(
  opts: RemindCommandOpts,
  _store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  // Pattern detection is part of Phase 6 - for now, show a placeholder
  if (opts.json) {
    runtime.log(JSON.stringify({ patterns: [], message: "Pattern detection coming in Phase 6" }));
    return;
  }

  runtime.log(info("Pattern detection is coming in Phase 6 of the PRD."));
  runtime.log("");
  runtime.log("This feature will automatically detect patterns like:");
  runtime.log("  - Time-based: 'You usually review PRs around 9 AM on weekdays'");
  runtime.log("  - Event-based: 'After committing, you typically create a PR'");
  runtime.log("  - Context-based: 'When discussing deployments, you need staging URLs'");
}

/**
 * Handle 'config' subcommand for quiet hours configuration
 */
async function handleConfig(
  opts: RemindCommandOpts,
  _store: ReminderStore,
  runtime: RuntimeEnv,
): Promise<void> {
  const key = opts.configKey?.trim();
  const value = opts.configValue?.trim();

  if (!key) {
    runtime.log(info("Reminder configuration options:"));
    runtime.log("");
    runtime.log("  /remind config quiet-start TIME    Set quiet hours start (e.g., 22:00)");
    runtime.log("  /remind config quiet-end TIME      Set quiet hours end (e.g., 07:00)");
    runtime.log("");
    runtime.log(
      "Note: Quiet hours configuration is stored in gimli.json under agents.defaults.reminders",
    );
    return;
  }

  if (!value) {
    runtime.error(`Error: Value is required for config key "${key}".`);
    runtime.exit(1);
    return;
  }

  // Validate time format (HH:MM)
  const timeMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) {
    runtime.error(`Error: Invalid time format "${value}". Use HH:MM format (e.g., 22:00).`);
    runtime.exit(1);
    return;
  }

  const hours = Number.parseInt(timeMatch[1], 10);
  const minutes = Number.parseInt(timeMatch[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    runtime.error(`Error: Invalid time "${value}". Hours must be 0-23, minutes 0-59.`);
    runtime.exit(1);
    return;
  }

  const normalizedTime = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

  if (key === "quiet-start" || key === "quiet-end") {
    runtime.log(info(`To set ${key} to ${normalizedTime}, add to your gimli.json:`));
    runtime.log("");
    runtime.log(`  "agents": {`);
    runtime.log(`    "defaults": {`);
    runtime.log(`      "reminders": {`);
    runtime.log(
      `        "${key === "quiet-start" ? "quietHoursStart" : "quietHoursEnd"}": "${normalizedTime}"`,
    );
    runtime.log(`      }`);
    runtime.log(`    }`);
    runtime.log(`  }`);
    runtime.log("");
    runtime.log(
      "Or use: gimli config set agents.defaults.reminders.quietHoursStart " + normalizedTime,
    );
  } else {
    runtime.error(`Error: Unknown config key "${key}". Use: quiet-start, quiet-end.`);
    runtime.exit(1);
  }
}

/**
 * Show help for the remind command
 */
function showHelp(runtime: RuntimeEnv): void {
  runtime.log("Usage: /remind <subcommand> [options]");
  runtime.log("");
  runtime.log("Subcommands:");
  runtime.log('  add "message" --at TIME          Create a scheduled reminder');
  runtime.log('  add "message" --cron "EXPR"      Create a recurring reminder');
  runtime.log('  add "message" --context "keys"   Create a context-triggered reminder');
  runtime.log("  list [--status STATUS]           List reminders");
  runtime.log("  complete ID                      Mark reminder as completed");
  runtime.log("  dismiss ID                       Dismiss reminder");
  runtime.log("  snooze ID --minutes N            Snooze reminder");
  runtime.log("  delete ID                        Delete reminder");
  runtime.log("  stats                            Show reminder statistics");
  runtime.log("  patterns [--active]              Show detected patterns");
  runtime.log("  config KEY VALUE                 Configure reminder settings");
  runtime.log("");
  runtime.log("Options:");
  runtime.log("  --at TIME            Scheduled time (ISO 8601 or HH:MM AM/PM)");
  runtime.log('  --cron "EXPR"        Cron expression for recurring reminders');
  runtime.log('  --context "keys"     Comma-separated context keywords');
  runtime.log("  --priority LEVEL     Priority: urgent, normal (default), low");
  runtime.log("  --status STATUS      Filter: pending, triggered, completed, dismissed, snoozed");
  runtime.log("  --minutes N          Snooze duration in minutes");
  runtime.log("  --active             Show only active patterns");
  runtime.log("  --json               Output as JSON");
  runtime.log("  --agent ID           Agent ID override");
  runtime.log("");
  runtime.log("Examples:");
  runtime.log('  /remind add "Review PRs" --at "9:00 AM" --priority normal');
  runtime.log('  /remind add "Weekly status" --cron "0 16 * * 5"');
  runtime.log('  /remind add "Check staging" --context "deploy,release"');
  runtime.log("  /remind list --status pending");
  runtime.log("  /remind complete abc123");
  runtime.log("  /remind snooze abc123 --minutes 30");
  runtime.log("  /remind config quiet-start 22:00");
}

/**
 * Main remind command handler
 */
export async function remindCommand(
  opts: RemindCommandOpts,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<void> {
  const cfg = loadConfig();
  const agentId = opts.agentId?.trim() || resolveDefaultAgentId(cfg);

  const subcommand = opts.subcommand?.trim().toLowerCase();

  if (!subcommand || subcommand === "help") {
    showHelp(runtime);
    return;
  }

  let store: ReminderStore | undefined;

  try {
    store = createReminderStore(agentId, cfg);

    switch (subcommand) {
      case "add":
        await handleAdd(opts, store, agentId, runtime);
        break;

      case "list":
      case "ls":
        await handleList(opts, store, runtime);
        break;

      case "complete":
      case "done":
        await handleComplete(opts, store, runtime);
        break;

      case "dismiss":
        await handleDismiss(opts, store, runtime);
        break;

      case "snooze":
        await handleSnooze(opts, store, runtime);
        break;

      case "delete":
      case "rm":
      case "remove":
        await handleDelete(opts, store, runtime);
        break;

      case "stats":
        await handleStats(opts, store, runtime);
        break;

      case "patterns":
        await handlePatterns(opts, store, runtime);
        break;

      case "config":
        await handleConfig(opts, store, runtime);
        break;

      default:
        runtime.error(`Unknown subcommand: ${subcommand}`);
        runtime.log("");
        showHelp(runtime);
        runtime.exit(1);
    }
  } finally {
    store?.close();
  }
}
