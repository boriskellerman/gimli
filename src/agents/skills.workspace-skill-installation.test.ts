import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installSkill, type SkillInstallRequest } from "./skills-install.js";
import {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  filterWorkspaceSkillEntries,
  loadWorkspaceSkillEntries,
} from "./skills.js";

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

describe("workspace skill installation", () => {
  let tempDir: string;
  let workspaceDir: string;
  let workspaceSkillsDir: string;
  let managedDir: string;
  let bundledDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-ws-install-"));
    workspaceDir = tempDir;
    workspaceSkillsDir = path.join(workspaceDir, "skills");
    managedDir = path.join(tempDir, ".managed");
    bundledDir = path.join(tempDir, ".bundled");
    await fs.mkdir(workspaceSkillsDir, { recursive: true });
    await fs.mkdir(managedDir, { recursive: true });
    await fs.mkdir(bundledDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loading skills from workspace skills directory", () => {
    it("loads skill installed in workspace skills directory", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "my-custom-skill"),
        name: "my-custom-skill",
        description: "A custom skill installed in workspace",
        body: "## Usage\nUse this skill to do custom things.",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("my-custom-skill");
      expect(entries[0].skill.source).toBe("gimli-workspace");
      expect(entries[0].skill.description).toBe("A custom skill installed in workspace");
    });

    it("loads multiple skills from workspace skills directory", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "skill-alpha"),
        name: "skill-alpha",
        description: "First workspace skill",
      });
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "skill-beta"),
        name: "skill-beta",
        description: "Second workspace skill",
      });
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "skill-gamma"),
        name: "skill-gamma",
        description: "Third workspace skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(3);
      const names = entries.map((e) => e.skill.name).sort();
      expect(names).toEqual(["skill-alpha", "skill-beta", "skill-gamma"]);
      for (const entry of entries) {
        expect(entry.skill.source).toBe("gimli-workspace");
      }
    });

    it("workspace skill overrides managed skill with same name", async () => {
      // Install in managed directory first
      await writeSkill({
        dir: path.join(managedDir, "override-skill"),
        name: "override-skill",
        description: "Managed version of the skill",
      });

      // Install in workspace directory (should take precedence)
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "override-skill"),
        name: "override-skill",
        description: "Workspace version of the skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("override-skill");
      expect(entries[0].skill.description).toBe("Workspace version of the skill");
      expect(entries[0].skill.source).toBe("gimli-workspace");
    });

    it("workspace skill overrides bundled skill with same name", async () => {
      await writeSkill({
        dir: path.join(bundledDir, "bundled-skill"),
        name: "bundled-skill",
        description: "Bundled version",
      });

      await writeSkill({
        dir: path.join(workspaceSkillsDir, "bundled-skill"),
        name: "bundled-skill",
        description: "Workspace override version",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.description).toBe("Workspace override version");
      expect(entries[0].skill.source).toBe("gimli-workspace");
    });

    it("loads skill with metadata and requirements from workspace", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "metadata-skill"),
        name: "metadata-skill",
        description: "Skill with metadata",
        metadata: {
          emoji: "🚀",
          requires: {
            bins: ["node"],
          },
          primaryEnv: "MY_API_KEY",
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].metadata?.emoji).toBe("🚀");
      expect(entries[0].metadata?.requires?.bins).toEqual(["node"]);
      expect(entries[0].metadata?.primaryEnv).toBe("MY_API_KEY");
    });
  });

  describe("workspace skill filtering", () => {
    it("includes workspace skill when requirements are met", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "node-skill"),
        name: "node-skill",
        description: "Requires node binary",
        metadata: {
          requires: {
            bins: ["node"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      const filtered = filterWorkspaceSkillEntries(entries);

      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("node-skill");
    });

    it("excludes workspace skill when required binary is missing", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "missing-bin-skill"),
        name: "missing-bin-skill",
        description: "Requires nonexistent binary",
        metadata: {
          requires: {
            bins: ["nonexistent-binary-xyz-12345"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      const filtered = filterWorkspaceSkillEntries(entries);

      expect(filtered.length).toBe(0);
    });

    it("excludes workspace skill when required env var is missing", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "env-skill"),
        name: "env-skill",
        description: "Requires env var",
        metadata: {
          requires: {
            env: ["NONEXISTENT_ENV_VAR_XYZ_12345"],
          },
        },
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      const filtered = filterWorkspaceSkillEntries(entries);

      expect(filtered.length).toBe(0);
    });

    it("includes workspace skill with always=true despite missing requirements", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "always-skill"),
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
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      const filtered = filterWorkspaceSkillEntries(entries);

      expect(filtered.length).toBe(1);
      expect(filtered[0].skill.name).toBe("always-skill");
    });

    it("respects disabled flag for workspace skills", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "disabled-skill"),
        name: "disabled-skill",
        description: "Should be disabled via config",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
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

      expect(filtered.length).toBe(0);
    });

    it("workspace skills are not affected by bundled allowlist", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "ws-skill"),
        name: "ws-skill",
        description: "Workspace skill not in allowlist",
      });
      await writeSkill({
        dir: path.join(bundledDir, "bundled-skill"),
        name: "bundled-skill",
        description: "Bundled skill",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      // Apply restrictive bundled allowlist
      const filtered = filterWorkspaceSkillEntries(entries, {
        skills: {
          allowBundled: ["some-other-skill"],
        },
      });

      // Workspace skill should still be included
      expect(filtered.some((e) => e.skill.name === "ws-skill")).toBe(true);
      // Bundled skill should be excluded
      expect(filtered.some((e) => e.skill.name === "bundled-skill")).toBe(false);
    });
  });

  describe("workspace skill snapshot and prompt generation", () => {
    it("includes workspace skill in snapshot", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "snapshot-skill"),
        name: "snapshot-skill",
        description: "Skill for snapshot testing",
        body: "## How to use\nJust invoke /snapshot-skill.",
      });

      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(snapshot.skills.length).toBe(1);
      expect(snapshot.skills[0].name).toBe("snapshot-skill");
      expect(snapshot.prompt).toContain("snapshot-skill");
      expect(snapshot.prompt).toContain("Skill for snapshot testing");
    });

    it("includes workspace skill in prompt", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "prompt-skill"),
        name: "prompt-skill",
        description: "Skill for prompt testing",
      });

      const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(prompt).toContain("prompt-skill");
      expect(prompt).toContain("Skill for prompt testing");
    });

    it("filters workspace skills by skillFilter parameter", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "included-skill"),
        name: "included-skill",
        description: "Should be included",
      });
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "excluded-skill"),
        name: "excluded-skill",
        description: "Should be excluded",
      });

      const prompt = buildWorkspaceSkillsPrompt(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
        skillFilter: ["included-skill"],
      });

      expect(prompt).toContain("included-skill");
      expect(prompt).not.toContain("excluded-skill");
    });
  });

  describe("workspace skill file path resolution", () => {
    it("resolves correct file path for workspace skill", async () => {
      const skillDir = path.join(workspaceSkillsDir, "path-skill");
      await writeSkill({
        dir: skillDir,
        name: "path-skill",
        description: "Skill for path testing",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.filePath).toBe(path.join(skillDir, "SKILL.md"));
      expect(entries[0].skill.baseDir).toBe(skillDir);
    });
  });

  describe("workspace skill invocation policy", () => {
    it("loads user-invocable skill from workspace", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "invocable-skill"),
        name: "invocable-skill",
        description: "User invocable skill",
        frontmatterExtra: "user-invocable: true",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].invocation?.userInvocable).toBe(true);
    });

    it("loads skill with model invocation disabled", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "no-model-skill"),
        name: "no-model-skill",
        description: "Not model invocable",
        frontmatterExtra: "disable-model-invocation: true",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].invocation?.disableModelInvocation).toBe(true);
    });

    it("excludes model-disabled skills from prompt but includes in snapshot", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "visible-skill"),
        name: "visible-skill",
        description: "Visible in prompt",
      });
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "hidden-skill"),
        name: "hidden-skill",
        description: "Hidden from model",
        frontmatterExtra: "disable-model-invocation: true",
      });

      const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      // Both skills should be in the snapshot skills array
      expect(snapshot.skills.length).toBe(2);
      // But only the visible one should be in the prompt
      expect(snapshot.prompt).toContain("visible-skill");
      expect(snapshot.prompt).not.toContain("hidden-skill");
    });
  });

  describe("installSkill function", () => {
    it("returns error when skill not found", async () => {
      const request: SkillInstallRequest = {
        workspaceDir,
        skillName: "nonexistent-skill",
        installId: "brew-0",
      };

      const result = await installSkill(request);

      expect(result.ok).toBe(false);
      expect(result.message).toContain("Skill not found");
      expect(result.message).toContain("nonexistent-skill");
    });

    it("returns error when installer not found", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "no-installer-skill"),
        name: "no-installer-skill",
        description: "Skill without installer",
      });

      const result = await installSkill({
        workspaceDir,
        skillName: "no-installer-skill",
        installId: "brew-0",
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("Installer not found");
    });

    it("finds skill with install spec by id", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "installable-skill"),
        name: "installable-skill",
        description: "Skill with installer",
        metadata: {
          install: [
            {
              kind: "brew",
              id: "my-installer",
              formula: "nonexistent-formula-xyz-12345",
            },
          ],
        },
      });

      const result = await installSkill({
        workspaceDir,
        skillName: "installable-skill",
        installId: "my-installer",
      });

      // Should find the installer (even if brew fails or isn't installed)
      // The key is that it doesn't return "Installer not found"
      expect(result.message).not.toContain("Installer not found");
    });

    it("handles download install spec with missing url", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "download-skill"),
        name: "download-skill",
        description: "Skill with download installer",
        metadata: {
          install: [
            {
              kind: "download",
              id: "download-installer",
              // Missing url
            },
          ],
        },
      });

      const result = await installSkill({
        workspaceDir,
        skillName: "download-skill",
        installId: "download-installer",
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain("missing download url");
    });
  });

  describe("workspace skills directory creation", () => {
    it("handles missing workspace skills directory gracefully", async () => {
      // Remove the skills directory
      await fs.rm(workspaceSkillsDir, { recursive: true, force: true });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      // Should return empty array, not throw
      expect(entries).toEqual([]);
    });

    it("loads skills after directory is created", async () => {
      // Start with no skills directory
      await fs.rm(workspaceSkillsDir, { recursive: true, force: true });

      let entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      expect(entries).toEqual([]);

      // Create directory and add skill
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "new-skill"),
        name: "new-skill",
        description: "Newly installed skill",
      });

      entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });
      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("new-skill");
    });
  });

  describe("workspace skill with special characters", () => {
    it("handles skill name with underscores", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "my_custom_skill"),
        name: "my_custom_skill",
        description: "Skill with underscores",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("my_custom_skill");
    });

    it("handles skill name with hyphens", async () => {
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "my-custom-skill"),
        name: "my-custom-skill",
        description: "Skill with hyphens",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("my-custom-skill");
    });

    it("handles skill with unicode content in body", async () => {
      // Note: Unicode in YAML description needs proper quoting; body content handles unicode natively
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "unicode-skill"),
        name: "unicode-skill",
        description: "Skill with international support",
        body: "## Instructions\n\nSupports émojis 🎉 and languages: 日本語, 中文, العربية",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.name).toBe("unicode-skill");
      // Body content contains unicode
      const content = await fs.readFile(entries[0].skill.filePath, "utf-8");
      expect(content).toContain("日本語");
      expect(content).toContain("🎉");
    });
  });

  describe("workspace skill precedence chain", () => {
    it("follows correct precedence: extra < bundled < managed < workspace", async () => {
      // Create skill in all locations
      await writeSkill({
        dir: path.join(bundledDir, "precedence-skill"),
        name: "precedence-skill",
        description: "Bundled version",
      });
      await writeSkill({
        dir: path.join(managedDir, "precedence-skill"),
        name: "precedence-skill",
        description: "Managed version",
      });
      await writeSkill({
        dir: path.join(workspaceSkillsDir, "precedence-skill"),
        name: "precedence-skill",
        description: "Workspace version",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.description).toBe("Workspace version");
      expect(entries[0].skill.source).toBe("gimli-workspace");
    });

    it("managed overrides bundled when workspace is absent", async () => {
      await writeSkill({
        dir: path.join(bundledDir, "managed-precedence"),
        name: "managed-precedence",
        description: "Bundled version",
      });
      await writeSkill({
        dir: path.join(managedDir, "managed-precedence"),
        name: "managed-precedence",
        description: "Managed version",
      });

      const entries = loadWorkspaceSkillEntries(workspaceDir, {
        managedSkillsDir: managedDir,
        bundledSkillsDir: bundledDir,
      });

      expect(entries.length).toBe(1);
      expect(entries[0].skill.description).toBe("Managed version");
      expect(entries[0].skill.source).toBe("gimli-managed");
    });
  });
});
