/**
 * Reminder feedback system type definitions
 *
 * Defines the core types for tracking and analyzing reminder effectiveness,
 * enabling the system to learn which reminders are helpful and adjust
 * delivery strategies accordingly.
 */

import type { ReminderPriority, ReminderTriggerType } from "./types.js";

/**
 * User reaction to a reminder
 *
 * - completed: User acknowledged and completed the reminder task
 * - dismissed: User explicitly dismissed without completing
 * - snoozed: User postponed the reminder
 * - ignored: Reminder was shown but no explicit action taken
 * - acted: User took related action (detected from context)
 */
export type ReminderReaction = "completed" | "dismissed" | "snoozed" | "ignored" | "acted";

/**
 * Source of feedback detection
 *
 * - explicit: User used a command (e.g., /remind done, /remind dismiss)
 * - inferred: Detected from user's next message or actions
 * - timeout: No response within observation window
 */
export type FeedbackSource = "explicit" | "inferred" | "timeout";

/**
 * Individual feedback event for a reminder showing
 */
export interface ReminderFeedbackEvent {
  /** Unique identifier for this feedback event */
  id: string;

  /** The reminder this feedback is for */
  reminderId: string;

  /** Agent that owns the reminder */
  agentId: string;

  /** Session where the reminder was shown */
  sessionKey: string;

  /** When the reminder was shown to the user */
  shownAt: Date;

  /** User's reaction to the reminder */
  reaction: ReminderReaction;

  /** How the feedback was detected */
  source: FeedbackSource;

  /** When the feedback was recorded */
  recordedAt: Date;

  /** Time from showing to reaction (milliseconds) */
  reactionTimeMs?: number;

  /** Context relevance score if this was a context-triggered reminder */
  contextRelevanceScore?: number;

  /** The user message that triggered the context (for context reminders) */
  triggerMessage?: string;

  /** User's immediate response after reminder was shown */
  userResponse?: string;
}

/**
 * Aggregated effectiveness metrics for a single reminder
 */
export interface ReminderEffectivenessMetrics {
  /** The reminder ID */
  reminderId: string;

  /** Total number of times shown */
  totalShowings: number;

  /** Breakdown by reaction type */
  reactionCounts: Record<ReminderReaction, number>;

  /** Completion rate (completed / total) */
  completionRate: number;

  /** Dismissal rate (dismissed / total) */
  dismissalRate: number;

  /** Average time to reaction in milliseconds */
  avgReactionTimeMs: number | null;

  /** Average context relevance score for context reminders */
  avgContextRelevanceScore: number | null;

  /** Overall effectiveness score (0-1) */
  effectivenessScore: number;

  /** Trend direction: improving, declining, or stable */
  trend: "improving" | "declining" | "stable";

  /** Last calculated timestamp */
  lastCalculatedAt: Date;
}

/**
 * Global effectiveness metrics for the reminder system
 */
export interface SystemEffectivenessMetrics {
  /** Agent ID */
  agentId: string;

  /** Time window for metrics (e.g., last 7 days) */
  windowDays: number;

  /** Total reminders shown in window */
  totalShowings: number;

  /** Total unique reminders shown */
  uniqueReminders: number;

  /** Overall completion rate */
  overallCompletionRate: number;

  /** Overall dismissal rate */
  overallDismissalRate: number;

  /** Breakdown by priority */
  metricsByPriority: Record<
    ReminderPriority,
    {
      showings: number;
      completionRate: number;
      avgReactionTimeMs: number | null;
    }
  >;

  /** Breakdown by trigger type */
  metricsByTriggerType: Record<
    ReminderTriggerType,
    {
      showings: number;
      completionRate: number;
      avgContextRelevanceScore: number | null;
    }
  >;

  /** Best performing reminder IDs */
  topPerformers: string[];

  /** Worst performing reminder IDs (candidates for adjustment) */
  bottomPerformers: string[];

  /** Last calculated timestamp */
  lastCalculatedAt: Date;
}

/**
 * Feedback-based adjustment suggestion
 */
export interface ReminderAdjustmentSuggestion {
  /** The reminder to adjust */
  reminderId: string;

  /** Type of suggested adjustment */
  adjustmentType:
    | "reduce_frequency" // Too many dismissals
    | "increase_frequency" // High completion, maybe show more
    | "change_priority" // Priority doesn't match user behavior
    | "change_timing" // User often snoozes to similar times
    | "archive" // Consistently ignored
    | "refine_context"; // Context trigger too broad/narrow

  /** Suggested new value (depends on adjustment type) */
  suggestedValue?: string | number;

  /** Confidence in this suggestion (0-1) */
  confidence: number;

  /** Reason for the suggestion */
  reason: string;

  /** Supporting metrics */
  supportingMetrics: {
    showings: number;
    completionRate: number;
    dismissalRate: number;
    avgSnoozeDurationMinutes?: number;
  };
}

/**
 * Configuration for the feedback system
 */
export interface FeedbackSystemConfig {
  /** Whether feedback collection is enabled */
  enabled: boolean;

  /** Time window for observing user reaction (milliseconds) */
  reactionWindowMs: number;

  /** Minimum showings before calculating effectiveness */
  minShowingsForMetrics: number;

  /** Window (days) for calculating system metrics */
  metricsWindowDays: number;

  /** Threshold below which a reminder is considered ineffective */
  ineffectiveThreshold: number;

  /** Threshold above which a reminder is considered effective */
  effectiveThreshold: number;

  /** Whether to auto-apply adjustment suggestions */
  autoApplyAdjustments: boolean;

  /** Minimum confidence for auto-applying adjustments */
  autoApplyMinConfidence: number;
}

/**
 * Default feedback system configuration
 */
export const defaultFeedbackConfig: FeedbackSystemConfig = {
  enabled: true,
  reactionWindowMs: 5 * 60 * 1000, // 5 minutes
  minShowingsForMetrics: 3,
  metricsWindowDays: 14,
  ineffectiveThreshold: 0.2,
  effectiveThreshold: 0.7,
  autoApplyAdjustments: false,
  autoApplyMinConfidence: 0.8,
};

/**
 * Database row for reminder feedback events
 */
export interface ReminderFeedbackRow {
  id: string;
  reminder_id: string;
  agent_id: string;
  session_key: string;
  shown_at: number;
  reaction: ReminderReaction;
  source: FeedbackSource;
  recorded_at: number;
  reaction_time_ms: number | null;
  context_relevance_score: number | null;
  trigger_message: string | null;
  user_response: string | null;
}

/**
 * Convert a database row to a ReminderFeedbackEvent
 */
export function rowToFeedbackEvent(row: ReminderFeedbackRow): ReminderFeedbackEvent {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    agentId: row.agent_id,
    sessionKey: row.session_key,
    shownAt: new Date(row.shown_at),
    reaction: row.reaction,
    source: row.source,
    recordedAt: new Date(row.recorded_at),
    reactionTimeMs: row.reaction_time_ms ?? undefined,
    contextRelevanceScore: row.context_relevance_score ?? undefined,
    triggerMessage: row.trigger_message ?? undefined,
    userResponse: row.user_response ?? undefined,
  };
}

/**
 * Convert a ReminderFeedbackEvent to database row values
 */
export function feedbackEventToRow(event: ReminderFeedbackEvent): ReminderFeedbackRow {
  return {
    id: event.id,
    reminder_id: event.reminderId,
    agent_id: event.agentId,
    session_key: event.sessionKey,
    shown_at: event.shownAt.getTime(),
    reaction: event.reaction,
    source: event.source,
    recorded_at: event.recordedAt.getTime(),
    reaction_time_ms: event.reactionTimeMs ?? null,
    context_relevance_score: event.contextRelevanceScore ?? null,
    trigger_message: event.triggerMessage ?? null,
    user_response: event.userResponse ?? null,
  };
}

/**
 * Calculate effectiveness score from metrics
 *
 * Algorithm:
 * - Completion rate is weighted heavily (60%)
 * - Low dismissal rate is rewarded (25%)
 * - Quick reaction time is a positive signal (15%)
 */
export function calculateEffectivenessScore(
  completionRate: number,
  dismissalRate: number,
  avgReactionTimeMs: number | null,
): number {
  const completionWeight = 0.6;
  const dismissalWeight = 0.25;
  const reactionWeight = 0.15;

  // Base score from completion rate
  let score = completionRate * completionWeight;

  // Add bonus for low dismissal rate (inverted)
  score += (1 - dismissalRate) * dismissalWeight;

  // Add bonus for quick reaction (normalize to 0-1, assuming 1 minute is ideal)
  if (avgReactionTimeMs !== null && avgReactionTimeMs > 0) {
    const reactionMinutes = avgReactionTimeMs / 60000;
    // Sigmoid-like scoring: 1 minute = 1.0, 5 minutes = 0.5, 10+ minutes = ~0
    const reactionScore = Math.max(0, 1 - Math.log10(reactionMinutes + 1) / 1.2);
    score += reactionScore * reactionWeight;
  } else {
    // No reaction time data, assume neutral
    score += 0.5 * reactionWeight;
  }

  return Math.min(1, Math.max(0, score));
}

/**
 * Determine trend from recent effectiveness scores
 */
export function calculateTrend(
  recentScores: number[],
  windowSize: number = 5,
): "improving" | "declining" | "stable" {
  if (recentScores.length < 2) return "stable";

  const recent = recentScores.slice(-windowSize);
  if (recent.length < 2) return "stable";

  // Simple linear regression slope
  const n = recent.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = recent.reduce((a, b) => a + b, 0);
  const sumXY = recent.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Threshold for considering a trend significant
  const threshold = 0.02;

  if (slope > threshold) return "improving";
  if (slope < -threshold) return "declining";
  return "stable";
}

/**
 * Generate adjustment suggestions based on effectiveness metrics
 */
export function generateAdjustmentSuggestions(
  metrics: ReminderEffectivenessMetrics,
  config: FeedbackSystemConfig = defaultFeedbackConfig,
): ReminderAdjustmentSuggestion[] {
  const suggestions: ReminderAdjustmentSuggestion[] = [];

  // Not enough data for suggestions
  if (metrics.totalShowings < config.minShowingsForMetrics) {
    return suggestions;
  }

  const { completionRate, dismissalRate, effectivenessScore, trend } = metrics;

  // High dismissal rate: reduce frequency or archive
  if (dismissalRate > 0.6) {
    if (metrics.totalShowings > 10 && completionRate < 0.1) {
      suggestions.push({
        reminderId: metrics.reminderId,
        adjustmentType: "archive",
        confidence: 0.8,
        reason: `Reminder has been dismissed ${Math.round(dismissalRate * 100)}% of the time with very low completion`,
        supportingMetrics: {
          showings: metrics.totalShowings,
          completionRate,
          dismissalRate,
        },
      });
    } else {
      suggestions.push({
        reminderId: metrics.reminderId,
        adjustmentType: "reduce_frequency",
        confidence: 0.7,
        reason: `High dismissal rate (${Math.round(dismissalRate * 100)}%) suggests this reminder is shown too often`,
        supportingMetrics: {
          showings: metrics.totalShowings,
          completionRate,
          dismissalRate,
        },
      });
    }
  }

  // Low effectiveness with declining trend: needs attention
  if (effectivenessScore < config.ineffectiveThreshold && trend === "declining") {
    suggestions.push({
      reminderId: metrics.reminderId,
      adjustmentType: "change_priority",
      suggestedValue: "low",
      confidence: 0.6,
      reason: `Effectiveness declining (score: ${effectivenessScore.toFixed(2)}), consider lowering priority`,
      supportingMetrics: {
        showings: metrics.totalShowings,
        completionRate,
        dismissalRate,
      },
    });
  }

  // High effectiveness: maybe increase visibility
  if (effectivenessScore > config.effectiveThreshold && completionRate > 0.8) {
    suggestions.push({
      reminderId: metrics.reminderId,
      adjustmentType: "increase_frequency",
      confidence: 0.5,
      reason: `High completion rate (${Math.round(completionRate * 100)}%) indicates this reminder is valuable`,
      supportingMetrics: {
        showings: metrics.totalShowings,
        completionRate,
        dismissalRate,
      },
    });
  }

  // Poor context relevance for context-based reminders
  if (metrics.avgContextRelevanceScore !== null && metrics.avgContextRelevanceScore < 0.3) {
    suggestions.push({
      reminderId: metrics.reminderId,
      adjustmentType: "refine_context",
      confidence: 0.7,
      reason: `Low context relevance score (${metrics.avgContextRelevanceScore.toFixed(2)}) suggests trigger pattern needs refinement`,
      supportingMetrics: {
        showings: metrics.totalShowings,
        completionRate,
        dismissalRate,
      },
    });
  }

  return suggestions;
}
