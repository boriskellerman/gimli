import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ralphyTemplatesDir = join(__dirname, "../../ralphy/templates");

describe("Feature Template", () => {
  let templateContent: string;
  let workflowContent: string;

  beforeAll(() => {
    const templatePath = join(ralphyTemplatesDir, "FEATURE-TEMPLATE.md");
    const workflowPath = join(ralphyTemplatesDir, "FEATURE-WORKFLOW.md");

    expect(existsSync(templatePath)).toBe(true);
    expect(existsSync(workflowPath)).toBe(true);

    templateContent = readFileSync(templatePath, "utf-8");
    workflowContent = readFileSync(workflowPath, "utf-8");
  });

  describe("FEATURE-TEMPLATE.md structure", () => {
    it("has YAML frontmatter with required fields", () => {
      expect(templateContent).toMatch(/^---\n/);
      expect(templateContent).toMatch(/title:/);
      expect(templateContent).toMatch(/type:\s*feature/);
      expect(templateContent).toMatch(/status:/);
      expect(templateContent).toMatch(/owner:/);
      expect(templateContent).toMatch(/security_reviewed:/);
    });

    it("contains all 10 required sections", () => {
      const requiredSections = [
        "## 1. Context & Motivation",
        "## 2. Scope",
        "## 3. Security Analysis",
        "## 4. Design",
        "## 5. Implementation Plan",
        "## 6. Testing Strategy",
        "## 7. Documentation",
        "## 8. Rollback Plan",
        "## 9. Post-Launch",
        "## 10. Changelog Entry",
      ];

      for (const section of requiredSections) {
        expect(templateContent).toContain(section);
      }
    });

    it("has Context section with required subsections", () => {
      expect(templateContent).toContain("### Why Now?");
      expect(templateContent).toContain("### Current State");
      expect(templateContent).toContain("### Success Criteria");
    });

    it("has Scope section with Goals and Non-Goals", () => {
      expect(templateContent).toContain("### Goals");
      expect(templateContent).toContain("### Non-Goals");
      expect(templateContent).toContain("### Dependencies");
    });

    it("has comprehensive Security Analysis section", () => {
      expect(templateContent).toContain("### Trust Boundaries Affected");
      expect(templateContent).toContain("### Security Checklist");
      expect(templateContent).toContain("### Risk Assessment");

      // Verify security checklist items cover key concerns
      expect(templateContent).toContain("credentials exposed in logs");
      expect(templateContent).toContain("external inputs validated");
      expect(templateContent).toContain("restrictive permissions");
      expect(templateContent).toContain("command injection");
      expect(templateContent).toContain("Zod");
    });

    it("has Design section with architecture and API details", () => {
      expect(templateContent).toContain("### Architecture Overview");
      expect(templateContent).toContain("### Key Design Decisions");
      expect(templateContent).toContain("### API / Interface Changes");
    });

    it("has Implementation Plan with all phases", () => {
      expect(templateContent).toContain("### Phase 1: Scout");
      expect(templateContent).toContain("### Phase 2: Plan");
      expect(templateContent).toContain("### Phase 3: Build");
      expect(templateContent).toContain("### Phase 4: Test");
      expect(templateContent).toContain("### Phase 5: Review");
      expect(templateContent).toContain("### Phase 6: Deploy");
    });

    it("has Testing Strategy with unit, integration, and edge cases", () => {
      expect(templateContent).toContain("### Unit Tests");
      expect(templateContent).toContain("### Integration Tests");
      expect(templateContent).toContain("### Manual Verification");
      expect(templateContent).toContain("### Edge Cases");
    });

    it("has Documentation checklist", () => {
      expect(templateContent).toContain("### User-Facing Docs");
      expect(templateContent).toContain("### Developer Docs");
      expect(templateContent).toContain("### Docs Links");
    });

    it("has Rollback Plan section", () => {
      expect(templateContent).toContain("### How to Revert");
      expect(templateContent).toContain("git revert");
      expect(templateContent).toContain("### Feature Flag");
    });

    it("has Post-Launch monitoring and metrics", () => {
      expect(templateContent).toContain("### Monitoring");
      expect(templateContent).toContain("### Success Metrics");
      expect(templateContent).toContain("### Known Limitations");
      expect(templateContent).toContain("### Follow-up Tasks");
    });

    it("references Gimli-specific patterns", () => {
      // Security-first
      expect(templateContent).toContain("Gimli is security-hardened");

      // Trust boundaries from ARCHITECTURE.md
      expect(templateContent).toContain("Gateway");
      expect(templateContent).toContain("Agent runtime");
      expect(templateContent).toContain("Tool system");
      expect(templateContent).toContain("Sandbox");

      // Gimli conventions
      expect(templateContent).toContain("gimli.json");
    });
  });

  describe("FEATURE-WORKFLOW.md structure", () => {
    it("has YAML frontmatter", () => {
      expect(workflowContent).toMatch(/^---\n/);
      expect(workflowContent).toMatch(/title:/);
      expect(workflowContent).toMatch(/type:\s*workflow/);
    });

    it("documents all five phases", () => {
      expect(workflowContent).toContain("## Phase 1: Scout");
      expect(workflowContent).toContain("## Phase 2: Plan");
      expect(workflowContent).toContain("## Phase 3: Build");
      expect(workflowContent).toContain("## Phase 4: Test");
      expect(workflowContent).toContain("## Phase 5: Review");
    });

    it("includes quick reference ASCII diagram", () => {
      expect(workflowContent).toContain("FEATURE DEVELOPMENT PHASES");
      expect(workflowContent).toContain("SCOUT");
      expect(workflowContent).toContain("PLAN");
      expect(workflowContent).toContain("BUILD");
      expect(workflowContent).toContain("TEST");
      expect(workflowContent).toContain("REVIEW");
    });

    it("includes validation gate checklist", () => {
      expect(workflowContent).toContain("## Validation Gate");
      expect(workflowContent).toContain("pnpm lint && pnpm build && pnpm test");
    });

    it("documents Gimli-specific conventions", () => {
      expect(workflowContent).toContain("## Gimli-Specific Conventions");
      expect(workflowContent).toContain("src/cli/progress.ts");
      expect(workflowContent).toContain("src/terminal/table.ts");
      expect(workflowContent).toContain("src/terminal/palette.ts");
      expect(workflowContent).toContain("createDefaultDeps");
    });

    it("includes quick commands reference", () => {
      expect(workflowContent).toContain("## Quick Commands Reference");
      expect(workflowContent).toContain("pnpm install");
      expect(workflowContent).toContain("pnpm build");
      expect(workflowContent).toContain("pnpm test");
      expect(workflowContent).toContain("pnpm lint");
    });

    it("documents anti-patterns to avoid", () => {
      expect(workflowContent).toContain("## Anti-Patterns to Avoid");
    });

    it("references TAC principles", () => {
      expect(workflowContent).toContain("## TAC Integration");
      expect(workflowContent).toContain("Template Engineering");
      expect(workflowContent).toContain("Feedback Loops");
      expect(workflowContent).toContain("One Agent, One Purpose");
    });

    it("includes security requirements in Build phase", () => {
      expect(workflowContent).toContain("### Security Requirements");
      expect(workflowContent).toContain("No credentials in logs");
      expect(workflowContent).toContain("All inputs validated via Zod");
      expect(workflowContent).toContain("command injection");
    });

    it("includes test coverage requirements", () => {
      expect(workflowContent).toContain("### Test Coverage Requirements");
      expect(workflowContent).toContain("70%");
    });
  });

  describe("Template consistency", () => {
    it("both files reference the same phases", () => {
      const templatePhases = ["Scout", "Plan", "Build", "Test", "Review"];
      for (const phase of templatePhases) {
        expect(templateContent).toContain(phase);
        expect(workflowContent).toContain(phase);
      }
    });

    it("both files have consistent security emphasis", () => {
      // Both should mention Zod for validation
      expect(templateContent).toContain("Zod");
      expect(workflowContent).toContain("Zod");

      // Both should mention credentials security
      expect(templateContent.toLowerCase()).toContain("credential");
      expect(workflowContent.toLowerCase()).toContain("credential");
    });

    it("workflow references the template", () => {
      expect(workflowContent).toContain("FEATURE-TEMPLATE.md");
    });
  });
});

describe("Feature Template Usage", () => {
  it("can be used as a starting point for new features", () => {
    const templatePath = join(ralphyTemplatesDir, "FEATURE-TEMPLATE.md");
    const content = readFileSync(templatePath, "utf-8");

    // Template has placeholder markers for customization
    expect(content).toContain("[FEATURE-NAME]");
    expect(content).toContain("YYYY-MM-DD");
    expect(content).toContain("[agent-name or human]");

    // Has example/placeholder content in tables
    expect(content).toContain("Example:");
    expect(content).toContain("Decision 1");
    expect(content).toContain("Risk");
    expect(content).toContain("Mitigation");
  });

  it("provides clear guidance on each section", () => {
    const templatePath = join(ralphyTemplatesDir, "FEATURE-TEMPLATE.md");
    const content = readFileSync(templatePath, "utf-8");

    // Each major section has explanatory text
    expect(content).toContain("Explain the trigger");
    expect(content).toContain("What this feature WILL accomplish");
    expect(content).toContain("What this feature will NOT address");
    expect(content).toContain("Every feature must pass security review");
  });
});
