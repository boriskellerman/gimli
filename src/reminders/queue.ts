/**
 * Reminder queue with priority-aware delivery
 *
 * Manages pending reminders with:
 * - Priority-based ordering (urgent > normal > low)
 * - Quiet hours respect (non-urgent held during quiet hours)
 * - Context coalescing for low-priority reminders
 * - Batching for normal-priority reminders
 */

import {
  defaultPriorityConfig,
  defaultReminderInjectionConfig,
  isQuietHours,
  isReminderEligible,
  shouldBypassQuietHours,
  sortRemindersByPriority,
  type PrioritySystemConfig,
  type Reminder,
  type ReminderInjectionConfig,
  type ReminderPriority,
} from "./types.js";

/**
 * Queued reminder with delivery metadata
 */
export interface QueuedReminder {
  /** The reminder */
  reminder: Reminder;
  /** When the reminder was added to the queue */
  queuedAt: Date;
  /** Number of delivery attempts */
  deliveryAttempts: number;
  /** Whether this reminder is part of a batch */
  batched: boolean;
  /** Batch ID if part of a batch */
  batchId?: string;
  /** Whether this reminder was coalesced with others */
  coalesced: boolean;
  /** IDs of reminders coalesced into this one */
  coalescedIds?: string[];
}

/**
 * Batch of reminders for delivery
 */
export interface ReminderBatch {
  /** Unique batch identifier */
  id: string;
  /** Reminders in this batch */
  reminders: Reminder[];
  /** Priority level of the batch */
  priority: ReminderPriority;
  /** When the batch was created */
  createdAt: Date;
}

/**
 * Result of processing the queue
 */
export interface QueueProcessResult {
  /** Reminders ready for immediate delivery */
  immediate: Reminder[];
  /** Batched reminders (normal priority) */
  batches: ReminderBatch[];
  /** Coalesced reminders (low priority) */
  coalesced: CoalescedGroup[];
  /** Reminders held due to quiet hours */
  held: Reminder[];
}

/**
 * Group of coalesced low-priority reminders
 */
export interface CoalescedGroup {
  /** Context tag that groups these reminders */
  contextTag: string;
  /** Reminders in this group */
  reminders: Reminder[];
  /** Summary reminder representing the group */
  summary: string;
}

/**
 * Queue configuration
 */
export interface ReminderQueueConfig {
  /** Injection config for quiet hours */
  injection: ReminderInjectionConfig;
  /** Priority system config */
  priority: PrioritySystemConfig;
}

/**
 * Default queue configuration
 */
export const defaultQueueConfig: ReminderQueueConfig = {
  injection: defaultReminderInjectionConfig,
  priority: defaultPriorityConfig,
};

/**
 * Reminder queue managing pending reminders
 */
export class ReminderQueue {
  private queue: Map<string, QueuedReminder> = new Map();
  private config: ReminderQueueConfig;

  constructor(config: Partial<ReminderQueueConfig> = {}) {
    this.config = {
      injection: config.injection ?? defaultReminderInjectionConfig,
      priority: config.priority ?? defaultPriorityConfig,
    };
  }

  /**
   * Add a reminder to the queue
   */
  add(reminder: Reminder): void {
    const queued: QueuedReminder = {
      reminder,
      queuedAt: new Date(),
      deliveryAttempts: 0,
      batched: false,
      coalesced: false,
    };
    this.queue.set(reminder.id, queued);
  }

  /**
   * Add multiple reminders to the queue
   */
  addAll(reminders: Reminder[]): void {
    for (const reminder of reminders) {
      this.add(reminder);
    }
  }

  /**
   * Remove a reminder from the queue
   */
  remove(reminderId: string): boolean {
    return this.queue.delete(reminderId);
  }

  /**
   * Get a reminder from the queue
   */
  get(reminderId: string): QueuedReminder | undefined {
    return this.queue.get(reminderId);
  }

  /**
   * Check if a reminder is in the queue
   */
  has(reminderId: string): boolean {
    return this.queue.has(reminderId);
  }

  /**
   * Get the number of reminders in the queue
   */
  get size(): number {
    return this.queue.size;
  }

  /**
   * Clear all reminders from the queue
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Get all queued reminders
   */
  getAll(): QueuedReminder[] {
    return Array.from(this.queue.values());
  }

  /**
   * Get reminders by priority
   */
  getByPriority(priority: ReminderPriority): QueuedReminder[] {
    return this.getAll().filter((q) => q.reminder.priority === priority);
  }

  /**
   * Process the queue and determine which reminders to deliver
   *
   * Returns reminders categorized by delivery method:
   * - immediate: Urgent reminders for immediate delivery
   * - batches: Normal reminders grouped into batches
   * - coalesced: Low reminders grouped by context
   * - held: Reminders held during quiet hours
   */
  process(now: Date = new Date()): QueueProcessResult {
    const result: QueueProcessResult = {
      immediate: [],
      batches: [],
      coalesced: [],
      held: [],
    };

    // Get eligible reminders
    const eligible = this.getAll().filter((q) => isReminderEligible(q.reminder, now));

    // Check if we're in quiet hours
    const inQuietHours = isQuietHours(this.config.injection, now);

    // Separate by quiet hours handling
    const { deliverable, held } = this.separateByQuietHours(
      eligible.map((q) => q.reminder),
      inQuietHours,
    );
    result.held = held;

    // Sort deliverable by priority
    const sorted = sortRemindersByPriority(deliverable);

    // Process by priority
    const urgent = sorted.filter((r) => r.priority === "urgent");
    const normal = sorted.filter((r) => r.priority === "normal");
    const low = sorted.filter((r) => r.priority === "low");

    // Urgent: immediate delivery
    result.immediate = urgent;

    // Normal: batch according to config
    result.batches = this.batchReminders(normal, now);

    // Low: coalesce by context
    result.coalesced = this.coalesceReminders(low);

    return result;
  }

  /**
   * Separate reminders into deliverable and held based on quiet hours
   */
  private separateByQuietHours(
    reminders: Reminder[],
    inQuietHours: boolean,
  ): { deliverable: Reminder[]; held: Reminder[] } {
    if (!inQuietHours) {
      return { deliverable: reminders, held: [] };
    }

    const deliverable: Reminder[] = [];
    const held: Reminder[] = [];

    for (const reminder of reminders) {
      if (shouldBypassQuietHours(reminder, this.config.priority)) {
        deliverable.push(reminder);
      } else {
        held.push(reminder);
      }
    }

    return { deliverable, held };
  }

  /**
   * Batch normal-priority reminders according to config
   */
  private batchReminders(reminders: Reminder[], now: Date): ReminderBatch[] {
    if (reminders.length === 0) return [];

    const maxBatchSize = this.config.priority.normal.maxBatchSize;
    const batches: ReminderBatch[] = [];

    // Sort by creation time for consistent batching
    const sorted = [...reminders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Create batches of maxBatchSize
    for (let i = 0; i < sorted.length; i += maxBatchSize) {
      const batchReminders = sorted.slice(i, i + maxBatchSize);
      const batch: ReminderBatch = {
        id: `batch-${now.getTime()}-${i}`,
        reminders: batchReminders,
        priority: "normal",
        createdAt: now,
      };
      batches.push(batch);

      // Mark reminders as batched
      for (const reminder of batchReminders) {
        const queued = this.queue.get(reminder.id);
        if (queued) {
          queued.batched = true;
          queued.batchId = batch.id;
        }
      }
    }

    return batches;
  }

  /**
   * Coalesce low-priority reminders by context
   */
  private coalesceReminders(reminders: Reminder[]): CoalescedGroup[] {
    if (reminders.length === 0) return [];

    // Check if coalescing is enabled
    if (!this.config.priority.low.coalesceByContext) {
      // Return each reminder as its own group
      return reminders.map((r) => ({
        contextTag: r.contextTags?.[0] ?? "general",
        reminders: [r],
        summary: r.title,
      }));
    }

    // Group by context tags
    const groups = new Map<string, Reminder[]>();

    for (const reminder of reminders) {
      // Use first context tag or "general" as the grouping key
      const tag = reminder.contextTags?.[0] ?? "general";

      const group = groups.get(tag) ?? [];
      group.push(reminder);
      groups.set(tag, group);
    }

    // Convert to CoalescedGroup array
    const coalesced: CoalescedGroup[] = [];

    for (const [tag, groupReminders] of groups) {
      const summary =
        groupReminders.length === 1
          ? groupReminders[0].title
          : `${groupReminders.length} ${tag} reminders`;

      coalesced.push({
        contextTag: tag,
        reminders: groupReminders,
        summary,
      });

      // Mark reminders as coalesced
      if (groupReminders.length > 1) {
        const coalescedIds = groupReminders.map((r) => r.id);
        for (const reminder of groupReminders) {
          const queued = this.queue.get(reminder.id);
          if (queued) {
            queued.coalesced = true;
            queued.coalescedIds = coalescedIds.filter((id) => id !== reminder.id);
          }
        }
      }
    }

    return coalesced;
  }

  /**
   * Get the next delivery time considering quiet hours
   *
   * If currently in quiet hours, returns the end of quiet hours.
   * Otherwise returns the current time.
   */
  getNextDeliveryTime(now: Date = new Date()): Date {
    const { quietHoursStart, quietHoursEnd } = this.config.injection;

    // If quiet hours not configured, deliver now
    if (!quietHoursStart || !quietHoursEnd) {
      return now;
    }

    // If not in quiet hours, deliver now
    if (!isQuietHours(this.config.injection, now)) {
      return now;
    }

    // Calculate when quiet hours end
    const [endH, endM] = quietHoursEnd.split(":").map(Number);
    const endTime = new Date(now);
    endTime.setHours(endH, endM, 0, 0);

    // If end time is before now, it's tomorrow
    if (endTime <= now) {
      endTime.setDate(endTime.getDate() + 1);
    }

    return endTime;
  }

  /**
   * Increment delivery attempts for a reminder
   */
  incrementDeliveryAttempts(reminderId: string): number {
    const queued = this.queue.get(reminderId);
    if (!queued) return 0;
    queued.deliveryAttempts += 1;
    return queued.deliveryAttempts;
  }

  /**
   * Get reminders that have exceeded max delivery attempts
   */
  getFailedDeliveries(maxAttempts: number): QueuedReminder[] {
    return this.getAll().filter((q) => q.deliveryAttempts >= maxAttempts);
  }

  /**
   * Update the queue configuration
   */
  updateConfig(config: Partial<ReminderQueueConfig>): void {
    if (config.injection) {
      this.config.injection = { ...this.config.injection, ...config.injection };
    }
    if (config.priority) {
      this.config.priority = { ...this.config.priority, ...config.priority };
    }
  }

  /**
   * Get the current configuration
   */
  getConfig(): ReminderQueueConfig {
    return { ...this.config };
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const all = this.getAll();
    return {
      total: all.length,
      byPriority: {
        urgent: all.filter((q) => q.reminder.priority === "urgent").length,
        normal: all.filter((q) => q.reminder.priority === "normal").length,
        low: all.filter((q) => q.reminder.priority === "low").length,
      },
      batched: all.filter((q) => q.batched).length,
      coalesced: all.filter((q) => q.coalesced).length,
    };
  }
}

/**
 * Queue statistics
 */
export interface QueueStats {
  total: number;
  byPriority: Record<ReminderPriority, number>;
  batched: number;
  coalesced: number;
}

/**
 * Create a reminder queue with the given configuration
 */
export function createReminderQueue(config?: Partial<ReminderQueueConfig>): ReminderQueue {
  return new ReminderQueue(config);
}

/**
 * Process reminders for delivery without maintaining queue state
 *
 * Stateless helper for one-time processing of a reminder list.
 */
export function processRemindersForDelivery(
  reminders: Reminder[],
  config: ReminderQueueConfig = defaultQueueConfig,
  now: Date = new Date(),
): QueueProcessResult {
  const queue = new ReminderQueue(config);
  queue.addAll(reminders);
  return queue.process(now);
}

/**
 * Get delivery priority for a set of process results
 *
 * Returns reminders in order of delivery priority:
 * 1. Immediate (urgent)
 * 2. First batch of normal
 * 3. Coalesced low priority
 */
export function getDeliveryOrder(result: QueueProcessResult): Reminder[] {
  const order: Reminder[] = [];

  // Urgent first
  order.push(...result.immediate);

  // First batch of normal (if any)
  if (result.batches.length > 0) {
    order.push(...result.batches[0].reminders);
  }

  // Coalesced low (first from each group)
  for (const group of result.coalesced) {
    if (group.reminders.length > 0) {
      // For coalesced groups, we might want to deliver just a summary
      // or the first reminder. Here we include the first one.
      order.push(group.reminders[0]);
    }
  }

  return order;
}

/**
 * Format a coalesced group for display
 */
export function formatCoalescedGroup(group: CoalescedGroup): string {
  if (group.reminders.length === 1) {
    return group.reminders[0].title;
  }

  const titles = group.reminders.map((r) => `  - ${r.title}`).join("\n");
  return `${group.summary}:\n${titles}`;
}

/**
 * Format a batch for display
 */
export function formatBatch(batch: ReminderBatch): string {
  if (batch.reminders.length === 1) {
    return batch.reminders[0].title;
  }

  const titles = batch.reminders.map((r) => `  - ${r.title}`).join("\n");
  return `${batch.reminders.length} reminders:\n${titles}`;
}
