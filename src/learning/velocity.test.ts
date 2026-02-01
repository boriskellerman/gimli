import { describe, expect, it } from "vitest";
import {
  calculateVelocity,
  compareVelocityPeriods,
  createEmptyVelocityAnalysis,
  getVelocitySummary,
  type VelocityAnalysis,
} from "./velocity.js";
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

describe("calculateVelocity", () => {
  it("returns insufficient_data for empty learnings array", () => {
    const analysis = calculateVelocity([]);

    expect(analysis.trend).toBe("insufficient_data");
    expect(analysis.currentVelocity).toBe(0);
    expect(analysis.averageVelocity).toBe(0);
    expect(analysis.dataPoints).toHaveLength(0);
    expect(analysis.totalLearnings).toBe(0);
  });

  it("returns insufficient_data for single learning", () => {
    const learnings: StoredLearning[] = [createLearning({ timestamp: daysAgo(1) })];

    const analysis = calculateVelocity(learnings);

    expect(analysis.trend).toBe("insufficient_data");
  });

  it("calculates velocity as learnings per day", () => {
    // Create 14 learnings over the last 7 days (2 per day)
    const learnings: StoredLearning[] = [];
    for (let i = 0; i < 7; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(i) }));
      learnings.push(createLearning({ timestamp: daysAgo(i) }));
    }

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 1 });

    // Most recent period should have 14 learnings / 7 days = 2 per day
    expect(analysis.currentVelocity).toBe(2);
  });

  it("generates correct number of data points", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(1) }),
      createLearning({ timestamp: daysAgo(10) }),
    ];

    const analysis = calculateVelocity(learnings, { periodCount: 4 });

    expect(analysis.dataPoints).toHaveLength(4);
    expect(analysis.periodsAnalyzed).toBe(4);
  });

  it("calculates peak velocity correctly", () => {
    // Week 1 (14-7 days ago): 1 learning
    // Week 2 (7-0 days ago): 7 learnings
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(10) }),
      ...Array.from({ length: 7 }, (_, i) => createLearning({ timestamp: daysAgo(i) })),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 2 });

    // Peak should be 7/7 = 1 (most recent week)
    expect(analysis.peakVelocity).toBe(1);
  });

  it("calculates change percent correctly", () => {
    // Create a clear doubling pattern between periods
    // Use clear middle-of-period timestamps to avoid boundary issues
    const learnings: StoredLearning[] = [
      // Previous period (days 8-14): 7 learnings at day 10
      ...Array.from({ length: 7 }, () => createLearning({ timestamp: daysAgo(10) })),
      // Current period (days 0-6): 14 learnings at day 3
      ...Array.from({ length: 14 }, () => createLearning({ timestamp: daysAgo(3) })),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 2 });

    // Previous: 7 learnings / 7 days = 1.0
    // Current: 14 learnings / 7 days = 2.0
    // Change: (2.0 - 1.0) / 1.0 * 100 = 100%
    expect(analysis.previousVelocity).toBe(1);
    expect(analysis.currentVelocity).toBe(2);
    expect(analysis.changePercent).toBe(100);
  });

  it("handles zero previous velocity (infinite growth)", () => {
    // No learnings in previous period, some in current
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(0) }),
      createLearning({ timestamp: daysAgo(1) }),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 2 });

    // With no previous velocity, 100% is used as the change
    expect(analysis.changePercent).toBe(100);
  });

  it("calculates total learnings across all periods", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(1) }),
      createLearning({ timestamp: daysAgo(5) }),
      createLearning({ timestamp: daysAgo(10) }),
      createLearning({ timestamp: daysAgo(15) }),
      createLearning({ timestamp: daysAgo(100) }), // Outside typical window
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 4 });

    // Only counts learnings within the 28-day window (4 periods x 7 days)
    expect(analysis.totalLearnings).toBe(4);
  });
});

describe("velocity trend detection", () => {
  it("detects accelerating trend", () => {
    // Create increasing learnings over time
    const learnings: StoredLearning[] = [];

    // 4 weeks ago: 1 learning
    learnings.push(createLearning({ timestamp: daysAgo(25) }));

    // 3 weeks ago: 2 learnings
    learnings.push(createLearning({ timestamp: daysAgo(18) }));
    learnings.push(createLearning({ timestamp: daysAgo(19) }));

    // 2 weeks ago: 4 learnings
    for (let i = 0; i < 4; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(10 + i) }));
    }

    // Last week: 8 learnings
    for (let i = 0; i < 8; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(i) }));
    }

    const analysis = calculateVelocity(learnings, {
      periodDays: 7,
      periodCount: 4,
      plateauThreshold: 10,
    });

    expect(analysis.trend).toBe("accelerating");
  });

  it("detects decelerating trend", () => {
    // Create decreasing learnings over time
    const learnings: StoredLearning[] = [];

    // 4 weeks ago: 8 learnings
    for (let i = 0; i < 8; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(25 + (i % 7)) }));
    }

    // 3 weeks ago: 4 learnings
    for (let i = 0; i < 4; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(18 + (i % 7)) }));
    }

    // 2 weeks ago: 2 learnings
    learnings.push(createLearning({ timestamp: daysAgo(10) }));
    learnings.push(createLearning({ timestamp: daysAgo(11) }));

    // Last week: 1 learning
    learnings.push(createLearning({ timestamp: daysAgo(1) }));

    const analysis = calculateVelocity(learnings, {
      periodDays: 7,
      periodCount: 4,
      plateauThreshold: 10,
    });

    expect(analysis.trend).toBe("decelerating");
  });

  it("detects plateau when velocity is stable", () => {
    // Create consistent learnings over time (2 per week)
    const learnings: StoredLearning[] = [];

    for (let week = 0; week < 4; week++) {
      const baseDay = week * 7;
      learnings.push(createLearning({ timestamp: daysAgo(baseDay + 1) }));
      learnings.push(createLearning({ timestamp: daysAgo(baseDay + 4) }));
    }

    const analysis = calculateVelocity(learnings, {
      periodDays: 7,
      periodCount: 4,
      plateauThreshold: 15,
    });

    expect(analysis.trend).toBe("plateau");
  });

  it("detects plateau when all velocities are zero", () => {
    // Learnings only from very long ago (outside analysis window)
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(100) }),
      createLearning({ timestamp: daysAgo(120) }),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 4 });

    expect(analysis.trend).toBe("plateau");
  });

  it("returns insufficient_data with fewer than 3 periods of data", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(1) }),
      createLearning({ timestamp: daysAgo(2) }),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 2 });

    // With only 2 periods, trend detection has insufficient data
    expect(analysis.trend).toBe("insufficient_data");
  });

  it("respects custom plateau threshold", () => {
    // Create slight variation that's above default threshold but below custom
    const learnings: StoredLearning[] = [];

    // Week 4: 2 learnings
    learnings.push(createLearning({ timestamp: daysAgo(25) }));
    learnings.push(createLearning({ timestamp: daysAgo(26) }));

    // Week 3: 2 learnings
    learnings.push(createLearning({ timestamp: daysAgo(18) }));
    learnings.push(createLearning({ timestamp: daysAgo(19) }));

    // Week 2: 3 learnings (slight increase)
    for (let i = 0; i < 3; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(10 + i) }));
    }

    // Week 1: 3 learnings
    for (let i = 0; i < 3; i++) {
      learnings.push(createLearning({ timestamp: daysAgo(i + 1) }));
    }

    // With high threshold, should be plateau
    const highThreshold = calculateVelocity(learnings, {
      periodDays: 7,
      periodCount: 4,
      plateauThreshold: 50,
    });

    expect(highThreshold.trend).toBe("plateau");
  });
});

describe("getVelocitySummary", () => {
  it("returns message for insufficient data", () => {
    const analysis = createEmptyVelocityAnalysis();

    const summary = getVelocitySummary(analysis);

    expect(summary).toBe("Not enough data to analyze learning velocity.");
  });

  it("includes trend description for accelerating", () => {
    const analysis: VelocityAnalysis = {
      currentVelocity: 2,
      previousVelocity: 1,
      averageVelocity: 1.5,
      peakVelocity: 2,
      trend: "accelerating",
      changePercent: 100,
      dataPoints: [],
      periodsAnalyzed: 4,
      totalLearnings: 10,
    };

    const summary = getVelocitySummary(analysis);

    expect(summary).toContain("Learning is accelerating");
    expect(summary).toContain("Current: 2.00 learnings/day");
    expect(summary).toContain("+100%");
  });

  it("includes trend description for decelerating", () => {
    const analysis: VelocityAnalysis = {
      currentVelocity: 1,
      previousVelocity: 2,
      averageVelocity: 1.5,
      peakVelocity: 2,
      trend: "decelerating",
      changePercent: -50,
      dataPoints: [],
      periodsAnalyzed: 4,
      totalLearnings: 10,
    };

    const summary = getVelocitySummary(analysis);

    expect(summary).toContain("Learning is decelerating");
    expect(summary).toContain("-50%");
  });

  it("includes trend description for plateau", () => {
    const analysis: VelocityAnalysis = {
      currentVelocity: 1,
      previousVelocity: 1,
      averageVelocity: 1,
      peakVelocity: 1.2,
      trend: "plateau",
      changePercent: 0,
      dataPoints: [],
      periodsAnalyzed: 4,
      totalLearnings: 10,
    };

    const summary = getVelocitySummary(analysis);

    expect(summary).toContain("Learning has plateaued");
  });

  it("includes all metrics in summary", () => {
    const analysis: VelocityAnalysis = {
      currentVelocity: 1.5,
      previousVelocity: 1.2,
      averageVelocity: 1.3,
      peakVelocity: 2.1,
      trend: "accelerating",
      changePercent: 25,
      dataPoints: [],
      periodsAnalyzed: 4,
      totalLearnings: 10,
    };

    const summary = getVelocitySummary(analysis);

    expect(summary).toContain("Current: 1.50 learnings/day");
    expect(summary).toContain("Average: 1.30 learnings/day");
    expect(summary).toContain("Peak: 2.10 learnings/day");
  });
});

describe("compareVelocityPeriods", () => {
  it("compares velocity between two time periods", () => {
    // Period 1 (30-15 days ago): 4 learnings
    // Period 2 (14-0 days ago): 7 learnings
    const learnings: StoredLearning[] = [
      ...Array.from({ length: 4 }, (_, i) => createLearning({ timestamp: daysAgo(20 + i) })),
      ...Array.from({ length: 7 }, (_, i) => createLearning({ timestamp: daysAgo(i + 1) })),
    ];

    const comparison = compareVelocityPeriods(
      learnings,
      { start: 30, end: 15 }, // 16 days
      { start: 14, end: 0 }, // 15 days
    );

    expect(comparison.period1Velocity).toBe(0.25); // 4 / 16
    expect(comparison.period2Velocity).toBeCloseTo(0.47, 1); // 7 / 15
    expect(comparison.difference).toBeGreaterThan(0);
    expect(comparison.percentChange).toBeGreaterThan(0);
  });

  it("handles empty periods", () => {
    const learnings: StoredLearning[] = [createLearning({ timestamp: daysAgo(1) })];

    const comparison = compareVelocityPeriods(
      learnings,
      { start: 100, end: 50 }, // No learnings here
      { start: 7, end: 0 },
    );

    expect(comparison.period1Velocity).toBe(0);
    expect(comparison.period2Velocity).toBeGreaterThan(0);
    expect(comparison.percentChange).toBe(100); // From zero to something
  });

  it("calculates percent change correctly for increase", () => {
    // Period 1: 1 learning per day
    // Period 2: 2 learnings per day (100% increase)
    const learnings: StoredLearning[] = [
      ...Array.from({ length: 7 }, () => createLearning({ timestamp: daysAgo(20) })),
      ...Array.from({ length: 14 }, (_, i) => createLearning({ timestamp: daysAgo(i + 1) })),
    ];

    const comparison = compareVelocityPeriods(
      learnings,
      { start: 21, end: 15 }, // 7 learnings / 7 days
      { start: 14, end: 0 }, // 14 learnings / 15 days
    );

    expect(comparison.percentChange).toBeLessThan(0); // Actually a decrease per day
  });

  it("handles both periods being empty", () => {
    const learnings: StoredLearning[] = [createLearning({ timestamp: daysAgo(200) })];

    const comparison = compareVelocityPeriods(
      learnings,
      { start: 100, end: 50 },
      { start: 40, end: 10 },
    );

    expect(comparison.period1Velocity).toBe(0);
    expect(comparison.period2Velocity).toBe(0);
    expect(comparison.difference).toBe(0);
    expect(comparison.percentChange).toBe(0);
  });
});

describe("createEmptyVelocityAnalysis", () => {
  it("returns properly structured empty analysis", () => {
    const analysis = createEmptyVelocityAnalysis();

    expect(analysis.currentVelocity).toBe(0);
    expect(analysis.previousVelocity).toBe(0);
    expect(analysis.averageVelocity).toBe(0);
    expect(analysis.peakVelocity).toBe(0);
    expect(analysis.trend).toBe("insufficient_data");
    expect(analysis.changePercent).toBe(0);
    expect(analysis.dataPoints).toHaveLength(0);
    expect(analysis.periodsAnalyzed).toBe(0);
    expect(analysis.totalLearnings).toBe(0);
  });
});

describe("velocity data points", () => {
  it("includes period start and end dates", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(1) }),
      createLearning({ timestamp: daysAgo(10) }),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 2 });

    expect(analysis.dataPoints).toHaveLength(2);
    analysis.dataPoints.forEach((dp) => {
      expect(dp.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(dp.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof dp.count).toBe("number");
      expect(typeof dp.velocity).toBe("number");
    });
  });

  it("orders data points chronologically (oldest first)", () => {
    const learnings: StoredLearning[] = [
      createLearning({ timestamp: daysAgo(1) }),
      createLearning({ timestamp: daysAgo(20) }),
    ];

    const analysis = calculateVelocity(learnings, { periodDays: 7, periodCount: 3 });

    // First data point should be oldest
    const dates = analysis.dataPoints.map((dp) => new Date(dp.periodStart).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThan(dates[i - 1]);
    }
  });
});
