import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".gimli"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", GIMLI_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".gimli-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", GIMLI_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".gimli"));
  });

  it("uses GIMLI_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", GIMLI_STATE_DIR: "/var/lib/gimli" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/gimli"));
  });

  it("expands ~ in GIMLI_STATE_DIR", () => {
    const env = { HOME: "/Users/test", GIMLI_STATE_DIR: "~/gimli-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/gimli-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { GIMLI_STATE_DIR: "C:\\State\\gimli" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\gimli");
  });
});
