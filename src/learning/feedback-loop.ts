/**
 * Feedback loop for learning from user reactions to suggestions
 *
 * Captures thumbs up/down reactions on agent suggestions and uses
 * this feedback to improve future suggestion quality.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";
import {
  registerInternalHook,
  unregisterInternalHook,
  type InternalHookEvent,
  type InternalHookHandler,
} from "../hooks/internal-hooks.js";

export type FeedbackType = "positive" | "negative";

export interface SuggestionContext {
  /** The user's original query/request */
  userQuery: string;
  /** The agent's suggestion or response */
  suggestion: string;
  /** Tool calls made to generate the suggestion */
  toolCalls?: string[];
  /** Category of the suggestion (e.g., code, explanation, action) */
  category?: string;
}

export interface FeedbackEntry {
  /** Unique ID for this feedback entry */
  id: string;
  /** Agent ID this feedback belongs to */
  agentId: string;
  /** Session ID where feedback was given */
  sessionId?: string;
  /** The type of feedback (positive or negative) */
  type: FeedbackType;
  /** Context about what was being evaluated */
  context: SuggestionContext;
  /** When the feedback was recorded */
  timestamp: string;
  /** Optional user comment explaining the feedback */
  comment?: string;
}

export interface FeedbackStats {
  /** Total positive feedback count */
  positiveCount: number;
  /** Total negative feedback count */
  negativeCount: number;
  /** Ratio of positive to total feedback (0-1) */
  positiveRatio: number;
  /** Categories with their feedback breakdown */
  byCategory: Record<string, { positive: number; negative: number }>;
}

export interface FeedbackPattern {
  /** Pattern identifier */
  pattern: string;
  /** Number of positive feedback instances */
  positiveCount: number;
  /** Number of negative feedback instances */
  negativeCount: number;
  /** Computed score (-1 to 1, negative = demote, positive = boost) */
  score: number;
  /** Last updated timestamp */
  lastUpdated: string;
}

const FEEDBACK_FILENAME = "feedback.json";
const PATTERNS_FILENAME = "feedback-patterns.json";

// Minimum feedback count before a pattern is considered reliable
const MIN_FEEDBACK_FOR_PATTERN = 3;

// Weight decay for older feedback (per day)
const WEIGHT_DECAY_PER_DAY = 0.95;

/**
 * Resolve the feedback storage directory for an agent
 */
function resolveFeedbackDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "feedback");
}

/**
 * Resolve the path to an agent's feedback file
 */
export function resolveFeedbackPath(agentId: string): string {
  return path.join(resolveFeedbackDir(agentId), FEEDBACK_FILENAME);
}

/**
 * Resolve the path to an agent's feedback patterns file
 */
export function resolvePatternsPath(agentId: string): string {
  return path.join(resolveFeedbackDir(agentId), PATTERNS_FILENAME);
}

/**
 * Generate a unique ID for a feedback entry
 */
function generateFeedbackId(): string {
  return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load all feedback entries for an agent
 */
export async function loadFeedback(agentId: string): Promise<FeedbackEntry[]> {
  const filePath = resolveFeedbackPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch {
    return [];
  }
}

/**
 * Save feedback entries for an agent
 */
export async function saveFeedback(agentId: string, entries: FeedbackEntry[]): Promise<void> {
  const filePath = resolveFeedbackPath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ entries }, null, 2), "utf8");
}

/**
 * Record feedback for a suggestion
 */
export async function recordFeedback(
  agentId: string,
  type: FeedbackType,
  context: SuggestionContext,
  options: { sessionId?: string; comment?: string } = {},
): Promise<FeedbackEntry> {
  const entries = await loadFeedback(agentId);

  const entry: FeedbackEntry = {
    id: generateFeedbackId(),
    agentId,
    sessionId: options.sessionId,
    type,
    context,
    timestamp: new Date().toISOString(),
    comment: options.comment,
  };

  entries.push(entry);
  await saveFeedback(agentId, entries);

  // Update patterns based on new feedback
  await updatePatterns(agentId, entry);

  return entry;
}

/**
 * Record positive feedback (thumbs up)
 */
export async function recordPositiveFeedback(
  agentId: string,
  context: SuggestionContext,
  options: { sessionId?: string; comment?: string } = {},
): Promise<FeedbackEntry> {
  return recordFeedback(agentId, "positive", context, options);
}

/**
 * Record negative feedback (thumbs down)
 */
export async function recordNegativeFeedback(
  agentId: string,
  context: SuggestionContext,
  options: { sessionId?: string; comment?: string } = {},
): Promise<FeedbackEntry> {
  return recordFeedback(agentId, "negative", context, options);
}

/**
 * Get feedback statistics for an agent
 */
export async function getFeedbackStats(agentId: string): Promise<FeedbackStats> {
  const entries = await loadFeedback(agentId);

  const stats: FeedbackStats = {
    positiveCount: 0,
    negativeCount: 0,
    positiveRatio: 0,
    byCategory: {},
  };

  for (const entry of entries) {
    if (entry.type === "positive") {
      stats.positiveCount++;
    } else {
      stats.negativeCount++;
    }

    // Track by category
    const category = entry.context.category || "general";
    if (!stats.byCategory[category]) {
      stats.byCategory[category] = { positive: 0, negative: 0 };
    }
    stats.byCategory[category][entry.type === "positive" ? "positive" : "negative"]++;
  }

  const total = stats.positiveCount + stats.negativeCount;
  stats.positiveRatio = total > 0 ? stats.positiveCount / total : 0;

  return stats;
}

/**
 * Load feedback patterns for an agent
 */
export async function loadPatterns(agentId: string): Promise<FeedbackPattern[]> {
  const filePath = resolvePatternsPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return Array.isArray(data.patterns) ? data.patterns : [];
  } catch {
    return [];
  }
}

/**
 * Save feedback patterns for an agent
 */
export async function savePatterns(agentId: string, patterns: FeedbackPattern[]): Promise<void> {
  const filePath = resolvePatternsPath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ patterns }, null, 2), "utf8");
}

/**
 * Extract pattern key from suggestion context
 * Uses a simplified approach: category + key terms from the query
 */
function extractPatternKey(context: SuggestionContext): string {
  const category = context.category || "general";

  // Extract key terms (simplified: first 3 significant words)
  const terms = context.userQuery
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 3)
    .sort()
    .join("_");

  return `${category}:${terms || "query"}`;
}

/**
 * Update patterns based on new feedback
 */
async function updatePatterns(agentId: string, entry: FeedbackEntry): Promise<void> {
  const patterns = await loadPatterns(agentId);
  const patternKey = extractPatternKey(entry.context);

  let pattern = patterns.find((p) => p.pattern === patternKey);

  if (!pattern) {
    pattern = {
      pattern: patternKey,
      positiveCount: 0,
      negativeCount: 0,
      score: 0,
      lastUpdated: new Date().toISOString(),
    };
    patterns.push(pattern);
  }

  // Update counts
  if (entry.type === "positive") {
    pattern.positiveCount++;
  } else {
    pattern.negativeCount++;
  }

  // Recalculate score
  pattern.score = calculatePatternScore(pattern);
  pattern.lastUpdated = new Date().toISOString();

  await savePatterns(agentId, patterns);
}

/**
 * Calculate pattern score based on feedback counts
 * Returns a value between -1 (strongly negative) and 1 (strongly positive)
 */
function calculatePatternScore(pattern: FeedbackPattern): number {
  const total = pattern.positiveCount + pattern.negativeCount;

  if (total < MIN_FEEDBACK_FOR_PATTERN) {
    // Not enough data, return neutral
    return 0;
  }

  // Wilson score interval (simplified) for small sample reliability
  const positive = pattern.positiveCount;
  const n = total;

  // Basic ratio with confidence adjustment
  const ratio = positive / n;
  const confidence = 1 - 1 / Math.sqrt(n);

  // Scale to -1 to 1 range
  return (ratio * 2 - 1) * confidence;
}

/**
 * Get pattern boost/demote score for a suggestion context
 * Returns a value between -1 and 1 indicating whether similar
 * suggestions have been received well (positive) or poorly (negative)
 */
export async function getPatternScore(
  agentId: string,
  context: SuggestionContext,
): Promise<number> {
  const patterns = await loadPatterns(agentId);
  const patternKey = extractPatternKey(context);

  const pattern = patterns.find((p) => p.pattern === patternKey);

  if (!pattern) {
    return 0; // Neutral for unknown patterns
  }

  // Apply time decay to the score
  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(pattern.lastUpdated).getTime()) / (24 * 60 * 60 * 1000),
  );
  const decayFactor = Math.pow(WEIGHT_DECAY_PER_DAY, daysSinceUpdate);

  return pattern.score * decayFactor;
}

/**
 * Get all patterns with their scores, sorted by absolute score
 */
export async function getTopPatterns(agentId: string, limit = 10): Promise<FeedbackPattern[]> {
  const patterns = await loadPatterns(agentId);

  return patterns
    .filter((p) => p.positiveCount + p.negativeCount >= MIN_FEEDBACK_FOR_PATTERN)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, limit);
}

/**
 * Check if a suggestion pattern should be demoted based on negative feedback
 */
export async function shouldDemoteSuggestion(
  agentId: string,
  context: SuggestionContext,
  threshold = -0.3,
): Promise<boolean> {
  const score = await getPatternScore(agentId, context);
  return score < threshold;
}

/**
 * Check if a suggestion pattern should be boosted based on positive feedback
 */
export async function shouldBoostSuggestion(
  agentId: string,
  context: SuggestionContext,
  threshold = 0.3,
): Promise<boolean> {
  const score = await getPatternScore(agentId, context);
  return score > threshold;
}

/**
 * Parse feedback reaction from a user message
 * Detects thumbs up/down emojis or explicit feedback phrases
 */
export function parseFeedbackReaction(message: string): FeedbackType | null {
  const normalized = message.trim().toLowerCase();

  // Thumbs up patterns
  const positivePatterns = [
    /^(👍|👍🏻|👍🏼|👍🏽|👍🏾|👍🏿|\+1|:thumbsup:)$/,
    /^(good|great|perfect|thanks|helpful|nice|love it|excellent)!?$/i,
    /^(that'?s? (great|perfect|helpful|what i (wanted|needed)))!?$/i,
  ];

  // Thumbs down patterns
  const negativePatterns = [
    /^(👎|👎🏻|👎🏼|👎🏽|👎🏾|👎🏿|-1|:thumbsdown:)$/,
    /^(bad|wrong|unhelpful|not (good|helpful|what i (wanted|needed)))!?$/i,
    /^(that'?s? (wrong|not (right|helpful|what i (wanted|needed))))!?$/i,
  ];

  for (const pattern of positivePatterns) {
    if (pattern.test(normalized)) {
      return "positive";
    }
  }

  for (const pattern of negativePatterns) {
    if (pattern.test(normalized)) {
      return "negative";
    }
  }

  return null;
}

/**
 * Feedback capture hook configuration
 */
export interface FeedbackLoopConfig {
  /** Whether feedback capture is enabled */
  enabled: boolean;
  /** Minimum suggestion length to track */
  minSuggestionLength: number;
}

export const defaultFeedbackLoopConfig: FeedbackLoopConfig = {
  enabled: true,
  minSuggestionLength: 20,
};

// Store the handler reference for cleanup
let feedbackHandler: InternalHookHandler | null = null;
let lastSuggestionContext: Map<string, SuggestionContext> = new Map();

/**
 * Register the feedback loop hook
 * Listens for turn:complete events and captures feedback reactions
 */
export function registerFeedbackLoopHook(config: Partial<FeedbackLoopConfig> = {}): () => void {
  const cfg = { ...defaultFeedbackLoopConfig, ...config };

  if (!cfg.enabled) {
    return () => {};
  }

  feedbackHandler = async (event: InternalHookEvent): Promise<void> => {
    if (event.type !== "agent" || event.action !== "turn:complete") {
      return;
    }

    const { agentId, sessionId, userMessage, payloads } = event.context as {
      agentId?: string;
      sessionId?: string;
      userMessage?: string;
      payloads?: Array<{ text?: string; isError?: boolean }>;
    };

    if (!agentId) return;

    const sessionKey = `${agentId}:${sessionId || "default"}`;

    // Check if user message is feedback reaction
    if (userMessage) {
      const feedbackType = parseFeedbackReaction(userMessage);

      if (feedbackType) {
        // Look up the last suggestion context for this session
        const lastContext = lastSuggestionContext.get(sessionKey);

        if (lastContext) {
          try {
            await recordFeedback(agentId, feedbackType, lastContext, { sessionId });
          } catch (err) {
            console.error("[feedback-loop] Failed to record feedback:", err);
          }
        }

        // Clear the context after recording feedback
        lastSuggestionContext.delete(sessionKey);
        return;
      }
    }

    // Store the current suggestion as context for potential future feedback
    const suggestionText = payloads
      ?.filter((p) => p.text && !p.isError)
      .map((p) => p.text)
      .join("\n");

    if (suggestionText && suggestionText.length >= cfg.minSuggestionLength && userMessage) {
      lastSuggestionContext.set(sessionKey, {
        userQuery: userMessage,
        suggestion: suggestionText,
      });
    }
  };

  registerInternalHook("agent:turn:complete", feedbackHandler);

  return () => {
    if (feedbackHandler) {
      unregisterInternalHook("agent:turn:complete", feedbackHandler);
      feedbackHandler = null;
    }
    lastSuggestionContext.clear();
  };
}

/**
 * Clear the last suggestion context (useful for testing)
 */
export function clearSuggestionContext(): void {
  lastSuggestionContext.clear();
}

/**
 * Set suggestion context for a session (useful for testing or manual context)
 */
export function setSuggestionContext(sessionKey: string, context: SuggestionContext): void {
  lastSuggestionContext.set(sessionKey, context);
}
