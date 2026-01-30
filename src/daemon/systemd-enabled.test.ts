import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { isSystemdServiceEnabled } from "./systemd.js";

describe("isSystemdServiceEnabled", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  function mockSystemctlResponse(responses: Array<{ args?: string[]; code: number }>) {
    let callIndex = 0;
    execFileMock.mockImplementation((_cmd, args, _opts, cb) => {
      const response = responses[callIndex] ?? { code: 0 };
      callIndex++;
      if (response.code === 0) {
        cb(null, "", "");
      } else {
        const err = new Error("Command failed") as Error & { code?: number };
        err.code = response.code;
        cb(err, "", "");
      }
    });
  }

  it("returns true when service is enabled", async () => {
    // First call: systemctl --user status (availability check)
    // Second call: systemctl --user is-enabled
    mockSystemctlResponse([{ code: 0 }, { code: 0 }]);
    const result = await isSystemdServiceEnabled({ env: { HOME: "/home/test" } });
    expect(result).toBe(true);
  });

  it("returns false when service is disabled", async () => {
    // First call: systemctl --user status (availability check)
    // Second call: systemctl --user is-enabled (returns 1 for disabled)
    mockSystemctlResponse([{ code: 0 }, { code: 1 }]);
    const result = await isSystemdServiceEnabled({ env: { HOME: "/home/test" } });
    expect(result).toBe(false);
  });

  it("uses correct service name from GIMLI_PROFILE", async () => {
    mockSystemctlResponse([{ code: 0 }, { code: 0 }]);
    await isSystemdServiceEnabled({
      env: { HOME: "/home/test", GIMLI_PROFILE: "production" },
    });
    // Verify the is-enabled call used profile-specific service name
    expect(execFileMock).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "is-enabled", "gimli-gateway-production.service"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("uses default service name when GIMLI_PROFILE is default", async () => {
    mockSystemctlResponse([{ code: 0 }, { code: 0 }]);
    await isSystemdServiceEnabled({
      env: { HOME: "/home/test", GIMLI_PROFILE: "default" },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "is-enabled", "gimli-gateway.service"],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("uses GIMLI_SYSTEMD_UNIT when provided", async () => {
    mockSystemctlResponse([{ code: 0 }, { code: 0 }]);
    await isSystemdServiceEnabled({
      env: { HOME: "/home/test", GIMLI_SYSTEMD_UNIT: "custom-gateway" },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "systemctl",
      ["--user", "is-enabled", "custom-gateway.service"],
      expect.anything(),
      expect.any(Function),
    );
  });
});
