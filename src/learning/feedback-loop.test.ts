import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  recordFeedback,
  recordPositiveFeedback,
  recordNegativeFeedback,
  loadFeedback,
  saveFeedback,
  getFeedbackStats,
  loadPatterns,
  savePatterns,
  getPatternScore,
  getTopPatterns,
  shouldDemoteSuggestion,
  shouldBoostSuggestion,
  parseFeedbackReaction,
  registerFeedbackLoopHook,
  clearSuggestionContext,
  setSuggestionContext,
  resolveFeedbackPath,
  resolvePatternsPath,
  type FeedbackEntry,
  type SuggestionContext,
  type FeedbackPattern,
} from "./feedback-loop.js";
import { clearInternalHooks, triggerInternalHook } from "../hooks/internal-hooks.js";

// Mock the paths module to use temp directory
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => testStateDir,
}));

let testStateDir: string;

beforeEach(async () => {
  testStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-feedback-test-"));
  clearInternalHooks();
  clearSuggestionContext();
});

afterEach(async () => {
  clearInternalHooks();
  clearSuggestionContext();
  try {
    await fs.rm(testStateDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("feedback storage", () => {
  const testAgentId = "test-agent";

  it("returns empty array when no feedback exists", async () => {
    const entries = await loadFeedback(testAgentId);
    expect(entries).toEqual([]);
  });

  it("saves and loads feedback entries", async () => {
    const entries: FeedbackEntry[] = [
      {
        id: "fb_test1",
        agentId: testAgentId,
        type: "positive",
        context: {
          userQuery: "How do I test?",
          suggestion: "Use vitest for testing",
        },
        timestamp: new Date().toISOString(),
      },
    ];

    await saveFeedback(testAgentId, entries);
    const loaded = await loadFeedback(testAgentId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("fb_test1");
    expect(loaded[0].type).toBe("positive");
  });

  it("records feedback and generates unique IDs", async () => {
    const context: SuggestionContext = {
      userQuery: "What is TypeScript?",
      suggestion: "TypeScript is a typed superset of JavaScript",
    };

    const entry1 = await recordFeedback(testAgentId, "positive", context);
    const entry2 = await recordFeedback(testAgentId, "negative", context);

    expect(entry1.id).not.toBe(entry2.id);
    expect(entry1.id).toMatch(/^fb_/);
    expect(entry2.id).toMatch(/^fb_/);

    const loaded = await loadFeedback(testAgentId);
    expect(loaded).toHaveLength(2);
  });

  it("records positive feedback with helper", async () => {
    const context: SuggestionContext = {
      userQuery: "Help me",
      suggestion: "Here is my help",
    };

    const entry = await recordPositiveFeedback(testAgentId, context, {
      sessionId: "session-1",
      comment: "Very helpful!",
    });

    expect(entry.type).toBe("positive");
    expect(entry.sessionId).toBe("session-1");
    expect(entry.comment).toBe("Very helpful!");
  });

  it("records negative feedback with helper", async () => {
    const context: SuggestionContext = {
      userQuery: "Help me",
      suggestion: "Here is my help",
    };

    const entry = await recordNegativeFeedback(testAgentId, context);

    expect(entry.type).toBe("negative");
  });
});

describe("feedback statistics", () => {
  const testAgentId = "stats-agent";

  it("returns zero stats for empty feedback", async () => {
    const stats = await getFeedbackStats(testAgentId);

    expect(stats.positiveCount).toBe(0);
    expect(stats.negativeCount).toBe(0);
    expect(stats.positiveRatio).toBe(0);
    expect(stats.byCategory).toEqual({});
  });

  it("calculates correct statistics", async () => {
    const codeContext: SuggestionContext = {
      userQuery: "Write code",
      suggestion: "Here is the code",
      category: "code",
    };

    const explainContext: SuggestionContext = {
      userQuery: "Explain this",
      suggestion: "This is the explanation",
      category: "explanation",
    };

    await recordPositiveFeedback(testAgentId, codeContext);
    await recordPositiveFeedback(testAgentId, codeContext);
    await recordNegativeFeedback(testAgentId, codeContext);
    await recordPositiveFeedback(testAgentId, explainContext);

    const stats = await getFeedbackStats(testAgentId);

    expect(stats.positiveCount).toBe(3);
    expect(stats.negativeCount).toBe(1);
    expect(stats.positiveRatio).toBe(0.75);
    expect(stats.byCategory.code).toEqual({ positive: 2, negative: 1 });
    expect(stats.byCategory.explanation).toEqual({ positive: 1, negative: 0 });
  });
});

describe("feedback patterns", () => {
  const testAgentId = "pattern-agent";

  it("returns empty array when no patterns exist", async () => {
    const patterns = await loadPatterns(testAgentId);
    expect(patterns).toEqual([]);
  });

  it("saves and loads patterns", async () => {
    const patterns: FeedbackPattern[] = [
      {
        pattern: "code:testing_vitest",
        positiveCount: 5,
        negativeCount: 1,
        score: 0.6,
        lastUpdated: new Date().toISOString(),
      },
    ];

    await savePatterns(testAgentId, patterns);
    const loaded = await loadPatterns(testAgentId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].pattern).toBe("code:testing_vitest");
  });

  it("updates patterns when feedback is recorded", async () => {
    const context: SuggestionContext = {
      userQuery: "How do I write tests?",
      suggestion: "Use vitest for testing",
      category: "code",
    };

    // Record multiple feedback entries
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);
    await recordNegativeFeedback(testAgentId, context);

    const patterns = await loadPatterns(testAgentId);

    expect(patterns.length).toBeGreaterThan(0);
    const pattern = patterns[0];
    expect(pattern.positiveCount).toBe(3);
    expect(pattern.negativeCount).toBe(1);
    // With 3 positive and 1 negative (75% positive), score should be positive
    expect(pattern.score).toBeGreaterThan(0);
  });

  it("returns neutral score for insufficient data", async () => {
    const context: SuggestionContext = {
      userQuery: "Random question here",
      suggestion: "Random answer",
    };

    // Only 2 feedback entries (below threshold of 3)
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);

    const score = await getPatternScore(testAgentId, context);
    expect(score).toBe(0);
  });

  it("returns pattern score for sufficient data", async () => {
    const context: SuggestionContext = {
      userQuery: "Testing patterns work",
      suggestion: "Yes they do",
      category: "testing",
    };

    // 4 positive, 1 negative = 80% positive
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);
    await recordPositiveFeedback(testAgentId, context);
    await recordNegativeFeedback(testAgentId, context);

    const score = await getPatternScore(testAgentId, context);
    expect(score).toBeGreaterThan(0);
  });

  it("gets top patterns sorted by absolute score", async () => {
    // Create patterns with different feedback profiles
    const goodContext: SuggestionContext = {
      userQuery: "Good pattern here",
      suggestion: "Good response",
      category: "good",
    };

    const badContext: SuggestionContext = {
      userQuery: "Bad pattern here",
      suggestion: "Bad response",
      category: "bad",
    };

    // Good pattern: 4 positive, 0 negative
    for (let i = 0; i < 4; i++) {
      await recordPositiveFeedback(testAgentId, goodContext);
    }

    // Bad pattern: 0 positive, 4 negative
    for (let i = 0; i < 4; i++) {
      await recordNegativeFeedback(testAgentId, badContext);
    }

    const topPatterns = await getTopPatterns(testAgentId, 5);

    expect(topPatterns.length).toBe(2);
    // Both should have high absolute scores (at least 0.5)
    expect(Math.abs(topPatterns[0].score)).toBeGreaterThanOrEqual(0.5);
    expect(Math.abs(topPatterns[1].score)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("suggestion boost/demote", () => {
  const testAgentId = "boost-agent";

  it("demotes suggestions with negative feedback", async () => {
    const context: SuggestionContext = {
      userQuery: "This always fails",
      suggestion: "Bad suggestion",
      category: "failing",
    };

    // All negative feedback
    for (let i = 0; i < 5; i++) {
      await recordNegativeFeedback(testAgentId, context);
    }

    const shouldDemote = await shouldDemoteSuggestion(testAgentId, context);
    expect(shouldDemote).toBe(true);
  });

  it("boosts suggestions with positive feedback", async () => {
    const context: SuggestionContext = {
      userQuery: "This always works",
      suggestion: "Good suggestion",
      category: "working",
    };

    // All positive feedback
    for (let i = 0; i < 5; i++) {
      await recordPositiveFeedback(testAgentId, context);
    }

    const shouldBoost = await shouldBoostSuggestion(testAgentId, context);
    expect(shouldBoost).toBe(true);
  });

  it("does not demote/boost with insufficient data", async () => {
    const context: SuggestionContext = {
      userQuery: "New pattern",
      suggestion: "New suggestion",
    };

    await recordNegativeFeedback(testAgentId, context);

    const shouldDemote = await shouldDemoteSuggestion(testAgentId, context);
    const shouldBoost = await shouldBoostSuggestion(testAgentId, context);

    expect(shouldDemote).toBe(false);
    expect(shouldBoost).toBe(false);
  });
});

describe("parseFeedbackReaction", () => {
  it("detects thumbs up emoji", () => {
    expect(parseFeedbackReaction("👍")).toBe("positive");
    expect(parseFeedbackReaction("👍🏻")).toBe("positive");
    expect(parseFeedbackReaction("👍🏿")).toBe("positive");
  });

  it("detects thumbs down emoji", () => {
    expect(parseFeedbackReaction("👎")).toBe("negative");
    expect(parseFeedbackReaction("👎🏻")).toBe("negative");
    expect(parseFeedbackReaction("👎🏿")).toBe("negative");
  });

  it("detects +1 and -1", () => {
    expect(parseFeedbackReaction("+1")).toBe("positive");
    expect(parseFeedbackReaction("-1")).toBe("negative");
  });

  it("detects positive phrases", () => {
    expect(parseFeedbackReaction("good")).toBe("positive");
    expect(parseFeedbackReaction("Great!")).toBe("positive");
    expect(parseFeedbackReaction("perfect")).toBe("positive");
    expect(parseFeedbackReaction("Thanks")).toBe("positive");
    expect(parseFeedbackReaction("helpful")).toBe("positive");
    expect(parseFeedbackReaction("love it")).toBe("positive");
    expect(parseFeedbackReaction("excellent!")).toBe("positive");
  });

  it("detects negative phrases", () => {
    expect(parseFeedbackReaction("bad")).toBe("negative");
    expect(parseFeedbackReaction("wrong")).toBe("negative");
    expect(parseFeedbackReaction("unhelpful")).toBe("negative");
    expect(parseFeedbackReaction("not helpful")).toBe("negative");
    expect(parseFeedbackReaction("not good")).toBe("negative");
  });

  it("detects contextual positive phrases", () => {
    expect(parseFeedbackReaction("that's great")).toBe("positive");
    expect(parseFeedbackReaction("that's perfect")).toBe("positive");
    expect(parseFeedbackReaction("that's what I wanted")).toBe("positive");
  });

  it("detects contextual negative phrases", () => {
    expect(parseFeedbackReaction("that's wrong")).toBe("negative");
    expect(parseFeedbackReaction("thats not right")).toBe("negative");
    expect(parseFeedbackReaction("that's not what I wanted")).toBe("negative");
  });

  it("returns null for non-feedback messages", () => {
    expect(parseFeedbackReaction("How do I do this?")).toBeNull();
    expect(parseFeedbackReaction("Please help me with X")).toBeNull();
    expect(parseFeedbackReaction("Can you explain?")).toBeNull();
    expect(parseFeedbackReaction("")).toBeNull();
  });
});

describe("feedback loop hook", () => {
  const testAgentId = "hook-agent";

  it("returns cleanup function when disabled", () => {
    const cleanup = registerFeedbackLoopHook({ enabled: false });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("registers hook and captures feedback on reaction", async () => {
    const cleanup = registerFeedbackLoopHook({ enabled: true });

    // Set up a suggestion context
    const sessionKey = `${testAgentId}:session-1`;
    setSuggestionContext(sessionKey, {
      userQuery: "How do I test?",
      suggestion: "Use vitest for testing TypeScript projects",
    });

    // Trigger a turn with feedback reaction
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "👍",
        payloads: [],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Check that feedback was recorded
    const entries = await loadFeedback(testAgentId);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("positive");

    cleanup();
  });

  it("stores suggestion context from agent replies", async () => {
    const cleanup = registerFeedbackLoopHook({ enabled: true });

    // Trigger a turn with a suggestion
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-2",
        userMessage: "How do I write tests?",
        payloads: [{ text: "You can use vitest for testing. Here is an example..." }],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Now trigger feedback
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-2",
        userMessage: "perfect",
        payloads: [],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Check that feedback was recorded with context
    const entries = await loadFeedback(testAgentId);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("positive");
    expect(entries[0].context.userQuery).toBe("How do I write tests?");

    cleanup();
  });

  it("ignores short suggestions", async () => {
    const cleanup = registerFeedbackLoopHook({
      enabled: true,
      minSuggestionLength: 50,
    });

    // Trigger a turn with a short suggestion
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-3",
        userMessage: "Hi",
        payloads: [{ text: "Hello!" }],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Try to give feedback
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-3",
        userMessage: "👍",
        payloads: [],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Feedback should not be recorded because suggestion was too short
    const entries = await loadFeedback(testAgentId);
    expect(entries).toHaveLength(0);

    cleanup();
  });

  it("cleans up on unregister", async () => {
    const cleanup = registerFeedbackLoopHook({ enabled: true });

    // Set context
    setSuggestionContext(`${testAgentId}:test`, {
      userQuery: "Test",
      suggestion: "Test suggestion that is long enough",
    });

    cleanup();

    // Trigger after cleanup - should not record
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        userMessage: "👍",
        payloads: [],
      },
      timestamp: new Date(),
      messages: [],
    });

    const entries = await loadFeedback(testAgentId);
    expect(entries).toHaveLength(0);
  });
});

describe("path resolution", () => {
  it("resolves feedback path correctly", () => {
    const feedbackPath = resolveFeedbackPath("test-agent");
    expect(feedbackPath).toContain("agents");
    expect(feedbackPath).toContain("test-agent");
    expect(feedbackPath).toContain("feedback.json");
  });

  it("resolves patterns path correctly", () => {
    const patternsPath = resolvePatternsPath("test-agent");
    expect(patternsPath).toContain("agents");
    expect(patternsPath).toContain("test-agent");
    expect(patternsPath).toContain("feedback-patterns.json");
  });
});
