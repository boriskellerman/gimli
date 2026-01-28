/**
 * Structured audit logger for Gimli.
 *
 * Logs all security-relevant events in structured JSON format
 * with timestamps, source identification, and event categorization.
 * Supports log rotation and configurable retention.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export type AuditEventType =
  | "auth.login"
  | "auth.logout"
  | "auth.failed"
  | "auth.token_issued"
  | "exec.command"
  | "exec.denied"
  | "exec.sandbox"
  | "config.changed"
  | "config.secret_accessed"
  | "plugin.loaded"
  | "plugin.failed"
  | "gateway.connection"
  | "gateway.disconnection"
  | "gateway.rate_limited"
  | "security.injection_detected"
  | "security.audit_run"
  | "security.permission_change"
  | "channel.message_received"
  | "channel.message_sent"
  | "agent.tool_use"
  | "agent.error";

export interface AuditEvent {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event type category */
  event: AuditEventType;
  /** Severity level */
  severity: "info" | "warn" | "error" | "critical";
  /** Source IP address or identifier */
  source?: string;
  /** User or session identifier */
  userId?: string;
  /** Channel the event originated from */
  channel?: string;
  /** Human-readable description */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
}

export interface AuditLoggerConfig {
  /** Directory to store audit logs */
  logDir: string;
  /** Maximum log file size in bytes before rotation. Default: 10MB */
  maxFileSize: number;
  /** Maximum number of rotated log files to keep. Default: 10 */
  maxFiles: number;
  /** Whether audit logging is enabled. Default: true */
  enabled: boolean;
}

const DEFAULT_CONFIG: AuditLoggerConfig = {
  logDir: "",
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 10,
  enabled: true,
};

export class AuditLogger {
  private config: AuditLoggerConfig;
  private logFilePath: string;

  constructor(config: Partial<AuditLoggerConfig> & { logDir: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logFilePath = join(this.config.logDir, "audit.log");

    if (this.config.enabled) {
      if (!existsSync(this.config.logDir)) {
        mkdirSync(this.config.logDir, { recursive: true, mode: 0o700 });
      }
    }
  }

  /**
   * Log a security-relevant event.
   */
  log(event: Omit<AuditEvent, "timestamp">): void {
    if (!this.config.enabled) return;

    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };

    // Scrub sensitive data from the event
    const sanitized = this.scrubSensitiveData(entry);
    const line = JSON.stringify(sanitized) + "\n";

    try {
      this.rotateIfNeeded();
      appendFileSync(this.logFilePath, line, { mode: 0o600 });
    } catch {
      // Audit logging should never crash the application
      // Write to stderr as fallback
      process.stderr.write(`[AUDIT FALLBACK] ${line}`);
    }
  }

  /** Convenience: log an authentication event */
  logAuth(
    type: "login" | "logout" | "failed" | "token_issued",
    message: string,
    opts?: { source?: string; userId?: string; data?: Record<string, unknown> },
  ): void {
    this.log({
      event: `auth.${type}`,
      severity: type === "failed" ? "warn" : "info",
      message,
      ...opts,
    });
  }

  /** Convenience: log a command execution event */
  logExec(
    type: "command" | "denied" | "sandbox",
    message: string,
    opts?: { userId?: string; channel?: string; data?: Record<string, unknown> },
  ): void {
    this.log({
      event: `exec.${type}`,
      severity: type === "denied" ? "warn" : "info",
      message,
      ...opts,
    });
  }

  /** Convenience: log a security event */
  logSecurity(
    type: "injection_detected" | "audit_run" | "permission_change",
    message: string,
    opts?: { severity?: "info" | "warn" | "error" | "critical"; data?: Record<string, unknown> },
  ): void {
    this.log({
      event: `security.${type}`,
      severity: opts?.severity ?? (type === "injection_detected" ? "critical" : "info"),
      message,
      data: opts?.data,
    });
  }

  /** Convenience: log rate limiting */
  logRateLimited(source: string, data?: Record<string, unknown>): void {
    this.log({
      event: "gateway.rate_limited",
      severity: "warn",
      source,
      message: `Rate limit exceeded for ${source}`,
      data,
    });
  }

  /**
   * Scrub sensitive data (API keys, passwords, tokens) from log entries.
   */
  private scrubSensitiveData(event: AuditEvent): AuditEvent {
    if (!event.data) return event;

    const scrubbed = { ...event, data: { ...event.data } };
    const sensitiveKeys = [
      "password",
      "token",
      "secret",
      "key",
      "apiKey",
      "api_key",
      "authorization",
      "cookie",
      "session",
      "credential",
      "passphrase",
    ];

    for (const [key, value] of Object.entries(scrubbed.data)) {
      const keyLower = key.toLowerCase();
      if (sensitiveKeys.some((sk) => keyLower.includes(sk))) {
        scrubbed.data[key] =
          typeof value === "string" && value.length > 4
            ? `${value.slice(0, 2)}...[REDACTED]`
            : "[REDACTED]";
      }
    }

    return scrubbed;
  }

  /**
   * Rotate log files if the current one exceeds the max size.
   */
  private rotateIfNeeded(): void {
    if (!existsSync(this.logFilePath)) return;

    try {
      const stat = statSync(this.logFilePath);
      if (stat.size < this.config.maxFileSize) return;

      // Rotate: audit.log -> audit.log.1 -> audit.log.2 -> ...
      for (let i = this.config.maxFiles - 1; i >= 1; i--) {
        const src = i === 1 ? this.logFilePath : `${this.logFilePath}.${i - 1}`;
        const dst = `${this.logFilePath}.${i}`;
        if (existsSync(src)) {
          renameSync(src, dst);
        }
      }
    } catch {
      // Rotation failure is not critical — continue logging
    }
  }
}
