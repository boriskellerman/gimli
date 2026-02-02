/**
 * Expertise Store - YAML-based expertise storage for agents
 *
 * Stores agent expertise in YAML files that can be maintained automatically.
 * Each expert (e.g., "database", "gateway", "security") has its own YAML file
 * containing structured knowledge, mental models, and self-improvement data.
 *
 * Storage location: ~/.gimli/agents/{agentId}/expertise/{expertName}.yaml
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";

const EXPERTISE_DIR = "expertise";
const CURRENT_VERSION = 1;

/**
 * A piece of knowledge an expert maintains
 */
export interface ExpertKnowledge {
  /** Short title for the knowledge item */
  title: string;
  /** Brief summary of what this knowledge covers */
  summary: string;
  /** Detailed explanation or notes */
  details?: string;
  /** When this knowledge was last updated */
  lastUpdated: string;
  /** Confidence level 0-1 */
  confidence: number;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * A component in the expert's mental model
 */
export interface MentalModelComponent {
  /** Component name (e.g., class name, module name) */
  component: string;
  /** What this component does */
  description: string;
  /** Key patterns or behaviors to remember */
  patterns: string[];
  /** Related file paths */
  relatedFiles?: string[];
}

/**
 * A common issue the expert knows how to handle
 */
export interface CommonIssue {
  /** Brief description of the issue */
  issue: string;
  /** Root cause or why it happens */
  cause: string;
  /** How to resolve it */
  solution: string;
  /** References to relevant code or docs */
  links?: string[];
}

/**
 * A file reference with context
 */
export interface RelatedFile {
  /** Path to the file */
  path: string;
  /** Importance score 1-10 */
  importance: number;
  /** Why this file matters */
  reason: string;
}

/**
 * Self-improvement tracking data
 */
export interface SelfImprovement {
  /** When expertise was last synced with code */
  lastSync: string;
  /** Sources used for knowledge updates */
  sources: SyncSource[];
  /** Updates that need to be applied */
  pendingUpdates: string[];
  /** History of sync operations */
  syncHistory?: SyncHistoryEntry[];
}

/**
 * A source used for syncing expertise
 */
export interface SyncSource {
  /** Type of source */
  type: "code_audit" | "conversation_analysis" | "documentation" | "manual";
  /** Number of files checked (for code_audit) */
  filesChecked?: number;
  /** Number of changes detected */
  changesDetected?: number;
  /** When this source was last consulted */
  lastConsulted?: string;
}

/**
 * A history entry for sync operations
 */
export interface SyncHistoryEntry {
  /** When the sync occurred */
  timestamp: string;
  /** What triggered the sync */
  trigger: "scheduled" | "manual" | "code_change" | "conversation";
  /** Summary of what changed */
  summary: string;
  /** Number of knowledge items updated */
  itemsUpdated: number;
}

/**
 * Full expertise configuration for an agent expert
 */
export interface ExpertiseConfig {
  /** Schema version */
  version: number;
  /** Expert metadata */
  expert: {
    /** Display name */
    name: string;
    /** Expert's role description */
    role: string;
    /** Areas of expertise */
    expertiseAreas: string[];
    /** When this expert was created */
    createdAt: string;
    /** When this expert was last updated */
    lastUpdated: string;
  };
  /** Key knowledge items */
  keyKnowledge: ExpertKnowledge[];
  /** Mental model components */
  mentalModel: MentalModelComponent[];
  /** Common issues and solutions */
  commonIssues: CommonIssue[];
  /** Related files */
  relatedFiles: RelatedFile[];
  /** Self-improvement data */
  selfImprovement: SelfImprovement;
}

/**
 * Options for creating a new expertise config
 */
export interface CreateExpertiseOptions {
  name: string;
  role: string;
  expertiseAreas: string[];
}

/**
 * Update options for expertise
 */
export interface ExpertiseUpdate {
  /** Add new knowledge items */
  addKnowledge?: Omit<ExpertKnowledge, "lastUpdated">[];
  /** Update existing knowledge by title */
  updateKnowledge?: { title: string; updates: Partial<Omit<ExpertKnowledge, "title">> }[];
  /** Add mental model components */
  addComponents?: MentalModelComponent[];
  /** Add common issues */
  addIssues?: CommonIssue[];
  /** Add related files */
  addFiles?: RelatedFile[];
  /** Add pending updates for self-improvement */
  addPendingUpdates?: string[];
  /** Mark pending updates as complete */
  completePendingUpdates?: string[];
}

/**
 * Sync report returned after expertise sync
 */
export interface ExpertiseSyncReport {
  expertName: string;
  timestamp: string;
  filesChecked: number;
  changesDetected: number;
  knowledgeUpdated: number;
  pendingUpdatesAdded: string[];
  summary: string;
}

/**
 * Resolve the expertise directory for an agent
 */
export function resolveExpertiseDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, EXPERTISE_DIR);
}

/**
 * Resolve the path to a specific expertise file
 */
export function resolveExpertisePath(agentId: string, expertName: string): string {
  const sanitizedName = sanitizeExpertName(expertName);
  return path.join(resolveExpertiseDir(agentId), `${sanitizedName}.yaml`);
}

/**
 * Sanitize expert name for use as filename
 */
function sanitizeExpertName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Create an empty expertise config
 */
export function createEmptyExpertise(options: CreateExpertiseOptions): ExpertiseConfig {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    expert: {
      name: options.name,
      role: options.role,
      expertiseAreas: options.expertiseAreas,
      createdAt: now,
      lastUpdated: now,
    },
    keyKnowledge: [],
    mentalModel: [],
    commonIssues: [],
    relatedFiles: [],
    selfImprovement: {
      lastSync: now,
      sources: [],
      pendingUpdates: [],
      syncHistory: [],
    },
  };
}

/**
 * Load expertise for an agent expert
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name (e.g., "database", "gateway")
 * @returns The expertise config, or null if not found
 */
export async function loadExpertise(
  agentId: string,
  expertName: string,
): Promise<ExpertiseConfig | null> {
  const filePath = resolveExpertisePath(agentId, expertName);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const parsed = YAML.parse(content) as ExpertiseConfig;
    return parsed;
  } catch (error) {
    // Return null if file doesn't exist
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Save expertise for an agent expert
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name
 * @param config - The expertise config to save
 */
export async function saveExpertise(
  agentId: string,
  expertName: string,
  config: ExpertiseConfig,
): Promise<void> {
  const filePath = resolveExpertisePath(agentId, expertName);
  const dir = path.dirname(filePath);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Update lastUpdated timestamp
  config.expert.lastUpdated = new Date().toISOString();

  // Serialize to YAML with nice formatting
  const yamlContent = YAML.stringify(config, {
    indent: 2,
    lineWidth: 100,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });

  await fs.writeFile(filePath, yamlContent, "utf8");
}

/**
 * Create a new expertise file for an expert
 *
 * @param agentId - The agent ID
 * @param options - Expert creation options
 * @returns The created expertise config
 */
export async function createExpertise(
  agentId: string,
  options: CreateExpertiseOptions,
): Promise<ExpertiseConfig> {
  const config = createEmptyExpertise(options);
  const expertName = sanitizeExpertName(options.name);
  await saveExpertise(agentId, expertName, config);
  return config;
}

/**
 * List all expertise files for an agent
 *
 * @param agentId - The agent ID
 * @returns Array of expert names (without .yaml extension)
 */
export async function listExpertise(agentId: string): Promise<string[]> {
  const dir = resolveExpertiseDir(agentId);

  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith(".yaml")).map((f) => f.replace(/\.yaml$/, ""));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Delete an expertise file
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name
 * @returns true if deleted, false if not found
 */
export async function deleteExpertise(agentId: string, expertName: string): Promise<boolean> {
  const filePath = resolveExpertisePath(agentId, expertName);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Update expertise with new information
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name
 * @param updates - The updates to apply
 * @returns The updated config, or null if expert not found
 */
export async function updateExpertiseKnowledge(
  agentId: string,
  expertName: string,
  updates: ExpertiseUpdate,
): Promise<ExpertiseConfig | null> {
  const config = await loadExpertise(agentId, expertName);
  if (!config) return null;

  const now = new Date().toISOString();

  // Add new knowledge items
  if (updates.addKnowledge) {
    for (const knowledge of updates.addKnowledge) {
      config.keyKnowledge.push({
        ...knowledge,
        lastUpdated: now,
      });
    }
  }

  // Update existing knowledge by title
  if (updates.updateKnowledge) {
    for (const { title, updates: knowledgeUpdates } of updates.updateKnowledge) {
      const existing = config.keyKnowledge.find((k) => k.title === title);
      if (existing) {
        Object.assign(existing, knowledgeUpdates, { lastUpdated: now });
      }
    }
  }

  // Add mental model components
  if (updates.addComponents) {
    config.mentalModel.push(...updates.addComponents);
  }

  // Add common issues
  if (updates.addIssues) {
    config.commonIssues.push(...updates.addIssues);
  }

  // Add related files (dedupe by path)
  if (updates.addFiles) {
    const existingPaths = new Set(config.relatedFiles.map((f) => f.path));
    for (const file of updates.addFiles) {
      if (!existingPaths.has(file.path)) {
        config.relatedFiles.push(file);
        existingPaths.add(file.path);
      }
    }
  }

  // Add pending updates
  if (updates.addPendingUpdates) {
    config.selfImprovement.pendingUpdates.push(...updates.addPendingUpdates);
  }

  // Mark pending updates as complete
  if (updates.completePendingUpdates) {
    const completed = new Set(updates.completePendingUpdates);
    config.selfImprovement.pendingUpdates = config.selfImprovement.pendingUpdates.filter(
      (u) => !completed.has(u),
    );
  }

  await saveExpertise(agentId, expertName, config);
  return config;
}

/**
 * Record a sync operation in the expertise history
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name
 * @param report - The sync report
 */
export async function recordExpertiseSync(
  agentId: string,
  expertName: string,
  report: ExpertiseSyncReport,
): Promise<void> {
  const config = await loadExpertise(agentId, expertName);
  if (!config) return;

  // Update sync timestamp
  config.selfImprovement.lastSync = report.timestamp;

  // Update sources
  const codeAuditSource = config.selfImprovement.sources.find((s) => s.type === "code_audit");
  if (codeAuditSource) {
    codeAuditSource.filesChecked = report.filesChecked;
    codeAuditSource.changesDetected = report.changesDetected;
    codeAuditSource.lastConsulted = report.timestamp;
  } else {
    config.selfImprovement.sources.push({
      type: "code_audit",
      filesChecked: report.filesChecked,
      changesDetected: report.changesDetected,
      lastConsulted: report.timestamp,
    });
  }

  // Add pending updates from sync
  if (report.pendingUpdatesAdded.length > 0) {
    config.selfImprovement.pendingUpdates.push(...report.pendingUpdatesAdded);
  }

  // Add to sync history (keep last 50 entries)
  if (!config.selfImprovement.syncHistory) {
    config.selfImprovement.syncHistory = [];
  }
  config.selfImprovement.syncHistory.unshift({
    timestamp: report.timestamp,
    trigger: "code_change",
    summary: report.summary,
    itemsUpdated: report.knowledgeUpdated,
  });
  if (config.selfImprovement.syncHistory.length > 50) {
    config.selfImprovement.syncHistory = config.selfImprovement.syncHistory.slice(0, 50);
  }

  await saveExpertise(agentId, expertName, config);
}

/**
 * Get pending updates for an expert
 *
 * @param agentId - The agent ID
 * @param expertName - The expert name
 * @returns Array of pending update descriptions
 */
export async function getPendingUpdates(agentId: string, expertName: string): Promise<string[]> {
  const config = await loadExpertise(agentId, expertName);
  if (!config) return [];
  return config.selfImprovement.pendingUpdates;
}

/**
 * Search expertise across all experts for an agent
 *
 * @param agentId - The agent ID
 * @param query - Search query
 * @returns Matching knowledge items with expert context
 */
export async function searchExpertise(
  agentId: string,
  query: string,
): Promise<Array<{ expert: string; knowledge: ExpertKnowledge }>> {
  const experts = await listExpertise(agentId);
  const results: Array<{ expert: string; knowledge: ExpertKnowledge }> = [];
  const queryLower = query.toLowerCase();

  for (const expertName of experts) {
    const config = await loadExpertise(agentId, expertName);
    if (!config) continue;

    for (const knowledge of config.keyKnowledge) {
      const titleMatch = knowledge.title.toLowerCase().includes(queryLower);
      const summaryMatch = knowledge.summary.toLowerCase().includes(queryLower);
      const detailsMatch = knowledge.details?.toLowerCase().includes(queryLower);
      const tagsMatch = knowledge.tags?.some((t) => t.toLowerCase().includes(queryLower));

      if (titleMatch || summaryMatch || detailsMatch || tagsMatch) {
        results.push({ expert: expertName, knowledge });
      }
    }
  }

  return results;
}

/**
 * Format expertise as human-readable summary
 *
 * @param config - The expertise config
 * @returns Formatted string
 */
export function formatExpertiseSummary(config: ExpertiseConfig): string {
  const sections: string[] = [];

  sections.push(`# ${config.expert.name}`);
  sections.push(`Role: ${config.expert.role}`);
  sections.push("");
  sections.push(`## Expertise Areas`);
  for (const area of config.expert.expertiseAreas) {
    sections.push(`- ${area}`);
  }

  if (config.keyKnowledge.length > 0) {
    sections.push("");
    sections.push(`## Key Knowledge (${config.keyKnowledge.length} items)`);
    for (const k of config.keyKnowledge.slice(0, 5)) {
      const confidence = Math.round(k.confidence * 100);
      sections.push(`- **${k.title}** (${confidence}% confidence)`);
      sections.push(`  ${k.summary}`);
    }
    if (config.keyKnowledge.length > 5) {
      sections.push(`  ... and ${config.keyKnowledge.length - 5} more`);
    }
  }

  if (config.mentalModel.length > 0) {
    sections.push("");
    sections.push(`## Mental Model (${config.mentalModel.length} components)`);
    for (const c of config.mentalModel.slice(0, 3)) {
      sections.push(`- **${c.component}**: ${c.description}`);
    }
    if (config.mentalModel.length > 3) {
      sections.push(`  ... and ${config.mentalModel.length - 3} more`);
    }
  }

  if (config.commonIssues.length > 0) {
    sections.push("");
    sections.push(`## Common Issues (${config.commonIssues.length})`);
    for (const i of config.commonIssues.slice(0, 3)) {
      sections.push(`- **${i.issue}**: ${i.solution}`);
    }
  }

  if (config.selfImprovement.pendingUpdates.length > 0) {
    sections.push("");
    sections.push(`## Pending Updates (${config.selfImprovement.pendingUpdates.length})`);
    for (const u of config.selfImprovement.pendingUpdates.slice(0, 5)) {
      sections.push(`- ${u}`);
    }
  }

  sections.push("");
  sections.push(`Last synced: ${config.selfImprovement.lastSync}`);
  sections.push(`Last updated: ${config.expert.lastUpdated}`);

  return sections.join("\n");
}

/**
 * Merge two expertise configs, preferring newer data
 *
 * @param base - Base config
 * @param incoming - Incoming config to merge
 * @returns Merged config
 */
export function mergeExpertise(base: ExpertiseConfig, incoming: ExpertiseConfig): ExpertiseConfig {
  const merged = structuredClone(base);

  // Merge key knowledge (dedupe by title, prefer newer)
  const knowledgeByTitle = new Map(merged.keyKnowledge.map((k) => [k.title, k]));
  for (const k of incoming.keyKnowledge) {
    const existing = knowledgeByTitle.get(k.title);
    if (!existing || new Date(k.lastUpdated) > new Date(existing.lastUpdated)) {
      knowledgeByTitle.set(k.title, k);
    }
  }
  merged.keyKnowledge = Array.from(knowledgeByTitle.values());

  // Merge mental model (dedupe by component name)
  const componentByName = new Map(merged.mentalModel.map((c) => [c.component, c]));
  for (const c of incoming.mentalModel) {
    componentByName.set(c.component, c);
  }
  merged.mentalModel = Array.from(componentByName.values());

  // Merge common issues (dedupe by issue description)
  const issueByDesc = new Map(merged.commonIssues.map((i) => [i.issue, i]));
  for (const i of incoming.commonIssues) {
    issueByDesc.set(i.issue, i);
  }
  merged.commonIssues = Array.from(issueByDesc.values());

  // Merge related files (dedupe by path)
  const fileByPath = new Map(merged.relatedFiles.map((f) => [f.path, f]));
  for (const f of incoming.relatedFiles) {
    fileByPath.set(f.path, f);
  }
  merged.relatedFiles = Array.from(fileByPath.values());

  // Merge pending updates (dedupe)
  const pendingSet = new Set([
    ...merged.selfImprovement.pendingUpdates,
    ...incoming.selfImprovement.pendingUpdates,
  ]);
  merged.selfImprovement.pendingUpdates = Array.from(pendingSet);

  // Use newer lastSync
  if (new Date(incoming.selfImprovement.lastSync) > new Date(merged.selfImprovement.lastSync)) {
    merged.selfImprovement.lastSync = incoming.selfImprovement.lastSync;
  }

  return merged;
}
