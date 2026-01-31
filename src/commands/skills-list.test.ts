import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

import { buildWorkspaceSkillStatus, type SkillStatusReport } from "../agents/skills-status.js";
import { formatSkillsList, formatSkillInfo, formatSkillsCheck } from "../cli/skills-cli.js";

/**
 * Integration tests for `gimli skills list` command
 * PRD Task: List installed skills with `gimli skills list`
 */

/**
 * Helper to run CLI commands safely using spawnSync (no shell injection risk)
 */
function runCliCommand(args: string[]): string {
  const result = spawnSync("pnpm", ["gimli", ...args], {
    cwd: process.cwd(),
    encoding: "utf-8",
    timeout: 60000,
    shell: false, // Explicit: no shell, preventing injection
  });
  return result.stdout + result.stderr;
}

/**
 * Extract JSON from CLI output that may contain build messages and hints
 */
function extractJsonFromOutput(output: string): unknown {
  const lines = output.split("\n");
  const jsonStart = lines.findIndex((l) => l.trim().startsWith("{"));
  if (jsonStart < 0) throw new Error("No JSON found in output");

  // Find the end of the JSON object by tracking brace depth
  let depth = 0;
  let jsonEndLine = -1;
  for (let i = jsonStart; i < lines.length; i++) {
    for (const char of lines[i]) {
      if (char === "{") depth++;
      else if (char === "}") depth--;
    }
    if (depth === 0) {
      jsonEndLine = i;
      break;
    }
  }

  if (jsonEndLine < 0) throw new Error("Incomplete JSON in output");
  const jsonContent = lines.slice(jsonStart, jsonEndLine + 1).join("\n");
  return JSON.parse(jsonContent);
}

describe("gimli skills list", () => {
  describe("CLI command execution", () => {
    it("executes gimli skills list without errors", () => {
      // This tests the actual CLI command runs successfully
      const result = runCliCommand(["skills", "list", "--json"]);

      // Should produce valid JSON output
      const parsed = extractJsonFromOutput(result) as { skills: unknown[] };
      expect(parsed).toHaveProperty("skills");
      expect(Array.isArray(parsed.skills)).toBe(true);
    });

    it("executes gimli skills list with --eligible flag", () => {
      const result = runCliCommand(["skills", "list", "--eligible", "--json"]);
      const parsed = extractJsonFromOutput(result) as { skills: Array<{ eligible: boolean }> };

      // All returned skills should be eligible
      for (const skill of parsed.skills) {
        expect(skill.eligible).toBe(true);
      }
    });

    it("executes gimli skills check without errors", () => {
      const result = runCliCommand(["skills", "check", "--json"]);
      const parsed = extractJsonFromOutput(result) as {
        summary: { total: number; eligible: number };
      };

      expect(parsed).toHaveProperty("summary");
      expect(parsed.summary).toHaveProperty("total");
      expect(parsed.summary).toHaveProperty("eligible");
      expect(parsed.summary.total).toBeGreaterThan(0);
    });

    it("executes gimli skills info for a bundled skill", () => {
      // github is a bundled skill that should always exist
      const result = runCliCommand(["skills", "info", "github", "--json"]);
      const parsed = extractJsonFromOutput(result) as {
        name: string;
        description: string;
        source: string;
      };

      expect(parsed.name).toBe("github");
      expect(parsed).toHaveProperty("description");
      expect(parsed).toHaveProperty("source");
    });
  });

  describe("buildWorkspaceSkillStatus", () => {
    it("loads bundled skills from repository", () => {
      const report = buildWorkspaceSkillStatus("/tmp", {
        managedSkillsDir: "/nonexistent",
      });

      expect(report.skills.length).toBeGreaterThan(0);

      // Check for known bundled skills
      const skillNames = report.skills.map((s) => s.name);
      expect(skillNames).toContain("github");
      expect(skillNames).toContain("weather");
    });

    it("categorizes skills by eligibility correctly", () => {
      const report = buildWorkspaceSkillStatus("/tmp", {
        managedSkillsDir: "/nonexistent",
      });

      const eligible = report.skills.filter((s) => s.eligible);
      const ineligible = report.skills.filter((s) => !s.eligible);

      // Should have both eligible and ineligible skills
      expect(eligible.length).toBeGreaterThan(0);
      expect(ineligible.length).toBeGreaterThan(0);

      // Eligible skills should have no missing requirements
      for (const skill of eligible) {
        const hasMissing =
          skill.missing.bins.length > 0 ||
          skill.missing.anyBins.length > 0 ||
          skill.missing.env.length > 0 ||
          skill.missing.config.length > 0 ||
          skill.missing.os.length > 0;

        // If eligible and not disabled/blocked, should have no missing requirements
        if (!skill.disabled && !skill.blockedByAllowlist) {
          expect(hasMissing).toBe(false);
        }
      }
    });

    it("populates skill metadata correctly", () => {
      const report = buildWorkspaceSkillStatus("/tmp", {
        managedSkillsDir: "/nonexistent",
      });

      for (const skill of report.skills) {
        // All skills should have these required fields
        expect(skill.name).toBeTruthy();
        expect(typeof skill.name).toBe("string");
        expect(skill.description).toBeTruthy();
        expect(typeof skill.description).toBe("string");
        expect(skill.filePath).toBeTruthy();
        expect(skill.baseDir).toBeTruthy();
        expect(skill.skillKey).toBeTruthy();

        // Requirements should be arrays
        expect(Array.isArray(skill.requirements.bins)).toBe(true);
        expect(Array.isArray(skill.requirements.anyBins)).toBe(true);
        expect(Array.isArray(skill.requirements.env)).toBe(true);
        expect(Array.isArray(skill.requirements.config)).toBe(true);
        expect(Array.isArray(skill.requirements.os)).toBe(true);

        // Missing should be arrays
        expect(Array.isArray(skill.missing.bins)).toBe(true);
        expect(Array.isArray(skill.missing.anyBins)).toBe(true);
        expect(Array.isArray(skill.missing.env)).toBe(true);
        expect(Array.isArray(skill.missing.config)).toBe(true);
        expect(Array.isArray(skill.missing.os)).toBe(true);
      }
    });

    it("identifies skill source correctly", () => {
      const report = buildWorkspaceSkillStatus("/tmp", {
        managedSkillsDir: "/nonexistent",
      });

      const bundledSkills = report.skills.filter(
        (s) => s.source === "bundled" || s.source === "gimli-bundled",
      );

      // Should have bundled skills
      expect(bundledSkills.length).toBeGreaterThan(0);
    });
  });

  describe("formatSkillsList output", () => {
    let mockReport: SkillStatusReport;

    beforeEach(() => {
      mockReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/managed",
        skills: [
          {
            name: "test-ready",
            description: "A ready skill",
            source: "bundled",
            filePath: "/path/to/SKILL.md",
            baseDir: "/path/to",
            skillKey: "test-ready",
            emoji: "✅",
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: true,
            requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
          {
            name: "test-missing",
            description: "A skill with missing deps",
            source: "bundled",
            filePath: "/path/to/SKILL2.md",
            baseDir: "/path/to",
            skillKey: "test-missing",
            emoji: "❌",
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: false,
            requirements: { bins: ["mytool"], anyBins: [], env: [], config: [], os: [] },
            missing: { bins: ["mytool"], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      };
    });

    it("shows ready/missing status indicators", () => {
      const output = formatSkillsList(mockReport, {});
      expect(output).toContain("test-ready");
      expect(output).toContain("test-missing");
      expect(output).toContain("ready");
      expect(output).toContain("missing");
    });

    it("shows count of ready vs total skills", () => {
      const output = formatSkillsList(mockReport, {});
      // Should show "1/2 ready" for our mock
      expect(output).toMatch(/1\/2/);
    });

    it("filters to eligible only when requested", () => {
      const output = formatSkillsList(mockReport, { eligible: true });
      expect(output).toContain("test-ready");
      expect(output).not.toContain("test-missing");
    });

    it("outputs valid JSON when requested", () => {
      const output = formatSkillsList(mockReport, { json: true });
      const parsed = JSON.parse(output);
      expect(parsed.skills).toHaveLength(2);
      expect(parsed.skills[0].name).toBe("test-ready");
      expect(parsed.skills[1].name).toBe("test-missing");
    });

    it("includes gimlihub hint in non-JSON output", () => {
      const output = formatSkillsList(mockReport, {});
      expect(output).toContain("npx gimlihub");
    });

    it("excludes gimlihub hint in JSON output", () => {
      const output = formatSkillsList(mockReport, { json: true });
      expect(output).not.toContain("npx gimlihub");
    });
  });

  describe("formatSkillInfo output", () => {
    let mockReport: SkillStatusReport;

    beforeEach(() => {
      mockReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/managed",
        skills: [
          {
            name: "detailed-skill",
            description: "A skill with all details",
            source: "bundled",
            filePath: "/path/to/SKILL.md",
            baseDir: "/path/to",
            skillKey: "detailed-skill",
            emoji: "📦",
            homepage: "https://example.com",
            primaryEnv: "EXAMPLE_API_KEY",
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: false,
            requirements: {
              bins: ["tool1", "tool2"],
              anyBins: ["altA", "altB"],
              env: ["API_KEY"],
              config: [],
              os: ["darwin"],
            },
            missing: {
              bins: ["tool2"],
              anyBins: [],
              env: ["API_KEY"],
              config: [],
              os: ["darwin"],
            },
            configChecks: [],
            install: [
              { id: "brew", kind: "brew" as const, label: "brew install tool2", bins: ["tool2"] },
            ],
          },
        ],
      };
    });

    it("shows skill details", () => {
      const output = formatSkillInfo(mockReport, "detailed-skill", {});
      expect(output).toContain("detailed-skill");
      expect(output).toContain("A skill with all details");
      expect(output).toContain("https://example.com");
    });

    it("shows requirements status", () => {
      const output = formatSkillInfo(mockReport, "detailed-skill", {});
      expect(output).toContain("tool1");
      expect(output).toContain("tool2");
      expect(output).toContain("API_KEY");
    });

    it("shows install options for missing skills", () => {
      const output = formatSkillInfo(mockReport, "detailed-skill", {});
      expect(output).toContain("brew install tool2");
    });

    it("returns not found for unknown skill", () => {
      const output = formatSkillInfo(mockReport, "unknown-skill", {});
      expect(output).toContain("not found");
    });

    it("outputs valid JSON when requested", () => {
      const output = formatSkillInfo(mockReport, "detailed-skill", { json: true });
      const parsed = JSON.parse(output);
      expect(parsed.name).toBe("detailed-skill");
      expect(parsed.homepage).toBe("https://example.com");
    });
  });

  describe("formatSkillsCheck output", () => {
    let mockReport: SkillStatusReport;

    beforeEach(() => {
      mockReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/managed",
        skills: [
          {
            name: "ready-skill",
            description: "Ready",
            source: "bundled",
            filePath: "/p/SKILL.md",
            baseDir: "/p",
            skillKey: "ready-skill",
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: true,
            requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
          {
            name: "disabled-skill",
            description: "Disabled",
            source: "bundled",
            filePath: "/p/SKILL2.md",
            baseDir: "/p",
            skillKey: "disabled-skill",
            always: false,
            disabled: true,
            blockedByAllowlist: false,
            eligible: false,
            requirements: { bins: [], anyBins: [], env: [], config: [], os: [] },
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
          {
            name: "missing-skill",
            description: "Missing",
            source: "bundled",
            filePath: "/p/SKILL3.md",
            baseDir: "/p",
            skillKey: "missing-skill",
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: false,
            requirements: { bins: ["missing-bin"], anyBins: [], env: [], config: [], os: [] },
            missing: { bins: ["missing-bin"], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      };
    });

    it("shows summary counts", () => {
      const output = formatSkillsCheck(mockReport, {});
      expect(output).toContain("Total:");
      expect(output).toContain("Eligible:");
      expect(output).toContain("Disabled:");
    });

    it("lists ready skills", () => {
      const output = formatSkillsCheck(mockReport, {});
      expect(output).toContain("ready-skill");
    });

    it("lists skills with missing requirements", () => {
      const output = formatSkillsCheck(mockReport, {});
      expect(output).toContain("missing-skill");
      expect(output).toContain("missing-bin");
    });

    it("outputs valid JSON summary when requested", () => {
      const output = formatSkillsCheck(mockReport, { json: true });
      const parsed = JSON.parse(output);
      expect(parsed.summary.total).toBe(3);
      expect(parsed.summary.eligible).toBe(1);
      expect(parsed.summary.disabled).toBe(1);
      expect(parsed.summary.missingRequirements).toBe(1);
    });
  });

  describe("workspace skills loading", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gimli-skills-test-"));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("loads skills from workspace skills directory", () => {
      // Create a workspace skill
      const skillDir = path.join(tempDir, "skills", "test-workspace-skill");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---
name: test-workspace-skill
description: A test workspace skill
---

# Test Workspace Skill

This is a test skill.
`,
      );

      const report = buildWorkspaceSkillStatus(tempDir, {
        managedSkillsDir: "/nonexistent",
      });

      const workspaceSkill = report.skills.find((s) => s.name === "test-workspace-skill");
      expect(workspaceSkill).toBeDefined();
      // Source is "gimli-workspace" for workspace skills loaded from workspace/skills dir
      expect(workspaceSkill?.source).toBe("gimli-workspace");
    });

    it("handles missing workspace skills directory gracefully", () => {
      const report = buildWorkspaceSkillStatus("/nonexistent-workspace", {
        managedSkillsDir: "/nonexistent",
      });

      // Should still load bundled skills
      expect(report.skills.length).toBeGreaterThan(0);
    });
  });
});
