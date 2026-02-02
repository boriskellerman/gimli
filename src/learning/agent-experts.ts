/**
 * Agent Experts - TAC Lesson 13 Implementation
 *
 * Loads and queries domain expert knowledge from YAML files.
 * Follows the "Act → Learn → Reuse" pattern to externalize
 * agent knowledge that would otherwise be lost between sessions.
 *
 * Expert files contain:
 * - Mental models (high-level architecture understanding)
 * - Decision patterns (step-by-step guides for common tasks)
 * - Pitfalls (learned mistakes to avoid)
 * - Code references (quick navigation for implementation)
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

/** Expert domain types */
export type ExpertDomain = "security" | "database" | "gateway" | "channel";

/** Decision pattern step */
export interface DecisionStep {
  action: string;
  notes?: string;
}

/** Decision pattern for common tasks */
export interface DecisionPattern {
  name: string;
  steps: string[];
}

/** Common pitfall to avoid */
export interface Pitfall {
  name: string;
  symptom: string;
  cause: string;
  fix: string;
  prevention: string;
}

/** Code reference for navigation */
export interface CodeReference {
  category: string;
  files: Record<string, string>;
}

/** Security layer in the mental model */
export interface SecurityLayer {
  name: string;
  purpose: string;
  mechanisms: string[];
  config_keys?: string[];
  critical_files?: string[];
}

/** Mental model structure */
export interface MentalModel {
  philosophy: string;
  principle: string;
  five_layers?: SecurityLayer[];
}

/** Authentication mode */
export interface AuthMode {
  description: string;
  implementation?: string;
  config?: string;
  recommendation?: string;
  note?: string;
}

/** Credential storage location */
export interface CredentialLocation {
  path: string;
  mode?: string;
  note?: string;
}

/** Full expert knowledge structure */
export interface AgentExpert {
  name: string;
  domain: ExpertDomain;
  version: string;
  updated: string;
  description: string;
  mental_model: MentalModel;
  authentication?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
  sandboxing?: Record<string, unknown>;
  security_audit?: Record<string, unknown>;
  decision_patterns: Record<string, DecisionPattern>;
  pitfalls: Pitfall[];
  code_references: Record<string, Record<string, string>>;
  config_reference?: Record<string, unknown>;
  threat_model?: Record<string, unknown>;
}

/** Query result from expert */
export interface ExpertQueryResult {
  domain: ExpertDomain;
  topic: string;
  relevantContent: string;
  codeReferences: string[];
  relatedPatterns: string[];
}

/** Loaded expert cache */
const expertCache = new Map<ExpertDomain, AgentExpert>();

/** Custom experts directory (for testing) */
let customExpertsDir: string | null = null;

/**
 * Set a custom experts directory (mainly for testing)
 */
export function setExpertsDir(dir: string | null): void {
  customExpertsDir = dir;
}

/**
 * Get the path to the experts directory
 */
export function getExpertsDir(): string {
  if (customExpertsDir) {
    return customExpertsDir;
  }
  // Look for experts in the ralphy directory relative to project root
  return path.join(process.cwd(), "ralphy", "experts");
}

/**
 * Load an expert from YAML file
 */
export async function loadExpert(domain: ExpertDomain): Promise<AgentExpert | null> {
  // Check cache first
  const cached = expertCache.get(domain);
  if (cached) {
    return cached;
  }

  const expertsDir = getExpertsDir();
  const filePath = path.join(expertsDir, `${domain}-expert.yaml`);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const expert = YAML.parse(content) as AgentExpert;

    // Validate required fields
    if (!expert.name || !expert.domain || !expert.mental_model) {
      return null;
    }

    // Cache the loaded expert
    expertCache.set(domain, expert);
    return expert;
  } catch {
    // File doesn't exist or parse error
    return null;
  }
}

/**
 * List all available experts
 */
export async function listExperts(): Promise<ExpertDomain[]> {
  const expertsDir = getExpertsDir();
  const domains: ExpertDomain[] = [];

  try {
    const files = await fs.readdir(expertsDir);
    for (const file of files) {
      if (file.endsWith("-expert.yaml")) {
        const domain = file.replace("-expert.yaml", "") as ExpertDomain;
        domains.push(domain);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return domains;
}

/**
 * Get the mental model for a domain
 */
export async function getMentalModel(domain: ExpertDomain): Promise<MentalModel | null> {
  const expert = await loadExpert(domain);
  return expert?.mental_model ?? null;
}

/**
 * Get decision pattern by name
 */
export async function getDecisionPattern(
  domain: ExpertDomain,
  patternName: string,
): Promise<DecisionPattern | null> {
  const expert = await loadExpert(domain);
  if (!expert?.decision_patterns) {
    return null;
  }

  // Normalize pattern name for lookup (snake_case)
  const normalizedName = patternName.toLowerCase().replace(/[\s-]+/g, "_");
  return expert.decision_patterns[normalizedName] ?? null;
}

/**
 * Get all decision patterns for a domain
 */
export async function listDecisionPatterns(domain: ExpertDomain): Promise<string[]> {
  const expert = await loadExpert(domain);
  if (!expert?.decision_patterns) {
    return [];
  }
  return Object.keys(expert.decision_patterns);
}

/**
 * Get pitfalls for a domain
 */
export async function getPitfalls(domain: ExpertDomain): Promise<Pitfall[]> {
  const expert = await loadExpert(domain);
  return expert?.pitfalls ?? [];
}

/**
 * Get code references for a domain
 */
export async function getCodeReferences(
  domain: ExpertDomain,
  category?: string,
): Promise<Record<string, string>> {
  const expert = await loadExpert(domain);
  if (!expert?.code_references) {
    return {};
  }

  if (category) {
    return expert.code_references[category] ?? {};
  }

  // Flatten all references
  const all: Record<string, string> = {};
  for (const refs of Object.values(expert.code_references)) {
    Object.assign(all, refs);
  }
  return all;
}

/**
 * Query expert knowledge for a specific topic
 */
export async function queryExpert(
  domain: ExpertDomain,
  topic: string,
): Promise<ExpertQueryResult | null> {
  const expert = await loadExpert(domain);
  if (!expert) {
    return null;
  }

  const normalizedTopic = topic.toLowerCase();
  const result: ExpertQueryResult = {
    domain,
    topic,
    relevantContent: "",
    codeReferences: [],
    relatedPatterns: [],
  };

  // Search mental model
  if (expert.mental_model.philosophy.toLowerCase().includes(normalizedTopic)) {
    result.relevantContent += `Philosophy: ${expert.mental_model.philosophy}\n\n`;
  }

  // Search security layers if present
  if (expert.mental_model.five_layers) {
    for (const layer of expert.mental_model.five_layers) {
      if (
        layer.name.toLowerCase().includes(normalizedTopic) ||
        layer.purpose.toLowerCase().includes(normalizedTopic) ||
        layer.mechanisms.some((m) => m.toLowerCase().includes(normalizedTopic))
      ) {
        result.relevantContent += `Layer: ${layer.name}\n`;
        result.relevantContent += `Purpose: ${layer.purpose}\n`;
        result.relevantContent += `Mechanisms: ${layer.mechanisms.join(", ")}\n\n`;
        if (layer.critical_files) {
          result.codeReferences.push(...layer.critical_files);
        }
      }
    }
  }

  // Search decision patterns
  if (expert.decision_patterns) {
    for (const [name, pattern] of Object.entries(expert.decision_patterns)) {
      if (
        name.includes(normalizedTopic) ||
        pattern.steps.some((s) => s.toLowerCase().includes(normalizedTopic))
      ) {
        result.relatedPatterns.push(name);
      }
    }
  }

  // Search pitfalls
  for (const pitfall of expert.pitfalls ?? []) {
    if (
      pitfall.name.toLowerCase().includes(normalizedTopic) ||
      pitfall.symptom.toLowerCase().includes(normalizedTopic) ||
      pitfall.cause.toLowerCase().includes(normalizedTopic)
    ) {
      result.relevantContent += `Pitfall: ${pitfall.name}\n`;
      result.relevantContent += `Symptom: ${pitfall.symptom}\n`;
      result.relevantContent += `Fix: ${pitfall.fix}\n\n`;
    }
  }

  // Get related code references
  const refs = await getCodeReferences(domain);
  for (const [key, file] of Object.entries(refs)) {
    if (key.toLowerCase().includes(normalizedTopic)) {
      result.codeReferences.push(file);
    }
  }

  // Deduplicate code references
  result.codeReferences = [...new Set(result.codeReferences)];

  return result;
}

/**
 * Get the security philosophy and principle
 */
export async function getSecurityPhilosophy(): Promise<{
  philosophy: string;
  principle: string;
} | null> {
  const expert = await loadExpert("security");
  if (!expert?.mental_model) {
    return null;
  }
  return {
    philosophy: expert.mental_model.philosophy,
    principle: expert.mental_model.principle,
  };
}

/**
 * Get authentication guidance for a specific mode
 */
export async function getAuthGuidance(authType: string): Promise<Record<string, unknown> | null> {
  const expert = await loadExpert("security");
  if (!expert?.authentication) {
    return null;
  }

  const normalizedType = authType.toLowerCase().replace(/[\s-]+/g, "_");
  return (expert.authentication as Record<string, Record<string, unknown>>)[normalizedType] ?? null;
}

/**
 * Get sandboxing configuration guidance
 */
export async function getSandboxingGuidance(): Promise<Record<string, unknown> | null> {
  const expert = await loadExpert("security");
  return expert?.sandboxing ?? null;
}

/**
 * Get threat model information
 */
export async function getThreatModel(): Promise<Record<string, unknown> | null> {
  const expert = await loadExpert("security");
  return expert?.threat_model ?? null;
}

/**
 * Clear the expert cache (useful for testing)
 */
export function clearExpertCache(): void {
  expertCache.clear();
}

/**
 * Format expert knowledge as context for an agent prompt
 */
export async function formatExpertContext(
  domain: ExpertDomain,
  topics?: string[],
): Promise<string> {
  const expert = await loadExpert(domain);
  if (!expert) {
    return "";
  }

  const sections: string[] = [];

  // Add mental model
  sections.push(`# ${expert.name} Mental Model`);
  sections.push("");
  sections.push(`**Philosophy:** ${expert.mental_model.philosophy}`);
  sections.push("");
  sections.push(`**Core Principle:** ${expert.mental_model.principle}`);
  sections.push("");

  // Add relevant decision patterns
  if (topics?.length && expert.decision_patterns) {
    sections.push("## Relevant Decision Patterns");
    sections.push("");
    for (const topic of topics) {
      const pattern = await getDecisionPattern(domain, topic);
      if (pattern) {
        sections.push(`### ${pattern.name}`);
        for (let i = 0; i < pattern.steps.length; i++) {
          sections.push(`${i + 1}. ${pattern.steps[i]}`);
        }
        sections.push("");
      }
    }
  }

  // Add pitfalls summary
  const pitfalls = await getPitfalls(domain);
  if (pitfalls.length > 0) {
    sections.push("## Common Pitfalls");
    sections.push("");
    for (const pitfall of pitfalls.slice(0, 5)) {
      sections.push(`- **${pitfall.name}**: ${pitfall.symptom} → ${pitfall.fix}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
