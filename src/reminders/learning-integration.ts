/**
 * Learning integration for reminder effectiveness tracking
 *
 * Connects the reminder feedback system to Gimli's learning system,
 * enabling the agent to learn from reminder outcomes and improve
 * delivery strategies over time.
 */

import type { DatabaseSync } from "node:sqlite";

import type { ExtractedLearning } from "../learning/extract-learnings.js";
import { addLearning } from "../learning/learnings-store.js";
import type {
  ReminderReaction,
  ReminderEffectivenessMetrics,
  ReminderAdjustmentSuggestion,
  FeedbackSystemConfig,
} from "./feedback-types.js";
import {
  getFeedbackForReminder,
  getEffectivenessMetrics,
  upsertEffectivenessMetrics,
  getAgentFeedbackStats,
} from "./feedback-schema.js";
import {
  calculateEffectivenessScore,
  calculateTrend,
  generateAdjustmentSuggestions,
  defaultFeedbackConfig,
} from "./feedback-types.js";
import type { Reminder, ReminderPriority, ReminderTriggerType } from "./types.js";

/**
 * Outcome record for a reminder interaction
 */
export interface ReminderOutcome {
  reminderId: string;
  agentId: string;
  reaction: ReminderReaction;
  reactionTimeMs?: number;
  contextRelevanceScore?: number;
  userResponse?: string;
}

/**
 * Learning derived from reminder feedback
 */
export interface ReminderLearning extends ExtractedLearning {
  /** The reminder ID this learning relates to */
  reminderId: string;
  /** The effectiveness score at time of learning */
  effectivenessScore: number;
  /** Whether this was from a positive or negative outcome */
  outcomeType: "positive" | "negative" | "neutral";
}

/**
 * Weight factors for effectiveness score calculation
 */
const REACTION_WEIGHTS: Record<ReminderReaction, number> = {
  completed: 1.0, // Best outcome
  acted: 0.8, // User took related action
  snoozed: 0.3, // Not bad, user will address later
  dismissed: 0.1, // User didn't find it useful
  ignored: 0.0, // User didn't engage at all
};

/**
 * Calculate an effectiveness score for a single outcome
 */
export function calculateOutcomeScore(reaction: ReminderReaction): number {
  return REACTION_WEIGHTS[reaction];
}

/**
 * Record a reminder outcome and update effectiveness metrics
 */
export async function recordOutcome(
  db: DatabaseSync,
  outcome: ReminderOutcome,
): Promise<ReminderEffectivenessMetrics> {
  // Get existing feedback for the reminder
  const feedback = getFeedbackForReminder(db, outcome.reminderId);

  // Calculate counts by reaction
  const reactionCounts: Record<ReminderReaction, number> = {
    completed: 0,
    dismissed: 0,
    snoozed: 0,
    ignored: 0,
    acted: 0,
  };

  // Include the new outcome
  reactionCounts[outcome.reaction] = 1;

  // Count existing feedback
  for (const event of feedback) {
    reactionCounts[event.reaction]++;
  }

  const totalShowings = feedback.length + 1;
  const completedCount = reactionCounts.completed;
  const dismissedCount = reactionCounts.dismissed;
  const snoozedCount = reactionCounts.snoozed;
  const ignoredCount = reactionCounts.ignored;
  const actedCount = reactionCounts.acted;

  // Calculate rates
  const completionRate = completedCount / totalShowings;
  const dismissalRate = dismissedCount / totalShowings;

  // Calculate average reaction time
  const reactionTimes = feedback
    .filter((f) => f.reaction_time_ms !== null)
    .map((f) => f.reaction_time_ms as number);
  if (outcome.reactionTimeMs !== undefined) {
    reactionTimes.push(outcome.reactionTimeMs);
  }
  const avgReactionTimeMs =
    reactionTimes.length > 0
      ? reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length
      : null;

  // Calculate average context relevance
  const relevanceScores = feedback
    .filter((f) => f.context_relevance_score !== null)
    .map((f) => f.context_relevance_score as number);
  if (outcome.contextRelevanceScore !== undefined) {
    relevanceScores.push(outcome.contextRelevanceScore);
  }
  const avgContextRelevance =
    relevanceScores.length > 0
      ? relevanceScores.reduce((a, b) => a + b, 0) / relevanceScores.length
      : null;

  // Calculate effectiveness score
  const effectivenessScore = calculateEffectivenessScore(
    completionRate,
    dismissalRate,
    avgReactionTimeMs,
  );

  // Get existing metrics for trend calculation
  const existingMetrics = getEffectivenessMetrics(db, outcome.reminderId);
  const existingScores: number[] = existingMetrics?.recent_scores
    ? JSON.parse(existingMetrics.recent_scores)
    : [];

  // Add new score to recent scores (keep last 10)
  const recentScores = [...existingScores, effectivenessScore].slice(-10);
  const trend = calculateTrend(recentScores);

  // Update database
  upsertEffectivenessMetrics(db, {
    reminderId: outcome.reminderId,
    totalShowings,
    completedCount,
    dismissedCount,
    snoozedCount,
    ignoredCount,
    actedCount,
    completionRate,
    dismissalRate,
    avgReactionTimeMs,
    avgContextRelevance,
    effectivenessScore,
    trend,
    recentScores,
  });

  return {
    reminderId: outcome.reminderId,
    totalShowings,
    reactionCounts,
    completionRate,
    dismissalRate,
    avgReactionTimeMs,
    avgContextRelevanceScore: avgContextRelevance,
    effectivenessScore,
    trend,
    lastCalculatedAt: new Date(),
  };
}

/**
 * Convert a reminder outcome to a learning for the learning system
 */
export function outcomeToLearning(
  outcome: ReminderOutcome,
  reminder: Reminder,
  metrics: ReminderEffectivenessMetrics,
): ReminderLearning | null {
  const outcomeScore = calculateOutcomeScore(outcome.reaction);

  // Only create learnings for clear positive or negative outcomes
  if (outcomeScore >= 0.8) {
    // Positive outcome - user found reminder useful
    return {
      category: "pattern",
      content: buildPositiveLearningContent(reminder, outcome, metrics),
      confidence: metrics.totalShowings >= 3 ? "high" : "medium",
      source: "reminder_feedback",
      reminderId: outcome.reminderId,
      effectivenessScore: metrics.effectivenessScore,
      outcomeType: "positive",
    };
  } else if (outcomeScore <= 0.1 && metrics.totalShowings >= 3) {
    // Negative outcome - user consistently dismisses/ignores
    return {
      category: "correction",
      content: buildNegativeLearningContent(reminder, metrics),
      confidence: metrics.totalShowings >= 5 ? "high" : "medium",
      source: "reminder_feedback",
      reminderId: outcome.reminderId,
      effectivenessScore: metrics.effectivenessScore,
      outcomeType: "negative",
    };
  }

  return null;
}

/**
 * Build learning content for positive outcomes
 */
function buildPositiveLearningContent(
  reminder: Reminder,
  outcome: ReminderOutcome,
  metrics: ReminderEffectivenessMetrics,
): string {
  const parts: string[] = [];

  parts.push(`Reminder "${reminder.title}" is effective`);

  if (reminder.trigger.type === "context") {
    parts.push(`(context: ${reminder.trigger.pattern})`);
  } else if (reminder.trigger.type === "scheduled") {
    const hour = reminder.trigger.datetime.getHours();
    const timeLabel = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    parts.push(`(${timeLabel} timing works well)`);
  }

  if (metrics.completionRate > 0.7) {
    parts.push(`with ${Math.round(metrics.completionRate * 100)}% completion rate`);
  }

  return parts.join(" ");
}

/**
 * Build learning content for negative outcomes
 */
function buildNegativeLearningContent(
  reminder: Reminder,
  metrics: ReminderEffectivenessMetrics,
): string {
  const parts: string[] = [];

  parts.push(`Reminder "${reminder.title}" is not working well`);

  if (metrics.dismissalRate > 0.5) {
    parts.push(`- dismissed ${Math.round(metrics.dismissalRate * 100)}% of the time`);
  }

  if (reminder.trigger.type === "context" && metrics.avgContextRelevanceScore !== null) {
    if (metrics.avgContextRelevanceScore < 0.3) {
      parts.push("- context pattern may be too broad");
    }
  }

  if (metrics.trend === "declining") {
    parts.push("- effectiveness declining over time");
  }

  return parts.join(" ");
}

/**
 * Feed effectiveness data into the learning system
 */
export async function feedToLearningSystem(
  agentId: string,
  learning: ReminderLearning,
): Promise<boolean> {
  // Convert to the format expected by the learning system
  const extractedLearning: ExtractedLearning = {
    category: learning.category,
    content: learning.content,
    confidence: learning.confidence,
    source: learning.source,
  };

  try {
    const stored = await addLearning(agentId, extractedLearning);
    return stored !== null;
  } catch {
    // Failed to store - could be duplicate or disk issue
    return false;
  }
}

/**
 * Process an outcome: record it, calculate metrics, and feed to learning system
 */
export async function processReminderOutcome(
  db: DatabaseSync,
  outcome: ReminderOutcome,
  reminder: Reminder,
): Promise<{
  metrics: ReminderEffectivenessMetrics;
  learning: ReminderLearning | null;
  suggestions: ReminderAdjustmentSuggestion[];
}> {
  // Record the outcome and get updated metrics
  const metrics = await recordOutcome(db, outcome);

  // Convert to learning if appropriate
  const learning = outcomeToLearning(outcome, reminder, metrics);

  // Feed to learning system if we have a learning
  if (learning) {
    await feedToLearningSystem(outcome.agentId, learning);
  }

  // Generate adjustment suggestions
  const suggestions = generateAdjustmentSuggestions(metrics);

  return { metrics, learning, suggestions };
}

/**
 * Aggregate statistics for learning about reminder patterns
 */
export interface ReminderPatternStats {
  /** Stats by priority level */
  byPriority: Record<
    ReminderPriority,
    {
      count: number;
      avgEffectiveness: number;
      avgCompletionRate: number;
    }
  >;
  /** Stats by trigger type */
  byTriggerType: Record<
    ReminderTriggerType,
    {
      count: number;
      avgEffectiveness: number;
      avgCompletionRate: number;
    }
  >;
  /** Time-of-day patterns */
  byTimeOfDay: Record<
    "morning" | "afternoon" | "evening" | "night",
    {
      count: number;
      avgEffectiveness: number;
    }
  >;
  /** Overall stats */
  overall: {
    totalReminders: number;
    totalShowings: number;
    avgEffectiveness: number;
    avgCompletionRate: number;
    avgDismissalRate: number;
  };
}

/**
 * Default empty pattern stats
 */
export function createEmptyPatternStats(): ReminderPatternStats {
  return {
    byPriority: {
      urgent: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
      normal: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
      low: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
    },
    byTriggerType: {
      scheduled: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
      recurring: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
      context: { count: 0, avgEffectiveness: 0, avgCompletionRate: 0 },
    },
    byTimeOfDay: {
      morning: { count: 0, avgEffectiveness: 0 },
      afternoon: { count: 0, avgEffectiveness: 0 },
      evening: { count: 0, avgEffectiveness: 0 },
      night: { count: 0, avgEffectiveness: 0 },
    },
    overall: {
      totalReminders: 0,
      totalShowings: 0,
      avgEffectiveness: 0,
      avgCompletionRate: 0,
      avgDismissalRate: 0,
    },
  };
}

/**
 * Get agent-level feedback stats from the database
 */
export function getAgentLevelStats(
  db: DatabaseSync,
  agentId: string,
  sinceDays: number = 14,
): {
  totalShowings: number;
  uniqueReminders: number;
  byReaction: Record<string, number>;
  avgCompletionRate: number;
  avgDismissalRate: number;
} {
  return getAgentFeedbackStats(db, agentId, sinceDays);
}

/**
 * Generate system-level learnings from aggregate stats
 */
export function generateSystemLearnings(
  agentId: string,
  stats: ReminderPatternStats,
  config: FeedbackSystemConfig = defaultFeedbackConfig,
): ReminderLearning[] {
  const learnings: ReminderLearning[] = [];

  // Not enough data
  if (stats.overall.totalShowings < config.minShowingsForMetrics * 3) {
    return learnings;
  }

  // Learn about priority effectiveness
  const priorityEntries = Object.entries(stats.byPriority) as Array<
    [ReminderPriority, { count: number; avgEffectiveness: number; avgCompletionRate: number }]
  >;

  const effectivePriorities = priorityEntries
    .filter(([, data]) => data.count >= 3 && data.avgEffectiveness > config.effectiveThreshold)
    .map(([priority]) => priority);

  if (effectivePriorities.length > 0) {
    learnings.push({
      category: "pattern",
      content: `${effectivePriorities.join(", ")} priority reminders work well for this user`,
      confidence: "medium",
      source: "reminder_feedback",
      reminderId: "system",
      effectivenessScore: stats.overall.avgEffectiveness,
      outcomeType: "positive",
    });
  }

  // Learn about trigger type effectiveness
  const triggerEntries = Object.entries(stats.byTriggerType) as Array<
    [ReminderTriggerType, { count: number; avgEffectiveness: number; avgCompletionRate: number }]
  >;

  const bestTrigger = triggerEntries
    .filter(([, data]) => data.count >= 3)
    .sort((a, b) => b[1].avgEffectiveness - a[1].avgEffectiveness)[0];

  if (bestTrigger && bestTrigger[1].avgEffectiveness > config.effectiveThreshold) {
    learnings.push({
      category: "preference",
      content: `User responds best to ${bestTrigger[0]} reminders`,
      confidence: "medium",
      source: "reminder_feedback",
      reminderId: "system",
      effectivenessScore: bestTrigger[1].avgEffectiveness,
      outcomeType: "positive",
    });
  }

  // Learn about time-of-day preferences
  const timeEntries = Object.entries(stats.byTimeOfDay) as Array<
    ["morning" | "afternoon" | "evening" | "night", { count: number; avgEffectiveness: number }]
  >;

  const bestTime = timeEntries
    .filter(([, data]) => data.count >= 3)
    .sort((a, b) => b[1].avgEffectiveness - a[1].avgEffectiveness)[0];

  const worstTime = timeEntries
    .filter(([, data]) => data.count >= 3)
    .sort((a, b) => a[1].avgEffectiveness - b[1].avgEffectiveness)[0];

  if (bestTime && bestTime[1].avgEffectiveness > 0.6) {
    learnings.push({
      category: "preference",
      content: `Reminders are most effective in the ${bestTime[0]}`,
      confidence: "medium",
      source: "reminder_feedback",
      reminderId: "system",
      effectivenessScore: bestTime[1].avgEffectiveness,
      outcomeType: "positive",
    });
  }

  if (worstTime && worstTime[1].avgEffectiveness < 0.3 && worstTime !== bestTime) {
    learnings.push({
      category: "correction",
      content: `Avoid sending reminders in the ${worstTime[0]} - low engagement`,
      confidence: "medium",
      source: "reminder_feedback",
      reminderId: "system",
      effectivenessScore: worstTime[1].avgEffectiveness,
      outcomeType: "negative",
    });
  }

  return learnings;
}

/**
 * Feed system-level learnings to the learning system
 */
export async function feedSystemLearnings(
  agentId: string,
  learnings: ReminderLearning[],
): Promise<number> {
  let storedCount = 0;

  for (const learning of learnings) {
    const success = await feedToLearningSystem(agentId, learning);
    if (success) {
      storedCount++;
    }
  }

  return storedCount;
}

/**
 * Learning integration configuration
 */
export interface LearningIntegrationConfig {
  /** Whether learning integration is enabled */
  enabled: boolean;
  /** Minimum showings before generating learnings */
  minShowingsForLearning: number;
  /** Minimum effectiveness score to generate positive learning */
  positiveThreshold: number;
  /** Maximum effectiveness score to generate negative learning */
  negativeThreshold: number;
  /** Whether to auto-feed learnings to the learning system */
  autoFeedLearnings: boolean;
}

/**
 * Default learning integration configuration
 */
export const defaultLearningIntegrationConfig: LearningIntegrationConfig = {
  enabled: true,
  minShowingsForLearning: 3,
  positiveThreshold: 0.7,
  negativeThreshold: 0.2,
  autoFeedLearnings: true,
};
