/**
 * Pattern types for the anticipation system
 *
 * Defines the three pattern categories that Gimli tracks to predict user needs:
 * - Time-based: Triggered by temporal conditions
 * - Event-based: Triggered by specific events or actions
 * - Context-based: Triggered by semantic context
 */

/**
 * Pattern type discriminator
 */
export type PatternType = "time-based" | "event-based" | "context-based";

/**
 * Base fields shared by all pattern types
 */
export interface BasePattern {
  /** Unique identifier */
  id: string;

  /** Agent this pattern belongs to */
  agentId: string;

  /** Human-readable description of what was observed */
  description: string;

  /** Pattern type discriminator */
  type: PatternType;

  /** Confidence score (0-1) based on observation frequency and recency */
  confidence: number;

  /** Number of times this pattern has been observed */
  observationCount: number;

  /** When the pattern was first observed */
  firstObserved: Date;

  /** When the pattern was most recently observed */
  lastObserved: Date;

  /** Whether this pattern is active (can trigger reminders) */
  active: boolean;

  /** Optional link to a reminder this pattern triggers */
  linkedReminderId?: string;
}

// ============================================================================
// Time-Based Patterns
// ============================================================================

/**
 * Time-of-day trigger (e.g., "at 9:00 AM")
 */
export interface TimeOfDayTrigger {
  kind: "time-of-day";
  /** Hour (0-23) */
  hour: number;
  /** Minute (0-59) */
  minute: number;
}

/**
 * Day-of-week trigger (e.g., "Monday mornings")
 */
export interface DayOfWeekTrigger {
  kind: "day-of-week";
  /** Day of week (1-7, Monday=1) */
  dayOfWeek: number;
  /** Optional hour (0-23) */
  hour?: number;
  /** Optional minute (0-59) */
  minute?: number;
}

/**
 * Interval trigger (e.g., "every 2 hours")
 */
export interface IntervalTrigger {
  kind: "interval";
  /** Interval in minutes */
  intervalMinutes: number;
  /** When this trigger last fired */
  lastTriggered?: Date;
}

/**
 * Union of all time pattern trigger types
 */
export type TimePatternTrigger = TimeOfDayTrigger | DayOfWeekTrigger | IntervalTrigger;

/**
 * Pattern triggered by temporal conditions
 *
 * Examples:
 * - "User reviews PRs every Monday morning around 9 AM"
 * - "User writes status updates on Friday afternoons"
 */
export interface TimePattern extends BasePattern {
  type: "time-based";

  /** What time condition triggers this pattern */
  trigger: TimePatternTrigger;

  /** What the user typically does at this time */
  typicalAction: string;

  /** Time window tolerance in minutes (default: 30) */
  toleranceMinutes: number;

  /** Days of week this pattern applies to (1-7, Monday=1), undefined = all days */
  daysOfWeek?: number[];
}

// ============================================================================
// Event-Based Patterns
// ============================================================================

/**
 * Tool call trigger (e.g., "after running git commit")
 */
export interface ToolCallTrigger {
  kind: "tool-call";
  /** Name of the tool that triggers this pattern */
  toolName: string;
  /** Optional regex pattern to match against tool result */
  resultPattern?: string;
}

/**
 * Error trigger (e.g., "after a test failure")
 */
export interface ErrorTrigger {
  kind: "error";
  /** Optional error type to match */
  errorType?: string;
  /** Optional regex pattern to match against error message */
  messagePattern?: string;
}

/**
 * Command trigger (e.g., "after /reset command")
 */
export interface CommandTrigger {
  kind: "command";
  /** The command that triggers this pattern */
  command: string;
}

/**
 * Session event trigger (e.g., "at session start")
 */
export interface SessionEventTrigger {
  kind: "session-event";
  /** The session event that triggers this pattern */
  event: "start" | "end" | "compact" | "reset";
}

/**
 * User mention trigger (e.g., "when user mentions 'deployment'")
 */
export interface UserMentionTrigger {
  kind: "user-mention";
  /** Keywords that trigger this pattern */
  keywords: string[];
}

/**
 * Union of all event pattern trigger types
 */
export type EventPatternTrigger =
  | ToolCallTrigger
  | ErrorTrigger
  | CommandTrigger
  | SessionEventTrigger
  | UserMentionTrigger;

/**
 * Pattern triggered by specific events or actions
 *
 * Examples:
 * - "After a test failure, user typically runs in debug mode"
 * - "After committing code, user usually creates a PR"
 */
export interface EventPattern extends BasePattern {
  type: "event-based";

  /** What event triggers this pattern */
  trigger: EventPatternTrigger;

  /** What the user typically does after the trigger event */
  typicalFollowUp: string;

  /** Typical delay between trigger and follow-up (in seconds) */
  typicalDelaySeconds?: number;

  /** Maximum delay before pattern no longer applies (in seconds) */
  expirationSeconds: number;
}

// ============================================================================
// Context-Based Patterns
// ============================================================================

/**
 * Pattern triggered by semantic context in the conversation
 *
 * Examples:
 * - "When discussing deployments, user needs staging URLs"
 * - "When reviewing security issues, user wants OWASP references"
 */
export interface ContextPattern extends BasePattern {
  type: "context-based";

  /** Keywords that indicate this context */
  contextKeywords: string[];

  /** Minimum semantic similarity score to trigger (0-1) */
  relevanceThreshold: number;

  /** What the user typically needs in this context */
  typicalNeed: string;

  /** Related memory chunks that inform this pattern */
  relatedChunkIds?: string[];

  /** Whether to use semantic matching in addition to keywords */
  useSemanticMatching: boolean;
}

// ============================================================================
// Union Type
// ============================================================================

/**
 * Union of all pattern types
 */
export type Pattern = TimePattern | EventPattern | ContextPattern;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Pattern system configuration
 */
export interface PatternConfig {
  /** Minimum confidence to activate a pattern */
  activationThreshold: number;

  /** Minimum observations before activation */
  minObservations: number;

  /** Days before inactive pattern is archived */
  archiveAfterDays: number;

  /** Maximum patterns per agent */
  maxPatternsPerAgent: number;

  /** Whether to auto-generate reminder suggestions */
  autoSuggestReminders: boolean;

  /** Confidence threshold for auto-suggesting reminders */
  reminderSuggestionThreshold: number;
}

/**
 * Default pattern configuration
 */
export const defaultPatternConfig: PatternConfig = {
  activationThreshold: 0.4,
  minObservations: 3,
  archiveAfterDays: 90,
  maxPatternsPerAgent: 100,
  autoSuggestReminders: true,
  reminderSuggestionThreshold: 0.6,
};

// ============================================================================
// Observation Types
// ============================================================================

/**
 * A single observation that might contribute to a pattern
 */
export interface PatternObservation {
  /** Type of observation */
  type: PatternType;

  /** Agent ID */
  agentId: string;

  /** When the observation occurred */
  timestamp: Date;

  /** Observation-specific data */
  data: TimeObservationData | EventObservationData | ContextObservationData;
}

/**
 * Data for a time-based observation
 */
export interface TimeObservationData {
  type: "time-based";
  /** Hour of day (0-23) */
  hour: number;
  /** Minute (0-59) */
  minute: number;
  /** Day of week (1-7, Monday=1) */
  dayOfWeek: number;
  /** What action was observed */
  action: string;
}

/**
 * Data for an event-based observation
 */
export interface EventObservationData {
  type: "event-based";
  /** The event that was observed */
  event: string;
  /** What the user did after */
  followUp: string;
  /** Delay in seconds between event and follow-up */
  delaySeconds: number;
}

/**
 * Data for a context-based observation
 */
export interface ContextObservationData {
  type: "context-based";
  /** Keywords present in the context */
  keywords: string[];
  /** What the user needed */
  need: string;
  /** Semantic similarity score if available */
  similarityScore?: number;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate pattern confidence based on observations
 */
export function calculateConfidence(params: {
  observationCount: number;
  daysSinceLastObserved: number;
  consistencyScore: number;
}): number {
  const { observationCount, daysSinceLastObserved, consistencyScore } = params;

  // Base confidence from observation count (asymptotic to 0.7)
  const countFactor = 1 - Math.exp(-observationCount / 5);

  // Recency decay (halves every 14 days)
  const recencyFactor = Math.exp(-daysSinceLastObserved / 14);

  // Combined confidence (weighted: 50% count, 30% consistency, 20% recency)
  const rawConfidence = countFactor * 0.5 + consistencyScore * 0.3 + recencyFactor * 0.2;

  // Clamp to 0-1
  return Math.max(0, Math.min(1, rawConfidence));
}

/**
 * Check if a pattern meets activation criteria
 */
export function isPatternActivatable(
  pattern: Pattern,
  config: PatternConfig = defaultPatternConfig,
): boolean {
  return (
    pattern.confidence >= config.activationThreshold &&
    pattern.observationCount >= config.minObservations
  );
}

/**
 * Check if a pattern should be archived due to inactivity
 */
export function shouldArchivePattern(
  pattern: Pattern,
  now: Date = new Date(),
  config: PatternConfig = defaultPatternConfig,
): boolean {
  const daysSinceLastObserved =
    (now.getTime() - pattern.lastObserved.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceLastObserved > config.archiveAfterDays;
}

/**
 * Check if a time pattern matches the current time
 */
export function doesTimePatternMatch(pattern: TimePattern, now: Date = new Date()): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // Convert Sunday=0 to Sunday=7

  // Check day of week constraint if specified
  if (pattern.daysOfWeek && !pattern.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  const tolerance = pattern.toleranceMinutes;

  switch (pattern.trigger.kind) {
    case "time-of-day": {
      const targetMinutes = pattern.trigger.hour * 60 + pattern.trigger.minute;
      const currentMinutes = hour * 60 + minute;
      const diff = Math.abs(currentMinutes - targetMinutes);
      return diff <= tolerance || diff >= 24 * 60 - tolerance; // Handle midnight wrap
    }

    case "day-of-week": {
      if (pattern.trigger.dayOfWeek !== dayOfWeek) return false;
      if (pattern.trigger.hour === undefined) return true; // Day match is enough

      const targetMinutes = pattern.trigger.hour * 60 + (pattern.trigger.minute ?? 0);
      const currentMinutes = hour * 60 + minute;
      return Math.abs(currentMinutes - targetMinutes) <= tolerance;
    }

    case "interval": {
      if (!pattern.trigger.lastTriggered) return true; // Never triggered, so trigger now
      const elapsed = now.getTime() - pattern.trigger.lastTriggered.getTime();
      const intervalMs = pattern.trigger.intervalMinutes * 60 * 1000;
      return elapsed >= intervalMs;
    }
  }
}

/**
 * Check if an event pattern trigger matches an event
 */
export function doesEventTriggerMatch(
  trigger: EventPatternTrigger,
  event: { type: string; name?: string; message?: string; keywords?: string[] },
): boolean {
  switch (trigger.kind) {
    case "tool-call":
      if (event.type !== "tool-call" || event.name !== trigger.toolName) return false;
      if (trigger.resultPattern && event.message) {
        return new RegExp(trigger.resultPattern).test(event.message);
      }
      return true;

    case "error":
      if (event.type !== "error") return false;
      if (trigger.errorType && event.name !== trigger.errorType) return false;
      if (trigger.messagePattern && event.message) {
        return new RegExp(trigger.messagePattern).test(event.message);
      }
      return true;

    case "command":
      return event.type === "command" && event.name === trigger.command;

    case "session-event":
      return event.type === "session-event" && event.name === trigger.event;

    case "user-mention":
      if (event.type !== "user-mention" || !event.keywords) return false;
      return trigger.keywords.some((kw) =>
        event.keywords!.some((ek) => ek.toLowerCase().includes(kw.toLowerCase())),
      );
  }
}

/**
 * Check if a context pattern matches given keywords
 */
export function doesContextPatternMatch(
  pattern: ContextPattern,
  keywords: string[],
  semanticScore?: number,
): boolean {
  // Check keyword match
  const keywordMatch = pattern.contextKeywords.some((pk) =>
    keywords.some((k) => k.toLowerCase().includes(pk.toLowerCase())),
  );

  // If semantic matching is disabled, use keyword match only
  if (!pattern.useSemanticMatching) {
    return keywordMatch;
  }

  // If semantic score provided, use it
  if (semanticScore !== undefined) {
    return semanticScore >= pattern.relevanceThreshold;
  }

  // Fall back to keyword match
  return keywordMatch;
}

/**
 * Get the day of week name (for display)
 */
export function getDayOfWeekName(day: number): string {
  const days = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return days[day] ?? "Unknown";
}

/**
 * Format a time pattern trigger for display
 */
export function formatTimePatternTrigger(trigger: TimePatternTrigger): string {
  switch (trigger.kind) {
    case "time-of-day": {
      const hour = trigger.hour % 12 || 12;
      const ampm = trigger.hour < 12 ? "AM" : "PM";
      const minute = trigger.minute.toString().padStart(2, "0");
      return `${hour}:${minute} ${ampm}`;
    }

    case "day-of-week": {
      const day = getDayOfWeekName(trigger.dayOfWeek);
      if (trigger.hour === undefined) return day;
      const hour = trigger.hour % 12 || 12;
      const ampm = trigger.hour < 12 ? "AM" : "PM";
      const minute = (trigger.minute ?? 0).toString().padStart(2, "0");
      return `${day} at ${hour}:${minute} ${ampm}`;
    }

    case "interval":
      if (trigger.intervalMinutes < 60) {
        return `every ${trigger.intervalMinutes} minutes`;
      }
      const hours = Math.floor(trigger.intervalMinutes / 60);
      const mins = trigger.intervalMinutes % 60;
      if (mins === 0) return `every ${hours} hour${hours > 1 ? "s" : ""}`;
      return `every ${hours}h ${mins}m`;
  }
}

/**
 * Format a pattern for display
 */
export function formatPatternDescription(pattern: Pattern): string {
  switch (pattern.type) {
    case "time-based":
      return `${formatTimePatternTrigger(pattern.trigger)}: ${pattern.typicalAction}`;

    case "event-based":
      return `After ${pattern.trigger.kind}: ${pattern.typicalFollowUp}`;

    case "context-based":
      return `When discussing [${pattern.contextKeywords.join(", ")}]: ${pattern.typicalNeed}`;
  }
}
