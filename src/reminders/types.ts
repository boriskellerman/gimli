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
 * - urgent: High priority, bypass quiet hours, immediate delivery, auto-repeat
 * - normal: Standard priority, respects quiet hours, batched up to 3
 * - low: Background reminder, aggressive batching, context coalescing
 */
export type ReminderPriority = "urgent" | "normal" | "low";

/**
 * Priority-specific delivery configuration for urgent reminders
 */
export interface UrgentPriorityConfig {
  /** Always delivered even during quiet hours */
  bypassQuietHours: true;
  /** Minutes before auto-repeating if not acknowledged (null = no repeat) */
  repeatOnDismissMinutes: number | null;
  /** Minimum snooze duration in minutes */
  minSnoozeMinutes: number;
  /** Maximum snooze duration in minutes */
  maxSnoozeMinutes: number;
  /** Whether to deliver to all active channels */
  escalateToAllChannels: boolean;
  /** Relevance boost factor for semantic search (1.0 = no boost) */
  relevanceBoost: number;
}

/**
 * Priority-specific delivery configuration for normal reminders
 */
export interface NormalPriorityConfig {
  /** Maximum reminders to batch together */
  maxBatchSize: number;
  /** Minimum snooze duration in minutes */
  minSnoozeMinutes: number;
  /** Maximum snooze duration in minutes */
  maxSnoozeMinutes: number;
}

/**
 * Priority-specific delivery configuration for low reminders
 */
export interface LowPriorityConfig {
  /** Whether to combine similar context reminders */
  coalesceByContext: boolean;
  /** Optional time to batch all low reminders (HH:MM format, null = no digest) */
  digestTime: string | null;
  /** Minimum snooze duration in minutes */
  minSnoozeMinutes: number;
  /** Maximum snooze duration in minutes */
  maxSnoozeMinutes: number;
  /** Relevance factor for semantic search (1.0 = normal, <1 = reduced) */
  relevanceFactor: number;
}

/**
 * Complete priority system configuration
 */
export interface PrioritySystemConfig {
  urgent: UrgentPriorityConfig;
  normal: NormalPriorityConfig;
  low: LowPriorityConfig;
}

/**
 * Default priority system configuration
 */
export const defaultPriorityConfig: PrioritySystemConfig = {
  urgent: {
    bypassQuietHours: true,
    repeatOnDismissMinutes: 5,
    minSnoozeMinutes: 5,
    maxSnoozeMinutes: 60,
    escalateToAllChannels: true,
    relevanceBoost: 1.5,
  },
  normal: {
    maxBatchSize: 3,
    minSnoozeMinutes: 15,
    maxSnoozeMinutes: 24 * 60, // 24 hours
  },
  low: {
    coalesceByContext: true,
    digestTime: null,
    minSnoozeMinutes: 60,
    maxSnoozeMinutes: 7 * 24 * 60, // 7 days
    relevanceFactor: 0.7,
  },
};

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

/**
 * Priority order for sorting (lower number = higher priority)
 */
const PRIORITY_ORDER: Record<ReminderPriority, number> = {
  urgent: 0,
  normal: 1,
  low: 2,
};

/**
 * Get the due time for a reminder (for sorting within same priority)
 */
function getDueTime(reminder: Reminder): number {
  if (reminder.trigger.type === "scheduled") {
    return reminder.trigger.datetime.getTime();
  }
  // For recurring/context, use creation time as fallback
  return reminder.createdAt.getTime();
}

/**
 * Check if a reminder is eligible for injection (pending or snoozed and due)
 */
export function isReminderEligible(reminder: Reminder, now: Date = new Date()): boolean {
  if (reminder.status === "pending") return true;
  if (reminder.status === "snoozed" && reminder.snoozeUntil && reminder.snoozeUntil <= now) {
    return true;
  }
  return false;
}

/**
 * Check if a reminder should bypass quiet hours
 */
export function shouldBypassQuietHours(
  reminder: Reminder,
  config: PrioritySystemConfig = defaultPriorityConfig,
): boolean {
  // Explicitly marked as quiet hours exempt
  if (reminder.quietHoursExempt) return true;

  // Urgent reminders bypass by default
  if (reminder.priority === "urgent" && config.urgent.bypassQuietHours) {
    return true;
  }

  return false;
}

/**
 * Sort reminders by priority and due time
 */
export function sortRemindersByPriority(reminders: Reminder[]): Reminder[] {
  return [...reminders].sort((a, b) => {
    // First sort by priority
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Within same priority, sort by due time (earliest first)
    return getDueTime(a) - getDueTime(b);
  });
}

/**
 * Select reminders for injection based on priority rules
 *
 * Algorithm:
 * 1. Filter to eligible reminders (pending or snoozed and due)
 * 2. During quiet hours, only include urgent/exempt reminders
 * 3. Sort by priority (urgent > normal > low) and due time
 * 4. Urgent reminders always included (no limit)
 * 5. Normal + low subject to maxReminders limit
 */
export function selectRemindersForInjection(
  reminders: Reminder[],
  config: ReminderInjectionConfig,
  now: Date = new Date(),
  priorityConfig: PrioritySystemConfig = defaultPriorityConfig,
): Reminder[] {
  // Step 1: Filter to eligible reminders
  const eligible = reminders.filter((r) => isReminderEligible(r, now));

  // Step 2: Handle quiet hours
  const inQuietHours = isQuietHours(config, now);
  const filtered = inQuietHours
    ? eligible.filter((r) => shouldBypassQuietHours(r, priorityConfig))
    : eligible;

  // Step 3: Sort by priority and due time
  const sorted = sortRemindersByPriority(filtered);

  // Step 4 & 5: Apply limits
  // Urgent reminders always included
  const urgent = sorted.filter((r) => r.priority === "urgent");
  const normalAndLow = sorted.filter((r) => r.priority !== "urgent");

  // Normal + low are subject to maxReminders limit
  const limited = normalAndLow.slice(0, config.maxReminders);

  return [...urgent, ...limited];
}

/**
 * Get snooze constraints for a priority level
 */
export function getSnoozeConstraints(
  priority: ReminderPriority,
  config: PrioritySystemConfig = defaultPriorityConfig,
): { minMinutes: number; maxMinutes: number } {
  switch (priority) {
    case "urgent":
      return {
        minMinutes: config.urgent.minSnoozeMinutes,
        maxMinutes: config.urgent.maxSnoozeMinutes,
      };
    case "normal":
      return {
        minMinutes: config.normal.minSnoozeMinutes,
        maxMinutes: config.normal.maxSnoozeMinutes,
      };
    case "low":
      return {
        minMinutes: config.low.minSnoozeMinutes,
        maxMinutes: config.low.maxSnoozeMinutes,
      };
  }
}

/**
 * Validate and clamp snooze duration to priority constraints
 */
export function clampSnoozeDuration(
  minutes: number,
  priority: ReminderPriority,
  config: PrioritySystemConfig = defaultPriorityConfig,
): number {
  const { minMinutes, maxMinutes } = getSnoozeConstraints(priority, config);
  return Math.max(minMinutes, Math.min(maxMinutes, minutes));
}

/**
 * Get relevance adjustment factor for a priority level
 * Used for semantic search ranking
 */
export function getRelevanceAdjustment(
  priority: ReminderPriority,
  config: PrioritySystemConfig = defaultPriorityConfig,
): number {
  switch (priority) {
    case "urgent":
      return config.urgent.relevanceBoost;
    case "normal":
      return 1.0; // No adjustment
    case "low":
      return config.low.relevanceFactor;
  }
}

/**
 * Check if a reminder should auto-repeat after dismissal
 */
export function shouldAutoRepeat(
  reminder: Reminder,
  config: PrioritySystemConfig = defaultPriorityConfig,
): { shouldRepeat: boolean; intervalMinutes: number | null } {
  if (reminder.priority === "urgent" && config.urgent.repeatOnDismissMinutes !== null) {
    return {
      shouldRepeat: true,
      intervalMinutes: config.urgent.repeatOnDismissMinutes,
    };
  }
  return { shouldRepeat: false, intervalMinutes: null };
}
