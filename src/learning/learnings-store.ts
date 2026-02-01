/**
 * Learnings storage and persistence
 *
 * Provides file-based storage for extracted learnings with CRUD operations.
 * Learnings are stored per-agent in JSON files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";
import type {
  LearningCategory,
  LearningConfidence,
  LearningSource,
  ExtractedLearning,
} from "./extract-learnings.js";

/**
 * A stored learning with metadata
 */
export interface StoredLearning {
  /** Unique identifier */
  id: string;
  /** Agent ID this learning belongs to */
  agentId: string;
  /** The learning content */
  content: string;
  /** Category of the learning */
  category: LearningCategory;
  /** Confidence level */
  confidence: LearningConfidence;
  /** Source of the learning */
  source: LearningSource;
  /** When the learning was captured */
  timestamp: string;
  /** Related context */
  context?: string;
  /** Tags for organization */
  tags?: string[];
  /** Whether this learning is active */
  active: boolean;
  /** Last validation timestamp */
  lastValidated?: string;
}

/**
 * File format for learnings storage
 */
export interface LearningsFile {
  /** Schema version */
  version: number;
  /** Agent ID */
  agentId: string;
  /** Stored learnings */
  learnings: StoredLearning[];
  /** Last updated timestamp */
  lastUpdated: string;
}

const LEARNINGS_FILENAME = "learnings.json";
const CURRENT_VERSION = 1;

/**
 * Resolve the learnings directory for an agent
 */
function resolveLearningsDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "learning");
}

/**
 * Resolve the path to an agent's learnings file
 */
export function resolveLearningsPath(agentId: string): string {
  return path.join(resolveLearningsDir(agentId), LEARNINGS_FILENAME);
}

/**
 * Generate a unique learning ID
 */
function generateLearningId(): string {
  return `lrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load all learnings for an agent
 */
export async function loadLearnings(agentId: string): Promise<StoredLearning[]> {
  const filePath = resolveLearningsPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content) as LearningsFile;
    return data.learnings ?? [];
  } catch {
    return [];
  }
}

/**
 * Save learnings for an agent
 */
export async function saveLearnings(agentId: string, learnings: StoredLearning[]): Promise<void> {
  const filePath = resolveLearningsPath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });

  const data: LearningsFile = {
    version: CURRENT_VERSION,
    agentId: normalizeAgentId(agentId),
    learnings,
    lastUpdated: new Date().toISOString(),
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Add a new learning for an agent
 */
export async function addLearning(
  agentId: string,
  learning: ExtractedLearning,
): Promise<StoredLearning> {
  const learnings = await loadLearnings(agentId);

  const stored: StoredLearning = {
    id: generateLearningId(),
    agentId: normalizeAgentId(agentId),
    content: learning.content,
    category: learning.category,
    confidence: learning.confidence,
    source: learning.source,
    timestamp: new Date().toISOString(),
    context: learning.context,
    tags: learning.tags,
    active: true,
  };

  learnings.push(stored);
  await saveLearnings(agentId, learnings);

  return stored;
}

/**
 * Update an existing learning
 */
export async function updateLearning(
  agentId: string,
  learningId: string,
  updates: Partial<Pick<StoredLearning, "content" | "confidence" | "active" | "tags">>,
): Promise<StoredLearning | null> {
  const learnings = await loadLearnings(agentId);
  const index = learnings.findIndex((l) => l.id === learningId);

  if (index === -1) {
    return null;
  }

  learnings[index] = {
    ...learnings[index],
    ...updates,
    lastValidated: new Date().toISOString(),
  };

  await saveLearnings(agentId, learnings);
  return learnings[index];
}

/**
 * Remove a learning by ID
 */
export async function removeLearning(agentId: string, learningId: string): Promise<boolean> {
  const learnings = await loadLearnings(agentId);
  const index = learnings.findIndex((l) => l.id === learningId);

  if (index === -1) {
    return false;
  }

  learnings.splice(index, 1);
  await saveLearnings(agentId, learnings);
  return true;
}

/**
 * Search learnings by content
 */
export async function searchLearnings(
  agentId: string,
  query: string,
  options: { category?: LearningCategory; activeOnly?: boolean } = {},
): Promise<StoredLearning[]> {
  const learnings = await loadLearnings(agentId);
  const queryLower = query.toLowerCase();

  return learnings.filter((l) => {
    if (options.activeOnly && !l.active) return false;
    if (options.category && l.category !== options.category) return false;
    return l.content.toLowerCase().includes(queryLower);
  });
}

/**
 * Get learnings by category
 */
export async function getLearningsByCategory(
  agentId: string,
  category: LearningCategory,
): Promise<StoredLearning[]> {
  const learnings = await loadLearnings(agentId);
  return learnings.filter((l) => l.category === category && l.active);
}

/**
 * Deactivate old learnings (for decay)
 */
export async function deactivateOldLearnings(
  agentId: string,
  olderThanDays: number,
): Promise<number> {
  const learnings = await loadLearnings(agentId);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let deactivated = 0;

  for (const learning of learnings) {
    if (learning.active && new Date(learning.timestamp).getTime() < cutoff) {
      learning.active = false;
      deactivated++;
    }
  }

  if (deactivated > 0) {
    await saveLearnings(agentId, learnings);
  }

  return deactivated;
}
