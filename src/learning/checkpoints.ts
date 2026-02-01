/**
 * Learning Checkpoints
 *
 * Provides checkpoint/rollback functionality for the learning system.
 * Checkpoints capture the complete learning state (learnings, feedback,
 * patterns) and allow rolling back if quality degrades.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";
import type { StoredLearning } from "./learnings-store.js";
import { loadLearnings, saveLearnings } from "./learnings-store.js";
import type { FeedbackEntry, FeedbackPattern } from "./feedback-loop.js";
import { loadFeedback, saveFeedback, loadPatterns, savePatterns } from "./feedback-loop.js";
import type { LearningMetrics } from "./metrics.js";
import { calculateMetrics } from "./metrics.js";

/**
 * Reason for creating a checkpoint
 */
export type CheckpointReason =
  | "manual" // User-triggered checkpoint
  | "scheduled" // Automatic periodic checkpoint
  | "before_import" // Before importing external learnings
  | "quality_high" // Quality metrics are high, worth preserving
  | "milestone"; // Reached a learning milestone (e.g., 100 learnings)

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
  /** Unique checkpoint ID */
  id: string;
  /** When the checkpoint was created */
  createdAt: string;
  /** Reason for creating the checkpoint */
  reason: CheckpointReason;
  /** Optional description */
  description?: string;
  /** Metrics at time of checkpoint */
  metrics: LearningMetrics;
  /** Number of learnings in checkpoint */
  learningsCount: number;
  /** Number of feedback entries in checkpoint */
  feedbackCount: number;
  /** Number of patterns in checkpoint */
  patternsCount: number;
}

/**
 * Complete checkpoint data including learning state
 */
export interface Checkpoint extends CheckpointMetadata {
  /** Stored learnings */
  learnings: StoredLearning[];
  /** Feedback entries */
  feedback: FeedbackEntry[];
  /** Feedback patterns */
  patterns: FeedbackPattern[];
}

/**
 * Checkpoint summary (metadata without full data)
 */
export interface CheckpointSummary extends CheckpointMetadata {
  /** Size of checkpoint file in bytes */
  fileSize: number;
}

/**
 * Rollback result
 */
export interface RollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Checkpoint that was restored */
  checkpoint: CheckpointMetadata;
  /** Number of learnings restored */
  learningsRestored: number;
  /** Number of feedback entries restored */
  feedbackRestored: number;
  /** Number of patterns restored */
  patternsRestored: number;
  /** Any warnings during rollback */
  warnings: string[];
}

const CHECKPOINTS_DIR = "checkpoints";
const CHECKPOINT_PREFIX = "cp_";
const MAX_CHECKPOINTS = 10; // Maximum checkpoints to keep per agent

/**
 * Resolve the checkpoints directory for an agent
 */
function resolveCheckpointsDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, CHECKPOINTS_DIR);
}

/**
 * Resolve the path to a specific checkpoint file
 */
function resolveCheckpointPath(agentId: string, checkpointId: string): string {
  return path.join(resolveCheckpointsDir(agentId), `${checkpointId}.json`);
}

/**
 * Generate a unique checkpoint ID
 */
function generateCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${CHECKPOINT_PREFIX}${timestamp}_${random}`;
}

/**
 * Create a checkpoint of the current learning state
 */
export async function createCheckpoint(
  agentId: string,
  reason: CheckpointReason,
  description?: string,
): Promise<CheckpointMetadata> {
  // Load all current learning data
  const [learnings, feedback, patterns] = await Promise.all([
    loadLearnings(agentId),
    loadFeedback(agentId),
    loadPatterns(agentId),
  ]);

  // Calculate metrics for the current state
  const metrics = calculateMetrics(learnings);

  const checkpointId = generateCheckpointId();
  const now = new Date().toISOString();

  const checkpoint: Checkpoint = {
    id: checkpointId,
    createdAt: now,
    reason,
    description,
    metrics,
    learningsCount: learnings.length,
    feedbackCount: feedback.length,
    patternsCount: patterns.length,
    learnings,
    feedback,
    patterns,
  };

  // Ensure checkpoints directory exists
  const checkpointsDir = resolveCheckpointsDir(agentId);
  await fs.mkdir(checkpointsDir, { recursive: true });

  // Save checkpoint
  const checkpointPath = resolveCheckpointPath(agentId, checkpointId);
  await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");

  // Prune old checkpoints if needed
  await pruneOldCheckpoints(agentId);

  // Return metadata only (not full data)
  return extractMetadata(checkpoint);
}

/**
 * Extract metadata from a full checkpoint
 */
function extractMetadata(checkpoint: Checkpoint): CheckpointMetadata {
  return {
    id: checkpoint.id,
    createdAt: checkpoint.createdAt,
    reason: checkpoint.reason,
    description: checkpoint.description,
    metrics: checkpoint.metrics,
    learningsCount: checkpoint.learningsCount,
    feedbackCount: checkpoint.feedbackCount,
    patternsCount: checkpoint.patternsCount,
  };
}

/**
 * List all checkpoints for an agent
 */
export async function listCheckpoints(agentId: string): Promise<CheckpointSummary[]> {
  const checkpointsDir = resolveCheckpointsDir(agentId);

  try {
    const files = await fs.readdir(checkpointsDir);
    const checkpointFiles = files.filter(
      (f) => f.startsWith(CHECKPOINT_PREFIX) && f.endsWith(".json"),
    );

    const summaries: CheckpointSummary[] = [];

    for (const file of checkpointFiles) {
      const filePath = path.join(checkpointsDir, file);

      try {
        const [content, stats] = await Promise.all([
          fs.readFile(filePath, "utf8"),
          fs.stat(filePath),
        ]);

        const checkpoint = JSON.parse(content) as Checkpoint;
        summaries.push({
          ...extractMetadata(checkpoint),
          fileSize: stats.size,
        });
      } catch {
        // Skip corrupted checkpoint files
        continue;
      }
    }

    // Sort by creation date (newest first)
    summaries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return summaries;
  } catch {
    return [];
  }
}

/**
 * Load a specific checkpoint
 */
export async function loadCheckpoint(agentId: string, checkpointId: string): Promise<Checkpoint> {
  const checkpointPath = resolveCheckpointPath(agentId, checkpointId);

  try {
    const content = await fs.readFile(checkpointPath, "utf8");
    return JSON.parse(content) as Checkpoint;
  } catch (error) {
    throw new Error(`Checkpoint not found: ${checkpointId}`);
  }
}

/**
 * Get the most recent checkpoint for an agent
 */
export async function getLatestCheckpoint(agentId: string): Promise<Checkpoint | null> {
  const summaries = await listCheckpoints(agentId);

  if (summaries.length === 0) {
    return null;
  }

  // First one is the most recent (already sorted)
  return loadCheckpoint(agentId, summaries[0].id);
}

/**
 * Rollback to a specific checkpoint
 */
export async function rollbackToCheckpoint(
  agentId: string,
  checkpointId: string,
): Promise<RollbackResult> {
  const warnings: string[] = [];

  // Load the checkpoint
  let checkpoint: Checkpoint;
  try {
    checkpoint = await loadCheckpoint(agentId, checkpointId);
  } catch (error) {
    throw new Error(`Cannot rollback: checkpoint not found: ${checkpointId}`);
  }

  // Create a backup checkpoint before rollback
  try {
    await createCheckpoint(agentId, "manual", `Backup before rollback to ${checkpointId}`);
  } catch (err) {
    warnings.push(`Failed to create backup checkpoint: ${err}`);
  }

  // Restore all data
  await Promise.all([
    saveLearnings(agentId, checkpoint.learnings),
    saveFeedback(agentId, checkpoint.feedback),
    savePatterns(agentId, checkpoint.patterns),
  ]);

  return {
    success: true,
    checkpoint: extractMetadata(checkpoint),
    learningsRestored: checkpoint.learnings.length,
    feedbackRestored: checkpoint.feedback.length,
    patternsRestored: checkpoint.patterns.length,
    warnings,
  };
}

/**
 * Delete a checkpoint
 */
export async function deleteCheckpoint(agentId: string, checkpointId: string): Promise<boolean> {
  const checkpointPath = resolveCheckpointPath(agentId, checkpointId);

  try {
    await fs.unlink(checkpointPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prune old checkpoints, keeping only the most recent ones
 */
async function pruneOldCheckpoints(
  agentId: string,
  maxCheckpoints = MAX_CHECKPOINTS,
): Promise<number> {
  const summaries = await listCheckpoints(agentId);

  if (summaries.length <= maxCheckpoints) {
    return 0;
  }

  // Delete oldest checkpoints
  const toDelete = summaries.slice(maxCheckpoints);
  let deleted = 0;

  for (const summary of toDelete) {
    const success = await deleteCheckpoint(agentId, summary.id);
    if (success) deleted++;
  }

  return deleted;
}

/**
 * Compare current state with a checkpoint
 */
export async function compareWithCheckpoint(
  agentId: string,
  checkpointId: string,
): Promise<{
  checkpoint: CheckpointMetadata;
  current: {
    learningsCount: number;
    feedbackCount: number;
    patternsCount: number;
    metrics: LearningMetrics;
  };
  diff: {
    learningsAdded: number;
    learningsRemoved: number;
    feedbackAdded: number;
    patternsAdded: number;
    accuracyChange: number;
  };
}> {
  const checkpoint = await loadCheckpoint(agentId, checkpointId);

  // Load current state
  const [currentLearnings, currentFeedback, currentPatterns] = await Promise.all([
    loadLearnings(agentId),
    loadFeedback(agentId),
    loadPatterns(agentId),
  ]);

  const currentMetrics = calculateMetrics(currentLearnings);

  // Calculate differences
  const checkpointLearningIds = new Set(checkpoint.learnings.map((l) => l.id));
  const currentLearningIds = new Set(currentLearnings.map((l) => l.id));

  const learningsAdded = currentLearnings.filter((l) => !checkpointLearningIds.has(l.id)).length;
  const learningsRemoved = checkpoint.learnings.filter((l) => !currentLearningIds.has(l.id)).length;

  return {
    checkpoint: extractMetadata(checkpoint),
    current: {
      learningsCount: currentLearnings.length,
      feedbackCount: currentFeedback.length,
      patternsCount: currentPatterns.length,
      metrics: currentMetrics,
    },
    diff: {
      learningsAdded,
      learningsRemoved,
      feedbackAdded: currentFeedback.length - checkpoint.feedbackCount,
      patternsAdded: currentPatterns.length - checkpoint.patternsCount,
      accuracyChange: currentMetrics.accuracyScore - checkpoint.metrics.accuracyScore,
    },
  };
}

/**
 * Check if rollback is recommended based on quality degradation
 */
export async function shouldRollback(
  agentId: string,
  options: {
    /** Minimum accuracy drop to trigger rollback recommendation */
    minAccuracyDrop?: number;
    /** Whether to check against latest checkpoint or all checkpoints */
    checkLatestOnly?: boolean;
  } = {},
): Promise<{
  recommended: boolean;
  reason?: string;
  suggestedCheckpoint?: CheckpointMetadata;
}> {
  const { minAccuracyDrop = 15, checkLatestOnly = false } = options;

  const summaries = await listCheckpoints(agentId);

  if (summaries.length === 0) {
    return { recommended: false };
  }

  const checkpointsToCheck = checkLatestOnly ? [summaries[0]] : summaries;

  // Load current metrics
  const currentLearnings = await loadLearnings(agentId);
  const currentMetrics = calculateMetrics(currentLearnings);

  // Find best checkpoint to rollback to
  for (const summary of checkpointsToCheck) {
    const accuracyDrop = summary.metrics.accuracyScore - currentMetrics.accuracyScore;

    if (accuracyDrop >= minAccuracyDrop) {
      return {
        recommended: true,
        reason: `Accuracy dropped by ${accuracyDrop.toFixed(1)} points since checkpoint "${summary.id}"`,
        suggestedCheckpoint: summary,
      };
    }
  }

  return { recommended: false };
}

/**
 * Create an automatic checkpoint if conditions are met
 */
export async function maybeCreateAutoCheckpoint(
  agentId: string,
  options: {
    /** Minimum hours since last checkpoint */
    minHoursSinceLastCheckpoint?: number;
    /** Minimum new learnings since last checkpoint */
    minNewLearnings?: number;
    /** Minimum accuracy score to create quality checkpoint */
    qualityThreshold?: number;
  } = {},
): Promise<CheckpointMetadata | null> {
  const { minHoursSinceLastCheckpoint = 24, minNewLearnings = 10, qualityThreshold = 80 } = options;

  const summaries = await listCheckpoints(agentId);
  const currentLearnings = await loadLearnings(agentId);

  if (currentLearnings.length === 0) {
    return null;
  }

  const currentMetrics = calculateMetrics(currentLearnings);
  const now = Date.now();

  // Check if we should create a checkpoint
  if (summaries.length > 0) {
    const latest = summaries[0];
    const hoursSinceLast = (now - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);

    const newLearnings = currentLearnings.length - latest.learningsCount;

    // Scheduled checkpoint: enough time has passed and new learnings
    if (hoursSinceLast >= minHoursSinceLastCheckpoint && newLearnings >= minNewLearnings) {
      return createCheckpoint(
        agentId,
        "scheduled",
        `Auto checkpoint after ${newLearnings} new learnings`,
      );
    }

    // Quality checkpoint: accuracy is high and improved
    if (
      currentMetrics.accuracyScore >= qualityThreshold &&
      currentMetrics.accuracyScore > latest.metrics.accuracyScore + 5
    ) {
      return createCheckpoint(
        agentId,
        "quality_high",
        `High quality checkpoint (accuracy: ${currentMetrics.accuracyScore})`,
      );
    }

    // Milestone checkpoint: significant learning count
    const milestones = [50, 100, 250, 500, 1000];
    for (const milestone of milestones) {
      if (currentLearnings.length >= milestone && latest.learningsCount < milestone) {
        return createCheckpoint(agentId, "milestone", `Reached ${milestone} learnings milestone`);
      }
    }
  } else {
    // No checkpoints exist, create first one if we have enough learnings
    if (currentLearnings.length >= 5) {
      return createCheckpoint(agentId, "scheduled", "Initial checkpoint");
    }
  }

  return null;
}
