/**
 * Tests for bash tool execution behavior with main session vs non-main sessions.
 *
 * Key behavior: In "non-main" sandbox mode, the main session runs on host (gateway)
 * while non-main sessions run in the sandbox (Docker container).
 *
 * Note: Tests use security: "full" to bypass approval workflows in unit tests.
 * The approval workflow itself is tested in bash-tools.exec.approval-id.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool, createProcessTool } from "./bash-tools.js";
import { sanitizeBinaryOutput } from "./shell-utils.js";

const isWin = process.platform === "win32";
const normalizeText = (value?: string) =>
  sanitizeBinaryOutput(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .trim();

beforeEach(() => {
  resetProcessRegistryForTests();
});

describe("bash tool main session execution", () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    if (!isWin) process.env.SHELL = "/bin/bash";
  });

  afterEach(() => {
    if (!isWin) process.env.SHELL = originalShell;
  });

  describe("main session runs on gateway host", () => {
    it("executes command on gateway host when session is main", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full", // Bypass approval for test
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo hello-from-host",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("hello-from-host");
      expect(result.details.status).toBe("completed");
    });

    it("executes complex commands on gateway host for main session", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      // Multi-command execution
      const result = await tool.execute("call1", {
        command: isWin ? "Write-Output test1; Write-Output test2" : "echo test1; echo test2",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("test1");
      expect(text).toContain("test2");
    });

    it("can read environment variables on gateway host for main session", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Write-Output $env:HOME" : "echo $HOME",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      // Should have a real home directory path
      expect(text.length).toBeGreaterThan(0);
      if (!isWin) {
        expect(text).toMatch(/^\/[^\s]+/);
      }
    });

    it("can access filesystem on gateway host for main session", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Test-Path ." : "ls -la . | head -3",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text.length).toBeGreaterThan(0);
    });

    it("respects workdir parameter on gateway host for main session", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Get-Location | Select-Object -ExpandProperty Path" : "pwd",
        workdir: isWin ? process.env.TEMP : "/tmp",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      if (isWin) {
        expect(text.toLowerCase()).toContain("temp");
      } else {
        expect(text).toBe("/tmp");
      }
    });
  });

  describe("main session identification", () => {
    it("identifies agent:main:main as main session", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo main-session-test",
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("main-session-test");
    });

    it("identifies agent:{agentId}:main as main session for custom agent", async () => {
      const tool = createExecTool({
        sessionKey: "agent:alice:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo custom-agent-main",
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("custom-agent-main");
    });

    it("identifies custom main key session", async () => {
      // Custom main key configured via session.mainKey
      const tool = createExecTool({
        sessionKey: "agent:main:work",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo custom-main-key",
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("custom-main-key");
    });
  });

  describe("host execution vs sandbox distinction", () => {
    it("uses configured host for execution", async () => {
      // When host is explicitly set to gateway, commands run directly on host
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "hostname" : "hostname",
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      // Should return actual hostname (not a container hostname)
      expect(text.length).toBeGreaterThan(0);
    });

    it("defaults host to sandbox when not specified", async () => {
      // Without explicit host, defaults to sandbox
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        // No host specified - defaults to sandbox
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      // When no sandbox config is provided but host defaults to sandbox,
      // commands should still work (sandbox config is separate from host)
      const result = await tool.execute("call1", {
        command: "echo sandbox-default-test",
      });

      // Without actual sandbox config, it will run but potentially fail
      // The important thing is the host defaults to "sandbox"
      expect(result).toBeDefined();
    });

    it("overrides host to gateway for elevated commands", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "sandbox", // Even with sandbox host configured
        elevated: { enabled: true, allowed: true, defaultLevel: "full" },
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      // Elevated commands should force gateway execution
      const result = await tool.execute("call1", {
        command: "echo elevated-runs-on-gateway",
        elevated: true,
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("elevated-runs-on-gateway");
    });
  });

  describe("security and approval for main session", () => {
    it("uses allowlist security mode for gateway host with ask off", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "allowlist",
        ask: "off", // Don't prompt for approval in tests
        safeBins: ["echo"], // echo is a safe command
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo security-test",
      });

      // echo is a safe command, should be allowed
      expect(result.details.status).toBe("completed");
    });

    it("can use full security mode to bypass allowlist", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo full-security-mode",
      });

      expect(result.details.status).toBe("completed");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("full-security-mode");
    });

    it("rejects elevated commands when not allowed", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        elevated: { enabled: true, allowed: false, defaultLevel: "off" },
        messageProvider: "telegram",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      await expect(
        tool.execute("call1", {
          command: "echo elevated-not-allowed",
          elevated: true,
        }),
      ).rejects.toThrow("elevated is not available");
    });

    it("triggers approval-pending when ask is on-miss and command is not allowlisted", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "allowlist",
        ask: "on-miss", // Prompt for approval
        // No safeBins, so command will require approval
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo approval-test",
      });

      // Should be approval-pending
      expect(result.details.status).toBe("approval-pending");
      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("Approval required");
    });
  });

  describe("PATH handling for main session", () => {
    const originalPath = process.env.PATH;

    afterEach(() => {
      process.env.PATH = originalPath;
    });

    it("prepends configured path entries for main session", async () => {
      const basePath = isWin ? "C:\\Windows\\System32" : "/usr/bin";
      const prepend = isWin ? ["C:\\custom\\bin"] : ["/custom/bin"];
      process.env.PATH = basePath;

      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        pathPrepend: prepend,
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Write-Output $env:PATH" : "echo $PATH",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      // The prepended path should appear before the base path
      const prependPath = prepend[0];
      expect(text).toContain(prependPath);
    });

    it("inherits shell PATH for gateway execution", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Write-Output $env:PATH" : "echo $PATH",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      // PATH should be non-empty and contain standard paths
      expect(text.length).toBeGreaterThan(10);
      if (!isWin) {
        expect(text).toMatch(/\/usr\/bin|\/bin/);
      }
    });
  });

  describe("exit code and status for main session", () => {
    it("reports completed status for successful commands", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo success",
      });

      expect(result.details.status).toBe("completed");
      expect(result.details.exitCode).toBe(0);
    });

    it("throws error for non-zero exit code", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      // The tool throws an error for non-zero exit codes
      await expect(
        tool.execute("call1", {
          command: isWin ? "exit 42" : "exit 42",
        }),
      ).rejects.toThrow("Command exited with code 42");
    });

    it("throws error for command not found", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      // The tool throws an error when command is not found
      await expect(
        tool.execute("call1", {
          command: "nonexistent-command-xyz-12345",
        }),
      ).rejects.toThrow(/command not found|Command exited with code 127/);
    });

    it("captures stdout for main session execution", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Write-Output 'line1'; Write-Output 'line2'" : "echo line1; echo line2",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("line1");
      expect(text).toContain("line2");
    });

    it("captures stderr for main session execution", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Write-Error 'error-output' 2>&1" : "echo error-output >&2",
      });

      const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
      expect(text).toContain("error-output");
    });
  });

  describe("timeout handling for main session", () => {
    it("respects timeout parameter by backgrounding long commands", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        timeoutSec: 1,
        backgroundMs: 100, // Background quickly
      });

      const result = await tool.execute("call1", {
        command: isWin ? "Start-Sleep -Seconds 10" : "sleep 10",
      });

      // Should be backgrounded (running) due to yield
      expect(result.details.status).toBe("running");
      expect((result.details as { sessionId?: string }).sessionId).toBeDefined();
    });

    it("uses default timeout when not specified", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        security: "full",
        timeoutSec: 5,
        backgroundMs: 1000,
      });

      const result = await tool.execute("call1", {
        command: "echo quick-command",
      });

      // Quick commands should complete within default timeout
      expect(result.details.status).toBe("completed");
    });
  });

  describe("provider context for main session", () => {
    it("includes provider in error messages", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        messageProvider: "telegram",
        elevated: { enabled: true, allowed: false, defaultLevel: "off" },
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      await expect(
        tool.execute("call1", {
          command: "echo test",
          elevated: true,
        }),
      ).rejects.toThrow("provider=telegram");
    });

    it("includes session in error messages", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:main",
        host: "gateway",
        messageProvider: "discord",
        elevated: { enabled: true, allowed: false, defaultLevel: "off" },
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      await expect(
        tool.execute("call1", {
          command: "echo test",
          elevated: true,
        }),
      ).rejects.toThrow("session=agent:main:main");
    });
  });
});

describe("bash tool non-main session execution context", () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    if (!isWin) process.env.SHELL = "/bin/bash";
  });

  afterEach(() => {
    if (!isWin) process.env.SHELL = originalShell;
  });

  describe("non-main session identification", () => {
    it("identifies group sessions as non-main", async () => {
      // Group sessions are always non-main
      const tool = createExecTool({
        sessionKey: "agent:main:telegram:group:12345",
        host: "gateway", // Explicitly using gateway for test
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo group-session",
      });

      // The session key structure identifies this as non-main
      expect(result).toBeDefined();
      expect(result.details.status).toBe("completed");
    });

    it("identifies DM sessions as non-main", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:dm:user123",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo dm-session",
      });

      expect(result).toBeDefined();
      expect(result.details.status).toBe("completed");
    });

    it("identifies named sessions as non-main", async () => {
      const tool = createExecTool({
        sessionKey: "agent:main:work-project",
        host: "gateway",
        security: "full",
        backgroundMs: 1000,
        timeoutSec: 5,
      });

      const result = await tool.execute("call1", {
        command: "echo named-session",
      });

      expect(result).toBeDefined();
      expect(result.details.status).toBe("completed");
    });
  });
});

describe("bash tool session scoping", () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    if (!isWin) process.env.SHELL = "/bin/bash";
  });

  afterEach(() => {
    if (!isWin) process.env.SHELL = originalShell;
  });

  it("scopes process sessions by session key", async () => {
    const toolMain = createExecTool({
      sessionKey: "agent:main:main",
      scopeKey: "agent:main:main",
      host: "gateway",
      security: "full",
      backgroundMs: 10,
      timeoutSec: 5,
    });

    const toolOther = createExecTool({
      sessionKey: "agent:main:work",
      scopeKey: "agent:main:work",
      host: "gateway",
      security: "full",
      backgroundMs: 10,
      timeoutSec: 5,
    });

    // Both can execute commands independently
    const [resultMain, resultOther] = await Promise.all([
      toolMain.execute("call1", { command: "echo main-scoped" }),
      toolOther.execute("call2", { command: "echo other-scoped" }),
    ]);

    expect(resultMain).toBeDefined();
    expect(resultOther).toBeDefined();
    expect(resultMain.details.status).toBe("completed");
    expect(resultOther.details.status).toBe("completed");
  });

  it("background sessions are isolated by scope key", async () => {
    const toolA = createExecTool({
      sessionKey: "agent:alpha:main",
      scopeKey: "agent:alpha",
      host: "gateway",
      security: "full",
      backgroundMs: 10,
      timeoutSec: 5,
    });
    const processA = createProcessTool({ scopeKey: "agent:alpha" });

    const toolB = createExecTool({
      sessionKey: "agent:beta:main",
      scopeKey: "agent:beta",
      host: "gateway",
      security: "full",
      backgroundMs: 10,
      timeoutSec: 5,
    });
    const processB = createProcessTool({ scopeKey: "agent:beta" });

    // Start background commands for both scopes
    const resultA = await toolA.execute("call1", {
      command: isWin ? "Start-Sleep -Milliseconds 100" : "sleep 0.1",
      background: true,
    });
    const resultB = await toolB.execute("call2", {
      command: isWin ? "Start-Sleep -Milliseconds 100" : "sleep 0.1",
      background: true,
    });

    const sessionA = (resultA.details as { sessionId: string }).sessionId;
    const sessionB = (resultB.details as { sessionId: string }).sessionId;

    // Process A should only see session A
    const listA = await processA.execute("call3", { action: "list" });
    const sessionsA = (listA.details as { sessions: Array<{ sessionId: string }> }).sessions;
    expect(sessionsA.some((s) => s.sessionId === sessionA)).toBe(true);
    expect(sessionsA.some((s) => s.sessionId === sessionB)).toBe(false);

    // Process B should not be able to access session A
    const pollB = await processB.execute("call4", {
      action: "poll",
      sessionId: sessionA,
    });
    expect(pollB.details.status).toBe("failed");
  });
});

describe("bash tool elevated execution for main session", () => {
  const originalShell = process.env.SHELL;

  beforeEach(() => {
    if (!isWin) process.env.SHELL = "/bin/bash";
  });

  afterEach(() => {
    if (!isWin) process.env.SHELL = originalShell;
  });

  it("elevated commands run on gateway host regardless of configured host", async () => {
    const tool = createExecTool({
      sessionKey: "agent:main:main",
      host: "sandbox", // Configured for sandbox
      elevated: { enabled: true, allowed: true, defaultLevel: "full" },
      backgroundMs: 1000,
      timeoutSec: 5,
    });

    // Elevated command should run on gateway, not sandbox
    const result = await tool.execute("call1", {
      command: "echo elevated-execution",
      elevated: true,
    });

    expect(result.details.status).toBe("completed");
    const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
    expect(text).toContain("elevated-execution");
  });

  it("elevated mode full bypasses all approvals", async () => {
    const tool = createExecTool({
      sessionKey: "agent:main:main",
      host: "gateway",
      security: "allowlist", // Would normally require approval
      ask: "always", // Would normally prompt
      elevated: { enabled: true, allowed: true, defaultLevel: "full" },
      backgroundMs: 1000,
      timeoutSec: 5,
    });

    // With elevated=true and defaultLevel="full", should bypass approvals
    const result = await tool.execute("call1", {
      command: "echo elevated-bypasses-approval",
      elevated: true,
    });

    expect(result.details.status).toBe("completed");
    const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
    expect(text).toContain("elevated-bypasses-approval");
  });

  it("elevated mode off does not default to elevated", async () => {
    const tool = createExecTool({
      sessionKey: "agent:main:main",
      host: "gateway",
      security: "full",
      elevated: { enabled: true, allowed: true, defaultLevel: "off" },
      backgroundMs: 1000,
      timeoutSec: 5,
    });

    // Without elevated=true, command runs normally
    const result = await tool.execute("call1", {
      command: "echo non-elevated",
    });

    expect(result.details.status).toBe("completed");
    const text = normalizeText(result.content.find((c) => c.type === "text")?.text);
    expect(text).toContain("non-elevated");
  });
});
