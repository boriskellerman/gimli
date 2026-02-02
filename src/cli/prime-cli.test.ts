import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock gateway RPC for logs tests
const callGatewayFromCli = vi.fn();

vi.mock("./gateway-rpc.js", async () => {
  const actual = await vi.importActual<typeof import("./gateway-rpc.js")>("./gateway-rpc.js");
  return {
    ...actual,
    callGatewayFromCli: (...args: unknown[]) => callGatewayFromCli(...args),
  };
});

describe("prime cli", () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Reset modules before each test to ensure fresh module state
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "prime-cli-test-"));
    originalEnv = { ...process.env };
    process.env.GIMLI_STATE_DIR = tmpDir;
    // Create agent sessions directory
    const sessionsDir = path.join(tmpDir, "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    // Reset mock before each test
    callGatewayFromCli.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
    callGatewayFromCli.mockReset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("prime db", () => {
    it("lists session keys with --keys", async () => {
      const storePath = path.join(tmpDir, "agents", "main", "sessions", "sessions.json");
      fs.writeFileSync(
        storePath,
        JSON.stringify({
          "user:123": { sessionId: "abc", updatedAt: Date.now() },
          "user:456": { sessionId: "def", updatedAt: Date.now() },
        }),
      );

      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        stdoutWrites.push(String(chunk));
        return true;
      });
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "db", "--keys"], { from: "user" });

      stdoutSpy.mockRestore();
      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      expect(output).toContain("user:123");
      expect(output).toContain("user:456");
      expect(output).toContain("2 session(s)");
    });

    it("gets a specific session by key", async () => {
      const storePath = path.join(tmpDir, "agents", "main", "sessions", "sessions.json");
      const now = Date.now();
      fs.writeFileSync(
        storePath,
        JSON.stringify({
          "user:123": {
            sessionId: "abc-session-id",
            updatedAt: now,
            channel: "telegram",
            thinkingLevel: "high",
          },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "db", "--key", "user:123"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      expect(output).toContain("Session: user:123");
      expect(output).toContain("ID: abc-session-id");
      expect(output).toContain("Channel: telegram");
      expect(output).toContain("Thinking: high");
    });

    it("outputs JSON with --json flag", async () => {
      const storePath = path.join(tmpDir, "agents", "main", "sessions", "sessions.json");
      fs.writeFileSync(
        storePath,
        JSON.stringify({
          "user:123": { sessionId: "abc", updatedAt: 1700000000000 },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "db", "--key", "user:123", "--json"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.key).toBe("user:123");
      expect(parsed.sessionId).toBe("abc");
    });

    it("filters sessions by pattern", async () => {
      const storePath = path.join(tmpDir, "agents", "main", "sessions", "sessions.json");
      fs.writeFileSync(
        storePath,
        JSON.stringify({
          "hook:webhook1": { sessionId: "h1", updatedAt: Date.now() },
          "hook:webhook2": { sessionId: "h2", updatedAt: Date.now() },
          "user:123": { sessionId: "u1", updatedAt: Date.now() },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "db", "--keys", "--filter", "hook:"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      expect(output).toContain("hook:webhook1");
      expect(output).toContain("hook:webhook2");
      expect(output).not.toContain("user:123");
      expect(output).toContain('2 session(s) matching "hook:"');
    });
  });

  describe("prime config", () => {
    it("shows full config", async () => {
      const configPath = path.join(tmpDir, "gimli.json");
      // Use valid config schema (gateway.port is valid)
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          gateway: { port: 18789 },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "config"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      // Config loader applies defaults, so we just check it outputs valid JSON
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it("gets a specific config path", async () => {
      const configPath = path.join(tmpDir, "gimli.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          gateway: { port: 12345 },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "config", "--get", "gateway.port"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n").trim();
      expect(output).toBe("12345");
    });

    it("shows config snapshot with --snapshot", async () => {
      const configPath = path.join(tmpDir, "gimli.json");
      // Use valid config schema (gateway.port is valid)
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          gateway: { port: 18789 },
        }),
      );

      const stdoutWrites: string[] = [];
      const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        stdoutWrites.push(args.map(String).join(" "));
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "config", "--snapshot"], { from: "user" });

      logSpy.mockRestore();

      const output = stdoutWrites.join("\n");
      expect(output).toContain("Config path:");
      expect(output).toContain("Exists: true");
      expect(output).toContain("Valid: true");
      expect(output).toContain("Hash:");
    });
  });

  describe("prime logs", () => {
    it("fetches and displays logs", async () => {
      // Use simple raw log line that will be displayed as-is
      callGatewayFromCli.mockResolvedValueOnce({
        file: "/tmp/gimli.log",
        cursor: 100,
        size: 1000,
        lines: ["raw test log line"],
      });

      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        stdoutWrites.push(String(chunk));
        return true;
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "logs"], { from: "user" });

      stdoutSpy.mockRestore();

      const output = stdoutWrites.join("");
      expect(output).toContain("Log file:");
      expect(output).toContain("raw test log line");
    });

    it("filters logs by level", async () => {
      // Use the actual log format expected by parseLogLine
      // Level is in _meta.logLevelName, message is in numeric keys
      callGatewayFromCli.mockResolvedValueOnce({
        file: "/tmp/gimli.log",
        cursor: 100,
        lines: [
          '{"time":"2024-01-01T12:00:00Z","_meta":{"logLevelName":"DEBUG"},"0":"debug msg"}',
          '{"time":"2024-01-01T12:00:01Z","_meta":{"logLevelName":"INFO"},"0":"info msg"}',
          '{"time":"2024-01-01T12:00:02Z","_meta":{"logLevelName":"ERROR"},"0":"error msg"}',
        ],
      });

      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        stdoutWrites.push(String(chunk));
        return true;
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "logs", "--level", "error"], { from: "user" });

      stdoutSpy.mockRestore();

      const output = stdoutWrites.join("");
      expect(output).not.toContain("debug msg");
      expect(output).not.toContain("info msg");
      expect(output).toContain("error msg");
    });

    it("filters logs by grep pattern", async () => {
      // Use raw log lines for simple grep matching
      callGatewayFromCli.mockResolvedValueOnce({
        file: "/tmp/gimli.log",
        cursor: 100,
        lines: [
          "2024-01-01 telegram connected",
          "2024-01-01 discord connected",
          "2024-01-01 telegram message received",
        ],
      });

      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        stdoutWrites.push(String(chunk));
        return true;
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "logs", "--grep", "telegram"], { from: "user" });

      stdoutSpy.mockRestore();

      const output = stdoutWrites.join("");
      expect(output).toContain("telegram connected");
      expect(output).toContain("telegram message received");
      expect(output).not.toContain("discord connected");
    });

    it("outputs JSON with --json flag", async () => {
      // Use the actual log format expected by parseLogLine
      // Message is in numeric keys
      callGatewayFromCli.mockResolvedValueOnce({
        file: "/tmp/gimli.log",
        cursor: 100,
        size: 1000,
        lines: [
          '{"time":"2024-01-01T12:00:00Z","_meta":{"logLevelName":"INFO"},"0":"test log message"}',
        ],
      });

      const stdoutWrites: string[] = [];
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        stdoutWrites.push(String(chunk));
        return true;
      });

      const { registerPrimeCli } = await import("./prime-cli.js");
      const program = new Command();
      program.exitOverride();
      registerPrimeCli(program);

      await program.parseAsync(["prime", "logs", "--json"], { from: "user" });

      stdoutSpy.mockRestore();

      const output = stdoutWrites.join("");
      const lines = output.trim().split("\n").filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(2);

      // First line should be meta
      const meta = JSON.parse(lines[0]);
      expect(meta.type).toBe("meta");
      expect(meta.file).toBe("/tmp/gimli.log");

      // Second line should be the log entry
      const log = JSON.parse(lines[1]);
      expect(log.type).toBe("log");
      expect(log.message).toBe("test log message");
    });
  });
});
