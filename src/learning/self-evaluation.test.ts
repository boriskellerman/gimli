import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  detectOutcomeSignal,
  calculateHelpfulnessScore,
  trackResponse,
  recordOutcome,
  loadTrackedResponses,
  saveTrackedResponses,
  getSelfEvaluationStats,
  processForLearnings,
  getResponsesForReview,
  getTopResponses,
  registerSelfEvaluationHook,
  clearTrackedResponseCache,
  setTrackedResponseCache,
  resolveEvaluationPath,
  SIGNAL_WEIGHTS,
  type TrackedResponse,
  type OutcomeSignal,
} from "./self-evaluation.js";
import { clearInternalHooks, triggerInternalHook } from "../hooks/internal-hooks.js";
import { loadLearnings } from "./learnings-store.js";

// Mock the paths module to use temp directory
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => testStateDir,
}));

let testStateDir: string;

beforeEach(async () => {
  testStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-self-eval-test-"));
  clearInternalHooks();
  clearTrackedResponseCache();
});

afterEach(async () => {
  clearInternalHooks();
  clearTrackedResponseCache();
  try {
    await fs.rm(testStateDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("outcome signal detection", () => {
  describe("explicit feedback", () => {
    it("detects positive feedback", () => {
      expect(detectOutcomeSignal("perfect!")).toBe("explicit-positive");
      expect(detectOutcomeSignal("excellent")).toBe("explicit-positive");
      expect(detectOutcomeSignal("great")).toBe("explicit-positive");
      expect(detectOutcomeSignal("Thanks!")).toBe("explicit-positive");
      expect(detectOutcomeSignal("that's exactly what I needed")).toBe("explicit-positive");
      expect(detectOutcomeSignal("love it")).toBe("explicit-positive");
    });

    it("detects negative feedback", () => {
      expect(detectOutcomeSignal("bad")).toBe("explicit-negative");
      expect(detectOutcomeSignal("terrible")).toBe("explicit-negative");
      expect(detectOutcomeSignal("useless")).toBe("explicit-negative");
      expect(detectOutcomeSignal("that's not helpful")).toBe("explicit-negative");
    });
  });

  describe("corrections", () => {
    it("detects correction signals", () => {
      expect(detectOutcomeSignal("no, that's wrong")).toBe("correction");
      expect(detectOutcomeSignal("incorrect")).toBe("correction");
      expect(detectOutcomeSignal("actually, I meant something else")).toBe("correction");
      expect(detectOutcomeSignal("I want a different approach")).toBe("correction");
      expect(detectOutcomeSignal("please stop doing that")).toBe("correction");
    });
  });

  describe("repetitions", () => {
    it("detects repetition signals", () => {
      expect(detectOutcomeSignal("I said to use TypeScript")).toBe("repetition");
      expect(detectOutcomeSignal("again, I need help")).toBe("repetition");
      expect(detectOutcomeSignal("I already asked for this")).toBe("repetition");
      expect(detectOutcomeSignal("that's not what I asked for")).toBe("repetition");
    });

    it("detects similarity-based repetition", () => {
      // Messages with high word overlap (>70%)
      const previousQuery = "please install nodejs and npm on the server";
      const similarMessage = "install nodejs and npm on the server please";

      expect(detectOutcomeSignal(similarMessage, previousQuery)).toBe("repetition");
    });
  });

  describe("topic changes", () => {
    it("detects topic change signals", () => {
      expect(detectOutcomeSignal("anyway, moving on to something else")).toBe("topic-change");
      expect(detectOutcomeSignal("different question now")).toBe("topic-change");
      expect(detectOutcomeSignal("let's change topic")).toBe("topic-change");
      expect(detectOutcomeSignal("never mind, forget that")).toBe("topic-change");
    });
  });

  describe("adoption signals", () => {
    it("detects adoption signals", () => {
      expect(detectOutcomeSignal("ok, got it")).toBe("adoption");
      expect(detectOutcomeSignal("makes sense")).toBe("adoption");
      expect(detectOutcomeSignal("let me try that")).toBe("adoption");
      expect(detectOutcomeSignal("that worked!")).toBe("adoption");
      expect(detectOutcomeSignal("done")).toBe("adoption");
      expect(detectOutcomeSignal("I did it")).toBe("adoption");
    });
  });

  describe("follow-up questions", () => {
    it("detects follow-up question signals", () => {
      expect(detectOutcomeSignal("can you explain that more?")).toBe("follow-up-question");
      expect(detectOutcomeSignal("what do you mean?")).toBe("follow-up-question");
      expect(detectOutcomeSignal("I don't understand")).toBe("follow-up-question");
      expect(detectOutcomeSignal("can you be more specific?")).toBe("follow-up-question");
      expect(detectOutcomeSignal("how does that work?")).toBe("follow-up-question");
    });
  });

  describe("continuation", () => {
    it("detects continuation for normal messages", () => {
      expect(detectOutcomeSignal("next we should add error handling")).toBe("continuation");
      expect(detectOutcomeSignal("the API looks good so far")).toBe("continuation");
    });

    it("returns null for empty or short messages", () => {
      expect(detectOutcomeSignal("")).toBeNull();
      expect(detectOutcomeSignal("   ")).toBeNull();
      expect(detectOutcomeSignal("hi")).toBeNull();
    });
  });
});

describe("helpfulness score calculation", () => {
  it("returns 0 for empty signals", () => {
    expect(calculateHelpfulnessScore([])).toBe(0);
  });

  it("calculates positive score for positive signals", () => {
    const signals: OutcomeSignal[] = ["explicit-positive"];
    const score = calculateHelpfulnessScore(signals);
    expect(score).toBe(SIGNAL_WEIGHTS["explicit-positive"]);
    expect(score).toBeGreaterThan(0);
  });

  it("calculates negative score for negative signals", () => {
    const signals: OutcomeSignal[] = ["explicit-negative"];
    const score = calculateHelpfulnessScore(signals);
    expect(score).toBe(SIGNAL_WEIGHTS["explicit-negative"]);
    expect(score).toBeLessThan(0);
  });

  it("combines multiple signals", () => {
    const signals: OutcomeSignal[] = ["adoption", "explicit-positive"];
    const score = calculateHelpfulnessScore(signals);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("handles mixed signals", () => {
    const signals: OutcomeSignal[] = ["adoption", "follow-up-question"];
    const score = calculateHelpfulnessScore(signals);
    // adoption: 0.5, follow-up: -0.2 = 0.3, normalized by sqrt(2)
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(SIGNAL_WEIGHTS.adoption);
  });

  it("clamps score to -1 to 1 range", () => {
    const positiveSignals: OutcomeSignal[] = [
      "explicit-positive",
      "adoption",
      "adoption",
      "continuation",
    ];
    const negativeSignals: OutcomeSignal[] = [
      "explicit-negative",
      "correction",
      "repetition",
      "repetition",
    ];

    const positiveScore = calculateHelpfulnessScore(positiveSignals);
    const negativeScore = calculateHelpfulnessScore(negativeSignals);

    expect(positiveScore).toBeLessThanOrEqual(1);
    expect(positiveScore).toBeGreaterThanOrEqual(-1);
    expect(negativeScore).toBeLessThanOrEqual(1);
    expect(negativeScore).toBeGreaterThanOrEqual(-1);
  });
});

describe("response tracking", () => {
  const testAgentId = "test-agent";

  it("returns empty array when no responses exist", async () => {
    const responses = await loadTrackedResponses(testAgentId);
    expect(responses).toEqual([]);
  });

  it("saves and loads tracked responses", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_test1",
        agentId: testAgentId,
        sessionId: "session-1",
        userQuery: "How do I test?",
        response: "Use vitest for testing",
        timestamp: new Date().toISOString(),
        signals: [],
        helpfulnessScore: 0,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);
    const loaded = await loadTrackedResponses(testAgentId);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("eval_test1");
    expect(loaded[0].userQuery).toBe("How do I test?");
  });

  it("tracks a new response with generated ID", async () => {
    const tracked = await trackResponse(
      testAgentId,
      "session-1",
      "How do I test?",
      "Use vitest for testing TypeScript projects. Here is an example...",
    );

    expect(tracked.id).toMatch(/^eval_/);
    expect(tracked.agentId).toBe(testAgentId);
    expect(tracked.sessionId).toBe("session-1");
    expect(tracked.signals).toEqual([]);
    expect(tracked.helpfulnessScore).toBe(0);
    expect(tracked.processedForLearning).toBe(false);

    const loaded = await loadTrackedResponses(testAgentId);
    expect(loaded).toHaveLength(1);
  });

  it("truncates long responses", async () => {
    const longResponse = "x".repeat(1000);
    const tracked = await trackResponse(testAgentId, "session-1", "query", longResponse);

    expect(tracked.response.length).toBeLessThanOrEqual(500);
  });

  it("limits history size", async () => {
    // Track 5 responses with limit of 3
    for (let i = 0; i < 5; i++) {
      await trackResponse(testAgentId, `session-${i}`, `query-${i}`, "response content here", {
        maxHistorySize: 3,
      });
    }

    const loaded = await loadTrackedResponses(testAgentId);
    expect(loaded).toHaveLength(3);
    // Should have the most recent ones
    expect(loaded[0].userQuery).toBe("query-2");
    expect(loaded[2].userQuery).toBe("query-4");
  });

  it("includes optional category and tool calls", async () => {
    const tracked = await trackResponse(
      testAgentId,
      "session-1",
      "query",
      "response content here",
      {
        category: "code",
        toolCalls: ["read_file", "write_file"],
      },
    );

    expect(tracked.category).toBe("code");
    expect(tracked.toolCalls).toEqual(["read_file", "write_file"]);
  });
});

describe("outcome recording", () => {
  const testAgentId = "outcome-agent";

  it("records outcome signal for tracked response", async () => {
    await trackResponse(testAgentId, "session-1", "How do I test?", "Use vitest for testing...");

    const result = await recordOutcome(testAgentId, "session-1", "adoption");

    expect(result).not.toBeNull();
    expect(result?.signals).toContain("adoption");
    expect(result?.helpfulnessScore).toBe(SIGNAL_WEIGHTS.adoption);
  });

  it("returns null when no response found for session", async () => {
    const result = await recordOutcome(testAgentId, "non-existent-session", "adoption");
    expect(result).toBeNull();
  });

  it("does not duplicate signals", async () => {
    await trackResponse(testAgentId, "session-1", "query", "response content here");

    await recordOutcome(testAgentId, "session-1", "adoption");
    await recordOutcome(testAgentId, "session-1", "adoption");

    const responses = await loadTrackedResponses(testAgentId);
    expect(responses[0].signals.filter((s) => s === "adoption")).toHaveLength(1);
  });

  it("accumulates multiple different signals", async () => {
    await trackResponse(testAgentId, "session-1", "query", "response content here");

    await recordOutcome(testAgentId, "session-1", "adoption");
    await recordOutcome(testAgentId, "session-1", "explicit-positive");

    const responses = await loadTrackedResponses(testAgentId);
    expect(responses[0].signals).toContain("adoption");
    expect(responses[0].signals).toContain("explicit-positive");
    expect(responses[0].helpfulnessScore).toBeGreaterThan(SIGNAL_WEIGHTS.adoption);
  });

  it("skips already processed responses", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_processed",
        agentId: testAgentId,
        sessionId: "session-1",
        userQuery: "query",
        response: "response",
        timestamp: new Date().toISOString(),
        signals: ["adoption"],
        helpfulnessScore: 0.5,
        processedForLearning: true, // Already processed
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const result = await recordOutcome(testAgentId, "session-1", "explicit-positive");
    expect(result).toBeNull();
  });
});

describe("self-evaluation statistics", () => {
  const testAgentId = "stats-agent";

  it("returns empty stats for no responses", async () => {
    const stats = await getSelfEvaluationStats(testAgentId);

    expect(stats.totalResponses).toBe(0);
    expect(stats.avgHelpfulness).toBe(0);
    expect(stats.recentTrend).toBe("stable");
  });

  it("calculates correct statistics", async () => {
    // Create responses with various signals
    const responses: TrackedResponse[] = [
      {
        id: "eval_1",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "q1",
        response: "r1",
        category: "code",
        timestamp: new Date().toISOString(),
        signals: ["adoption", "explicit-positive"],
        helpfulnessScore: 0.8,
        processedForLearning: false,
      },
      {
        id: "eval_2",
        agentId: testAgentId,
        sessionId: "s2",
        userQuery: "q2",
        response: "r2",
        category: "code",
        timestamp: new Date().toISOString(),
        signals: ["correction"],
        helpfulnessScore: -0.6,
        processedForLearning: false,
      },
      {
        id: "eval_3",
        agentId: testAgentId,
        sessionId: "s3",
        userQuery: "q3",
        response: "r3",
        category: "explanation",
        timestamp: new Date().toISOString(),
        signals: ["continuation"],
        helpfulnessScore: 0.2,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const stats = await getSelfEvaluationStats(testAgentId);

    expect(stats.totalResponses).toBe(3);
    expect(stats.avgHelpfulness).toBeCloseTo((0.8 - 0.6 + 0.2) / 3, 2);
    expect(stats.signalCounts.adoption).toBe(1);
    expect(stats.signalCounts["explicit-positive"]).toBe(1);
    expect(stats.signalCounts.correction).toBe(1);
    expect(stats.signalCounts.continuation).toBe(1);
    expect(stats.byCategory.code.count).toBe(2);
    expect(stats.byCategory.explanation.count).toBe(1);
  });

  it("detects improving trend", async () => {
    const responses: TrackedResponse[] = [];

    // 10 old responses with low scores
    for (let i = 0; i < 10; i++) {
      responses.push({
        id: `eval_old_${i}`,
        agentId: testAgentId,
        sessionId: `s${i}`,
        userQuery: `q${i}`,
        response: `r${i}`,
        timestamp: new Date(Date.now() - 1000 * i).toISOString(),
        signals: ["correction"],
        helpfulnessScore: -0.3,
        processedForLearning: false,
      });
    }

    // 10 recent responses with high scores
    for (let i = 10; i < 20; i++) {
      responses.push({
        id: `eval_new_${i}`,
        agentId: testAgentId,
        sessionId: `s${i}`,
        userQuery: `q${i}`,
        response: `r${i}`,
        timestamp: new Date(Date.now() + 1000 * i).toISOString(),
        signals: ["adoption"],
        helpfulnessScore: 0.5,
        processedForLearning: false,
      });
    }

    await saveTrackedResponses(testAgentId, responses);

    const stats = await getSelfEvaluationStats(testAgentId);
    expect(stats.recentTrend).toBe("improving");
  });

  it("detects declining trend", async () => {
    const responses: TrackedResponse[] = [];

    // 10 old responses with high scores
    for (let i = 0; i < 10; i++) {
      responses.push({
        id: `eval_old_${i}`,
        agentId: testAgentId,
        sessionId: `s${i}`,
        userQuery: `q${i}`,
        response: `r${i}`,
        timestamp: new Date(Date.now() - 1000 * i).toISOString(),
        signals: ["adoption"],
        helpfulnessScore: 0.5,
        processedForLearning: false,
      });
    }

    // 10 recent responses with low scores
    for (let i = 10; i < 20; i++) {
      responses.push({
        id: `eval_new_${i}`,
        agentId: testAgentId,
        sessionId: `s${i}`,
        userQuery: `q${i}`,
        response: `r${i}`,
        timestamp: new Date(Date.now() + 1000 * i).toISOString(),
        signals: ["correction"],
        helpfulnessScore: -0.3,
        processedForLearning: false,
      });
    }

    await saveTrackedResponses(testAgentId, responses);

    const stats = await getSelfEvaluationStats(testAgentId);
    expect(stats.recentTrend).toBe("declining");
  });
});

describe("learning generation", () => {
  const testAgentId = "learning-agent";

  it("generates positive learning for high-score response", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_positive",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "How do I test my TypeScript code?",
        response: "Use vitest for testing...",
        timestamp: new Date().toISOString(),
        signals: ["adoption", "explicit-positive"],
        helpfulnessScore: 0.6,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const count = await processForLearnings(testAgentId);

    expect(count).toBe(1);

    const learnings = await loadLearnings(testAgentId);
    expect(learnings).toHaveLength(1);
    expect(learnings[0].category).toBe("pattern");
    expect(learnings[0].content).toContain("Effective approach");
  });

  it("generates correction learning for low-score response", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_negative",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "How do I fix this bug?",
        response: "Try restarting...",
        timestamp: new Date().toISOString(),
        signals: ["correction", "explicit-negative"],
        helpfulnessScore: -0.5,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const count = await processForLearnings(testAgentId);

    expect(count).toBe(1);

    const learnings = await loadLearnings(testAgentId);
    expect(learnings).toHaveLength(1);
    expect(learnings[0].category).toBe("correction");
    expect(learnings[0].content).toContain("needs improvement");
  });

  it("skips already processed responses", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_processed",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "query",
        response: "response",
        timestamp: new Date().toISOString(),
        signals: ["adoption", "explicit-positive"],
        helpfulnessScore: 0.6,
        processedForLearning: true,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const count = await processForLearnings(testAgentId);
    expect(count).toBe(0);
  });

  it("requires minimum signals for learning", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_few_signals",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "query",
        response: "response",
        timestamp: new Date().toISOString(),
        signals: ["adoption"], // Only 1 signal
        helpfulnessScore: 0.5,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const count = await processForLearnings(testAgentId, { minSignalsForLearning: 2 });
    expect(count).toBe(0);
  });

  it("marks responses as processed after learning generation", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_to_process",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "query",
        response: "response",
        timestamp: new Date().toISOString(),
        signals: ["adoption", "explicit-positive"],
        helpfulnessScore: 0.6,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);
    await processForLearnings(testAgentId);

    const loaded = await loadTrackedResponses(testAgentId);
    expect(loaded[0].processedForLearning).toBe(true);
  });
});

describe("response queries", () => {
  const testAgentId = "query-agent";

  it("gets responses needing review (negative scores)", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_good",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "q1",
        response: "r1",
        timestamp: new Date().toISOString(),
        signals: ["adoption"],
        helpfulnessScore: 0.5,
        processedForLearning: false,
      },
      {
        id: "eval_bad1",
        agentId: testAgentId,
        sessionId: "s2",
        userQuery: "q2",
        response: "r2",
        timestamp: new Date().toISOString(),
        signals: ["correction"],
        helpfulnessScore: -0.3,
        processedForLearning: false,
      },
      {
        id: "eval_bad2",
        agentId: testAgentId,
        sessionId: "s3",
        userQuery: "q3",
        response: "r3",
        timestamp: new Date().toISOString(),
        signals: ["correction", "repetition"],
        helpfulnessScore: -0.7,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const forReview = await getResponsesForReview(testAgentId);

    expect(forReview).toHaveLength(2);
    // Should be sorted by score (lowest first)
    expect(forReview[0].id).toBe("eval_bad2");
    expect(forReview[1].id).toBe("eval_bad1");
  });

  it("excludes processed responses from review", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_processed",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "q1",
        response: "r1",
        timestamp: new Date().toISOString(),
        signals: ["correction"],
        helpfulnessScore: -0.5,
        processedForLearning: true,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const forReview = await getResponsesForReview(testAgentId);
    expect(forReview).toHaveLength(0);
  });

  it("gets top performing responses", async () => {
    const responses: TrackedResponse[] = [
      {
        id: "eval_best",
        agentId: testAgentId,
        sessionId: "s1",
        userQuery: "q1",
        response: "r1",
        timestamp: new Date().toISOString(),
        signals: ["adoption", "explicit-positive"],
        helpfulnessScore: 0.9,
        processedForLearning: false,
      },
      {
        id: "eval_good",
        agentId: testAgentId,
        sessionId: "s2",
        userQuery: "q2",
        response: "r2",
        timestamp: new Date().toISOString(),
        signals: ["adoption"],
        helpfulnessScore: 0.5,
        processedForLearning: false,
      },
      {
        id: "eval_no_signals",
        agentId: testAgentId,
        sessionId: "s3",
        userQuery: "q3",
        response: "r3",
        timestamp: new Date().toISOString(),
        signals: [],
        helpfulnessScore: 0,
        processedForLearning: false,
      },
    ];

    await saveTrackedResponses(testAgentId, responses);

    const topResponses = await getTopResponses(testAgentId);

    expect(topResponses).toHaveLength(2); // Excludes response with no signals
    expect(topResponses[0].id).toBe("eval_best");
    expect(topResponses[1].id).toBe("eval_good");
  });

  it("respects limit parameter", async () => {
    const responses: TrackedResponse[] = [];
    for (let i = 0; i < 10; i++) {
      responses.push({
        id: `eval_${i}`,
        agentId: testAgentId,
        sessionId: `s${i}`,
        userQuery: `q${i}`,
        response: `r${i}`,
        timestamp: new Date().toISOString(),
        signals: ["adoption"],
        helpfulnessScore: i * 0.1,
        processedForLearning: false,
      });
    }

    await saveTrackedResponses(testAgentId, responses);

    const top3 = await getTopResponses(testAgentId, 3);
    expect(top3).toHaveLength(3);
  });
});

describe("self-evaluation hook", () => {
  const testAgentId = "hook-agent";

  it("returns cleanup function when disabled", () => {
    const cleanup = registerSelfEvaluationHook({ enabled: false });
    expect(typeof cleanup).toBe("function");
    cleanup();
  });

  it("tracks responses from agent turns", async () => {
    const cleanup = registerSelfEvaluationHook({ enabled: true, minResponseLength: 10 });

    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "How do I test my code?",
        payloads: [{ text: "Use vitest for testing TypeScript projects." }],
      },
      timestamp: new Date(),
      messages: [],
    });

    const responses = await loadTrackedResponses(testAgentId);
    expect(responses).toHaveLength(1);
    expect(responses[0].userQuery).toBe("How do I test my code?");

    cleanup();
  });

  it("records outcome signals from follow-up messages", async () => {
    const cleanup = registerSelfEvaluationHook({ enabled: true, minResponseLength: 10 });

    // First turn: agent gives response
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "How do I test?",
        payloads: [{ text: "Use vitest for testing." }],
      },
      timestamp: new Date(),
      messages: [],
    });

    // Set up the tracked response in cache
    const responses = await loadTrackedResponses(testAgentId);
    setTrackedResponseCache(`${testAgentId}:session-1`, responses[0]);

    // Second turn: user gives feedback
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "perfect!",
        payloads: [],
      },
      timestamp: new Date(),
      messages: [],
    });

    const updatedResponses = await loadTrackedResponses(testAgentId);
    expect(updatedResponses[0].signals).toContain("explicit-positive");

    cleanup();
  });

  it("ignores short responses", async () => {
    const cleanup = registerSelfEvaluationHook({ enabled: true, minResponseLength: 50 });

    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "Hi",
        payloads: [{ text: "Hello!" }],
      },
      timestamp: new Date(),
      messages: [],
    });

    const responses = await loadTrackedResponses(testAgentId);
    expect(responses).toHaveLength(0);

    cleanup();
  });

  it("cleans up on unregister", async () => {
    const cleanup = registerSelfEvaluationHook({ enabled: true });

    cleanup();

    // Trigger after cleanup - should not track
    await triggerInternalHook({
      type: "agent",
      action: "turn:complete",
      sessionKey: testAgentId,
      context: {
        agentId: testAgentId,
        sessionId: "session-1",
        userMessage: "Test",
        payloads: [{ text: "This is a test response that should not be tracked." }],
      },
      timestamp: new Date(),
      messages: [],
    });

    const responses = await loadTrackedResponses(testAgentId);
    expect(responses).toHaveLength(0);
  });
});

describe("path resolution", () => {
  it("resolves evaluation path correctly", () => {
    const evalPath = resolveEvaluationPath("test-agent");
    expect(evalPath).toContain("agents");
    expect(evalPath).toContain("test-agent");
    expect(evalPath).toContain("self-evaluation.json");
  });
});

describe("signal weights", () => {
  it("has correct weight signs", () => {
    // Positive signals
    expect(SIGNAL_WEIGHTS.adoption).toBeGreaterThan(0);
    expect(SIGNAL_WEIGHTS["explicit-positive"]).toBeGreaterThan(0);
    expect(SIGNAL_WEIGHTS.continuation).toBeGreaterThan(0);

    // Negative signals
    expect(SIGNAL_WEIGHTS["follow-up-question"]).toBeLessThan(0);
    expect(SIGNAL_WEIGHTS["topic-change"]).toBeLessThan(0);
    expect(SIGNAL_WEIGHTS["explicit-negative"]).toBeLessThan(0);
    expect(SIGNAL_WEIGHTS.repetition).toBeLessThan(0);
    expect(SIGNAL_WEIGHTS.correction).toBeLessThan(0);
  });

  it("has weights in valid range", () => {
    for (const weight of Object.values(SIGNAL_WEIGHTS)) {
      expect(weight).toBeGreaterThanOrEqual(-1);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });
});
