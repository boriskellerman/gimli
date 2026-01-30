import { beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(__dirname, "../../scripts/setup-linux.sh");

/**
 * Tests for the Linux setup script (scripts/setup-linux.sh)
 *
 * These tests verify:
 * - Script structure and syntax validity
 * - Help output and argument parsing
 * - Dry-run mode behavior
 * - Node.js version detection logic
 */
describe("setup-linux.sh", () => {
  beforeEach(() => {
    // Ensure script exists and is executable
    expect(existsSync(SCRIPT_PATH)).toBe(true);
  });

  describe("script structure", () => {
    it("script file exists and is readable", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toBeTruthy();
      expect(content.length).toBeGreaterThan(0);
    });

    it("has valid bash shebang", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
    });

    it("uses strict mode (set -euo pipefail)", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("set -euo pipefail");
    });

    it("passes bash syntax check", () => {
      const result = spawnSync("bash", ["-n", SCRIPT_PATH], {
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    });

    it("has required functions defined", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      const requiredFunctions = [
        "log_info",
        "log_success",
        "log_warn",
        "log_error",
        "print_usage",
        "parse_args",
        "check_platform",
        "check_node",
        "install_gimli",
        "run_onboard",
        "enable_linger",
        "run_doctor",
        "verify_security",
        "main",
      ];
      for (const fn of requiredFunctions) {
        expect(content).toContain(`${fn}()`);
      }
    });
  });

  describe("help output", () => {
    it("displays help with --help flag", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "--help"], {
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stdout).toContain("Gimli Linux Server Setup Script");
      expect(result.stdout).toContain("--skip-node-check");
      expect(result.stdout).toContain("--skip-onboard");
      expect(result.stdout).toContain("--dry-run");
      expect(result.stdout).toContain("--verbose");
    });

    it("displays help with -h flag", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "-h"], {
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage:");
    });

    it("documents environment variables", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "--help"], {
        encoding: "utf-8",
      });
      expect(result.stdout).toContain("GIMLI_SKIP_NODE_CHECK");
      expect(result.stdout).toContain("GIMLI_SKIP_ONBOARD");
      expect(result.stdout).toContain("GIMLI_DRY_RUN");
    });
  });

  describe("argument parsing", () => {
    it("rejects unknown options", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "--unknown-flag"], {
        encoding: "utf-8",
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr || result.stdout).toContain("Unknown option");
    });
  });

  describe("dry-run mode", () => {
    it("does not execute commands in dry-run mode", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "--dry-run", "--skip-node-check"], {
        encoding: "utf-8",
        env: { ...process.env, PATH: process.env.PATH },
      });
      // Should complete without actually installing anything
      expect(result.stdout).toContain("[DRY RUN]");
      expect(result.stdout).toContain("Would run:");
    });

    it("respects GIMLI_DRY_RUN environment variable", () => {
      const result = spawnSync("bash", [SCRIPT_PATH, "--skip-node-check"], {
        encoding: "utf-8",
        env: {
          ...process.env,
          GIMLI_DRY_RUN: "1",
          PATH: process.env.PATH,
        },
      });
      expect(result.stdout).toContain("[DRY RUN]");
    });
  });

  describe("platform detection", () => {
    it("script contains Linux platform check", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("uname -s");
      expect(content).toContain("Linux");
    });
  });

  describe("Node.js version checking", () => {
    it("script checks for Node.js 22+", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("REQUIRED_NODE_MAJOR=22");
    });

    it("script provides nvm installation instructions when Node is missing", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("nvm install");
      expect(content).toContain("nodesource");
    });

    it("extracts major version correctly", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      // Verify the version extraction logic is present
      expect(content).toContain("node --version");
      expect(content).toContain("cut -d. -f1");
    });
  });

  describe("security verification", () => {
    it("script checks credentials directory permissions", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain(".gimli/credentials");
      expect(content).toContain("700");
    });

    it("script checks gateway bind address", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("127.0.0.1");
      expect(content).toContain("loopback");
    });
  });

  describe("systemd integration", () => {
    it("script enables user linger", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("loginctl enable-linger");
    });

    it("script checks linger status", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("show-user");
      expect(content).toContain("Linger=");
    });
  });

  describe("installation", () => {
    it("script uses SHARP_IGNORE_GLOBAL_LIBVIPS", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("SHARP_IGNORE_GLOBAL_LIBVIPS=1");
    });

    it("script runs gimli onboard with daemon flag", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("gimli onboard --install-daemon");
    });

    it("script runs gimli doctor for verification", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("gimli doctor");
    });
  });

  describe("documentation output", () => {
    it("script prints next steps after completion", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("Next steps:");
      expect(content).toContain("gimli models auth");
      expect(content).toContain("gimli agent");
      expect(content).toContain("gimli status");
    });

    it("script includes documentation URL", () => {
      const content = readFileSync(SCRIPT_PATH, "utf-8");
      expect(content).toContain("https://docs.gimli.bot");
    });
  });
});
