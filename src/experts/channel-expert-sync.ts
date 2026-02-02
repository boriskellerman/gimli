/**
 * Channel Expert Sync - Self-improvement mechanism for Channel Expert
 *
 * TAC Pattern: Act -> Learn -> Reuse
 *
 * This module helps keep channel expertise YAML files in sync with the actual codebase.
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
  skillPath: string;
  expertiseFiles: string[];
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
 * Load an expertise YAML file and parse its metadata
 */
export function loadExpertiseYaml(yamlPath: string): {
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
  // Find oldest expertise file update
  let oldestUpdate = Infinity;
  let lastUpdated = "";

  for (const expertiseFile of config.expertiseFiles) {
    const fullPath = path.join(baseDir, expertiseFile);
    const expert = loadExpertiseYaml(fullPath);
    if (expert) {
      const updateMs = new Date(expert.metadata.updated_at).getTime();
      if (updateMs < oldestUpdate) {
        oldestUpdate = updateMs;
        lastUpdated = expert.metadata.updated_at;
      }
    }
  }

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

  // Find stale sources (modified after oldest expertise update)
  const staleSources = sourceFiles
    .filter((sf) => sf.exists && sf.mtime > oldestUpdate)
    .map((sf) => sf.path);

  // Find missing sources
  const missingSources = sourceFiles.filter((sf) => !sf.exists).map((sf) => sf.path);

  const isStale = staleSources.length > 0 || missingSources.length > 0;

  const recommendations: string[] = [];
  if (staleSources.length > 0) {
    recommendations.push(`Review changes in: ${staleSources.join(", ")}`);
    recommendations.push(
      "Update the expertise YAML files to reflect any channel or routing changes",
    );
  }
  if (missingSources.length > 0) {
    recommendations.push(`Source files not found: ${missingSources.join(", ")}`);
    recommendations.push("Verify file paths or update expert config if files were moved");
  }
  if (!isStale) {
    recommendations.push("Channel expert mental model appears up-to-date");
  }

  return {
    expert: "channel",
    isStale,
    lastUpdated,
    sourceFiles,
    staleSources,
    missingSources,
    recommendations,
  };
}

/**
 * Generate a resync prompt for the channel expert
 */
export function generateResyncPrompt(checkResult: SyncCheckResult): string {
  const { staleSources, missingSources } = checkResult;

  let prompt = `# Channel Expert Resync\n\n`;
  prompt += `The channel expert's mental model may be out of sync with the codebase.\n\n`;

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
  prompt += `   - Channel plugin implementations\n`;
  prompt += `   - Routing and session key patterns\n`;
  prompt += `   - Security and DM policy handling\n`;
  prompt += `   - Capabilities and feature flags\n`;
  prompt += `   - New channels or deprecated ones\n\n`;
  prompt += `2. Update the expertise YAML files in \`skills/channel-expert/expertise/\`\n\n`;
  prompt += `3. Update the \`updated_at\` field in each modified YAML\n\n`;
  prompt += `4. If files were moved or renamed, update the source files list\n`;

  return prompt;
}

/**
 * Update the timestamp in expertise YAML files
 */
export function touchExpertise(yamlPath: string): boolean {
  const expert = loadExpertiseYaml(yamlPath);
  if (!expert) {
    return false;
  }

  expert.content["updated_at"] = new Date().toISOString();
  const yaml = stringifyYaml(expert.content, { lineWidth: 100 });
  fs.writeFileSync(yamlPath, yaml, "utf-8");
  return true;
}

/**
 * Channel Expert configuration
 */
export const CHANNEL_EXPERT_CONFIG: ExpertConfig = {
  skillPath: "skills/channel-expert/SKILL.md",
  expertiseFiles: [
    "skills/channel-expert/expertise/architecture.yaml",
    "skills/channel-expert/expertise/channels.yaml",
    "skills/channel-expert/expertise/security.yaml",
    "skills/channel-expert/expertise/troubleshooting.yaml",
  ],
  sourceFiles: [
    "src/channels/registry.ts",
    "src/channels/plugins/types.plugin.ts",
    "src/channels/plugins/types.core.ts",
    "src/channels/plugins/types.adapters.ts",
    "src/routing/resolve-route.ts",
    "src/routing/session-key.ts",
    "src/routing/bindings.ts",
    "docs/channels/index.md",
    "docs/channels/troubleshooting.md",
  ],
};

/**
 * Check sync status for channel expert
 */
export function checkChannelExpert(baseDir: string): SyncCheckResult {
  return checkExpertSync(CHANNEL_EXPERT_CONFIG, baseDir);
}
