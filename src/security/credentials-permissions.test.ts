import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { GimliConfig } from "../config/config.js";
import { runSecurityAudit } from "./audit.js";

const isWindows = process.platform === "win32";

describe("credentials directory permissions security", () => {
  let tmpDir: string;
  let prevStateDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-creds-perms-"));
    prevStateDir = process.env.GIMLI_STATE_DIR;
    process.env.GIMLI_STATE_DIR = tmpDir;
  });

  afterEach(async () => {
    if (prevStateDir === undefined) {
      delete process.env.GIMLI_STATE_DIR;
    } else {
      process.env.GIMLI_STATE_DIR = prevStateDir;
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("flags credentials directory when world-writable", async () => {
    if (isWindows) return; // chmod semantics differ on Windows

    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true, mode: 0o777 }); // world-writable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_writable",
          severity: "critical",
        }),
      ]),
    );
  });

  it("flags credentials directory when group-writable", async () => {
    if (isWindows) return;

    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true, mode: 0o770 }); // group-writable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_writable",
          severity: "critical",
        }),
      ]),
    );
  });

  it("warns when credentials directory is world-readable", async () => {
    if (isWindows) return;

    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true, mode: 0o744 }); // world-readable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_readable",
          severity: "warn",
        }),
      ]),
    );
  });

  it("warns when credentials directory is group-readable", async () => {
    if (isWindows) return;

    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true, mode: 0o740 }); // group-readable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_readable",
          severity: "warn",
        }),
      ]),
    );
  });

  it("does not flag credentials directory with secure permissions (700)", async () => {
    if (isWindows) return;

    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true, mode: 0o700 }); // secure permissions

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    // Should NOT contain credentials_dir permission findings
    const credsDirFindings = res.findings.filter((f) =>
      f.checkId.startsWith("fs.credentials_dir.perms"),
    );
    expect(credsDirFindings).toEqual([]);
  });

  it("flags auth-profiles.json when world-writable", async () => {
    if (isWindows) return;

    const agentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

    const authPath = path.join(agentDir, "auth-profiles.json");
    await fs.writeFile(authPath, "{}", "utf-8");
    await fs.chmod(authPath, 0o666); // world-writable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.auth_profiles.perms_writable",
          severity: "critical",
        }),
      ]),
    );
  });

  it("warns when auth-profiles.json is world-readable", async () => {
    if (isWindows) return;

    const agentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

    const authPath = path.join(agentDir, "auth-profiles.json");
    await fs.writeFile(authPath, "{}", "utf-8");
    await fs.chmod(authPath, 0o644); // world-readable

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.auth_profiles.perms_readable",
          severity: "warn",
        }),
      ]),
    );
  });

  it("does not flag auth-profiles.json with secure permissions (600)", async () => {
    if (isWindows) return;

    const agentDir = path.join(tmpDir, "agents", "main", "agent");
    await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });

    const authPath = path.join(agentDir, "auth-profiles.json");
    await fs.writeFile(authPath, "{}", "utf-8");
    await fs.chmod(authPath, 0o600); // secure permissions

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
    });

    // Should NOT contain auth_profiles permission findings
    const authProfilesFindings = res.findings.filter((f) =>
      f.checkId.startsWith("fs.auth_profiles.perms"),
    );
    expect(authProfilesFindings).toEqual([]);
  });
});

describe("credentials directory permissions - Windows ACL", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-creds-perms-win-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it("treats Windows ACL-only perms as secure for credentials dir", async () => {
    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true });

    const user = "DESKTOP-TEST\\Tester";
    const execIcacls = async (_cmd: string, args: string[]) => ({
      stdout: `${args[0]} NT AUTHORITY\\SYSTEM:(F)\n ${user}:(F)\n`,
      stderr: "",
    });

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
      platform: "win32",
      env: { ...process.env, USERNAME: "Tester", USERDOMAIN: "DESKTOP-TEST" },
      execIcacls,
    });

    // Should NOT contain credentials_dir permission findings
    const credsDirFindings = res.findings.filter((f) =>
      f.checkId.startsWith("fs.credentials_dir.perms"),
    );
    expect(credsDirFindings).toEqual([]);
  });

  it("flags Windows ACLs when BUILTIN\\Users can read credentials dir", async () => {
    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true });

    const user = "DESKTOP-TEST\\Tester";
    const execIcacls = async (_cmd: string, args: string[]) => {
      const target = args[0];
      if (target === credsDir) {
        return {
          stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Users:(RX)\n ${user}:(F)\n`,
          stderr: "",
        };
      }
      return {
        stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n ${user}:(F)\n`,
        stderr: "",
      };
    };

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
      platform: "win32",
      env: { ...process.env, USERNAME: "Tester", USERDOMAIN: "DESKTOP-TEST" },
      execIcacls,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_readable",
          severity: "warn",
        }),
      ]),
    );
  });

  it("flags Windows ACLs when BUILTIN\\Users can write to credentials dir", async () => {
    const credsDir = path.join(tmpDir, "credentials");
    await fs.mkdir(credsDir, { recursive: true });

    const user = "DESKTOP-TEST\\Tester";
    const execIcacls = async (_cmd: string, args: string[]) => {
      const target = args[0];
      if (target === credsDir) {
        return {
          stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n BUILTIN\\Users:(W)\n ${user}:(F)\n`,
          stderr: "",
        };
      }
      return {
        stdout: `${target} NT AUTHORITY\\SYSTEM:(F)\n ${user}:(F)\n`,
        stderr: "",
      };
    };

    const cfg: GimliConfig = {};
    const res = await runSecurityAudit({
      config: cfg,
      stateDir: tmpDir,
      configPath: path.join(tmpDir, "gimli.json"),
      includeFilesystem: true,
      includeChannelSecurity: false,
      platform: "win32",
      env: { ...process.env, USERNAME: "Tester", USERDOMAIN: "DESKTOP-TEST" },
      execIcacls,
    });

    expect(res.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: "fs.credentials_dir.perms_writable",
          severity: "critical",
        }),
      ]),
    );
  });
});
