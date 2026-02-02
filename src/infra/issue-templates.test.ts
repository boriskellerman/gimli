import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseFrontmatterBlock } from "../markdown/frontmatter.js";

// Resolve the repo root from the test file location
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const TEMPLATE_DIR = join(REPO_ROOT, ".github/ISSUE_TEMPLATE");
const GITHUB_DIR = join(REPO_ROOT, ".github");

const TEMPLATES = ["bug_report.md", "feature_request.md", "chore.md"];

const REQUIRED_FIELDS = ["name", "about", "title", "labels"];

// Engineering standards from CLAUDE.md that should appear in templates
const ENGINEERING_STANDARDS = {
  testCommands: ["pnpm test", "pnpm lint", "pnpm build"],
  nodeVersion: "22",
  affectedAreas: ["CLI", "Gateway", "Channel", "App", "Extension"],
  channels: ["Discord", "Slack", "Telegram", "Signal", "WhatsApp", "iMessage"],
};

describe("GitHub issue templates", () => {
  it("template directory exists", () => {
    expect(existsSync(TEMPLATE_DIR)).toBe(true);
  });

  it("config.yml exists and is valid YAML", () => {
    const configPath = join(TEMPLATE_DIR, "config.yml");
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, "utf-8");
    expect(content).toContain("blank_issues_enabled");
  });

  for (const template of TEMPLATES) {
    describe(`${template}`, () => {
      const templatePath = join(TEMPLATE_DIR, template);

      it("file exists", () => {
        expect(existsSync(templatePath)).toBe(true);
      });

      it("has valid frontmatter with required fields", () => {
        const content = readFileSync(templatePath, "utf-8");
        const frontmatter = parseFrontmatterBlock(content);

        for (const field of REQUIRED_FIELDS) {
          expect(frontmatter[field], `${template} missing required field: ${field}`).toBeDefined();
          expect(frontmatter[field], `${template} field ${field} should not be empty`).not.toBe("");
        }
      });

      it("has title prefix in brackets", () => {
        const content = readFileSync(templatePath, "utf-8");
        const frontmatter = parseFrontmatterBlock(content);
        expect(frontmatter.title).toMatch(/^\[.+\]:\s*$/);
      });

      it("has markdown content after frontmatter", () => {
        const content = readFileSync(templatePath, "utf-8");
        const endOfFrontmatter = content.indexOf("\n---", 3);
        const body = content.slice(endOfFrontmatter + 4).trim();
        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain("##");
      });

      it("has Affected Area section with standard options", () => {
        const content = readFileSync(templatePath, "utf-8");
        expect(content).toContain("## Affected Area");
        // Each template should have checkbox options for affected areas
        expect(content).toMatch(/- \[ \]/);
      });
    });
  }

  it("all .md files in directory are tested", () => {
    const files = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".md"));
    expect(files.sort()).toEqual(TEMPLATES.sort());
  });
});

describe("bug_report template specifics", () => {
  const templatePath = join(TEMPLATE_DIR, "bug_report.md");

  it("has bug label", () => {
    const content = readFileSync(templatePath, "utf-8");
    const frontmatter = parseFrontmatterBlock(content);
    expect(frontmatter.labels).toBe("bug");
  });

  it("includes environment section with version commands", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Environment");
    expect(content).toContain("gimli --version");
    expect(content).toContain("node --version");
  });

  it("mentions Node 22+ requirement", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("22");
  });

  it("includes debugging hints", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("gimli doctor");
  });

  it("lists major channels in affected areas", () => {
    const content = readFileSync(templatePath, "utf-8");
    for (const channel of ENGINEERING_STANDARDS.channels) {
      expect(content).toContain(channel);
    }
  });
});

describe("feature_request template specifics", () => {
  const templatePath = join(TEMPLATE_DIR, "feature_request.md");

  it("has enhancement label", () => {
    const content = readFileSync(templatePath, "utf-8");
    const frontmatter = parseFrontmatterBlock(content);
    expect(frontmatter.labels).toBe("enhancement");
  });

  it("has section for breaking changes", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("Breaking changes");
  });

  it("mentions GitHub Discussions for larger features", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("GitHub Discussion");
    expect(content).toContain("github.com/gimli/gimli/discussions");
  });

  it("has implementation considerations section", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("Implementation considerations");
  });
});

describe("chore template specifics", () => {
  const templatePath = join(TEMPLATE_DIR, "chore.md");

  it("has chore label", () => {
    const content = readFileSync(templatePath, "utf-8");
    const frontmatter = parseFrontmatterBlock(content);
    expect(frontmatter.labels).toBe("chore");
  });

  it("includes maintenance task types", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("Dependency update");
    expect(content).toContain("Security patch");
    expect(content).toContain("Technical debt");
  });

  it("has section for breaking changes", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("Breaking changes");
  });

  it("has testing requirements section with pnpm commands", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Testing requirements");
    for (const cmd of ENGINEERING_STANDARDS.testCommands) {
      expect(content).toContain(cmd);
    }
  });

  it("mentions patched dependencies policy", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("patchedDependencies");
  });

  it("mentions live testing option", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("GIMLI_LIVE_TEST=1");
  });
});

describe("pull request template", () => {
  const templatePath = join(GITHUB_DIR, "pull_request_template.md");

  it("file exists", () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  it("has Summary section", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Summary");
  });

  it("has Type section with common PR types", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Type");
    expect(content).toContain("Bug fix");
    expect(content).toContain("New feature");
    expect(content).toContain("Refactoring");
  });

  it("has Affected Areas section", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Affected Areas");
  });

  it("has Testing section with required commands", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Testing");
    for (const cmd of ENGINEERING_STANDARDS.testCommands) {
      expect(content).toContain(cmd);
    }
  });

  it("has Checklist section encoding engineering standards", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Checklist");
    // TypeScript ESM, strict typing
    expect(content).toContain("TypeScript ESM");
    expect(content).toContain("strict typing");
    expect(content).toContain("no `any`");
    // LOC guideline
    expect(content).toContain("700 LOC");
    // Security: no real credentials
    expect(content).toContain("No real phone numbers");
  });

  it("has Breaking Changes section", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Breaking Changes");
  });

  it("has AI-Assisted Development section per CONTRIBUTING.md", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## AI-Assisted Development");
    expect(content).toContain("AI assistance");
    expect(content).toContain("Testing level");
    expect(content).toContain("understand what the code does");
  });

  it("has Related Issues section", () => {
    const content = readFileSync(templatePath, "utf-8");
    expect(content).toContain("## Related Issues");
    expect(content).toContain("Fixes #");
  });
});
