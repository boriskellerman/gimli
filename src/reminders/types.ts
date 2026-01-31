/**
 * Reminder system type definitions
 *
 * Defines the core types for Gimli's anticipation and reminder system,
 * designed to integrate with the existing memory architecture.
 */

/**
 * Reminder trigger types
 *
 * - scheduled: One-time reminder at a specific datetime
 * - recurring: Repeating reminder using cron expression
 * - context: Triggered when semantically relevant context appears
 */
export type ReminderTriggerType = "scheduled" | "recurring" | "context";

/**
 * Reminder trigger configuration
 */
export type ReminderTrigger =
  | { type: "scheduled"; datetime: Date }
  | { type: "recurring"; cron: string }
  | { type: "context"; pattern: string };

/**
 * Reminder status values
 *
 * - pending: Waiting to be triggered
 * - triggered: Has fired but not yet acknowledged
 * - completed: User marked as done
 * - dismissed: User dismissed without completing
 * - snoozed: Temporarily postponed
 */
export type ReminderStatus = "pending" | "triggered" | "completed" | "dismissed" | "snoozed";

/**
 * Reminder priority levels
 *
 * - urgent: High priority, bypass quiet hours
 * - normal: Standard priority
 * - low: Background reminder, can be batched
 */
export type ReminderPriority = "urgent" | "normal" | "low";

/**
 * Core reminder entity
 */
export interface Reminder {
  /** Unique identifier */
  id: string;

  /** Agent this reminder belongs to */
  agentId: string;

  /** Short reminder title */
  title: string;

  /** Optional detailed description */
  body?: string;

  /** When/how the reminder should trigger */
  trigger: ReminderTrigger;

  /** Current status */
  status: ReminderStatus;

  /** Priority level */
  priority: ReminderPriority;

  /** When the reminder was created */
  createdAt: Date;

  /** When the reminder was triggered (if applicable) */
  triggeredAt?: Date;

  /** When the reminder was completed (if applicable) */
  completedAt?: Date;

  /** If snoozed, when to resurface */
  snoozeUntil?: Date;

  /** Tags for context-based matching */
  contextTags?: string[];

  /** Whether this reminder can bypass quiet hours */
  quietHoursExempt: boolean;

  /** Link to memory chunk for semantic search */
  chunkId?: string;
}

/**
 * Input for creating a new reminder
 */
export interface CreateReminderInput {
  agentId: string;
  title: string;
  body?: string;
  trigger: ReminderTrigger;
  priority?: ReminderPriority;
  contextTags?: string[];
  quietHoursExempt?: boolean;
}

/**
 * Filter options for querying reminders
 */
export interface ReminderFilter {
  status?: ReminderStatus | ReminderStatus[];
  priority?: ReminderPriority | ReminderPriority[];
  triggerType?: ReminderTriggerType | ReminderTriggerType[];
  createdAfter?: Date;
  createdBefore?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Result from proactive reminder query
 */
export interface ProactiveReminderResult {
  /** The reminder */
  reminder: Reminder;

  /** Relevance score (0-1) for context-based matches */
  relevanceScore: number;

  /** Whether this reminder is due based on schedule */
  isDue: boolean;

  /** Source of the match: 'schedule' for time-based, 'context' for semantic */
  matchSource: "schedule" | "context";
}

/**
 * Reminder injection configuration
 */
export interface ReminderInjectionConfig {
  /** Whether reminder injection is enabled */
  enabled: boolean;

  /** Maximum number of reminders to inject per turn */
  maxReminders: number;

  /** Whether to include context-based (semantic) reminders */
  includeContextual: boolean;

  /** Quiet hours start time (HH:MM format, e.g., "22:00") */
  quietHoursStart?: string;

  /** Quiet hours end time (HH:MM format, e.g., "07:00") */
  quietHoursEnd?: string;

  /** Minimum relevance score for context-based reminders */
  minContextScore: number;
}

/**
 * Default reminder injection configuration
 */
export const defaultReminderInjectionConfig: ReminderInjectionConfig = {
  enabled: true,
  maxReminders: 3,
  includeContextual: true,
  minContextScore: 0.4,
};

/**
 * Reminder store row as stored in SQLite
 */
export interface ReminderRow {
  id: string;
  agent_id: string;
  title: string;
  body: string | null;
  trigger_type: ReminderTriggerType;
  trigger_spec: string;
  status: ReminderStatus;
  priority: ReminderPriority;
  created_at: number;
  triggered_at: number | null;
  completed_at: number | null;
  snooze_until: number | null;
  context_tags: string | null;
  quiet_hours_exempt: number;
  chunk_id: string | null;
}

/**
 * Convert a database row to a Reminder object
 */
export function rowToReminder(row: ReminderRow): Reminder {
  const trigger = parseTrigger(row.trigger_type, row.trigger_spec);

  return {
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    body: row.body ?? undefined,
    trigger,
    status: row.status,
    priority: row.priority,
    createdAt: new Date(row.created_at),
    triggeredAt: row.triggered_at ? new Date(row.triggered_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    snoozeUntil: row.snooze_until ? new Date(row.snooze_until) : undefined,
    contextTags: row.context_tags ? JSON.parse(row.context_tags) : undefined,
    quietHoursExempt: row.quiet_hours_exempt === 1,
    chunkId: row.chunk_id ?? undefined,
  };
}

/**
 * Convert a Reminder object to database row values
 */
export function reminderToRow(reminder: Reminder): ReminderRow {
  const { type, spec } = serializeTrigger(reminder.trigger);

  return {
    id: reminder.id,
    agent_id: reminder.agentId,
    title: reminder.title,
    body: reminder.body ?? null,
    trigger_type: type,
    trigger_spec: spec,
    status: reminder.status,
    priority: reminder.priority,
    created_at: reminder.createdAt.getTime(),
    triggered_at: reminder.triggeredAt?.getTime() ?? null,
    completed_at: reminder.completedAt?.getTime() ?? null,
    snooze_until: reminder.snoozeUntil?.getTime() ?? null,
    context_tags: reminder.contextTags ? JSON.stringify(reminder.contextTags) : null,
    quiet_hours_exempt: reminder.quietHoursExempt ? 1 : 0,
    chunk_id: reminder.chunkId ?? null,
  };
}

/**
 * Parse trigger from stored format
 */
function parseTrigger(type: ReminderTriggerType, spec: string): ReminderTrigger {
  switch (type) {
    case "scheduled":
      return { type: "scheduled", datetime: new Date(spec) };
    case "recurring":
      return { type: "recurring", cron: spec };
    case "context":
      return { type: "context", pattern: spec };
  }
}

/**
 * Serialize trigger for storage
 */
function serializeTrigger(trigger: ReminderTrigger): { type: ReminderTriggerType; spec: string } {
  switch (trigger.type) {
    case "scheduled":
      return { type: "scheduled", spec: trigger.datetime.toISOString() };
    case "recurring":
      return { type: "recurring", spec: trigger.cron };
    case "context":
      return { type: "context", spec: trigger.pattern };
  }
}

/**
 * Check if a reminder is currently due based on its trigger
 */
export function isReminderDue(reminder: Reminder, asOf: Date = new Date()): boolean {
  if (reminder.status !== "pending") return false;

  // If snoozed, check snooze time
  if (reminder.snoozeUntil && asOf < reminder.snoozeUntil) return false;

  switch (reminder.trigger.type) {
    case "scheduled":
      return asOf >= reminder.trigger.datetime;

    case "recurring":
      // Recurring reminders are handled by cron service
      // This check is for the next scheduled occurrence
      return false;

    case "context":
      // Context reminders are not time-based
      return false;

    default:
      return false;
  }
}

/**
 * Check if current time is within quiet hours
 */
export function isQuietHours(config: ReminderInjectionConfig, now: Date = new Date()): boolean {
  if (!config.quietHoursStart || !config.quietHoursEnd) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = config.quietHoursStart.split(":").map(Number);
  const [endH, endM] = config.quietHoursEnd.split(":").map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Format a reminder for display in agent context
 */
export function formatReminderForContext(reminder: Reminder): string {
  const priorityEmoji = {
    urgent: "[!]",
    normal: "[-]",
    low: "[.]",
  }[reminder.priority];

  let triggerInfo = "";
  switch (reminder.trigger.type) {
    case "scheduled":
      triggerInfo = `Due: ${reminder.trigger.datetime.toLocaleString()}`;
      break;
    case "recurring":
      triggerInfo = `Recurring: ${reminder.trigger.cron}`;
      break;
    case "context":
      triggerInfo = `Context: ${reminder.trigger.pattern}`;
      break;
  }

  const lines = [`${priorityEmoji} ${reminder.title}`, triggerInfo];

  if (reminder.body) {
    lines.push(reminder.body);
  }

  return lines.join("\n");
}

/**
 * Format multiple reminders for injection into agent context
 */
export function formatRemindersForInjection(reminders: ProactiveReminderResult[]): string {
  if (reminders.length === 0) return "";

  const formattedReminders = reminders.map((r) => formatReminderForContext(r.reminder));

  return `## Active Reminders\n\n${formattedReminders.join("\n\n")}\n`;
}
