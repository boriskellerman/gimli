import { describe, expect, it } from "vitest";

import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "gimli", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "gimli", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "gimli", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "gimli", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "gimli", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "gimli", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "gimli", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "gimli"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "gimli", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "gimli", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "gimli", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "gimli", "status", "--timeout=2500"], "--timeout")).toBe("2500");
    expect(getFlagValue(["node", "gimli", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "gimli", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "gimli", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "gimli", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "gimli", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "gimli", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "gimli", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "gimli", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "gimli", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "gimli", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node", "gimli", "status"],
    });
    expect(nodeArgv).toEqual(["node", "gimli", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node-22", "gimli", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "gimli", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node-22.2.0.exe", "gimli", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "gimli", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node-22.2", "gimli", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "gimli", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node-22.2.exe", "gimli", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "gimli", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["/usr/bin/node-22.2.0", "gimli", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "gimli", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["nodejs", "gimli", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "gimli", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["node-dev", "gimli", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "gimli", "node-dev", "gimli", "status"]);

    const directArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["gimli", "status"],
    });
    expect(directArgv).toEqual(["node", "gimli", "status"]);

    const bunArgv = buildParseArgv({
      programName: "gimli",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "gimli",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "gimli", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "gimli", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "gimli", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "gimli", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "gimli", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "gimli", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "gimli", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "gimli", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
