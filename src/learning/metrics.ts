/**
 * Learning metrics aggregation and dashboard support
 *
 * Tracks and aggregates metrics about learnings captured by the system,
 * including category breakdown, confidence levels, and accuracy over time.
 */

import type { StoredLearning, LearningsFile } from "./learnings-store.js";
import { loadLearnings } from "./learnings-store.js";
import type { LearningCategory, LearningConfidence } from "./extract-learnings.js";

/**
 * Category breakdown for learnings
 */
export interface CategoryMetrics {
  preference: number;
  correction: number;
  pattern: number;
  "tool-usage": number;
}

/**
 * Confidence level breakdown
 */
export interface ConfidenceMetrics {
  high: number;
  medium: number;
  low: number;
}

/**
 * Time-based metrics for tracking learning trends
 */
export interface TimeMetrics {
  /** Learnings added in the last 24 hours */
  last24Hours: number;
  /** Learnings added in the last 7 days */
  last7Days: number;
  /** Learnings added in the last 30 days */
  last30Days: number;
  /** Average learnings per day (last 30 days) */
  avgPerDay: number;
}

/**
 * Source breakdown for learnings
 */
export interface SourceMetrics {
  userMessage: number;
  successPattern: number;
  file: number;
  other: number;
}

/**
 * Aggregated learning metrics for dashboard
 */
export interface LearningMetrics {
  /** Total number of learnings */
  total: number;
  /** Breakdown by category */
  byCategory: CategoryMetrics;
  /** Breakdown by confidence level */
  byConfidence: ConfidenceMetrics;
  /** Breakdown by source */
  bySource: SourceMetrics;
  /** Time-based metrics */
  timeMetrics: TimeMetrics;
  /** Timestamp of oldest learning */
  oldestLearning: string | null;
  /** Timestamp of newest learning */
  newestLearning: string | null;
  /** Estimated accuracy score (0-100) based on confidence distribution */
  accuracyScore: number;
}

/**
 * Learning trend data point
 */
export interface LearningTrendPoint {
  date: string;
  count: number;
  categories: CategoryMetrics;
}

/**
 * Top learnings for a category
 */
export interface TopLearning {
  id: string;
  content: string;
  confidence: LearningConfidence;
  timestamp: string;
}

/**
 * Calculate metrics from a list of stored learnings
 */
export function calculateMetrics(learnings: StoredLearning[]): LearningMetrics {
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const sevenDays = 7 * oneDay;
  const thirtyDays = 30 * oneDay;

  const byCategory: CategoryMetrics = {
    preference: 0,
    correction: 0,
    pattern: 0,
    "tool-usage": 0,
  };

  const byConfidence: ConfidenceMetrics = {
    high: 0,
    medium: 0,
    low: 0,
  };

  const bySource: SourceMetrics = {
    userMessage: 0,
    successPattern: 0,
    file: 0,
    other: 0,
  };

  let last24Hours = 0;
  let last7Days = 0;
  let last30Days = 0;

  let oldestTimestamp: number | null = null;
  let newestTimestamp: number | null = null;

  for (const learning of learnings) {
    // Category breakdown
    byCategory[learning.category]++;

    // Confidence breakdown
    byConfidence[learning.confidence]++;

    // Source breakdown
    const source = learning.source;
    if (source === "user_message") {
      bySource.userMessage++;
    } else if (source === "success_pattern") {
      bySource.successPattern++;
    } else if (source === "file") {
      bySource.file++;
    } else {
      bySource.other++;
    }

    // Time-based metrics
    const timestamp = new Date(learning.timestamp).getTime();

    if (oldestTimestamp === null || timestamp < oldestTimestamp) {
      oldestTimestamp = timestamp;
    }
    if (newestTimestamp === null || timestamp > newestTimestamp) {
      newestTimestamp = timestamp;
    }

    const age = now - timestamp;
    if (age <= oneDay) {
      last24Hours++;
    }
    if (age <= sevenDays) {
      last7Days++;
    }
    if (age <= thirtyDays) {
      last30Days++;
    }
  }

  // Calculate average per day over last 30 days
  const avgPerDay = last30Days / 30;

  // Calculate accuracy score based on confidence distribution
  // Higher confidence learnings indicate better extraction accuracy
  const total = learnings.length;
  const accuracyScore =
    total > 0
      ? Math.round(
          ((byConfidence.high * 100 + byConfidence.medium * 70 + byConfidence.low * 40) / total) *
            100,
        ) / 100
      : 0;

  return {
    total,
    byCategory,
    byConfidence,
    bySource,
    timeMetrics: {
      last24Hours,
      last7Days,
      last30Days,
      avgPerDay: Math.round(avgPerDay * 100) / 100,
    },
    oldestLearning: oldestTimestamp ? new Date(oldestTimestamp).toISOString() : null,
    newestLearning: newestTimestamp ? new Date(newestTimestamp).toISOString() : null,
    accuracyScore,
  };
}

/**
 * Load and calculate metrics for an agent
 */
export async function getAgentLearningMetrics(agentId: string): Promise<LearningMetrics> {
  const learnings = await loadLearnings(agentId);
  return calculateMetrics(learnings);
}

/**
 * Calculate learning trends over time (daily breakdown)
 */
export function calculateTrends(
  learnings: StoredLearning[],
  days: number = 30,
): LearningTrendPoint[] {
  const now = new Date();
  const trends: LearningTrendPoint[] = [];

  // Create a map of date -> learnings
  const byDate = new Map<string, StoredLearning[]>();

  for (const learning of learnings) {
    const date = learning.timestamp.split("T")[0];
    const existing = byDate.get(date) || [];
    existing.push(learning);
    byDate.set(date, existing);
  }

  // Generate data points for each day
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    const dayLearnings = byDate.get(dateStr) || [];

    const categories: CategoryMetrics = {
      preference: 0,
      correction: 0,
      pattern: 0,
      "tool-usage": 0,
    };

    for (const l of dayLearnings) {
      categories[l.category]++;
    }

    trends.push({
      date: dateStr,
      count: dayLearnings.length,
      categories,
    });
  }

  return trends;
}

/**
 * Get top learnings by category (most recent, highest confidence first)
 */
export function getTopLearnings(
  learnings: StoredLearning[],
  category: LearningCategory,
  limit: number = 5,
): TopLearning[] {
  // Filter by category and sort by confidence then timestamp
  const confidenceOrder: Record<LearningConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return learnings
    .filter((l) => l.category === category)
    .sort((a, b) => {
      // Primary sort: confidence (high to low)
      const confDiff = confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      if (confDiff !== 0) return confDiff;

      // Secondary sort: timestamp (newest first)
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, limit)
    .map((l) => ({
      id: l.id,
      content: l.content,
      confidence: l.confidence,
      timestamp: l.timestamp,
    }));
}

/**
 * Get comprehensive dashboard data for an agent's learnings
 */
export async function getLearningDashboardData(
  agentId: string,
  trendDays: number = 30,
): Promise<{
  metrics: LearningMetrics;
  trends: LearningTrendPoint[];
  topByCategory: Record<LearningCategory, TopLearning[]>;
}> {
  const learnings = await loadLearnings(agentId);
  const metrics = calculateMetrics(learnings);
  const trends = calculateTrends(learnings, trendDays);

  const topByCategory: Record<LearningCategory, TopLearning[]> = {
    preference: getTopLearnings(learnings, "preference"),
    correction: getTopLearnings(learnings, "correction"),
    pattern: getTopLearnings(learnings, "pattern"),
    "tool-usage": getTopLearnings(learnings, "tool-usage"),
  };

  return { metrics, trends, topByCategory };
}

/**
 * Calculate accuracy over time (rolling window)
 */
export function calculateAccuracyOverTime(
  learnings: StoredLearning[],
  windowDays: number = 7,
  points: number = 10,
): Array<{ date: string; accuracy: number }> {
  if (learnings.length === 0) return [];

  const now = new Date();
  const result: Array<{ date: string; accuracy: number }> = [];

  // Sort learnings by timestamp
  const sorted = [...learnings].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Get date range
  const oldestDate = new Date(sorted[0].timestamp);
  const totalDays = Math.ceil((now.getTime() - oldestDate.getTime()) / (24 * 60 * 60 * 1000));

  if (totalDays < windowDays) {
    // Not enough data for rolling window
    const accuracy = calculateMetrics(learnings).accuracyScore;
    return [{ date: now.toISOString().split("T")[0], accuracy }];
  }

  // Calculate step size
  const step = Math.max(1, Math.floor((totalDays - windowDays) / (points - 1)));

  for (let i = 0; i < points; i++) {
    const endDate = new Date(oldestDate);
    endDate.setDate(endDate.getDate() + windowDays + i * step);

    if (endDate > now) break;

    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - windowDays);

    // Filter learnings in window
    const windowLearnings = sorted.filter((l) => {
      const ts = new Date(l.timestamp).getTime();
      return ts >= startDate.getTime() && ts <= endDate.getTime();
    });

    if (windowLearnings.length > 0) {
      const accuracy = calculateMetrics(windowLearnings).accuracyScore;
      result.push({
        date: endDate.toISOString().split("T")[0],
        accuracy,
      });
    }
  }

  return result;
}

/**
 * Create an empty metrics object
 */
export function createEmptyMetrics(): LearningMetrics {
  return {
    total: 0,
    byCategory: {
      preference: 0,
      correction: 0,
      pattern: 0,
      "tool-usage": 0,
    },
    byConfidence: {
      high: 0,
      medium: 0,
      low: 0,
    },
    bySource: {
      userMessage: 0,
      successPattern: 0,
      file: 0,
      other: 0,
    },
    timeMetrics: {
      last24Hours: 0,
      last7Days: 0,
      last30Days: 0,
      avgPerDay: 0,
    },
    oldestLearning: null,
    newestLearning: null,
    accuracyScore: 0,
  };
}
