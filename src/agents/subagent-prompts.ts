/**
 * Sub-Agent Prompt Loader
 *
 * Loads and validates TAC Grade 2 sub-agent prompts from the ralphy/subagents directory.
 * These prompts are used for domain-specific task delegation.
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUBAGENTS_DIR = join(__dirname, "../../ralphy/subagents");

/** Available sub-agent domains */
export type SubagentDomain = "frontend" | "backend" | "gateway" | "channels";

/** Structure of a sub-agent prompt */
export interface SubagentPrompt {
  domain: SubagentDomain;
  title: string;
  description: string;
  content: string;
}

/** Required sections in a sub-agent prompt */
export const REQUIRED_SECTIONS = [
  "Identity",
  "Domain Knowledge",
  "Responsibilities",
  "Constraints",
  "Code Style",
  "When to Escalate",
  "Output Format",
] as const;

/**
 * Load a sub-agent prompt by domain.
 */
export async function loadSubagentPrompt(domain: SubagentDomain): Promise<SubagentPrompt> {
  const filePath = join(SUBAGENTS_DIR, `${domain}.md`);
  const content = await readFile(filePath, "utf-8");

  // Parse title from first line
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch?.[1] ?? `${domain} Sub-Agent`;

  // Parse description from first blockquote
  const descMatch = content.match(/^> (.+)$/m);
  const description = descMatch?.[1] ?? "";

  return {
    domain,
    title,
    description,
    content,
  };
}

/**
 * Load all sub-agent prompts.
 */
export async function loadAllSubagentPrompts(): Promise<Map<SubagentDomain, SubagentPrompt>> {
  const domains: SubagentDomain[] = ["frontend", "backend", "gateway", "channels"];
  const prompts = new Map<SubagentDomain, SubagentPrompt>();

  for (const domain of domains) {
    const prompt = await loadSubagentPrompt(domain);
    prompts.set(domain, prompt);
  }

  return prompts;
}

/**
 * Validate that a sub-agent prompt contains all required sections.
 */
export function validatePromptSections(content: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(`## ${section}`)) {
      missing.push(section);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Build a task prompt for a sub-agent.
 *
 * Combines the sub-agent's base prompt with a specific task.
 */
export function buildTaskPrompt(prompt: SubagentPrompt, task: string): string {
  return `${prompt.content}\n\n---\n\n## Your Task\n\n${task}`;
}
