import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "gimli", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "gimli", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "gimli", "--dev", "gateway"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "gimli", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "gimli", "--profile", "work", "status"]);
    if (!res.ok) throw new Error(res.error);
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "gimli", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "gimli", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "gimli", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "gimli", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join("/home/peter", ".gimli-dev");
    expect(env.GIMLI_PROFILE).toBe("dev");
    expect(env.GIMLI_STATE_DIR).toBe(expectedStateDir);
    expect(env.GIMLI_CONFIG_PATH).toBe(path.join(expectedStateDir, "gimli.json"));
    expect(env.GIMLI_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      GIMLI_STATE_DIR: "/custom",
      GIMLI_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.GIMLI_STATE_DIR).toBe("/custom");
    expect(env.GIMLI_GATEWAY_PORT).toBe("19099");
    expect(env.GIMLI_CONFIG_PATH).toBe(path.join("/custom", "gimli.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("gimli doctor --fix", {})).toBe("gimli doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("gimli doctor --fix", { GIMLI_PROFILE: "default" })).toBe(
      "gimli doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("gimli doctor --fix", { GIMLI_PROFILE: "Default" })).toBe(
      "gimli doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("gimli doctor --fix", { GIMLI_PROFILE: "bad profile" })).toBe(
      "gimli doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("gimli --profile work doctor --fix", { GIMLI_PROFILE: "work" })).toBe(
      "gimli --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("gimli --dev doctor", { GIMLI_PROFILE: "dev" })).toBe(
      "gimli --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("gimli doctor --fix", { GIMLI_PROFILE: "work" })).toBe(
      "gimli --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("gimli doctor --fix", { GIMLI_PROFILE: "  jbgimli  " })).toBe(
      "gimli --profile jbgimli doctor --fix",
    );
  });

  it("handles command with no args after gimli", () => {
    expect(formatCliCommand("gimli", { GIMLI_PROFILE: "test" })).toBe("gimli --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm gimli doctor", { GIMLI_PROFILE: "work" })).toBe(
      "pnpm gimli --profile work doctor",
    );
  });
});
