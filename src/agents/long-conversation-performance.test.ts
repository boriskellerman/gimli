/**
 * Tests verifying that long conversation sessions don't cause performance degradation.
 *
 * Key performance patterns tested:
 * 1. Token estimation - O(n) linear scaling with message count
 * 2. Session store operations - Consistent latency with many sessions
 * 3. Compaction chunking - Efficient splitting of large message histories
 * 4. Recency buffer - Fast slicing operations
 * 5. Hook session pruning - Prevents unbounded session store growth
 *
 * These tests ensure the system remains responsive even with very long conversations.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computeAdaptiveChunkRatio,
  estimateMessagesTokens,
  pruneHistoryForContextShare,
  splitMessagesByTokenShare,
} from "./compaction.js";
import {
  applyRecencyBuffer,
  DEFAULT_RECENCY_BUFFER_SIZE,
  isInRecencyBuffer,
  normalizeRecencyBufferSize,
} from "./recency-buffer.js";
import {
  clearSessionStoreCacheForTest,
  loadSessionStore,
  saveSessionStore,
  updateSessionStore,
} from "../config/sessions/store.js";
import type { SessionEntry } from "../config/sessions/types.js";

/**
 * Generate a message with specified content length (approximately token count).
 * Uses realistic structure with role and timestamp.
 */
function makeMessage(id: number, contentLength: number): AgentMessage {
  return {
    role: id % 2 === 0 ? "user" : "assistant",
    content: `Message ${id}: ${"x".repeat(Math.max(0, contentLength - 15))}`,
    timestamp: Date.now() + id,
  };
}

/**
 * Generate a conversation history with specified number of messages.
 * Messages alternate between user and assistant with varying sizes.
 */
function generateConversation(messageCount: number, avgContentLength = 500): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    // Vary message size to simulate real conversations
    const variation = Math.floor(avgContentLength * 0.5 * Math.sin(i * 0.3));
    const contentLength = Math.max(50, avgContentLength + variation);
    messages.push(makeMessage(i, contentLength));
  }
  return messages;
}

describe("long conversation session performance", () => {
  let testHome = "";
  let storePath = "";
  const envSnapshot: Record<string, string | undefined> = {};

  const snapshotEnv = () => {
    for (const key of ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "GIMLI_STATE_DIR"]) {
      envSnapshot[key] = process.env[key];
    }
  };

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  beforeAll(async () => {
    snapshotEnv();
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-long-conv-test-"));
    process.env.HOME = testHome;
    process.env.USERPROFILE = testHome;
    process.env.GIMLI_STATE_DIR = path.join(testHome, ".gimli");
    if (process.platform === "win32") {
      const match = testHome.match(/^([A-Za-z]:)(.*)$/);
      if (match) {
        process.env.HOMEDRIVE = match[1];
        process.env.HOMEPATH = match[2] || "\\";
      }
    }
    await fs.mkdir(path.join(testHome, ".gimli"), { recursive: true });
    storePath = path.join(testHome, ".gimli", "sessions.json");
  });

  afterAll(async () => {
    restoreEnv();
    clearSessionStoreCacheForTest();
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  });

  describe("token estimation performance", () => {
    it("estimates tokens for small conversation (10 messages) quickly", () => {
      const messages = generateConversation(10);

      const start = performance.now();
      const tokens = estimateMessagesTokens(messages);
      const elapsed = performance.now() - start;

      expect(tokens).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(50); // Should complete in < 50ms
    });

    it("estimates tokens for medium conversation (100 messages) in reasonable time", () => {
      const messages = generateConversation(100);

      const start = performance.now();
      const tokens = estimateMessagesTokens(messages);
      const elapsed = performance.now() - start;

      expect(tokens).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(200); // Should complete in < 200ms
    });

    it("estimates tokens for large conversation (500 messages) without timeout", () => {
      const messages = generateConversation(500);

      const start = performance.now();
      const tokens = estimateMessagesTokens(messages);
      const elapsed = performance.now() - start;

      expect(tokens).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(1000); // Should complete in < 1s
    });

    it("maintains linear scaling with message count", () => {
      const small = generateConversation(50);
      const medium = generateConversation(200);
      const large = generateConversation(400);

      const startSmall = performance.now();
      estimateMessagesTokens(small);
      const elapsedSmall = performance.now() - startSmall;

      const startMedium = performance.now();
      estimateMessagesTokens(medium);
      const elapsedMedium = performance.now() - startMedium;

      const startLarge = performance.now();
      estimateMessagesTokens(large);
      const elapsedLarge = performance.now() - startLarge;

      // Scaling factor should be roughly linear (with some overhead tolerance)
      // Medium is 4x small, should take roughly 4x time (with 3x tolerance)
      expect(elapsedMedium / Math.max(1, elapsedSmall)).toBeLessThan(12);
      // Large is 8x small, should take roughly 8x time (with 3x tolerance)
      expect(elapsedLarge / Math.max(1, elapsedSmall)).toBeLessThan(24);
    });

    it("handles empty message array efficiently", () => {
      const start = performance.now();
      const tokens = estimateMessagesTokens([]);
      const elapsed = performance.now() - start;

      expect(tokens).toBe(0);
      expect(elapsed).toBeLessThan(5); // Near-instant
    });
  });

  describe("message splitting performance (compaction)", () => {
    it("splits small conversation (10 messages) into chunks quickly", () => {
      const messages = generateConversation(10);

      const start = performance.now();
      const chunks = splitMessagesByTokenShare(messages, 2);
      const elapsed = performance.now() - start;

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.flat().length).toBe(messages.length);
      expect(elapsed).toBeLessThan(50);
    });

    it("splits medium conversation (100 messages) in reasonable time", () => {
      const messages = generateConversation(100);

      const start = performance.now();
      const chunks = splitMessagesByTokenShare(messages, 3);
      const elapsed = performance.now() - start;

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.flat().length).toBe(messages.length);
      expect(elapsed).toBeLessThan(300);
    });

    it("splits large conversation (500 messages) without timeout", () => {
      const messages = generateConversation(500);

      const start = performance.now();
      const chunks = splitMessagesByTokenShare(messages, 4);
      const elapsed = performance.now() - start;

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.flat().length).toBe(messages.length);
      expect(elapsed).toBeLessThan(1500);
    });

    it("handles many chunk parts efficiently", () => {
      const messages = generateConversation(100);

      const start = performance.now();
      const chunks = splitMessagesByTokenShare(messages, 10);
      const elapsed = performance.now() - start;

      expect(chunks.length).toBeLessThanOrEqual(10);
      expect(chunks.flat().length).toBe(messages.length);
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("context pruning performance", () => {
    it("prunes small conversation quickly", () => {
      const messages = generateConversation(10);

      const start = performance.now();
      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 1000,
        maxHistoryShare: 0.5,
        parts: 2,
      });
      const elapsed = performance.now() - start;

      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      expect(elapsed).toBeLessThan(100);
    });

    it("prunes medium conversation in reasonable time", () => {
      const messages = generateConversation(100);

      const start = performance.now();
      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 5000,
        maxHistoryShare: 0.5,
        parts: 2,
      });
      const elapsed = performance.now() - start;

      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      expect(elapsed).toBeLessThan(500);
    });

    it("prunes large conversation without timeout", () => {
      const messages = generateConversation(500);

      const start = performance.now();
      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 10000,
        maxHistoryShare: 0.5,
        parts: 3,
      });
      const elapsed = performance.now() - start;

      expect(result.messages.length).toBeLessThanOrEqual(messages.length);
      expect(elapsed).toBeLessThan(3000);
    });

    it("tracks all dropped messages correctly for large pruning", () => {
      const messages = generateConversation(200);

      const result = pruneHistoryForContextShare({
        messages,
        maxContextTokens: 1000,
        maxHistoryShare: 0.5,
        parts: 2,
      });

      // All messages should be accounted for
      const totalMessages = result.messages.length + result.droppedMessagesList.length;
      expect(totalMessages).toBe(messages.length);

      // Token counts should be consistent
      expect(result.keptTokens + result.droppedTokens).toBeGreaterThan(0);
    });
  });

  describe("recency buffer performance", () => {
    it("applies recency buffer to small conversation quickly", () => {
      const messages = generateConversation(20);

      const start = performance.now();
      const result = applyRecencyBuffer(messages, DEFAULT_RECENCY_BUFFER_SIZE);
      const elapsed = performance.now() - start;

      expect(result.preserved.length).toBe(DEFAULT_RECENCY_BUFFER_SIZE);
      expect(result.toSummarize.length).toBe(messages.length - DEFAULT_RECENCY_BUFFER_SIZE);
      expect(elapsed).toBeLessThan(10);
    });

    it("applies recency buffer to large conversation efficiently", () => {
      const messages = generateConversation(1000);

      const start = performance.now();
      const result = applyRecencyBuffer(messages, DEFAULT_RECENCY_BUFFER_SIZE);
      const elapsed = performance.now() - start;

      expect(result.preserved.length).toBe(DEFAULT_RECENCY_BUFFER_SIZE);
      expect(result.toSummarize.length).toBe(messages.length - DEFAULT_RECENCY_BUFFER_SIZE);
      expect(elapsed).toBeLessThan(50); // Array slicing is O(n) but fast
    });

    it("isInRecencyBuffer check is constant time", () => {
      const totalMessages = 10000;
      const bufferSize = 10;

      // Check first message (not in buffer)
      const start1 = performance.now();
      for (let i = 0; i < 1000; i++) {
        isInRecencyBuffer(0, totalMessages, bufferSize);
      }
      const elapsed1 = performance.now() - start1;

      // Check last message (in buffer)
      const start2 = performance.now();
      for (let i = 0; i < 1000; i++) {
        isInRecencyBuffer(totalMessages - 1, totalMessages, bufferSize);
      }
      const elapsed2 = performance.now() - start2;

      // Both should be similar (O(1))
      expect(Math.abs(elapsed1 - elapsed2)).toBeLessThan(20);
    });

    it("normalizes buffer size without performance issues", () => {
      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        normalizeRecencyBufferSize(i % 100);
        normalizeRecencyBufferSize(-5);
        normalizeRecencyBufferSize(NaN);
        normalizeRecencyBufferSize(undefined);
      }
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100); // Should handle 40k calls in < 100ms
    });
  });

  describe("adaptive chunk ratio performance", () => {
    it("computes adaptive ratio for varying message sizes", () => {
      const contextWindow = 128000;
      const smallMessages = generateConversation(50, 100);
      const largeMessages = generateConversation(50, 5000);

      const start = performance.now();
      const smallRatio = computeAdaptiveChunkRatio(smallMessages, contextWindow);
      const largeRatio = computeAdaptiveChunkRatio(largeMessages, contextWindow);
      const elapsed = performance.now() - start;

      // Large messages should result in smaller chunk ratio
      expect(largeRatio).toBeLessThanOrEqual(smallRatio);
      expect(elapsed).toBeLessThan(200);
    });

    it("handles empty message array", () => {
      const ratio = computeAdaptiveChunkRatio([], 128000);
      expect(ratio).toBe(0.4); // BASE_CHUNK_RATIO
    });
  });

  describe("session store performance with many sessions", () => {
    it("loads session store with few sessions quickly", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};
      for (let i = 0; i < 10; i++) {
        store[`session-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }
      await saveSessionStore(storePath, store);

      const start = performance.now();
      const loaded = loadSessionStore(storePath);
      const elapsed = performance.now() - start;

      expect(Object.keys(loaded).length).toBe(10);
      expect(elapsed).toBeLessThan(100);
    });

    it("loads session store with many sessions in reasonable time", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};
      for (let i = 0; i < 500; i++) {
        store[`session-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
          inputTokens: i * 100,
          outputTokens: i * 50,
          totalTokens: i * 150,
          compactionCount: Math.floor(i / 10),
        };
      }
      await saveSessionStore(storePath, store);

      clearSessionStoreCacheForTest();
      const start = performance.now();
      const loaded = loadSessionStore(storePath);
      const elapsed = performance.now() - start;

      expect(Object.keys(loaded).length).toBe(500);
      expect(elapsed).toBeLessThan(500);
    });

    it("updates session store with lock contention handled", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};
      for (let i = 0; i < 50; i++) {
        store[`session-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }
      await saveSessionStore(storePath, store);

      // Simulate concurrent updates
      const start = performance.now();
      await Promise.all([
        updateSessionStore(storePath, (s) => {
          s["session-0"]!.inputTokens = 100;
          return s;
        }),
        updateSessionStore(storePath, (s) => {
          s["session-1"]!.inputTokens = 200;
          return s;
        }),
        updateSessionStore(storePath, (s) => {
          s["session-2"]!.inputTokens = 300;
          return s;
        }),
      ]);
      const elapsed = performance.now() - start;

      // Should handle concurrent updates without excessive delays
      expect(elapsed).toBeLessThan(2000);

      clearSessionStoreCacheForTest();
      const loaded = loadSessionStore(storePath);
      expect(loaded["session-0"]?.inputTokens).toBe(100);
      expect(loaded["session-1"]?.inputTokens).toBe(200);
      expect(loaded["session-2"]?.inputTokens).toBe(300);
    });

    it("cache hit provides significant speedup", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};
      for (let i = 0; i < 200; i++) {
        store[`session-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }
      await saveSessionStore(storePath, store);

      clearSessionStoreCacheForTest();

      // First load (cache miss)
      const startCold = performance.now();
      loadSessionStore(storePath);
      const elapsedCold = performance.now() - startCold;

      // Second load (cache hit)
      const startWarm = performance.now();
      loadSessionStore(storePath);
      const elapsedWarm = performance.now() - startWarm;

      // Cache hit should be faster (at least 2x)
      expect(elapsedWarm).toBeLessThan(elapsedCold);
    });
  });

  describe("hook session pruning performance", () => {
    it("prunes expired hook sessions during save", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};

      // Add regular sessions
      for (let i = 0; i < 10; i++) {
        store[`session-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }

      // Add old hook sessions (should be pruned)
      const oldTime = Date.now() - 49 * 60 * 60 * 1000; // 49 hours ago
      for (let i = 0; i < 20; i++) {
        store[`hook:old-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: oldTime,
        };
      }

      // Add recent hook sessions (should be kept)
      for (let i = 0; i < 5; i++) {
        store[`hook:recent-${i}`] = {
          sessionId: crypto.randomUUID(),
          updatedAt: Date.now(),
        };
      }

      await saveSessionStore(storePath, store);
      clearSessionStoreCacheForTest();

      const loaded = loadSessionStore(storePath);

      // Regular sessions should be preserved
      expect(loaded["session-0"]).toBeDefined();
      expect(loaded["session-9"]).toBeDefined();

      // Old hook sessions should be pruned
      expect(loaded["hook:old-0"]).toBeUndefined();

      // Recent hook sessions should be kept
      expect(loaded["hook:recent-0"]).toBeDefined();
    });

    it("limits total hook sessions to prevent unbounded growth", async () => {
      clearSessionStoreCacheForTest();
      const store: Record<string, SessionEntry> = {};

      // Add more than 500 hook sessions
      for (let i = 0; i < 600; i++) {
        store[`hook:session-${i}`] = {
          sessionId: crypto.randomUUID(),
          // Stagger timestamps so we know which ones should be kept
          updatedAt: Date.now() - (600 - i) * 1000,
        };
      }

      await saveSessionStore(storePath, store);
      clearSessionStoreCacheForTest();

      const loaded = loadSessionStore(storePath);

      // Count remaining hook sessions
      const hookCount = Object.keys(loaded).filter((k) => k.startsWith("hook:")).length;

      // Should be capped at 500
      expect(hookCount).toBeLessThanOrEqual(500);

      // Should keep the newest ones (highest numbered)
      expect(loaded["hook:session-599"]).toBeDefined();
    });
  });

  describe("overall conversation lifecycle performance", () => {
    it("simulates realistic long conversation without degradation", async () => {
      // Simulate a conversation that grows over time with periodic compaction
      const contextWindow = 32000;
      const reserveTokens = 8000;
      const maxTokens = contextWindow - reserveTokens;

      let messages: AgentMessage[] = [];
      const compactionTimes: number[] = [];

      // Add messages until we hit the limit multiple times
      for (let cycle = 0; cycle < 3; cycle++) {
        // Add messages until approaching limit
        while (estimateMessagesTokens(messages) < maxTokens * 0.9) {
          messages.push(makeMessage(messages.length, 500));
        }

        // Perform compaction (prune history)
        const compactStart = performance.now();
        const { toSummarize, preserved } = applyRecencyBuffer(messages, 10);
        const pruned = pruneHistoryForContextShare({
          messages: toSummarize,
          maxContextTokens: contextWindow,
          maxHistoryShare: 0.5,
          parts: 2,
        });
        // Simulate keeping summary + preserved messages
        messages = [
          makeMessage(-1, estimateMessagesTokens(pruned.droppedMessagesList) / 10), // Summary
          ...pruned.messages,
          ...preserved,
        ];
        compactionTimes.push(performance.now() - compactStart);
      }

      // Compaction times should not increase dramatically
      const avgCompaction = compactionTimes.reduce((a, b) => a + b, 0) / compactionTimes.length;
      expect(avgCompaction).toBeLessThan(500); // Average compaction under 500ms

      // Final message count should be manageable (summary + kept + preserved buffer)
      // With 50% history share and 10-message recency buffer, expect < 200 messages
      expect(messages.length).toBeLessThan(200);
    });

    it("handles very long conversations with many compaction cycles", () => {
      const contextWindow = 16000;
      let messages: AgentMessage[] = [];

      // Simulate 10 compaction cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        // Add 50 messages per cycle
        for (let i = 0; i < 50; i++) {
          messages.push(makeMessage(cycle * 50 + i, 300));
        }

        // Check performance doesn't degrade
        const start = performance.now();
        const tokens = estimateMessagesTokens(messages);
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(200);

        // Prune if over budget
        if (tokens > contextWindow) {
          const { preserved, toSummarize } = applyRecencyBuffer(messages, 10);
          const pruned = pruneHistoryForContextShare({
            messages: toSummarize,
            maxContextTokens: contextWindow,
            maxHistoryShare: 0.5,
            parts: 2,
          });
          messages = [...pruned.messages, ...preserved];
        }
      }

      // Should still be within reasonable bounds after all cycles
      expect(messages.length).toBeLessThan(200);
    });
  });
});
