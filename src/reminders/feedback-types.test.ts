/**
 * Tests for reminder feedback types and utility functions
 */

import { describe, it, expect } from "vitest";

import {
  calculateEffectivenessScore,
  calculateTrend,
  generateAdjustmentSuggestions,
  rowToFeedbackEvent,
  feedbackEventToRow,
  defaultFeedbackConfig,
  type ReminderEffectivenessMetrics,
  type ReminderFeedbackRow,
  type ReminderFeedbackEvent,
} from "./feedback-types.js";

describe("calculateEffectivenessScore", () => {
  it("returns high score for high completion and low dismissal", () => {
    const score = calculateEffectivenessScore(0.9, 0.05, 30000); // 30s reaction
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns low score for low completion and high dismissal", () => {
    const score = calculateEffectivenessScore(0.1, 0.8, 300000); // 5min reaction
    expect(score).toBeLessThan(0.3);
  });

  it("weights completion rate highest", () => {
    const highCompletion = calculateEffectivenessScore(0.9, 0.5, null);
    const lowCompletion = calculateEffectivenessScore(0.1, 0.5, null);
    expect(highCompletion - lowCompletion).toBeGreaterThan(0.4);
  });

  it("gives bonus for quick reaction time", () => {
    const quickReaction = calculateEffectivenessScore(0.5, 0.3, 30000); // 30s
    const slowReaction = calculateEffectivenessScore(0.5, 0.3, 600000); // 10min
    expect(quickReaction).toBeGreaterThan(slowReaction);
  });

  it("handles null reaction time with neutral score", () => {
    const score = calculateEffectivenessScore(0.5, 0.3, null);
    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.8);
  });

  it("clamps score between 0 and 1", () => {
    const maxScore = calculateEffectivenessScore(1.0, 0, 1000);
    const minScore = calculateEffectivenessScore(0, 1.0, 1000000);
    expect(maxScore).toBeLessThanOrEqual(1);
    expect(minScore).toBeGreaterThanOrEqual(0);
  });

  it("penalizes high dismissal rate", () => {
    const lowDismissal = calculateEffectivenessScore(0.5, 0.1, null);
    const highDismissal = calculateEffectivenessScore(0.5, 0.9, null);
    expect(lowDismissal).toBeGreaterThan(highDismissal);
  });
});

describe("calculateTrend", () => {
  it("returns stable for insufficient data", () => {
    expect(calculateTrend([])).toBe("stable");
    expect(calculateTrend([0.5])).toBe("stable");
  });

  it("detects improving trend", () => {
    const scores = [0.3, 0.4, 0.5, 0.6, 0.7];
    expect(calculateTrend(scores)).toBe("improving");
  });

  it("detects declining trend", () => {
    const scores = [0.7, 0.6, 0.5, 0.4, 0.3];
    expect(calculateTrend(scores)).toBe("declining");
  });

  it("detects stable trend for flat data", () => {
    const scores = [0.5, 0.51, 0.49, 0.5, 0.5];
    expect(calculateTrend(scores)).toBe("stable");
  });

  it("uses only recent scores when window is smaller", () => {
    const scores = [0.2, 0.3, 0.8, 0.75, 0.7, 0.65, 0.6];
    // Only looks at last 5: [0.8, 0.75, 0.7, 0.65, 0.6] = declining
    expect(calculateTrend(scores, 5)).toBe("declining");
  });

  it("handles noisy data that trends up overall", () => {
    const scores = [0.3, 0.35, 0.32, 0.4, 0.38, 0.45, 0.5];
    expect(calculateTrend(scores)).toBe("improving");
  });
});

describe("generateAdjustmentSuggestions", () => {
  const baseMetrics: ReminderEffectivenessMetrics = {
    reminderId: "reminder-1",
    totalShowings: 10,
    reactionCounts: { completed: 5, dismissed: 2, snoozed: 1, ignored: 1, acted: 1 },
    completionRate: 0.5,
    dismissalRate: 0.2,
    avgReactionTimeMs: 60000,
    avgContextRelevanceScore: null,
    effectivenessScore: 0.5,
    trend: "stable",
    lastCalculatedAt: new Date(),
  };

  it("returns empty for insufficient data", () => {
    const lowShowings = { ...baseMetrics, totalShowings: 2 };
    const suggestions = generateAdjustmentSuggestions(lowShowings);
    expect(suggestions).toHaveLength(0);
  });

  it("suggests archive for high dismissal and low completion", () => {
    const poorPerformer: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      totalShowings: 15,
      dismissalRate: 0.7,
      completionRate: 0.05,
    };
    const suggestions = generateAdjustmentSuggestions(poorPerformer);
    expect(suggestions.some((s) => s.adjustmentType === "archive")).toBe(true);
  });

  it("suggests reduce_frequency for high dismissal rate", () => {
    const highDismissal: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      dismissalRate: 0.65,
      completionRate: 0.2,
    };
    const suggestions = generateAdjustmentSuggestions(highDismissal);
    expect(suggestions.some((s) => s.adjustmentType === "reduce_frequency")).toBe(true);
  });

  it("suggests change_priority for low effectiveness with declining trend", () => {
    const declining: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      effectivenessScore: 0.15,
      trend: "declining",
    };
    const suggestions = generateAdjustmentSuggestions(declining);
    expect(suggestions.some((s) => s.adjustmentType === "change_priority")).toBe(true);
  });

  it("suggests increase_frequency for high performers", () => {
    const highPerformer: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      completionRate: 0.85,
      effectivenessScore: 0.8,
    };
    const suggestions = generateAdjustmentSuggestions(highPerformer);
    expect(suggestions.some((s) => s.adjustmentType === "increase_frequency")).toBe(true);
  });

  it("suggests refine_context for low context relevance", () => {
    const lowRelevance: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      avgContextRelevanceScore: 0.2,
    };
    const suggestions = generateAdjustmentSuggestions(lowRelevance);
    expect(suggestions.some((s) => s.adjustmentType === "refine_context")).toBe(true);
  });

  it("includes supporting metrics in suggestions", () => {
    const highDismissal: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      dismissalRate: 0.65,
    };
    const suggestions = generateAdjustmentSuggestions(highDismissal);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].supportingMetrics).toBeDefined();
    expect(suggestions[0].supportingMetrics.showings).toBe(10);
  });

  it("respects custom threshold config", () => {
    const customConfig = {
      ...defaultFeedbackConfig,
      ineffectiveThreshold: 0.4, // Higher threshold
    };
    const borderline: ReminderEffectivenessMetrics = {
      ...baseMetrics,
      effectivenessScore: 0.35,
      trend: "declining",
    };
    const suggestions = generateAdjustmentSuggestions(borderline, customConfig);
    expect(suggestions.some((s) => s.adjustmentType === "change_priority")).toBe(true);
  });
});

describe("rowToFeedbackEvent", () => {
  it("converts database row to feedback event", () => {
    const row: ReminderFeedbackRow = {
      id: "feedback-1",
      reminder_id: "reminder-1",
      agent_id: "agent-1",
      session_key: "main",
      shown_at: 1706745600000,
      reaction: "completed",
      source: "explicit",
      recorded_at: 1706745660000,
      reaction_time_ms: 60000,
      context_relevance_score: 0.85,
      trigger_message: "What about that meeting?",
      user_response: "done",
    };

    const event = rowToFeedbackEvent(row);

    expect(event.id).toBe("feedback-1");
    expect(event.reminderId).toBe("reminder-1");
    expect(event.agentId).toBe("agent-1");
    expect(event.sessionKey).toBe("main");
    expect(event.shownAt).toBeInstanceOf(Date);
    expect(event.shownAt.getTime()).toBe(1706745600000);
    expect(event.reaction).toBe("completed");
    expect(event.source).toBe("explicit");
    expect(event.recordedAt).toBeInstanceOf(Date);
    expect(event.reactionTimeMs).toBe(60000);
    expect(event.contextRelevanceScore).toBe(0.85);
    expect(event.triggerMessage).toBe("What about that meeting?");
    expect(event.userResponse).toBe("done");
  });

  it("handles null optional fields", () => {
    const row: ReminderFeedbackRow = {
      id: "feedback-2",
      reminder_id: "reminder-2",
      agent_id: "agent-1",
      session_key: "main",
      shown_at: 1706745600000,
      reaction: "ignored",
      source: "timeout",
      recorded_at: 1706745900000,
      reaction_time_ms: null,
      context_relevance_score: null,
      trigger_message: null,
      user_response: null,
    };

    const event = rowToFeedbackEvent(row);

    expect(event.reactionTimeMs).toBeUndefined();
    expect(event.contextRelevanceScore).toBeUndefined();
    expect(event.triggerMessage).toBeUndefined();
    expect(event.userResponse).toBeUndefined();
  });
});

describe("feedbackEventToRow", () => {
  it("converts feedback event to database row", () => {
    const event: ReminderFeedbackEvent = {
      id: "feedback-1",
      reminderId: "reminder-1",
      agentId: "agent-1",
      sessionKey: "main",
      shownAt: new Date(1706745600000),
      reaction: "completed",
      source: "explicit",
      recordedAt: new Date(1706745660000),
      reactionTimeMs: 60000,
      contextRelevanceScore: 0.85,
      triggerMessage: "What about that meeting?",
      userResponse: "done",
    };

    const row = feedbackEventToRow(event);

    expect(row.id).toBe("feedback-1");
    expect(row.reminder_id).toBe("reminder-1");
    expect(row.agent_id).toBe("agent-1");
    expect(row.session_key).toBe("main");
    expect(row.shown_at).toBe(1706745600000);
    expect(row.reaction).toBe("completed");
    expect(row.source).toBe("explicit");
    expect(row.recorded_at).toBe(1706745660000);
    expect(row.reaction_time_ms).toBe(60000);
    expect(row.context_relevance_score).toBe(0.85);
    expect(row.trigger_message).toBe("What about that meeting?");
    expect(row.user_response).toBe("done");
  });

  it("converts undefined optional fields to null", () => {
    const event: ReminderFeedbackEvent = {
      id: "feedback-2",
      reminderId: "reminder-2",
      agentId: "agent-1",
      sessionKey: "main",
      shownAt: new Date(1706745600000),
      reaction: "ignored",
      source: "timeout",
      recordedAt: new Date(1706745900000),
    };

    const row = feedbackEventToRow(event);

    expect(row.reaction_time_ms).toBeNull();
    expect(row.context_relevance_score).toBeNull();
    expect(row.trigger_message).toBeNull();
    expect(row.user_response).toBeNull();
  });

  it("round-trips correctly", () => {
    const original: ReminderFeedbackEvent = {
      id: "feedback-3",
      reminderId: "reminder-3",
      agentId: "agent-1",
      sessionKey: "discord:group:123",
      shownAt: new Date(1706745600000),
      reaction: "snoozed",
      source: "inferred",
      recordedAt: new Date(1706745700000),
      reactionTimeMs: 100000,
      contextRelevanceScore: 0.65,
      triggerMessage: "reminder context",
      userResponse: "later",
    };

    const row = feedbackEventToRow(original);
    const restored = rowToFeedbackEvent(row);

    expect(restored.id).toBe(original.id);
    expect(restored.reminderId).toBe(original.reminderId);
    expect(restored.agentId).toBe(original.agentId);
    expect(restored.sessionKey).toBe(original.sessionKey);
    expect(restored.shownAt.getTime()).toBe(original.shownAt.getTime());
    expect(restored.reaction).toBe(original.reaction);
    expect(restored.source).toBe(original.source);
    expect(restored.recordedAt.getTime()).toBe(original.recordedAt.getTime());
    expect(restored.reactionTimeMs).toBe(original.reactionTimeMs);
    expect(restored.contextRelevanceScore).toBe(original.contextRelevanceScore);
    expect(restored.triggerMessage).toBe(original.triggerMessage);
    expect(restored.userResponse).toBe(original.userResponse);
  });
});

describe("defaultFeedbackConfig", () => {
  it("has sensible default values", () => {
    expect(defaultFeedbackConfig.enabled).toBe(true);
    expect(defaultFeedbackConfig.reactionWindowMs).toBe(5 * 60 * 1000);
    expect(defaultFeedbackConfig.minShowingsForMetrics).toBe(3);
    expect(defaultFeedbackConfig.metricsWindowDays).toBe(14);
    expect(defaultFeedbackConfig.ineffectiveThreshold).toBe(0.2);
    expect(defaultFeedbackConfig.effectiveThreshold).toBe(0.7);
    expect(defaultFeedbackConfig.autoApplyAdjustments).toBe(false);
    expect(defaultFeedbackConfig.autoApplyMinConfidence).toBe(0.8);
  });

  it("has ineffective threshold lower than effective threshold", () => {
    expect(defaultFeedbackConfig.ineffectiveThreshold).toBeLessThan(
      defaultFeedbackConfig.effectiveThreshold,
    );
  });
});
