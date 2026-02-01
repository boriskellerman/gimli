import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  calculateMetrics,
  calculateTrends,
  getTopLearnings,
  calculateAccuracyOverTime,
  createEmptyMetrics,
  type LearningMetrics,
} from "./metrics.js";
import type { StoredLearning } from "./learnings-store.js";

// Helper to create a stored learning
function createLearning(overrides: Partial<StoredLearning> = {}): StoredLearning {
  return {
    id: `l_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    category: "preference",
    content: "Test learning content",
    confidence: "medium",
    source: "user_message",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to create a date offset from now
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

describe("calculateMetrics", () => {
  it("returns empty metrics for empty learnings array", () => {
    const metrics = calculateMetrics([]);

    expect(metrics.total).toBe(0);
    expect(metrics.byCategory.preference).toBe(0);
    expect(metrics.byCategory.correction).toBe(0);
    expect(metrics.byCategory.pattern).toBe(0);
    expect(metrics.byCategory["tool-usage"]).toBe(0);
    expect(metrics.byConfidence.high).toBe(0);
    expect(metrics.byConfidence.medium).toBe(0);
    expect(metrics.byConfidence.low).toBe(0);
    expect(metrics.accuracyScore).toBe(0);
    expect(metrics.oldestLearning).toBeNull();
    expect(metrics.newestLearning).toBeNull();
  });

  it("calculates category breakdown correctly", () => {
    const learnings: StoredLearning[] = [
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
      createLearning({ category: "correction" }),
      createLearning({ category: "pattern" }),
      createLearning({ category: "tool-usage" }),
      createLearning({ category: "tool-usage" }),
    ];

    const metrics = calculateMetrics(learnings);

    expect(metrics.total).toBe(6);
    expect(metrics.byCategory.preference).toBe(2);
    expect(metrics.byCategory.correction).toBe(1);
    expect(metrics.byCategory.pattern).toBe(1);
    expect(metrics.byCategory["tool-usage"]).toBe(2);
  });

  it("calculates confidence breakdown correctly", () => {
    const learnings: StoredLearning[] = [
      createLearning({ confidence: "high" }),
      createLearning({ confidence: "high" }),
      createLearning({ confidence: "medium" }),
      createLearning({ confidence: "low" }),
    ];

    const metrics = calculateMetrics(learnings);

    expect(metrics.byConfidence.high).toBe(2);
    expect(metrics.byConfidence.medium).toBe(1);
    expect(metrics.byConfidence.low).toBe(1);
  });

  it("calculates source breakdown correctly", () => {
    const learnings: StoredLearning[] = [
      createLearning({ source: "user_message" }),
      createLearning({ source: "user_message" }),
      createLearning({ source: "success_pattern" }),
      createLearning({ source: "file" }),
      createLearning({ source: "unknown" }),
    ];

    const metrics = calculateMetrics(learnings);

    expect(metrics.bySource.userMessage).toBe(2);
    expect(metrics.bySource.successPattern).toBe(1);
    expect(metrics.bySource.file).toBe(1);
    expect(metrics.bySource.other).toBe(1);
  });

  it("calculates time-based metrics correctly", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(0) }), // today
      createLearning({ timestamp: daysAgo(0) }), // today
      createLearning({ timestamp: daysAgo(3) }), // 3 days ago
      createLearning({ timestamp: daysAgo(10) }), // 10 days ago
      createLearning({ timestamp: daysAgo(40) }), // 40 days ago (outside 30-day window)
    ];

    const metrics = calculateMetrics(learnings);

    expect(metrics.timeMetrics.last24Hours).toBe(2);
    expect(metrics.timeMetrics.last7Days).toBe(3);
    expect(metrics.timeMetrics.last30Days).toBe(4);
    expect(metrics.timeMetrics.avgPerDay).toBeCloseTo(4 / 30, 2);
  });

  it("tracks oldest and newest learning timestamps", () => {
    const oldDate = daysAgo(10);
    const newDate = daysAgo(0);

    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(5) }),
      createLearning({ timestamp: oldDate }),
      createLearning({ timestamp: newDate }),
    ];

    const metrics = calculateMetrics(learnings);

    expect(metrics.oldestLearning).toBe(new Date(oldDate).toISOString());
    expect(metrics.newestLearning).toBe(new Date(newDate).toISOString());
  });

  it("calculates accuracy score based on confidence distribution", () => {
    // All high confidence = 100
    const allHigh = calculateMetrics([
      createLearning({ confidence: "high" }),
      createLearning({ confidence: "high" }),
    ]);
    expect(allHigh.accuracyScore).toBe(100);

    // All medium confidence = 70
    const allMedium = calculateMetrics([
      createLearning({ confidence: "medium" }),
      createLearning({ confidence: "medium" }),
    ]);
    expect(allMedium.accuracyScore).toBe(70);

    // All low confidence = 40
    const allLow = calculateMetrics([
      createLearning({ confidence: "low" }),
      createLearning({ confidence: "low" }),
    ]);
    expect(allLow.accuracyScore).toBe(40);

    // Mix: 1 high (100), 1 medium (70), 1 low (40) = 210/3 = 70
    const mixed = calculateMetrics([
      createLearning({ confidence: "high" }),
      createLearning({ confidence: "medium" }),
      createLearning({ confidence: "low" }),
    ]);
    expect(mixed.accuracyScore).toBe(70);
  });
});

describe("calculateTrends", () => {
  it("returns empty array for empty learnings", () => {
    const trends = calculateTrends([], 7);
    expect(trends).toHaveLength(7);
    trends.forEach((t) => expect(t.count).toBe(0));
  });

  it("generates correct number of data points", () => {
    const trends = calculateTrends([], 30);
    expect(trends).toHaveLength(30);
  });

  it("groups learnings by date correctly", () => {
    const today = new Date().toISOString().split("T")[0];
    const todayTimestamp = new Date(today + "T12:00:00.000Z").toISOString();

    const learnings: StoredLearning[] = [
      createLearning({ timestamp: todayTimestamp, category: "preference" }),
      createLearning({ timestamp: todayTimestamp, category: "correction" }),
    ];

    const trends = calculateTrends(learnings, 7);
    const todayTrend = trends.find((t) => t.date === today);

    expect(todayTrend).toBeDefined();
    expect(todayTrend?.count).toBe(2);
    expect(todayTrend?.categories.preference).toBe(1);
    expect(todayTrend?.categories.correction).toBe(1);
  });

  it("includes category breakdown for each day", () => {
    const trends = calculateTrends([], 7);

    trends.forEach((t) => {
      expect(t.categories).toBeDefined();
      expect(t.categories.preference).toBe(0);
      expect(t.categories.correction).toBe(0);
      expect(t.categories.pattern).toBe(0);
      expect(t.categories["tool-usage"]).toBe(0);
    });
  });
});

describe("getTopLearnings", () => {
  it("returns empty array when no learnings match category", () => {
    const learnings: StoredLearning[] = [createLearning({ category: "preference" })];

    const top = getTopLearnings(learnings, "correction");
    expect(top).toHaveLength(0);
  });

  it("filters by category", () => {
    const learnings: StoredLearning[] = [
      createLearning({ category: "preference", content: "pref1" }),
      createLearning({ category: "correction", content: "corr1" }),
      createLearning({ category: "preference", content: "pref2" }),
    ];

    const top = getTopLearnings(learnings, "preference");
    expect(top).toHaveLength(2);
    expect(top.every((l) => l.content.startsWith("pref"))).toBe(true);
  });

  it("limits results to specified count", () => {
    const learnings: StoredLearning[] = [
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
      createLearning({ category: "preference" }),
    ];

    const top = getTopLearnings(learnings, "preference", 3);
    expect(top).toHaveLength(3);
  });

  it("sorts by confidence (high first)", () => {
    const learnings: StoredLearning[] = [
      createLearning({ category: "preference", confidence: "low", content: "low" }),
      createLearning({ category: "preference", confidence: "high", content: "high" }),
      createLearning({ category: "preference", confidence: "medium", content: "medium" }),
    ];

    const top = getTopLearnings(learnings, "preference");
    expect(top[0].confidence).toBe("high");
    expect(top[1].confidence).toBe("medium");
    expect(top[2].confidence).toBe("low");
  });

  it("sorts by timestamp within same confidence (newest first)", () => {
    const oldDate = daysAgo(10);
    const newDate = daysAgo(1);

    const learnings: StoredLearning[] = [
      createLearning({
        category: "preference",
        confidence: "high",
        timestamp: oldDate,
        content: "old",
      }),
      createLearning({
        category: "preference",
        confidence: "high",
        timestamp: newDate,
        content: "new",
      }),
    ];

    const top = getTopLearnings(learnings, "preference");
    expect(top[0].content).toBe("new");
    expect(top[1].content).toBe("old");
  });

  it("returns required fields in TopLearning", () => {
    const learnings: StoredLearning[] = [
      createLearning({
        category: "preference",
        id: "test_id",
        content: "test content",
        confidence: "high",
        timestamp: daysAgo(0),
      }),
    ];

    const top = getTopLearnings(learnings, "preference");
    expect(top[0]).toHaveProperty("id");
    expect(top[0]).toHaveProperty("content");
    expect(top[0]).toHaveProperty("confidence");
    expect(top[0]).toHaveProperty("timestamp");
  });
});

describe("calculateAccuracyOverTime", () => {
  it("returns empty array for no learnings", () => {
    const result = calculateAccuracyOverTime([]);
    expect(result).toHaveLength(0);
  });

  it("returns single point when data span is less than window", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(2), confidence: "high" }),
      createLearning({ timestamp: daysAgo(1), confidence: "high" }),
    ];

    const result = calculateAccuracyOverTime(learnings, 7, 10);
    expect(result).toHaveLength(1);
    expect(result[0].accuracy).toBe(100);
  });

  it("calculates rolling accuracy over time", () => {
    // Create learnings spread over 30 days
    const learnings: StoredLearning[] = [];

    // First 15 days: all low confidence
    for (let i = 30; i > 15; i--) {
      learnings.push(createLearning({ timestamp: daysAgo(i), confidence: "low" }));
    }

    // Last 15 days: all high confidence
    for (let i = 15; i >= 0; i--) {
      learnings.push(createLearning({ timestamp: daysAgo(i), confidence: "high" }));
    }

    const result = calculateAccuracyOverTime(learnings, 7, 5);

    // Should have multiple points
    expect(result.length).toBeGreaterThan(1);

    // Accuracy should increase over time (from low to high confidence)
    if (result.length >= 2) {
      const lastAccuracy = result[result.length - 1].accuracy;
      expect(lastAccuracy).toBe(100); // Recent learnings are all high confidence
    }
  });

  it("returns date and accuracy for each point", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(30), confidence: "medium" }),
      createLearning({ timestamp: daysAgo(20), confidence: "medium" }),
      createLearning({ timestamp: daysAgo(10), confidence: "high" }),
      createLearning({ timestamp: daysAgo(0), confidence: "high" }),
    ];

    const result = calculateAccuracyOverTime(learnings, 7, 3);

    result.forEach((point) => {
      expect(point).toHaveProperty("date");
      expect(point).toHaveProperty("accuracy");
      expect(typeof point.date).toBe("string");
      expect(typeof point.accuracy).toBe("number");
      expect(point.accuracy).toBeGreaterThanOrEqual(0);
      expect(point.accuracy).toBeLessThanOrEqual(100);
    });
  });
});

describe("createEmptyMetrics", () => {
  it("returns a properly structured empty metrics object", () => {
    const metrics = createEmptyMetrics();

    expect(metrics.total).toBe(0);
    expect(metrics.accuracyScore).toBe(0);
    expect(metrics.oldestLearning).toBeNull();
    expect(metrics.newestLearning).toBeNull();

    // Category metrics
    expect(metrics.byCategory.preference).toBe(0);
    expect(metrics.byCategory.correction).toBe(0);
    expect(metrics.byCategory.pattern).toBe(0);
    expect(metrics.byCategory["tool-usage"]).toBe(0);

    // Confidence metrics
    expect(metrics.byConfidence.high).toBe(0);
    expect(metrics.byConfidence.medium).toBe(0);
    expect(metrics.byConfidence.low).toBe(0);

    // Source metrics
    expect(metrics.bySource.userMessage).toBe(0);
    expect(metrics.bySource.successPattern).toBe(0);
    expect(metrics.bySource.file).toBe(0);
    expect(metrics.bySource.other).toBe(0);

    // Time metrics
    expect(metrics.timeMetrics.last24Hours).toBe(0);
    expect(metrics.timeMetrics.last7Days).toBe(0);
    expect(metrics.timeMetrics.last30Days).toBe(0);
    expect(metrics.timeMetrics.avgPerDay).toBe(0);
  });
});
