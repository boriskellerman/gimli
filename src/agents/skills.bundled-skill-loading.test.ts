import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  loadWorkspaceSkillEntries,
  filterWorkspaceSkillEntries,
  hasBinary,
  isBundledSkillAllowed,
  resolveBundledAllowlist,
} from "./skills.js";
import { resolveBundledSkillsDir } from "./skills/bundled-dir.js";

async function writeSkill(params: {
  dir: string;
  name: string;
  description: string;
  metadata?: Record<string, unknown>;
  frontmatterExtra?: string;
  body?: string;
}) {
  const { dir, name, description, metadata, frontmatterExtra, body } = params;
  await fs.mkdir(dir, { recursive: true });
  const metadataStr = metadata ? `metadata: ${JSON.stringify({ gimli: metadata })}` : "";
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---
name: ${name}
description: ${description}
${metadataStr}
${frontmatterExtra ?? ""}
---

${body ?? `# ${name}\n`}
`,
    "utf-8",
  );
}

describe("bundled skill loading", () => {
  describe("resolveBundledSkillsDir", () => {
    const originalEnv = process.env.GIMLI_BUNDLED_SKILLS_DIR;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.GIMLI_BUNDLED_SKILLS_DIR = originalEnv;
      } else {
        delete process.env.GIMLI_BUNDLED_SKILLS_DIR;
      }
    });

    it("uses GIMLI_BUNDLED_SKILLS_DIR environment variable when set", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));
      process.env.GIMLI_BUNDLED_SKILLS_DIR = tempDir;

      const resolved = resolveBundledSkillsDir();
      expect(resolved).toBe(tempDir);
    });

    it("falls back to package root skills directory", () => {
      delete process.env.GIMLI_BUNDLED_SKILLS_DIR;

      const resolved = resolveBundledSkillsDir();
      // Should resolve to the actual skills directory in the repo
      expect(resolved).toBeDefined();
      expect(resolved).toMatch(/skills$/);
    });
  });

  describe("loadWorkspaceSkillEntries with bundled skills", () => {
    it("loads skills from bundled directory", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));
      const managedDir = path.join(workspaceDir, ".managed");

      // Create a bundled skill
      await writeSkill({
        dir: path.join(bundledDir, "test-bundled"),
        name: "test-bundled",
        description: "A bundled test skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: managedDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("test-bundled");
      expect(entries[0].skill.source).toBe("gimli-bundled");
    });

    it("workspace skills override bundled skills with same name", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));
      const managedDir = path.join(workspaceDir, ".managed");

      // Create a bundled skill
      await writeSkill({
        dir: path.join(bundledDir, "my-skill"),
        name: "my-skill",
        description: "Bundled version",
      });

      // Create workspace skill with same name
      await writeSkill({
        dir: path.join(workspaceDir, "skills", "my-skill"),
        name: "my-skill",
        description: "Workspace version",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: managedDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("my-skill");
      expect(entries[0].skill.description).toBe("Workspace version");
      expect(entries[0].skill.source).toBe("gimli-workspace");
    });

    it("loads multiple bundled skills", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));
      const managedDir = path.join(workspaceDir, ".managed");

      await writeSkill({
        dir: path.join(bundledDir, "skill-a"),
        name: "skill-a",
        description: "First skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "skill-b"),
        name: "skill-b",
        description: "Second skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "skill-c"),
        name: "skill-c",
        description: "Third skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: managedDir,
      });

      expect(entries.length).toBe(3);
      const names = entries.map((e) => e.skill.name).sort();
      expect(names).toEqual(["skill-a", "skill-b", "skill-c"]);
    });

    it("loads bundled skill with metadata requirements", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));
      const managedDir = path.join(workspaceDir, ".managed");

      await writeSkill({
        dir: path.join(bundledDir, "gh-skill"),
        name: "gh-skill",
        description: "GitHub skill",
        metadata: {
          emoji: "🐙",
          requires: {
            bins: ["gh"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: managedDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].metadata?.requires?.bins).toEqual(["gh"]);
      expect(entries[0].metadata?.emoji).toBe("🐙");
    });
  });

  describe("bundled allowlist filtering", () => {
    it("resolveBundledAllowlist returns undefined when not configured", () => {
      const allowlist = resolveBundledAllowlist({});
      expect(allowlist).toBeUndefined();
    });

    it("resolveBundledAllowlist returns normalized list when configured", () => {
      const allowlist = resolveBundledAllowlist({
        skills: {
          allowBundled: ["github", "weather", "  tmux  "],
        },
      });
      expect(allowlist).toEqual(["github", "weather", "tmux"]);
    });

    it("isBundledSkillAllowed returns true when no allowlist", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "test-skill"),
        name: "test-skill",
        description: "Test skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      expect(isBundledSkillAllowed(entries[0], undefined)).toBe(true);
      expect(isBundledSkillAllowed(entries[0], [])).toBe(true);
    });

    it("isBundledSkillAllowed filters bundled skills by allowlist", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "allowed-skill"),
        name: "allowed-skill",
        description: "Allowed skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "blocked-skill"),
        name: "blocked-skill",
        description: "Blocked skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const allowlist = ["allowed-skill"];
      const allowed = entries.find((e) => e.skill.name === "allowed-skill")!;
      const blocked = entries.find((e) => e.skill.name === "blocked-skill")!;

      expect(isBundledSkillAllowed(allowed, allowlist)).toBe(true);
      expect(isBundledSkillAllowed(blocked, allowlist)).toBe(false);
    });

    it("isBundledSkillAllowed always allows non-bundled skills", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(workspaceDir, "skills", "workspace-skill"),
        name: "workspace-skill",
        description: "Workspace skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      // Even with a restrictive allowlist, workspace skills are allowed
      expect(isBundledSkillAllowed(entries[0], ["some-other-skill"])).toBe(true);
    });
  });

  describe("filterWorkspaceSkillEntries for bundled skills", () => {
    it("filters bundled skills by allowlist in config", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "allowed"),
        name: "allowed",
        description: "Allowed skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "blocked"),
        name: "blocked",
        description: "Blocked skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries, {
        skills: {
          allowBundled: ["allowed"],
        },
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("allowed");
    });

    it("filters bundled skills by disabled flag", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "enabled-skill"),
        name: "enabled-skill",
        description: "Enabled skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "disabled-skill"),
        name: "disabled-skill",
        description: "Disabled skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries, {
        skills: {
          entries: {
            "disabled-skill": {
              enabled: false,
            },
          },
        },
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("enabled-skill");
    });
  });

  describe("buildWorkspaceSkillSnapshot with bundled skills", () => {
    it("includes bundled skills in snapshot prompt", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "test-bundled"),
        name: "test-bundled",
        description: "A bundled test skill for testing",
        body: "## Usage\nRun the test bundled skill.",
      });

      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      expect(snapshot.prompt).toContain("test-bundled");
      expect(snapshot.prompt).toContain("A bundled test skill for testing");
      expect(snapshot.skills).toHaveLength(1);
      expect(snapshot.skills[0].name).toBe("test-bundled");
    });

    it("excludes bundled skills not in allowlist from prompt", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "included"),
        name: "included",
        description: "Included skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "excluded"),
        name: "excluded",
        description: "Excluded skill",
      });

      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        config: {
          skills: {
            allowBundled: ["included"],
          },
        },
      });

      expect(snapshot.prompt).toContain("included");
      expect(snapshot.prompt).not.toContain("excluded");
    });

    it("includes bundled skill location in prompt for model to read", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "content-skill"),
        name: "content-skill",
        description: "Skill with detailed content",
        body: `## Instructions

Use this skill to perform specific actions.

### Step 1
Do the first thing.

### Step 2
Do the second thing.
`,
      });

      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      // Skill prompt format includes metadata and location for the model to read
      expect(snapshot.prompt).toContain("content-skill");
      expect(snapshot.prompt).toContain("Skill with detailed content");
      expect(snapshot.prompt).toContain("SKILL.md");
      // The model uses the read tool to access skill content
      expect(snapshot.prompt).toContain("Use the read tool to load a skill");
    });
  });

  describe("buildWorkspaceSkillsPrompt with bundled skills", () => {
    it("generates prompt with bundled skills", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "prompt-skill"),
        name: "prompt-skill",
        description: "Skill for prompt testing",
      });

      const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      expect(prompt).toContain("prompt-skill");
      expect(prompt).toContain("Skill for prompt testing");
    });

    it("filters bundled skills using skillFilter parameter", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "skill-one"),
        name: "skill-one",
        description: "First skill",
      });
      await writeSkill({
        dir: path.join(bundledDir, "skill-two"),
        name: "skill-two",
        description: "Second skill",
      });

      const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
        skillFilter: ["skill-one"],
      });

      expect(prompt).toContain("skill-one");
      expect(prompt).not.toContain("skill-two");
    });
  });

  describe("bundled skill eligibility requirements", () => {
    it("excludes bundled skill when required binary is missing", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "bin-skill"),
        name: "bin-skill",
        description: "Requires a nonexistent binary",
        metadata: {
          requires: {
            bins: ["nonexistent-binary-12345"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(0);
    });

    it("includes bundled skill when required binary exists", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "node-skill"),
        name: "node-skill",
        description: "Requires node binary",
        metadata: {
          requires: {
            bins: ["node"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("node-skill");
    });

    it("includes bundled skill when anyBins requirement is met", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "anybin-skill"),
        name: "anybin-skill",
        description: "Requires any of these binaries",
        metadata: {
          requires: {
            anyBins: ["nonexistent-1", "node", "nonexistent-2"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(1);
    });

    it("excludes bundled skill when required env var is missing", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "env-skill"),
        name: "env-skill",
        description: "Requires an env var",
        metadata: {
          requires: {
            env: ["GIMLI_NONEXISTENT_VAR_12345"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(0);
    });

    it("includes bundled skill with always=true regardless of requirements", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "always-skill"),
        name: "always-skill",
        description: "Always included",
        metadata: {
          always: true,
          requires: {
            bins: ["nonexistent-binary-12345"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("always-skill");
    });

    it("excludes bundled skill when OS does not match", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      // Use an OS that definitely doesn't match
      const nonMatchingOS = process.platform === "linux" ? "darwin" : "linux";

      await writeSkill({
        dir: path.join(bundledDir, "os-skill"),
        name: "os-skill",
        description: "Requires specific OS",
        metadata: {
          os: [nonMatchingOS],
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(0);
    });

    it("includes bundled skill when OS matches", async () => {
      const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-"));
      const bundledDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-bundled-"));

      await writeSkill({
        dir: path.join(bundledDir, "matching-os-skill"),
        name: "matching-os-skill",
        description: "Requires current OS",
        metadata: {
          os: [process.platform],
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const filtered = filterWorkspaceSkillEntries(entries);
      expect(filtered.length).toBe(1);
    });
  });

  describe("loading real bundled skills", () => {
    it("loads skills from the actual bundled skills directory", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) {
        // Skip if bundled dir not found (CI environment without skills)
        return;
      }

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      // Should have multiple bundled skills
      expect(entries.length).toBeGreaterThan(0);
      // All should be marked as bundled source
      for (const entry of entries) {
        expect(entry.skill.source).toBe("gimli-bundled");
      }
    });

    it("includes well-known bundled skills like github", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) {
        return;
      }

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const names = entries.map((e) => e.skill.name);
      expect(names).toContain("github");
    });

    it("parses metadata correctly for bundled skills", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) {
        return;
      }

      const workspaceDir = os.tmpdir();
      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      const github = entries.find((e) => e.skill.name === "github");
      expect(github).toBeDefined();
      expect(github?.metadata?.requires?.bins).toContain("gh");
      expect(github?.metadata?.emoji).toBe("🐙");
    });

    it("generates valid snapshot from real bundled skills", () => {
      const bundledDir = resolveBundledSkillsDir();
      if (!bundledDir) {
        return;
      }

      const workspaceDir = os.tmpdir();
      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        bundledSkillsDir: bundledDir,
        managedSkillsDir: path.join(workspaceDir, ".managed"),
      });

      // Snapshot should have non-empty prompt if any skills are eligible
      expect(snapshot.skills.length).toBeGreaterThanOrEqual(0);
      // Skills array should match skills included in prompt
      if (snapshot.skills.length > 0) {
        expect(snapshot.prompt.length).toBeGreaterThan(0);
      }
    });
  });

  describe("hasBinary utility", () => {
    it("returns true for common binaries like node", () => {
      expect(hasBinary("node")).toBe(true);
    });

    it("returns false for nonexistent binaries", () => {
      expect(hasBinary("nonexistent-binary-xyz-12345")).toBe(false);
    });

    it("returns true for common system binaries", () => {
      // These should exist on most systems
      const commonBins = process.platform === "win32" ? ["cmd"] : ["ls", "cat"];
      for (const bin of commonBins) {
        expect(hasBinary(bin)).toBe(true);
      }
    });
  });
});
