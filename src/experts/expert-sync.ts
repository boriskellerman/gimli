/**
 * Expert Sync - Self-improvement mechanism for Agent Experts
 *
 * TAC Pattern: Act -> Learn -> Reuse
 *
 * This module helps keep expertise YAML files in sync with the actual codebase.
 * Agents can use this to detect when their mental models have drifted from reality.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface ExpertMetadata {
  version: string;
  expert: string;
  domain: string;
  updated_at: string;
}

export interface SourceFileInfo {
  path: string;
  hash: string;
  mtime: number;
  exists: boolean;
}

export interface SyncCheckResult {
  expert: string;
  isStale: boolean;
  lastUpdated: string;
  sourceFiles: SourceFileInfo[];
  staleSources: string[];
  missingSources: string[];
  recommendations: string[];
}

/**
 * Configuration for an expert's source files
 */
export interface ExpertConfig {
  yamlPath: string;
  sourceFiles: string[];
}

/**
 * Get the hash of a file's contents
 */
export function getFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  const content = fs.readFileSync(filePath, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Load an expert YAML file and parse its metadata
 */
export function loadExpertYaml(yamlPath: string): {
  metadata: ExpertMetadata;
  content: Record<string, unknown>;
} | null {
  if (!fs.existsSync(yamlPath)) {
    return null;
  }

  const content = fs.readFileSync(yamlPath, "utf-8");
  const parsed = parseYaml(content) as Record<string, unknown>;

  // Extract metadata with safe type coercion
  const version = typeof parsed["version"] === "string" ? parsed["version"] : "1.0";
  const expert = typeof parsed["expert"] === "string" ? parsed["expert"] : "unknown";
  const domain = typeof parsed["domain"] === "string" ? parsed["domain"] : "unknown";
  const updated_at =
    typeof parsed["updated_at"] === "string" ? parsed["updated_at"] : new Date().toISOString();

  return {
    metadata: { version, expert, domain, updated_at },
    content: parsed,
  };
}

/**
 * Check if an expert's mental model is stale compared to source files
 */
export function checkExpertSync(config: ExpertConfig, baseDir: string): SyncCheckResult {
  const fullYamlPath = path.join(baseDir, config.yamlPath);
  const expert = loadExpertYaml(fullYamlPath);
  const expertName = expert?.metadata.expert || path.basename(config.yamlPath, ".yaml");

  const sourceFiles: SourceFileInfo[] = config.sourceFiles.map((relativePath) => {
    const fullPath = path.join(baseDir, relativePath);
    const exists = fs.existsSync(fullPath);
    return {
      path: relativePath,
      hash: exists ? getFileHash(fullPath) : "",
      mtime: exists ? fs.statSync(fullPath).mtimeMs : 0,
      exists,
    };
  });

  // Get the expert's last updated timestamp
  const lastUpdated = expert?.metadata.updated_at || "";
  const lastUpdatedMs = lastUpdated ? new Date(lastUpdated).getTime() : 0;

  // Find stale sources (modified after expert was updated)
  const staleSources = sourceFiles
    .filter((sf) => sf.exists && sf.mtime > lastUpdatedMs)
    .map((sf) => sf.path);

  // Find missing sources
  const missingSources = sourceFiles.filter((sf) => !sf.exists).map((sf) => sf.path);

  const isStale = staleSources.length > 0 || missingSources.length > 0;

  const recommendations: string[] = [];
  if (staleSources.length > 0) {
    recommendations.push(`Review changes in: ${staleSources.join(", ")}`);
    recommendations.push("Update the expert YAML to reflect any schema or pattern changes");
  }
  if (missingSources.length > 0) {
    recommendations.push(`Source files not found: ${missingSources.join(", ")}`);
    recommendations.push("Verify file paths or update expert config if files were moved");
  }
  if (!isStale) {
    recommendations.push("Expert mental model appears up-to-date");
  }

  return {
    expert: expertName,
    isStale,
    lastUpdated,
    sourceFiles,
    staleSources,
    missingSources,
    recommendations,
  };
}

/**
 * Generate a resync prompt for an expert
 */
export function generateResyncPrompt(checkResult: SyncCheckResult, _baseDir: string): string {
  const { expert, staleSources, missingSources } = checkResult;

  let prompt = `# Expert Resync: ${expert}\n\n`;
  prompt += `The ${expert} expert's mental model may be out of sync with the codebase.\n\n`;

  if (staleSources.length > 0) {
    prompt += `## Modified Source Files\n\n`;
    prompt += `The following files have been modified since the expert was last updated:\n\n`;
    for (const file of staleSources) {
      prompt += `- \`${file}\`\n`;
    }
    prompt += `\n`;
  }

  if (missingSources.length > 0) {
    prompt += `## Missing Source Files\n\n`;
    prompt += `The following monitored files no longer exist:\n\n`;
    for (const file of missingSources) {
      prompt += `- \`${file}\`\n`;
    }
    prompt += `\n`;
  }

  prompt += `## Resync Instructions\n\n`;
  prompt += `1. Review the modified files for changes to:\n`;
  prompt += `   - Database schemas and table definitions\n`;
  prompt += `   - Access patterns and data flows\n`;
  prompt += `   - New stores or persistence mechanisms\n`;
  prompt += `   - Migration strategies\n`;
  prompt += `   - Performance or security improvements\n\n`;
  prompt += `2. Update the expert YAML file at \`experts/${expert}-expert.yaml\`\n\n`;
  prompt += `3. Update the \`updated_at\` field to the current timestamp\n\n`;
  prompt += `4. If files were moved or renamed, update the \`self_improve.source_files_to_monitor\` list\n`;

  return prompt;
}

/**
 * Update the timestamp in an expert YAML file
 */
export function touchExpert(yamlPath: string): boolean {
  const expert = loadExpertYaml(yamlPath);
  if (!expert) {
    return false;
  }

  expert.content["updated_at"] = new Date().toISOString();
  const yaml = stringifyYaml(expert.content, { lineWidth: 100 });
  fs.writeFileSync(yamlPath, yaml, "utf-8");
  return true;
}

/**
 * Database Expert configuration
 */
export const DATABASE_EXPERT_CONFIG: ExpertConfig = {
  yamlPath: "experts/database-expert.yaml",
  sourceFiles: [
    "src/infra/sessions-store.ts",
    "src/infra/memory-index.ts",
    "src/infra/reminder-store.ts",
    "src/infra/auth-profiles-store.ts",
    "src/infra/encrypted-store.ts",
    "src/infra/file-locking.ts",
    "src/infra/state-migrations.ts",
  ],
};

/**
 * All registered expert configurations
 */
export const EXPERT_CONFIGS: Record<string, ExpertConfig> = {
  database: DATABASE_EXPERT_CONFIG,
  // Future experts can be added here:
  // gateway: GATEWAY_EXPERT_CONFIG,
  // security: SECURITY_EXPERT_CONFIG,
  // channel: CHANNEL_EXPERT_CONFIG,
};

/**
 * Check sync status for all registered experts
 */
export function checkAllExperts(baseDir: string): SyncCheckResult[] {
  return Object.values(EXPERT_CONFIGS).map((config) => checkExpertSync(config, baseDir));
}
