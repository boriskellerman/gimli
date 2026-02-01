/**
 * Learning velocity metrics
 *
 * Tracks the rate of learning over time and detects whether
 * learning is accelerating, decelerating, or plateauing.
 */

import type { StoredLearning } from "./learnings-store.js";
import { loadLearnings } from "./learnings-store.js";

/**
 * Velocity trend classification
 */
export type VelocityTrend = "accelerating" | "decelerating" | "plateau" | "insufficient_data";

/**
 * Single velocity data point for a time period
 */
export interface VelocityDataPoint {
  /** Start of the period (ISO date string, e.g., "2024-01-15") */
  periodStart: string;
  /** End of the period (ISO date string) */
  periodEnd: string;
  /** Number of learnings in this period */
  count: number;
  /** Velocity: learnings per day in this period */
  velocity: number;
}

/**
 * Velocity analysis result
 */
export interface VelocityAnalysis {
  /** Current velocity (learnings per day over the most recent period) */
  currentVelocity: number;
  /** Previous period velocity for comparison */
  previousVelocity: number;
  /** Average velocity across all analyzed periods */
  averageVelocity: number;
  /** Peak velocity observed */
  peakVelocity: number;
  /** Classification of the trend */
  trend: VelocityTrend;
  /** Percentage change from previous to current period */
  changePercent: number;
  /** Velocity data points for charting */
  dataPoints: VelocityDataPoint[];
  /** Number of periods analyzed */
  periodsAnalyzed: number;
  /** Total learnings in the analysis window */
  totalLearnings: number;
}

/**
 * Velocity calculation options
 */
export interface VelocityOptions {
  /** Length of each period in days (default: 7) */
  periodDays?: number;
  /** Number of periods to analyze (default: 8) */
  periodCount?: number;
  /** Threshold for plateau detection as percent change (default: 10) */
  plateauThreshold?: number;
}

const DEFAULT_OPTIONS: Required<VelocityOptions> = {
  periodDays: 7,
  periodCount: 8,
  plateauThreshold: 10,
};

/**
 * Calculate velocity metrics from stored learnings
 */
export function calculateVelocity(
  learnings: StoredLearning[],
  options: VelocityOptions = {},
): VelocityAnalysis {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { periodDays, periodCount, plateauThreshold } = opts;

  // If not enough learnings for meaningful analysis
  if (learnings.length < 2) {
    return createInsufficientDataResult();
  }

  const now = new Date();
  const dataPoints: VelocityDataPoint[] = [];

  // Calculate data points for each period (most recent first, then reverse)
  for (let i = periodCount - 1; i >= 0; i--) {
    const periodEnd = new Date(now);
    periodEnd.setDate(periodEnd.getDate() - i * periodDays);
    periodEnd.setHours(23, 59, 59, 999);

    const periodStart = new Date(periodEnd);
    periodStart.setDate(periodStart.getDate() - periodDays + 1);
    periodStart.setHours(0, 0, 0, 0);

    const periodLearnings = learnings.filter((l) => {
      const ts = new Date(l.timestamp).getTime();
      return ts >= periodStart.getTime() && ts <= periodEnd.getTime();
    });

    const count = periodLearnings.length;
    const velocity = count / periodDays;

    dataPoints.push({
      periodStart: formatDate(periodStart),
      periodEnd: formatDate(periodEnd),
      count,
      velocity: Math.round(velocity * 100) / 100,
    });
  }

  // Calculate aggregate metrics
  const velocities = dataPoints.map((dp) => dp.velocity);
  const currentVelocity = velocities[velocities.length - 1] ?? 0;
  const previousVelocity = velocities[velocities.length - 2] ?? 0;
  const averageVelocity =
    velocities.length > 0
      ? Math.round((velocities.reduce((a, b) => a + b, 0) / velocities.length) * 100) / 100
      : 0;
  const peakVelocity = Math.max(...velocities, 0);
  const totalLearnings = dataPoints.reduce((sum, dp) => sum + dp.count, 0);

  // Calculate change percent
  const changePercent =
    previousVelocity > 0
      ? Math.round(((currentVelocity - previousVelocity) / previousVelocity) * 10000) / 100
      : currentVelocity > 0
        ? 100
        : 0;

  // Determine trend
  const trend = determineTrend(dataPoints, plateauThreshold);

  return {
    currentVelocity,
    previousVelocity,
    averageVelocity,
    peakVelocity,
    trend,
    changePercent,
    dataPoints,
    periodsAnalyzed: periodCount,
    totalLearnings,
  };
}

/**
 * Determine the velocity trend based on data points
 *
 * Uses linear regression to detect overall direction and
 * coefficient of variation to detect plateaus.
 */
function determineTrend(dataPoints: VelocityDataPoint[], plateauThreshold: number): VelocityTrend {
  const velocities = dataPoints.map((dp) => dp.velocity);

  // Need at least 3 data points for trend analysis
  if (velocities.length < 3) {
    return "insufficient_data";
  }

  // Check if all velocities are zero (no learning activity)
  if (velocities.every((v) => v === 0)) {
    return "plateau";
  }

  // Calculate linear regression slope
  const slope = calculateSlope(velocities);
  const avgVelocity = velocities.reduce((a, b) => a + b, 0) / velocities.length;

  // Normalize slope relative to average velocity
  // This gives us a percentage change per period
  const normalizedSlope = avgVelocity > 0 ? (slope / avgVelocity) * 100 : 0;

  // Check for plateau: small normalized slope
  if (Math.abs(normalizedSlope) < plateauThreshold) {
    return "plateau";
  }

  // Determine direction
  return normalizedSlope > 0 ? "accelerating" : "decelerating";
}

/**
 * Calculate the slope of a linear regression line
 * for a series of values (assuming evenly spaced x values)
 */
function calculateSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  // x values are 0, 1, 2, ... n-1
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * Format a date to ISO date string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Create an empty result for insufficient data
 */
function createInsufficientDataResult(): VelocityAnalysis {
  return {
    currentVelocity: 0,
    previousVelocity: 0,
    averageVelocity: 0,
    peakVelocity: 0,
    trend: "insufficient_data",
    changePercent: 0,
    dataPoints: [],
    periodsAnalyzed: 0,
    totalLearnings: 0,
  };
}

/**
 * Get velocity analysis for an agent
 */
export async function getAgentVelocity(
  agentId: string,
  options?: VelocityOptions,
): Promise<VelocityAnalysis> {
  const learnings = await loadLearnings(agentId);
  return calculateVelocity(learnings, options);
}

/**
 * Get a human-readable summary of the velocity analysis
 */
export function getVelocitySummary(analysis: VelocityAnalysis): string {
  if (analysis.trend === "insufficient_data") {
    return "Not enough data to analyze learning velocity.";
  }

  const trendDescriptions: Record<Exclude<VelocityTrend, "insufficient_data">, string> = {
    accelerating: "Learning is accelerating",
    decelerating: "Learning is decelerating",
    plateau: "Learning has plateaued",
  };

  const trendDesc = trendDescriptions[analysis.trend];
  const changeDesc =
    analysis.changePercent >= 0 ? `+${analysis.changePercent}%` : `${analysis.changePercent}%`;

  const parts = [
    trendDesc,
    `Current: ${analysis.currentVelocity.toFixed(2)} learnings/day`,
    `Change: ${changeDesc} from previous period`,
    `Average: ${analysis.averageVelocity.toFixed(2)} learnings/day`,
    `Peak: ${analysis.peakVelocity.toFixed(2)} learnings/day`,
  ];

  return parts.join(". ") + ".";
}

/**
 * Compare velocity between two time periods
 */
export function compareVelocityPeriods(
  learnings: StoredLearning[],
  period1Days: { start: number; end: number },
  period2Days: { start: number; end: number },
): { period1Velocity: number; period2Velocity: number; difference: number; percentChange: number } {
  const now = new Date();

  const getPeriodVelocity = (daysBack: { start: number; end: number }): number => {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() - daysBack.end);
    endDate.setHours(23, 59, 59, 999);

    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - daysBack.start);
    startDate.setHours(0, 0, 0, 0);

    const periodLearnings = learnings.filter((l) => {
      const ts = new Date(l.timestamp).getTime();
      return ts >= startDate.getTime() && ts <= endDate.getTime();
    });

    const periodDays = daysBack.start - daysBack.end + 1;
    return periodLearnings.length / periodDays;
  };

  const period1Velocity = Math.round(getPeriodVelocity(period1Days) * 100) / 100;
  const period2Velocity = Math.round(getPeriodVelocity(period2Days) * 100) / 100;
  const difference = Math.round((period2Velocity - period1Velocity) * 100) / 100;
  const percentChange =
    period1Velocity > 0
      ? Math.round((difference / period1Velocity) * 10000) / 100
      : period2Velocity > 0
        ? 100
        : 0;

  return { period1Velocity, period2Velocity, difference, percentChange };
}

/**
 * Create an empty velocity analysis result
 */
export function createEmptyVelocityAnalysis(): VelocityAnalysis {
  return createInsufficientDataResult();
}
