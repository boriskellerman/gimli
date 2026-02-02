import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSkillSnapshot,
  filterWorkspaceSkillEntries,
  loadWorkspaceSkillEntries,
} from "./skills.js";
import { resolveBundledSkillsDir } from "./skills/bundled-dir.js";

/**
 * Tests for Gimli-specific operational skills:
 * - gateway-health: Gateway health monitoring
 * - channel-tester: Channel connection testing
 * - gimli-doctor: Diagnostic and repair operations
 * - channel-logs: Channel activity logging
 */
describe("gimli operations skills", () => {
  describe("bundled gimli-ops skills loading", () => {
    it("loads gateway-health skill from bundled directory", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gatewayHealth = entries.find((e) => e.skill.name === "gateway-health");
      expect(gatewayHealth).toBeDefined();
      expect(gatewayHealth?.skill.description).toContain("gateway");
      expect(gatewayHealth?.skill.source).toBe("gimli-bundled");
    });

    it("loads channel-tester skill from bundled directory", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const channelTester = entries.find((e) => e.skill.name === "channel-tester");
      expect(channelTester).toBeDefined();
      expect(channelTester?.skill.description).toContain("channel");
      expect(channelTester?.skill.source).toBe("gimli-bundled");
    });

    it("loads gimli-doctor skill from bundled directory", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gimliDoctor = entries.find((e) => e.skill.name === "gimli-doctor");
      expect(gimliDoctor).toBeDefined();
      expect(gimliDoctor?.skill.description).toContain("diagnostic");
      expect(gimliDoctor?.skill.source).toBe("gimli-bundled");
    });

    it("loads channel-logs skill from bundled directory", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const channelLogs = entries.find((e) => e.skill.name === "channel-logs");
      expect(channelLogs).toBeDefined();
      expect(channelLogs?.skill.description).toContain("channel");
      expect(channelLogs?.skill.source).toBe("gimli-bundled");
    });
  });

  describe("gimli-ops skill metadata", () => {
    it("gateway-health has correct emoji metadata", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gatewayHealth = entries.find((e) => e.skill.name === "gateway-health");
      expect(gatewayHealth?.metadata?.emoji).toBe("💓");
    });

    it("channel-tester has correct emoji metadata", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const channelTester = entries.find((e) => e.skill.name === "channel-tester");
      expect(channelTester?.metadata?.emoji).toBe("🔌");
    });

    it("gimli-doctor has correct emoji metadata", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gimliDoctor = entries.find((e) => e.skill.name === "gimli-doctor");
      expect(gimliDoctor?.metadata?.emoji).toBe("🩺");
    });

    it("channel-logs has correct emoji metadata", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const channelLogs = entries.find((e) => e.skill.name === "channel-logs");
      expect(channelLogs?.metadata?.emoji).toBe("📋");
    });
  });

  describe("gimli-ops skills eligibility", () => {
    it("gateway-health skill has no binary requirements", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gatewayHealth = entries.find((e) => e.skill.name === "gateway-health");
      // No bin requirements means it should always be eligible
      expect(gatewayHealth?.metadata?.requires?.bins).toBeUndefined();
    });

    it("all gimli-ops skills pass eligibility filtering", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gimliOpsSkills = ["gateway-health", "channel-tester", "gimli-doctor", "channel-logs"];
      const gimliOpsEntries = entries.filter((e) => gimliOpsSkills.includes(e.skill.name));

      // All should pass filtering since they have no strict requirements
      const filtered = filterWorkspaceSkillEntries(gimliOpsEntries);
      expect(filtered.length).toBe(gimliOpsSkills.length);
    });
  });

  describe("gimli-ops skills in snapshot", () => {
    it("includes gimli-ops skills in workspace snapshot prompt", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      // Check that gimli-ops skills appear in the prompt
      expect(snapshot.prompt).toContain("gateway-health");
      expect(snapshot.prompt).toContain("channel-tester");
      expect(snapshot.prompt).toContain("gimli-doctor");
      expect(snapshot.prompt).toContain("channel-logs");
    });

    it("gimli-ops skills are user-invocable by default", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const gimliOpsSkills = ["gateway-health", "channel-tester", "gimli-doctor", "channel-logs"];
      for (const skillName of gimliOpsSkills) {
        const skill = entries.find((e) => e.skill.name === skillName);
        // userInvocable defaults to true when not explicitly set to false
        expect(skill?.skill.userInvocable).not.toBe(false);
      }
    });
  });

  describe("skill content structure", () => {
    it("gateway-health skill has proper command documentation", async () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const skillPath = path.join(bundledDir, "gateway-health", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("gimli health");
      expect(content).toContain("--json");
      expect(content).toContain("--verbose");
    });

    it("channel-tester skill has proper command documentation", async () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const skillPath = path.join(bundledDir, "channel-tester", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("gimli channels status");
      expect(content).toContain("--probe");
      expect(content).toContain("Discord");
      expect(content).toContain("Telegram");
      expect(content).toContain("WhatsApp");
    });

    it("gimli-doctor skill has proper command documentation", async () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const skillPath = path.join(bundledDir, "gimli-doctor", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("gimli doctor");
      expect(content).toContain("--non-interactive");
      expect(content).toContain("--fix");
    });

    it("channel-logs skill has proper command documentation", async () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) return;

      const skillPath = path.join(bundledDir, "channel-logs", "SKILL.md");
      const content = await fs.readFile(skillPath, "utf-8");

      expect(content).toContain("gimli channels logs");
      expect(content).toContain("--channel");
      expect(content).toContain("--follow");
    });
  });
});
