/**
 * Tests for learning checkpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  createCheckpoint,
  listCheckpoints,
  loadCheckpoint,
  getLatestCheckpoint,
  rollbackToCheckpoint,
  deleteCheckpoint,
  compareWithCheckpoint,
  shouldRollback,
  maybeCreateAutoCheckpoint,
  type CheckpointReason,
} from "./checkpoints.js";
import { saveLearnings, loadLearnings, type StoredLearning } from "./learnings-store.js";
import {
  saveFeedback,
  savePatterns,
  type FeedbackEntry,
  type FeedbackPattern,
} from "./feedback-loop.js";

// Mock paths to use temp directory
const testAgentId = "test-checkpoint-agent";
let tempDir: string;

vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => tempDir,
}));

vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: (id: string) => id,
}));

/**
 * Create sample learnings for testing
 */
function createSampleLearnings(
  count: number,
  confidence: "high" | "medium" | "low" = "medium",
): StoredLearning[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `l_test_${i}`,
    category: "preference" as const,
    content: `Test learning ${i}`,
    confidence,
    source: "user_message",
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
  }));
}

/**
 * Create sample feedback for testing
 */
function createSampleFeedback(count: number): FeedbackEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `fb_test_${i}`,
    agentId: testAgentId,
    type: i % 2 === 0 ? "positive" : "negative",
    context: {
      userQuery: `Test query ${i}`,
      suggestion: `Test suggestion ${i}`,
    },
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
  }));
}

/**
 * Create sample patterns for testing
 */
function createSamplePatterns(count: number): FeedbackPattern[] {
  return Array.from({ length: count }, (_, i) => ({
    pattern: `test:pattern_${i}`,
    positiveCount: 5,
    negativeCount: 2,
    score: 0.3,
    lastUpdated: new Date().toISOString(),
  }));
}

describe("checkpoints", () => {
  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-checkpoints-test-"));

    // Create agent directories
    const agentDir = path.join(tempDir, "agents", testAgentId, "agent");
    const feedbackDir = path.join(tempDir, "agents", testAgentId, "feedback");
    await fs.mkdir(agentDir, { recursive: true });
    await fs.mkdir(feedbackDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createCheckpoint", () => {
    it("creates a checkpoint with correct metadata", async () => {
      const learnings = createSampleLearnings(5, "high");
      await saveLearnings(testAgentId, learnings);

      const metadata = await createCheckpoint(testAgentId, "manual", "Test checkpoint");

      expect(metadata).toBeDefined();
      expect(metadata.id).toMatch(/^cp_[a-z0-9]+_[a-z0-9]+$/);
      expect(metadata.reason).toBe("manual");
      expect(metadata.description).toBe("Test checkpoint");
      expect(metadata.learningsCount).toBe(5);
      expect(metadata.createdAt).toBeDefined();
    });

    it("captures all learning data in checkpoint", async () => {
      const learnings = createSampleLearnings(3);
      const feedback = createSampleFeedback(2);
      const patterns = createSamplePatterns(1);

      await saveLearnings(testAgentId, learnings);
      await saveFeedback(testAgentId, feedback);
      await savePatterns(testAgentId, patterns);

      const metadata = await createCheckpoint(testAgentId, "scheduled");
      const checkpoint = await loadCheckpoint(testAgentId, metadata.id);

      expect(checkpoint.learnings).toHaveLength(3);
      expect(checkpoint.feedback).toHaveLength(2);
      expect(checkpoint.patterns).toHaveLength(1);
    });

    it("calculates metrics correctly", async () => {
      // Note: The learnings store markdown format loses confidence info,
      // but the checkpoint captures the actual loaded learnings
      const learnings = createSampleLearnings(10, "medium");
      await saveLearnings(testAgentId, learnings);

      const metadata = await createCheckpoint(testAgentId, "quality_high");

      expect(metadata.metrics).toBeDefined();
      expect(metadata.metrics.total).toBe(10);
      // After save/load through markdown format, all become "medium" confidence
      expect(metadata.metrics.byConfidence.medium).toBe(10);
      expect(metadata.metrics.accuracyScore).toBe(70); // medium = 70 accuracy
    });

    it("supports different checkpoint reasons", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(1));

      const reasons: CheckpointReason[] = [
        "manual",
        "scheduled",
        "before_import",
        "quality_high",
        "milestone",
      ];

      for (const reason of reasons) {
        const metadata = await createCheckpoint(testAgentId, reason);
        expect(metadata.reason).toBe(reason);
      }
    });
  });

  describe("listCheckpoints", () => {
    it("returns empty array when no checkpoints exist", async () => {
      const summaries = await listCheckpoints(testAgentId);
      expect(summaries).toEqual([]);
    });

    it("lists checkpoints sorted by date (newest first)", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(1));

      // Create checkpoints with small delays
      await createCheckpoint(testAgentId, "manual", "First");
      await new Promise((r) => setTimeout(r, 10));
      await createCheckpoint(testAgentId, "manual", "Second");
      await new Promise((r) => setTimeout(r, 10));
      await createCheckpoint(testAgentId, "manual", "Third");

      const summaries = await listCheckpoints(testAgentId);

      expect(summaries).toHaveLength(3);
      expect(summaries[0].description).toBe("Third");
      expect(summaries[1].description).toBe("Second");
      expect(summaries[2].description).toBe("First");
    });

    it("includes file size in summaries", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(10));
      await createCheckpoint(testAgentId, "manual");

      const summaries = await listCheckpoints(testAgentId);

      expect(summaries[0].fileSize).toBeGreaterThan(0);
    });
  });

  describe("loadCheckpoint", () => {
    it("loads a checkpoint with full data", async () => {
      const learnings = createSampleLearnings(5);
      await saveLearnings(testAgentId, learnings);

      const metadata = await createCheckpoint(testAgentId, "manual");
      const checkpoint = await loadCheckpoint(testAgentId, metadata.id);

      expect(checkpoint.id).toBe(metadata.id);
      expect(checkpoint.learnings).toHaveLength(5);
      expect(checkpoint.learnings[0].content).toBe("Test learning 0");
    });

    it("throws error for non-existent checkpoint", async () => {
      await expect(loadCheckpoint(testAgentId, "non_existent")).rejects.toThrow(
        "Checkpoint not found",
      );
    });
  });

  describe("getLatestCheckpoint", () => {
    it("returns null when no checkpoints exist", async () => {
      const latest = await getLatestCheckpoint(testAgentId);
      expect(latest).toBeNull();
    });

    it("returns the most recent checkpoint", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(1));

      await createCheckpoint(testAgentId, "manual", "First");
      await new Promise((r) => setTimeout(r, 10));
      await createCheckpoint(testAgentId, "manual", "Second");

      const latest = await getLatestCheckpoint(testAgentId);

      expect(latest).not.toBeNull();
      expect(latest!.description).toBe("Second");
    });
  });

  describe("rollbackToCheckpoint", () => {
    it("restores learning state from checkpoint", async () => {
      // Create initial state
      const originalLearnings = createSampleLearnings(3);
      await saveLearnings(testAgentId, originalLearnings);

      // Create checkpoint
      const metadata = await createCheckpoint(testAgentId, "manual");

      // Modify state
      const newLearnings = createSampleLearnings(10);
      await saveLearnings(testAgentId, newLearnings);

      // Verify state changed
      let currentLearnings = await loadLearnings(testAgentId);
      expect(currentLearnings).toHaveLength(10);

      // Rollback
      const result = await rollbackToCheckpoint(testAgentId, metadata.id);

      expect(result.success).toBe(true);
      expect(result.learningsRestored).toBe(3);

      // Verify state restored
      currentLearnings = await loadLearnings(testAgentId);
      expect(currentLearnings).toHaveLength(3);
    });

    it("creates backup checkpoint before rollback", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(5));
      const metadata = await createCheckpoint(testAgentId, "manual");

      await saveLearnings(testAgentId, createSampleLearnings(10));

      await rollbackToCheckpoint(testAgentId, metadata.id);

      // Should have original checkpoint + backup
      const summaries = await listCheckpoints(testAgentId);
      expect(summaries.length).toBeGreaterThanOrEqual(2);

      // Backup should contain the pre-rollback state
      const backup = summaries.find((s) => s.description?.includes("Backup before rollback"));
      expect(backup).toBeDefined();
      expect(backup!.learningsCount).toBe(10);
    });

    it("throws error for non-existent checkpoint", async () => {
      await expect(rollbackToCheckpoint(testAgentId, "non_existent")).rejects.toThrow(
        "Cannot rollback: checkpoint not found",
      );
    });
  });

  describe("deleteCheckpoint", () => {
    it("deletes a checkpoint", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(1));
      const metadata = await createCheckpoint(testAgentId, "manual");

      let summaries = await listCheckpoints(testAgentId);
      expect(summaries).toHaveLength(1);

      const deleted = await deleteCheckpoint(testAgentId, metadata.id);
      expect(deleted).toBe(true);

      summaries = await listCheckpoints(testAgentId);
      expect(summaries).toHaveLength(0);
    });

    it("returns false for non-existent checkpoint", async () => {
      const deleted = await deleteCheckpoint(testAgentId, "non_existent");
      expect(deleted).toBe(false);
    });
  });

  describe("compareWithCheckpoint", () => {
    it("calculates differences between checkpoint and current state", async () => {
      // Initial state
      const originalLearnings = createSampleLearnings(5);
      await saveLearnings(testAgentId, originalLearnings);
      const metadata = await createCheckpoint(testAgentId, "manual");

      // Add more learnings
      const moreLearnings = createSampleLearnings(8);
      await saveLearnings(testAgentId, moreLearnings);

      const comparison = await compareWithCheckpoint(testAgentId, metadata.id);

      expect(comparison.checkpoint.id).toBe(metadata.id);
      expect(comparison.checkpoint.learningsCount).toBe(5);
      expect(comparison.current.learningsCount).toBe(8);
      expect(comparison.diff.learningsAdded).toBe(8); // All new IDs
      expect(comparison.diff.learningsRemoved).toBe(5); // Original ones not present
    });

    it("calculates accuracy change", async () => {
      // Create initial learnings (note: markdown format normalizes to medium)
      await saveLearnings(testAgentId, createSampleLearnings(10, "medium"));
      const metadata = await createCheckpoint(testAgentId, "manual");

      // Add more learnings - different content means different IDs
      const moreLearnings = createSampleLearnings(15, "medium");
      await saveLearnings(testAgentId, moreLearnings);

      const comparison = await compareWithCheckpoint(testAgentId, metadata.id);

      // Both should have same accuracy (medium = 70) since format normalizes confidence
      expect(comparison.diff.accuracyChange).toBe(0);
      // But learning counts should differ
      expect(comparison.current.learningsCount).toBe(15);
      expect(comparison.checkpoint.learningsCount).toBe(10);
    });
  });

  describe("shouldRollback", () => {
    it("returns not recommended when no checkpoints exist", async () => {
      const result = await shouldRollback(testAgentId);
      expect(result.recommended).toBe(false);
    });

    it("recommends rollback when accuracy drops significantly", async () => {
      // Note: Since markdown format normalizes confidence to "medium",
      // we need to test with a scenario where the number of learnings changes
      // and the checkpoint has better metrics. We simulate by directly
      // manipulating the checkpoint metrics after creation.
      await saveLearnings(testAgentId, createSampleLearnings(20, "medium"));
      const metadata = await createCheckpoint(testAgentId, "quality_high");

      // Manually update the checkpoint to have higher accuracy for testing
      const checkpointPath = path.join(
        tempDir,
        "agents",
        testAgentId,
        "checkpoints",
        `${metadata.id}.json`,
      );
      const content = await fs.readFile(checkpointPath, "utf8");
      const checkpoint = JSON.parse(content);
      checkpoint.metrics.accuracyScore = 90; // Simulate high accuracy checkpoint
      await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

      // Current state remains at 70 (medium confidence), checkpoint shows 90
      const result = await shouldRollback(testAgentId, { minAccuracyDrop: 10 });

      expect(result.recommended).toBe(true);
      expect(result.reason).toContain("Accuracy dropped");
      expect(result.suggestedCheckpoint).toBeDefined();
    });

    it("does not recommend rollback when quality is stable", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(10, "medium"));
      await createCheckpoint(testAgentId, "manual");

      // Add more of the same quality
      const more = createSampleLearnings(15, "medium");
      await saveLearnings(testAgentId, more);

      const result = await shouldRollback(testAgentId);
      expect(result.recommended).toBe(false);
    });
  });

  describe("maybeCreateAutoCheckpoint", () => {
    it("returns null when no learnings exist", async () => {
      const result = await maybeCreateAutoCheckpoint(testAgentId);
      expect(result).toBeNull();
    });

    it("creates initial checkpoint when enough learnings exist", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(10));

      const result = await maybeCreateAutoCheckpoint(testAgentId);

      expect(result).not.toBeNull();
      expect(result!.description).toContain("Initial checkpoint");
    });

    it("creates milestone checkpoint when threshold reached", async () => {
      // Create initial state just under milestone
      await saveLearnings(testAgentId, createSampleLearnings(49));
      await createCheckpoint(testAgentId, "manual");

      // Add more to cross milestone
      await saveLearnings(testAgentId, createSampleLearnings(55));

      const result = await maybeCreateAutoCheckpoint(testAgentId);

      expect(result).not.toBeNull();
      expect(result!.reason).toBe("milestone");
      expect(result!.description).toContain("50 learnings");
    });

    it("creates quality checkpoint when accuracy is high", async () => {
      // Create initial state and checkpoint
      await saveLearnings(testAgentId, createSampleLearnings(10, "medium"));
      const initialMeta = await createCheckpoint(testAgentId, "manual");

      // Manually set the initial checkpoint to have low accuracy
      const checkpointPath = path.join(
        tempDir,
        "agents",
        testAgentId,
        "checkpoints",
        `${initialMeta.id}.json`,
      );
      const content = await fs.readFile(checkpointPath, "utf8");
      const checkpoint = JSON.parse(content);
      checkpoint.metrics.accuracyScore = 50; // Simulate low accuracy
      await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

      // Add more learnings - current accuracy is 70 (medium), which is 20 points higher
      await saveLearnings(testAgentId, createSampleLearnings(15, "medium"));

      const result = await maybeCreateAutoCheckpoint(testAgentId, {
        qualityThreshold: 60, // Lower threshold since we're working with medium = 70
      });

      expect(result).not.toBeNull();
      expect(result!.reason).toBe("quality_high");
    });
  });

  describe("checkpoint pruning", () => {
    it("prunes old checkpoints when limit exceeded", async () => {
      await saveLearnings(testAgentId, createSampleLearnings(1));

      // Create more checkpoints than the limit (default is 10)
      for (let i = 0; i < 12; i++) {
        await createCheckpoint(testAgentId, "manual", `Checkpoint ${i}`);
        await new Promise((r) => setTimeout(r, 5)); // Small delay for ordering
      }

      const summaries = await listCheckpoints(testAgentId);

      // Should be limited to MAX_CHECKPOINTS (10)
      expect(summaries.length).toBeLessThanOrEqual(10);

      // Newest should be preserved
      expect(summaries[0].description).toBe("Checkpoint 11");
    });
  });
});
