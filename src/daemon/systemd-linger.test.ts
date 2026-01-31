import { beforeEach, describe, expect, it, vi } from "vitest";

const runExecMock = vi.hoisted(() => vi.fn());

vi.mock("../process/exec.js", () => ({
  runExec: runExecMock,
  runCommandWithTimeout: vi.fn(),
}));

import { readSystemdUserLingerStatus } from "./systemd-linger.js";

describe("systemd linger status", () => {
  beforeEach(() => {
    runExecMock.mockReset();
  });

  it("returns linger=yes when enabled", async () => {
    runExecMock.mockResolvedValue({ stdout: "Linger=yes\n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toEqual({ user: "testuser", linger: "yes" });
    expect(runExecMock).toHaveBeenCalledWith(
      "loginctl",
      ["show-user", "testuser", "-p", "Linger"],
      { timeoutMs: 5_000 },
    );
  });

  it("returns linger=no when disabled", async () => {
    runExecMock.mockResolvedValue({ stdout: "Linger=no\n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toEqual({ user: "testuser", linger: "no" });
  });

  it("returns null when user cannot be determined", async () => {
    const result = await readSystemdUserLingerStatus({});
    expect(result).toBeNull();
  });

  it("returns null when loginctl fails", async () => {
    runExecMock.mockRejectedValue(new Error("loginctl not found"));
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toBeNull();
  });

  it("returns null when linger status is unexpected value", async () => {
    runExecMock.mockResolvedValue({ stdout: "Linger=unknown\n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toBeNull();
  });

  it("uses LOGNAME when USER is not set", async () => {
    runExecMock.mockResolvedValue({ stdout: "Linger=yes\n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ LOGNAME: "loguser" });
    expect(result).toEqual({ user: "loguser", linger: "yes" });
    expect(runExecMock).toHaveBeenCalledWith("loginctl", ["show-user", "loguser", "-p", "Linger"], {
      timeoutMs: 5_000,
    });
  });

  it("handles whitespace in output", async () => {
    runExecMock.mockResolvedValue({ stdout: "  Linger=yes  \n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toEqual({ user: "testuser", linger: "yes" });
  });

  it("handles case-insensitive linger values", async () => {
    runExecMock.mockResolvedValue({ stdout: "Linger=YES\n", stderr: "" });
    const result = await readSystemdUserLingerStatus({ USER: "testuser" });
    expect(result).toEqual({ user: "testuser", linger: "yes" });
  });
});
