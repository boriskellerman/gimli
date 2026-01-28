import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AuditLogger } from "./audit-logger.js";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AuditLogger", () => {
  let tempDir: string;
  let logger: AuditLogger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gimli-audit-test-"));
    logger = new AuditLogger({ logDir: tempDir });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
  });

  it("writes structured JSON log entries", () => {
    logger.log({
      event: "auth.login",
      severity: "info",
      message: "User logged in",
      source: "127.0.0.1",
      userId: "user123",
    });

    const logFile = join(tempDir, "audit.log");
    expect(existsSync(logFile)).toBe(true);

    const content = readFileSync(logFile, "utf8");
    const entry = JSON.parse(content.trim());

    expect(entry.event).toBe("auth.login");
    expect(entry.severity).toBe("info");
    expect(entry.message).toBe("User logged in");
    expect(entry.source).toBe("127.0.0.1");
    expect(entry.userId).toBe("user123");
    expect(entry.timestamp).toBeDefined();
  });

  it("scrubs sensitive data from log entries", () => {
    logger.log({
      event: "config.secret_accessed",
      severity: "info",
      message: "Secret accessed",
      data: {
        keyName: "api-key",
        apiKey: "sk-1234567890abcdef",
        password: "super-secret",
        normalField: "not-sensitive",
      },
    });

    const content = readFileSync(join(tempDir, "audit.log"), "utf8");
    const entry = JSON.parse(content.trim());

    // Sensitive fields should be redacted
    expect(entry.data.apiKey).toContain("[REDACTED]");
    expect(entry.data.password).toContain("[REDACTED]");
    // Non-sensitive fields should be preserved
    expect(entry.data.normalField).toBe("not-sensitive");
    // "keyName" contains "key" so it gets scrubbed — this is correct defensive behavior
    expect(entry.data.keyName).toContain("[REDACTED]");
  });

  it("writes multiple log entries", () => {
    logger.logAuth("login", "User A logged in");
    logger.logAuth("login", "User B logged in");
    logger.logAuth("failed", "User C failed auth");

    const content = readFileSync(join(tempDir, "audit.log"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);

    const entries = lines.map((line) => JSON.parse(line));
    expect(entries[0].event).toBe("auth.login");
    expect(entries[2].event).toBe("auth.failed");
    expect(entries[2].severity).toBe("warn"); // failed auth is warning
  });

  it("does not write when disabled", () => {
    const disabledLogger = new AuditLogger({ logDir: tempDir, enabled: false });
    disabledLogger.log({
      event: "auth.login",
      severity: "info",
      message: "Should not be logged",
    });

    const logFile = join(tempDir, "audit.log");
    expect(existsSync(logFile)).toBe(false);
  });

  it("convenience methods set correct event types", () => {
    logger.logExec("denied", "Command blocked");
    logger.logSecurity("injection_detected", "Prompt injection found");
    logger.logRateLimited("192.168.1.1");

    const content = readFileSync(join(tempDir, "audit.log"), "utf8");
    const lines = content
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines[0].event).toBe("exec.denied");
    expect(lines[1].event).toBe("security.injection_detected");
    expect(lines[1].severity).toBe("critical");
    expect(lines[2].event).toBe("gateway.rate_limited");
  });
});
