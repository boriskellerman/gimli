import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PROMPTS_DIR = path.join(process.cwd(), "ralphy", "prompts");

/**
 * Required sections for a closed-loop prompt following the
 * Request → Validate → Resolve pattern.
 */
const REQUIRED_SECTIONS = ["Request Phase", "Validate Phase", "Resolve Phase"];

/**
 * Required subsections that make the pattern actionable.
 * For Validate Phase, we accept either generic "Acceptance Criteria"
 * or domain-specific variants like "Review Quality Criteria".
 */
const REQUIRED_SUBSECTIONS = {
  "Request Phase": ["Input Schema", "Context Requirements"],
  // Acceptance criteria can be named contextually (e.g., "Review Quality Criteria")
  "Validate Phase": [],
  "Resolve Phase": ["Self-Correction Rules", "Iteration Tracking"],
};

/**
 * Validate Phase must have criteria - either generic or domain-specific.
 */
const ACCEPTANCE_CRITERIA_PATTERNS = [
  "### Acceptance Criteria",
  "### Review Quality Criteria",
  "### Documentation Quality Criteria",
  "Quality Criteria",
];

// Note: max_iterations and target parameters are verified in individual tests below

describe("closed-loop-prompts", () => {
  it("prompts directory exists", async () => {
    const files = await readdir(PROMPTS_DIR).catch(() => []);
    expect(files.length).toBeGreaterThan(0);
  });

  describe("prompt structure validation", () => {
    const promptFiles = [
      "testing-closed-loop.md",
      "reviewing-closed-loop.md",
      "documenting-closed-loop.md",
    ];

    for (const filename of promptFiles) {
      describe(filename, () => {
        let content: string;

        it("file exists and is readable", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");
          expect(content.length).toBeGreaterThan(100);
        });

        it("has all required sections", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          for (const section of REQUIRED_SECTIONS) {
            expect(content.includes(`## ${section}`), `Missing section: ${section}`).toBe(true);
          }
        });

        it("has required subsections", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          for (const [section, subsections] of Object.entries(REQUIRED_SUBSECTIONS)) {
            for (const subsection of subsections) {
              expect(
                content.includes(`### ${subsection}`),
                `Missing subsection '${subsection}' in ${section}`,
              ).toBe(true);
            }
          }

          // Validate Phase must have acceptance/quality criteria (can be named contextually)
          const hasAcceptanceCriteria = ACCEPTANCE_CRITERIA_PATTERNS.some((pattern) =>
            content.includes(pattern),
          );
          expect(
            hasAcceptanceCriteria,
            "Missing acceptance/quality criteria in Validate Phase",
          ).toBe(true);
        });

        it("defines iteration limits", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          expect(content.includes("max_iterations"), "Missing max_iterations parameter").toBe(true);
        });

        it("defines target parameter", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          expect(content.includes("target:"), "Missing target parameter definition").toBe(true);
        });

        it("includes example usage", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          expect(
            content.includes("## Example Usage") || content.includes("### Example"),
            "Missing example usage section",
          ).toBe(true);
        });

        it("includes output format", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          expect(
            content.includes("## Output Format") || content.includes("### Output"),
            "Missing output format section",
          ).toBe(true);
        });

        it("references validation pass/fail criteria", async () => {
          const filepath = path.join(PROMPTS_DIR, filename);
          content = await readFile(filepath, "utf-8");

          // Should have explicit pass/fail conditions
          const hasPassCriteria =
            content.toLowerCase().includes("pass") && content.toLowerCase().includes("fail");
          expect(hasPassCriteria, "Missing explicit pass/fail criteria").toBe(true);
        });
      });
    }
  });

  describe("README documentation", () => {
    it("README exists and documents the pattern", async () => {
      const readmePath = path.join(PROMPTS_DIR, "README.md");
      const content = await readFile(readmePath, "utf-8");

      expect(content.includes("Request")).toBe(true);
      expect(content.includes("Validate")).toBe(true);
      expect(content.includes("Resolve")).toBe(true);
    });

    it("README lists all prompt files", async () => {
      const readmePath = path.join(PROMPTS_DIR, "README.md");
      const content = await readFile(readmePath, "utf-8");

      expect(content.includes("testing-closed-loop.md")).toBe(true);
      expect(content.includes("reviewing-closed-loop.md")).toBe(true);
      expect(content.includes("documenting-closed-loop.md")).toBe(true);
    });
  });

  describe("prompt content quality", () => {
    it("testing prompt includes coverage validation", async () => {
      const filepath = path.join(PROMPTS_DIR, "testing-closed-loop.md");
      const content = await readFile(filepath, "utf-8");

      expect(content.includes("coverage")).toBe(true);
      expect(content.includes("pnpm test")).toBe(true);
    });

    it("reviewing prompt includes specificity requirements", async () => {
      const filepath = path.join(PROMPTS_DIR, "reviewing-closed-loop.md");
      const content = await readFile(filepath, "utf-8");

      expect(content.includes("Specific")).toBe(true);
      expect(content.includes("Actionable")).toBe(true);
      expect(content.includes("Accurate")).toBe(true);
    });

    it("documenting prompt includes accuracy validation", async () => {
      const filepath = path.join(PROMPTS_DIR, "documenting-closed-loop.md");
      const content = await readFile(filepath, "utf-8");

      expect(content.includes("Accurate")).toBe(true);
      expect(content.includes("Complete")).toBe(true);
      expect(content.includes("signature")).toBe(true);
    });
  });
});
