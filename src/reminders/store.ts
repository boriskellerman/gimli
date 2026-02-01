/**
 * Reminder store for CRUD operations
 *
 * Manages reminders in SQLite storage, integrating with the existing
 * memory database infrastructure.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveAgentDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import type { GimliConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import {
  clampSnoozeDuration,
  rowToReminder,
  type CreateReminderInput,
  type Reminder,
  type ReminderFilter,
  type ReminderPriority,
  type ReminderRow,
  type ReminderStatus,
  type ReminderTrigger,
} from "./types.js";
import { ensureReminderSchema, getReminderStats } from "./schema.js";

const DEFAULT_REMINDERS_DB_FILENAME = "reminders.db";

/**
 * Resolve the reminders database path for an agent
 */
export function resolveRemindersDbPath(cfg: GimliConfig, agentId: string): string {
  const agentDir = resolveAgentDir(cfg, agentId);
  return path.join(agentDir, DEFAULT_REMINDERS_DB_FILENAME);
}

/**
 * Ensure the database directory exists
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Open or create the reminders database
 */
function openRemindersDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  ensureDir(dir);
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  ensureReminderSchema(db);
  return db;
}

/**
 * Serialize a trigger for database storage
 */
function serializeTrigger(trigger: ReminderTrigger): { type: string; spec: string } {
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
 * Reminder store instance for an agent
 */
export class ReminderStore {
  private db: DatabaseSync;
  private agentId: string;

  constructor(db: DatabaseSync, agentId: string) {
    this.db = db;
    this.agentId = agentId;
  }

  /**
   * Create a new reminder
   */
  create(input: CreateReminderInput): Reminder {
    const id = randomUUID();
    const now = new Date();
    const { type, spec } = serializeTrigger(input.trigger);

    const stmt = this.db.prepare(`
      INSERT INTO reminders (
        id, agent_id, title, body, trigger_type, trigger_spec,
        status, priority, created_at, context_tags, quiet_hours_exempt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.agentId,
      input.title,
      input.body ?? null,
      type,
      spec,
      "pending",
      input.priority ?? "normal",
      now.getTime(),
      input.contextTags ? JSON.stringify(input.contextTags) : null,
      input.quietHoursExempt ? 1 : 0,
    );

    return {
      id,
      agentId: input.agentId,
      title: input.title,
      body: input.body,
      trigger: input.trigger,
      status: "pending",
      priority: input.priority ?? "normal",
      createdAt: now,
      contextTags: input.contextTags,
      quietHoursExempt: input.quietHoursExempt ?? false,
    };
  }

  /**
   * Get a reminder by ID
   */
  get(id: string): Reminder | null {
    const row = this.db
      .prepare(`SELECT * FROM reminders WHERE id = ? AND agent_id = ?`)
      .get(id, this.agentId) as ReminderRow | undefined;

    if (!row) return null;
    return rowToReminder(row);
  }

  /**
   * List reminders with optional filters
   */
  list(filter?: ReminderFilter): Reminder[] {
    const conditions: string[] = ["agent_id = ?"];
    const params: (string | number)[] = [this.agentId];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      const placeholders = statuses.map(() => "?").join(", ");
      conditions.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }

    if (filter?.priority) {
      const priorities = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      const placeholders = priorities.map(() => "?").join(", ");
      conditions.push(`priority IN (${placeholders})`);
      params.push(...priorities);
    }

    if (filter?.triggerType) {
      const types = Array.isArray(filter.triggerType) ? filter.triggerType : [filter.triggerType];
      const placeholders = types.map(() => "?").join(", ");
      conditions.push(`trigger_type IN (${placeholders})`);
      params.push(...types);
    }

    if (filter?.createdAfter) {
      conditions.push("created_at >= ?");
      params.push(filter.createdAfter.getTime());
    }

    if (filter?.createdBefore) {
      conditions.push("created_at <= ?");
      params.push(filter.createdBefore.getTime());
    }

    let sql = `SELECT * FROM reminders WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;

    if (filter?.limit) {
      sql += ` LIMIT ${filter.limit}`;
    }

    if (filter?.offset) {
      sql += ` OFFSET ${filter.offset}`;
    }

    const rows = this.db.prepare(sql).all(...params) as ReminderRow[];
    return rows.map(rowToReminder);
  }

  /**
   * Update reminder status
   */
  updateStatus(id: string, status: ReminderStatus): boolean {
    const now = Date.now();
    let sql = `UPDATE reminders SET status = ?`;
    const params: (string | number)[] = [status];

    if (status === "completed") {
      sql += ", completed_at = ?";
      params.push(now);
    } else if (status === "triggered") {
      sql += ", triggered_at = ?";
      params.push(now);
    }

    sql += " WHERE id = ? AND agent_id = ?";
    params.push(id, this.agentId);

    const result = this.db.prepare(sql).run(...params);
    return result.changes > 0;
  }

  /**
   * Snooze a reminder
   */
  snooze(id: string, minutes: number): boolean {
    const reminder = this.get(id);
    if (!reminder) return false;

    const clampedMinutes = clampSnoozeDuration(minutes, reminder.priority);
    const snoozeUntil = new Date(Date.now() + clampedMinutes * 60 * 1000);

    const result = this.db
      .prepare(
        `UPDATE reminders SET status = 'snoozed', snooze_until = ?
         WHERE id = ? AND agent_id = ?`,
      )
      .run(snoozeUntil.getTime(), id, this.agentId);

    return result.changes > 0;
  }

  /**
   * Delete a reminder
   */
  delete(id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM reminders WHERE id = ? AND agent_id = ?`)
      .run(id, this.agentId);
    return result.changes > 0;
  }

  /**
   * Get reminder statistics
   */
  getStats(): Record<string, number> {
    return getReminderStats(this.db, this.agentId);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * Create a reminder store for an agent
 */
export function createReminderStore(agentId?: string, cfg?: GimliConfig): ReminderStore {
  const config = cfg ?? loadConfig();
  const resolvedAgentId = agentId ?? resolveDefaultAgentId(config);
  const dbPath = resolveRemindersDbPath(config, resolvedAgentId);
  const db = openRemindersDb(dbPath);
  return new ReminderStore(db, resolvedAgentId);
}

/**
 * Parse a time string into a Date
 *
 * Supports formats:
 * - ISO 8601: "2026-01-20T14:00:00"
 * - Natural: "9:00 AM", "2:30 PM"
 * - Relative: "tomorrow 9am", "next Monday"
 */
export function parseTimeString(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try ISO format first
  const isoDate = new Date(trimmed);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Try HH:MM AM/PM format
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (timeMatch) {
    let hours = Number.parseInt(timeMatch[1], 10);
    const minutes = Number.parseInt(timeMatch[2], 10);
    const meridiem = timeMatch[3]?.toUpperCase();

    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;

    const date = new Date();
    date.setHours(hours, minutes, 0, 0);

    // If the time is in the past today, schedule for tomorrow
    if (date.getTime() <= Date.now()) {
      date.setDate(date.getDate() + 1);
    }

    return date;
  }

  return null;
}

/**
 * Parse a priority string
 */
export function parsePriority(input: string): ReminderPriority | null {
  const normalized = input.trim().toLowerCase();
  if (normalized === "urgent" || normalized === "high") return "urgent";
  if (normalized === "normal" || normalized === "medium") return "normal";
  if (normalized === "low") return "low";
  return null;
}

/**
 * Parse a status string
 */
export function parseStatus(input: string): ReminderStatus | null {
  const normalized = input.trim().toLowerCase();
  const validStatuses: ReminderStatus[] = [
    "pending",
    "triggered",
    "completed",
    "dismissed",
    "snoozed",
  ];
  if (validStatuses.includes(normalized as ReminderStatus)) {
    return normalized as ReminderStatus;
  }
  return null;
}
