import fs from "node:fs/promises";
import { lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const claudeDir = path.join(rootDir, ".claude");
const commandsDir = path.join(claudeDir, "commands");
const claudeMdPath = path.join(rootDir, "CLAUDE.md");

describe("CLAUDE.md memory file", () => {
  it("exists as a regular file (not a symlink)", async () => {
    const stats = lstatSync(claudeMdPath);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isFile()).toBe(true);
  });

  it("contains required TAC memory sections", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // Core sections for TAC memory file
    expect(content).toContain("# Gimli");
    expect(content).toContain("## Project Identity");
    expect(content).toContain("## Architecture Overview");
    expect(content).toContain("## Security Model");
    expect(content).toContain("## Development Patterns");
    expect(content).toContain("## Key Conventions");
  });

  it("contains agent mental models", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // Agent mental models for domain knowledge
    expect(content).toContain("Mental Model");
    expect(content).toContain("Gateway");
    expect(content).toContain("Channel");
    expect(content).toContain("Session");
  });

  it("documents security-critical paths", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // Security awareness for agents
    expect(content).toContain("Security");
    expect(content).toContain("sandbox");
    expect(content).toContain("credentials");
    expect(content).toContain("pairing");
  });

  it("includes quick reference for agents", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // Quick reference sections
    expect(content).toContain("Quick Reference");
    expect(content).toContain("Files to Read First");
  });

  it("documents multi-agent safety rules", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // Multi-agent coordination
    expect(content).toContain("Multi-Agent");
    expect(content).toContain("stash");
    expect(content).toContain("branch");
  });

  it("references TAC principles", async () => {
    const content = await fs.readFile(claudeMdPath, "utf-8");

    // TAC alignment
    expect(content).toContain("TAC");
    expect(content).toContain("agent");
  });
});

describe(".claude/commands directory structure", () => {
  describe("required command templates", () => {
    const requiredCommands = ["chore.md", "bug.md", "feature.md", "implement.md"];

    it.each(requiredCommands)("has %s template", async (filename) => {
      const filePath = path.join(commandsDir, filename);
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe("Gimli-specific command templates", () => {
    const gimliCommands = ["gateway.md", "channel.md", "test.md", "doctor.md"];

    it.each(gimliCommands)("has %s Gimli command", async (filename) => {
      const filePath = path.join(commandsDir, filename);
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).toBe(true);
    });
  });

  describe("template content structure", () => {
    it("chore.md contains Purpose section", async () => {
      const content = await fs.readFile(path.join(commandsDir, "chore.md"), "utf-8");
      expect(content).toContain("## Purpose");
      expect(content).toContain("## Instructions");
      expect(content).toContain("## Plan Format");
      expect(content).toContain("$ARGUMENTS");
    });

    it("bug.md contains security checklist", async () => {
      const content = await fs.readFile(path.join(commandsDir, "bug.md"), "utf-8");
      expect(content).toContain("## Security Checklist");
      expect(content).toContain("## Root Cause Analysis");
      expect(content).toContain("$ARGUMENTS");
    });

    it("feature.md contains phased tasks", async () => {
      const content = await fs.readFile(path.join(commandsDir, "feature.md"), "utf-8");
      expect(content).toContain("### Phase 1");
      expect(content).toContain("### Phase 2");
      expect(content).toContain("### Phase 3");
      expect(content).toContain("$ARGUMENTS");
    });

    it("implement.md is a higher-order prompt", async () => {
      const content = await fs.readFile(path.join(commandsDir, "implement.md"), "utf-8");
      expect(content).toContain("## Purpose");
      expect(content).toContain("Think hard");
      expect(content).toContain("## Report");
      expect(content).toContain("$ARGUMENTS");
    });
  });

  describe("settings.local.json", () => {
    it("exists with valid JSON", async () => {
      const settingsPath = path.join(claudeDir, "settings.local.json");
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings).toHaveProperty("permissions");
      expect(settings.permissions).toHaveProperty("allow");
      expect(Array.isArray(settings.permissions.allow)).toBe(true);
    });

    it("has Gimli-specific allow rules", async () => {
      const settingsPath = path.join(claudeDir, "settings.local.json");
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      const allowRules = settings.permissions.allow;
      expect(allowRules).toContain("Bash(pnpm test:*)");
      expect(allowRules).toContain("Bash(pnpm build:*)");
      expect(allowRules).toContain("Bash(gimli doctor:*)");
    });

    it("has security deny rules", async () => {
      const settingsPath = path.join(claudeDir, "settings.local.json");
      const content = await fs.readFile(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      expect(settings.permissions).toHaveProperty("deny");
      const denyRules = settings.permissions.deny;
      expect(denyRules).toContain("Bash(rm -rf:*)");
      expect(denyRules).toContain("Bash(git push --force:*)");
      expect(denyRules).toContain("Bash(npm publish:*)");
    });
  });
});
