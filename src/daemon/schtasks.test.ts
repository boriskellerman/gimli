import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSchtasksQuery, readScheduledTaskCommand, resolveTaskScriptPath } from "./schtasks.js";

describe("schtasks runtime parsing", () => {
  it("parses status and last run info", () => {
    const output = [
      "TaskName: \\Gimli Gateway",
      "Status: Ready",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Ready",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });

  it("parses running status", () => {
    const output = [
      "TaskName: \\Gimli Gateway",
      "Status: Running",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Running",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });
});

describe("resolveTaskScriptPath", () => {
  it("uses default path when GIMLI_PROFILE is default", () => {
    const env = { USERPROFILE: "C:\\Users\\test", GIMLI_PROFILE: "default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".gimli", "gateway.cmd"));
  });

  it("uses default path when GIMLI_PROFILE is unset", () => {
    const env = { USERPROFILE: "C:\\Users\\test" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".gimli", "gateway.cmd"));
  });

  it("uses profile-specific path when GIMLI_PROFILE is set to a custom value", () => {
    const env = { USERPROFILE: "C:\\Users\\test", GIMLI_PROFILE: "jbphoenix" };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".gimli-jbphoenix", "gateway.cmd"),
    );
  });

  it("prefers GIMLI_STATE_DIR over profile-derived defaults", () => {
    const env = {
      USERPROFILE: "C:\\Users\\test",
      GIMLI_PROFILE: "rescue",
      GIMLI_STATE_DIR: "C:\\State\\gimli",
    };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\State\\gimli", "gateway.cmd"));
  });

  it("handles case-insensitive 'Default' profile", () => {
    const env = { USERPROFILE: "C:\\Users\\test", GIMLI_PROFILE: "Default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".gimli", "gateway.cmd"));
  });

  it("handles case-insensitive 'DEFAULT' profile", () => {
    const env = { USERPROFILE: "C:\\Users\\test", GIMLI_PROFILE: "DEFAULT" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".gimli", "gateway.cmd"));
  });

  it("trims whitespace from GIMLI_PROFILE", () => {
    const env = { USERPROFILE: "C:\\Users\\test", GIMLI_PROFILE: "  myprofile  " };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".gimli-myprofile", "gateway.cmd"),
    );
  });

  it("falls back to HOME when USERPROFILE is not set", () => {
    const env = { HOME: "/home/test", GIMLI_PROFILE: "default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("/home/test", ".gimli", "gateway.cmd"));
  });
});

describe("readScheduledTaskCommand", () => {
  it("parses basic command script", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "node gateway.js --port 18789"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js", "--port", "18789"],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with working directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "cd /d C:\\Projects\\gimli", "node gateway.js"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js"],
        workingDirectory: "C:\\Projects\\gimli",
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with environment variables", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "set NODE_ENV=production", "set PORT=18789", "node gateway.js"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js"],
        environment: {
          NODE_ENV: "production",
          PORT: "18789",
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with quoted arguments containing spaces", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      // Use forward slashes which work in Windows cmd and avoid escape parsing issues
      await fs.writeFile(
        scriptPath,
        ["@echo off", '"C:/Program Files/Node/node.exe" gateway.js'].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["C:/Program Files/Node/node.exe", "gateway.js"],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when script does not exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when script has no command", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "rem This is just a comment"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses full script with all components", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".gimli", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        [
          "@echo off",
          "rem Gimli Gateway",
          "cd /d C:\\Projects\\gimli",
          "set NODE_ENV=production",
          "set GIMLI_PORT=18789",
          "node gateway.js --verbose",
        ].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, GIMLI_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js", "--verbose"],
        workingDirectory: "C:\\Projects\\gimli",
        environment: {
          NODE_ENV: "production",
          GIMLI_PORT: "18789",
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
