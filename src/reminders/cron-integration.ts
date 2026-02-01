/**
 * Reminder-Cron integration module
 *
 * Integrates the reminder system with Gimli's existing cron service.
 * - Scheduled reminders → one-time cron jobs (kind: "at")
 * - Recurring reminders → cron expression jobs (kind: "cron")
 * - Context reminders → not scheduled (handled via semantic search)
 */

import type { CronJob, CronJobCreate, CronSchedule } from "../cron/types.js";
import type { CronService } from "../cron/service.js";
import type { Reminder, ReminderPriority } from "./types.js";

/**
 * Job ID prefix for reminder-based cron jobs
 */
export const REMINDER_JOB_PREFIX = "reminder:";

/**
 * Build the cron job ID for a reminder
 */
export function getReminderJobId(reminderId: string): string {
  return `${REMINDER_JOB_PREFIX}${reminderId}`;
}

/**
 * Extract reminder ID from a cron job ID
 * Returns undefined if the job is not a reminder job
 */
export function parseReminderJobId(jobId: string): string | undefined {
  if (!jobId.startsWith(REMINDER_JOB_PREFIX)) return undefined;
  return jobId.slice(REMINDER_JOB_PREFIX.length);
}

/**
 * Check if a cron job is a reminder-based job
 */
export function isReminderJob(jobId: string): boolean {
  return jobId.startsWith(REMINDER_JOB_PREFIX);
}

/**
 * Format priority for display in reminder messages
 */
function formatPriority(priority: ReminderPriority): string {
  switch (priority) {
    case "urgent":
      return "URGENT";
    case "normal":
      return "Reminder";
    case "low":
      return "FYI";
  }
}

/**
 * Build the system event text for a reminder trigger
 */
export function buildReminderTriggerText(reminder: Reminder): string {
  const priorityLabel = formatPriority(reminder.priority);
  const lines = [`[${priorityLabel}] ${reminder.title}`];

  if (reminder.body) {
    lines.push(reminder.body);
  }

  if (reminder.contextTags && reminder.contextTags.length > 0) {
    lines.push(`Context: ${reminder.contextTags.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Convert a reminder trigger to a cron schedule
 * Returns undefined for context-based reminders (not schedulable)
 */
export function reminderTriggerToCronSchedule(reminder: Reminder): CronSchedule | undefined {
  switch (reminder.trigger.type) {
    case "scheduled":
      return {
        kind: "at",
        atMs: reminder.trigger.datetime.getTime(),
      };

    case "recurring":
      return {
        kind: "cron",
        expr: reminder.trigger.cron,
      };

    case "context":
      // Context-based reminders are not scheduled via cron
      // They're delivered via semantic search during agent turns
      return undefined;
  }
}

/**
 * Create input for a cron job from a reminder
 * Returns undefined if the reminder cannot be scheduled (context-based)
 */
export function reminderToCronJobCreate(reminder: Reminder): CronJobCreate | undefined {
  const schedule = reminderTriggerToCronSchedule(reminder);
  if (!schedule) return undefined;

  const isOneShot = reminder.trigger.type === "scheduled";

  return {
    name: getReminderJobId(reminder.id),
    agentId: reminder.agentId,
    description: `Reminder: ${reminder.title}`,
    enabled: reminder.status === "pending",
    deleteAfterRun: isOneShot,
    schedule,
    sessionTarget: "main",
    wakeMode: "now",
    payload: {
      kind: "systemEvent",
      text: buildReminderTriggerText(reminder),
    },
  };
}

/**
 * Register a reminder with the cron service
 *
 * - Scheduled reminders become one-time jobs
 * - Recurring reminders become cron expression jobs
 * - Context reminders are skipped (not schedulable)
 *
 * Returns the created cron job, or undefined if not schedulable
 */
export async function registerReminderWithCron(
  cronService: CronService,
  reminder: Reminder,
): Promise<CronJob | undefined> {
  const jobCreate = reminderToCronJobCreate(reminder);
  if (!jobCreate) return undefined;

  // Check if job already exists by listing and searching
  const existingJobs = await cronService.list({ includeDisabled: true });
  const existingJob = existingJobs.find((j) => j.name === jobCreate.name);

  if (existingJob) {
    // Update existing job instead of creating duplicate
    const updatedJob = await cronService.update(existingJob.id, {
      enabled: jobCreate.enabled,
      schedule: jobCreate.schedule,
      payload: jobCreate.payload,
    });
    return updatedJob;
  }

  return await cronService.add(jobCreate);
}

/**
 * Unregister a reminder from the cron service
 *
 * Returns true if a job was removed, false if no job existed
 */
export async function unregisterReminderFromCron(
  cronService: CronService,
  reminderId: string,
): Promise<boolean> {
  const jobName = getReminderJobId(reminderId);
  const existingJobs = await cronService.list({ includeDisabled: true });
  const existingJob = existingJobs.find((j) => j.name === jobName);

  if (!existingJob) return false;

  const result = await cronService.remove(existingJob.id);
  return result.removed;
}

/**
 * Update a reminder's cron job (e.g., after snooze or status change)
 *
 * - If status is 'pending', enables the job
 * - If status is 'snoozed', updates schedule to snoozeUntil time
 * - Otherwise, disables the job
 */
export async function updateReminderCronJob(
  cronService: CronService,
  reminder: Reminder,
): Promise<CronJob | undefined> {
  const jobName = getReminderJobId(reminder.id);
  const existingJobs = await cronService.list({ includeDisabled: true });
  const existingJob = existingJobs.find((j) => j.name === jobName);

  // Context reminders have no cron job
  if (reminder.trigger.type === "context") {
    if (existingJob) {
      await cronService.remove(existingJob.id);
    }
    return undefined;
  }

  // Determine if job should be enabled
  const shouldBeEnabled = reminder.status === "pending" || reminder.status === "snoozed";

  // Determine schedule
  let schedule: CronSchedule;
  if (reminder.status === "snoozed" && reminder.snoozeUntil) {
    // Snoozed reminders use snoozeUntil as the trigger time
    schedule = { kind: "at", atMs: reminder.snoozeUntil.getTime() };
  } else {
    const baseSchedule = reminderTriggerToCronSchedule(reminder);
    if (!baseSchedule) return undefined;
    schedule = baseSchedule;
  }

  if (!existingJob) {
    // Create new job if reminder is active
    if (shouldBeEnabled) {
      const jobCreate = reminderToCronJobCreate(reminder);
      if (jobCreate) {
        jobCreate.schedule = schedule;
        return await cronService.add(jobCreate);
      }
    }
    return undefined;
  }

  // Update existing job
  return await cronService.update(existingJob.id, {
    enabled: shouldBeEnabled,
    schedule,
    payload: {
      kind: "systemEvent",
      text: buildReminderTriggerText(reminder),
    },
  });
}

/**
 * Sync all reminders with the cron service
 *
 * This ensures the cron service has jobs for all active reminders
 * and removes jobs for completed/dismissed reminders.
 */
export async function syncRemindersWithCron(
  cronService: CronService,
  reminders: Reminder[],
): Promise<{ registered: number; updated: number; removed: number }> {
  const result = { registered: 0, updated: 0, removed: 0 };

  // Get all existing reminder jobs
  const existingJobs = await cronService.list({ includeDisabled: true });
  const reminderJobs = existingJobs.filter((j) => isReminderJob(j.name));

  // Build map of reminder IDs to reminders
  const reminderMap = new Map(reminders.map((r) => [r.id, r]));

  // Track which jobs we've processed
  const processedJobNames = new Set<string>();

  // Process each reminder
  for (const reminder of reminders) {
    const jobName = getReminderJobId(reminder.id);
    processedJobNames.add(jobName);

    const existingJob = reminderJobs.find((j) => j.name === jobName);
    const shouldHaveJob =
      reminder.trigger.type !== "context" &&
      (reminder.status === "pending" || reminder.status === "snoozed");

    if (shouldHaveJob) {
      if (existingJob) {
        // Update existing job
        await updateReminderCronJob(cronService, reminder);
        result.updated++;
      } else {
        // Register new job
        const job = await registerReminderWithCron(cronService, reminder);
        if (job) result.registered++;
      }
    } else if (existingJob) {
      // Remove job for inactive reminder
      await cronService.remove(existingJob.id);
      result.removed++;
    }
  }

  // Remove orphaned jobs (reminders that no longer exist)
  for (const job of reminderJobs) {
    if (processedJobNames.has(job.name)) continue;

    const reminderId = parseReminderJobId(job.name);
    if (reminderId && !reminderMap.has(reminderId)) {
      await cronService.remove(job.id);
      result.removed++;
    }
  }

  return result;
}

/**
 * Callback type for when a reminder cron job fires
 */
export type ReminderTriggerCallback = (reminderId: string, job: CronJob) => Promise<void> | void;

/**
 * Create a handler for cron job execution that detects reminder jobs
 * and invokes the appropriate callback
 *
 * This is meant to be integrated with the cron service's event system
 */
export function createReminderJobHandler(
  onReminderTrigger: ReminderTriggerCallback,
): (job: CronJob) => Promise<void> {
  return async (job: CronJob) => {
    const reminderId = parseReminderJobId(job.name);
    if (!reminderId) return; // Not a reminder job

    await onReminderTrigger(reminderId, job);
  };
}

/**
 * Get all reminder-related cron jobs
 */
export async function listReminderCronJobs(
  cronService: CronService,
  opts?: { includeDisabled?: boolean },
): Promise<CronJob[]> {
  const allJobs = await cronService.list(opts);
  return allJobs.filter((j) => isReminderJob(j.name));
}

/**
 * Get the cron job for a specific reminder
 */
export async function getReminderCronJob(
  cronService: CronService,
  reminderId: string,
): Promise<CronJob | undefined> {
  const jobName = getReminderJobId(reminderId);
  const jobs = await cronService.list({ includeDisabled: true });
  return jobs.find((j) => j.name === jobName);
}
