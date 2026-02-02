/**
 * Tests for sub-agent prompts - validates structure and content.
 *
 * These prompts are used for TAC Grade 2 sub-agent delegation.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSubagentPrompt,
  loadAllSubagentPrompts,
  validatePromptSections,
  buildTaskPrompt,
  REQUIRED_SECTIONS,
  type SubagentDomain,
} from "./subagent-prompts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUBAGENTS_DIR = join(__dirname, "../../ralphy/subagents");

// Expected sub-agent files
const EXPECTED_SUBAGENTS: SubagentDomain[] = ["frontend", "backend", "gateway", "channels"];

describe("sub-agent prompts", () => {
  let prompts: Map<SubagentDomain, string>;

  beforeAll(async () => {
    prompts = new Map();
    for (const domain of EXPECTED_SUBAGENTS) {
      const content = await readFile(join(SUBAGENTS_DIR, `${domain}.md`), "utf-8");
      prompts.set(domain, content);
    }
  });

  describe("file structure", () => {
    it("all expected sub-agent files exist", async () => {
      const files = await readdir(SUBAGENTS_DIR);
      for (const domain of EXPECTED_SUBAGENTS) {
        expect(files).toContain(`${domain}.md`);
      }
    });

    it("README.md exists and documents all sub-agents", async () => {
      const readme = await readFile(join(SUBAGENTS_DIR, "README.md"), "utf-8");
      expect(readme).toContain("Sub-Agent Prompts");
      for (const domain of EXPECTED_SUBAGENTS) {
        expect(readme.toLowerCase()).toContain(domain);
      }
    });
  });

  describe("prompt structure", () => {
    for (const domain of EXPECTED_SUBAGENTS) {
      describe(domain, () => {
        it("has a title header", () => {
          const content = prompts.get(domain)!;
          expect(content).toMatch(/^# .+ Sub-Agent Prompt/);
        });

        it("has a description blockquote", () => {
          const content = prompts.get(domain)!;
          expect(content).toMatch(/^> .+/m);
        });

        for (const section of REQUIRED_SECTIONS) {
          it(`contains "${section}" section`, () => {
            const content = prompts.get(domain)!;
            expect(content).toContain(`## ${section}`);
          });
        }

        it("has Technology Stack subsection", () => {
          const content = prompts.get(domain)!;
          expect(content).toContain("### Technology Stack");
        });

        it("has Key Directories subsection", () => {
          const content = prompts.get(domain)!;
          expect(content).toContain("### Key Directories");
        });

        it("contains code examples", () => {
          const content = prompts.get(domain)!;
          expect(content).toMatch(/```typescript[\s\S]+```/);
        });
      });
    }
  });

  describe("content quality", () => {
    it("frontend.md mentions Lit and Vite", () => {
      const content = prompts.get("frontend")!;
      expect(content).toContain("Lit");
      expect(content).toContain("Vite");
    });

    it("frontend.md references ui/ directory", () => {
      const content = prompts.get("frontend")!;
      expect(content).toContain("ui/src/ui/");
    });

    it("backend.md mentions agents and providers", () => {
      const content = prompts.get("backend")!;
      expect(content).toContain("src/agents/");
      expect(content).toContain("src/providers/");
    });

    it("backend.md mentions tool schema constraints", () => {
      const content = prompts.get("backend")!;
      expect(content).toContain("Type.Union");
      expect(content).toContain("anyOf");
    });

    it("gateway.md mentions WebSocket and port 18789", () => {
      const content = prompts.get("gateway")!;
      expect(content).toContain("WebSocket");
      expect(content).toContain("18789");
    });

    it("gateway.md references gateway directory", () => {
      const content = prompts.get("gateway")!;
      expect(content).toContain("src/gateway/");
    });

    it("channels.md mentions multiple platforms", () => {
      const content = prompts.get("channels")!;
      expect(content).toContain("WhatsApp");
      expect(content).toContain("Telegram");
      expect(content).toContain("Discord");
      expect(content).toContain("Slack");
    });

    it("channels.md references extensions directory", () => {
      const content = prompts.get("channels")!;
      expect(content).toContain("extensions/");
    });
  });

  describe("cross-references", () => {
    it("each prompt mentions escalation to other domains", () => {
      for (const domain of EXPECTED_SUBAGENTS) {
        const content = prompts.get(domain)!;
        const otherDomains = EXPECTED_SUBAGENTS.filter((d) => d !== domain);

        // At least one other domain should be mentioned in escalation
        const escalationSection = content.split("## When to Escalate")[1]?.split("##")[0] ?? "";
        const mentionsOther = otherDomains.some(
          (d) =>
            escalationSection.toLowerCase().includes(d) || escalationSection.includes("domain"),
        );
        expect(mentionsOther, `${domain} should mention other domains in escalation`).toBe(true);
      }
    });
  });

  describe("testing approach", () => {
    for (const domain of EXPECTED_SUBAGENTS) {
      it(`${domain} includes testing guidance`, () => {
        const content = prompts.get(domain)!;
        expect(content).toContain("## Testing Approach");
        expect(content.toLowerCase()).toMatch(/test/);
      });
    }
  });
});

describe("subagent-prompts module", () => {
  describe("loadSubagentPrompt", () => {
    it("loads frontend prompt", async () => {
      const prompt = await loadSubagentPrompt("frontend");
      expect(prompt.domain).toBe("frontend");
      expect(prompt.title).toContain("Frontend");
      expect(prompt.content).toContain("Lit");
    });

    it("loads backend prompt", async () => {
      const prompt = await loadSubagentPrompt("backend");
      expect(prompt.domain).toBe("backend");
      expect(prompt.title).toContain("Backend");
      expect(prompt.content).toContain("agents");
    });

    it("loads gateway prompt", async () => {
      const prompt = await loadSubagentPrompt("gateway");
      expect(prompt.domain).toBe("gateway");
      expect(prompt.title).toContain("Gateway");
      expect(prompt.content).toContain("WebSocket");
    });

    it("loads channels prompt", async () => {
      const prompt = await loadSubagentPrompt("channels");
      expect(prompt.domain).toBe("channels");
      expect(prompt.title).toContain("Channels");
      expect(prompt.content).toContain("Telegram");
    });
  });

  describe("loadAllSubagentPrompts", () => {
    it("loads all four domains", async () => {
      const prompts = await loadAllSubagentPrompts();
      expect(prompts.size).toBe(4);
      expect(prompts.has("frontend")).toBe(true);
      expect(prompts.has("backend")).toBe(true);
      expect(prompts.has("gateway")).toBe(true);
      expect(prompts.has("channels")).toBe(true);
    });
  });

  describe("validatePromptSections", () => {
    it("returns valid for complete prompt", async () => {
      const prompt = await loadSubagentPrompt("frontend");
      const result = validatePromptSections(prompt.content);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it("returns invalid for incomplete content", () => {
      const result = validatePromptSections("# Test\n## Identity\nSome content");
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });
  });

  describe("buildTaskPrompt", () => {
    it("combines prompt with task", async () => {
      const prompt = await loadSubagentPrompt("frontend");
      const task = "Add a dark mode toggle";
      const result = buildTaskPrompt(prompt, task);

      expect(result).toContain(prompt.content);
      expect(result).toContain("## Your Task");
      expect(result).toContain(task);
    });
  });
});
