/**
 * Self-evaluation mechanism for response quality
 *
 * Tracks response outcomes through implicit signals (follow-up questions,
 * topic changes, adoption signals) and explicit feedback to score
 * response helpfulness. Feeds scores back into the learning system.
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
import { addLearning } from "./learnings-store.js";
import type { LearningCategory } from "./extract-learnings.js";

/** Types of outcome signals that affect helpfulness scores */
export type OutcomeSignal =
  | "follow-up-question" // User asked clarifying question (possibly unclear response)
  | "topic-change" // User changed topic (possibly unhelpful response)
  | "adoption" // User adopted the suggestion (positive signal)
  | "explicit-positive" // Direct positive feedback
  | "explicit-negative" // Direct negative feedback
  | "continuation" // User continued in same direction (neutral-positive)
  | "repetition" // User repeated request (possibly failed to address)
  | "correction"; // User corrected the response (negative signal)

/** Weights for different outcome signals (-1 to 1 scale) */
export const SIGNAL_WEIGHTS: Record<OutcomeSignal, number> = {
  "follow-up-question": -0.2, // Mild negative: may indicate unclear response
  "topic-change": -0.1, // Weak negative: might be natural conversation flow
  adoption: 0.5, // Strong positive: user acted on suggestion
  "explicit-positive": 0.8, // Very strong positive
  "explicit-negative": -0.8, // Very strong negative
  continuation: 0.2, // Mild positive: conversation is on track
  repetition: -0.4, // Moderate negative: request wasn't fulfilled
  correction: -0.6, // Strong negative: response was wrong
};

/** A tracked response and its outcome */
export interface TrackedResponse {
  /** Unique ID for this response */
  id: string;
  /** Agent ID this belongs to */
  agentId: string;
  /** Session ID where response was given */
  sessionId: string;
  /** The user's original query */
  userQuery: string;
  /** The agent's response (truncated for storage) */
  response: string;
  /** Category of the response if detected */
  category?: string;
  /** Tool calls made during response */
  toolCalls?: string[];
  /** When the response was given */
  timestamp: string;
  /** Outcome signals detected for this response */
  signals: OutcomeSignal[];
  /** Computed helpfulness score (-1 to 1) */
  helpfulnessScore: number;
  /** Whether this has been processed for learning */
  processedForLearning: boolean;
}

/** Aggregated self-evaluation statistics */
export interface SelfEvaluationStats {
  /** Total responses tracked */
  totalResponses: number;
  /** Average helpfulness score */
  avgHelpfulness: number;
  /** Count of each outcome signal */
  signalCounts: Record<OutcomeSignal, number>;
  /** Helpfulness by category */
  byCategory: Record<string, { count: number; avgScore: number }>;
  /** Trend over last N responses */
  recentTrend: "improving" | "stable" | "declining";
  /** Score for last 10 responses */
  recentAvgScore: number;
}

/** Configuration for self-evaluation */
export interface SelfEvaluationConfig {
  /** Whether self-evaluation is enabled */
  enabled: boolean;
  /** Minimum response length to track */
  minResponseLength: number;
  /** Maximum responses to keep in history */
  maxHistorySize: number;
  /** Score threshold to generate positive learning */
  positiveThreshold: number;
  /** Score threshold to generate negative learning (pattern to avoid) */
  negativeThreshold: number;
  /** Number of signals required before generating learning */
  minSignalsForLearning: number;
}

export const defaultSelfEvaluationConfig: SelfEvaluationConfig = {
  enabled: true,
  minResponseLength: 30,
  maxHistorySize: 500,
  positiveThreshold: 0.4,
  negativeThreshold: -0.3,
  minSignalsForLearning: 2,
};

const EVALUATION_FILENAME = "self-evaluation.json";
const MAX_RESPONSE_LENGTH = 500; // Truncate stored responses

// Pattern detection for outcome signals
const FOLLOW_UP_PATTERNS = [
  /^(what|how|why|can you|could you|please)\s+(explain|clarify|elaborate)/i,
  /^(i\s+)?don'?t\s+understand/i,
  /^what\s+do\s+you\s+mean/i,
  /^(so|wait),?\s+(you'?re|you)\s+(saying|mean)/i,
  /^can\s+you\s+be\s+more\s+(specific|clear)/i,
  /\?\s*$/,
];

const ADOPTION_PATTERNS = [
  /^(ok|okay|got\s+it|makes\s+sense|i\s+(see|understand))/i,
  /^(let\s+me|i'?ll)\s+(try|do|use)/i,
  /^(that\s+)?work(s|ed)/i,
  /^done/i,
  /^(i\s+)?did\s+(that|it)/i,
  /^(using|trying|applying)\s+/i,
];

const REPETITION_PATTERNS = [
  /^(i\s+)?said/i,
  /^(again|once\s+more)/i,
  /^(i\s+)?already\s+(said|asked|told)/i,
  /^(that'?s\s+)?not\s+what\s+i\s+asked/i,
];

const CORRECTION_PATTERNS = [
  /^(no,?\s+|wrong|incorrect)/i,
  /^that'?s\s+(wrong|incorrect|not\s+(right|correct|what\s+i\s+(wanted|meant)))/i,
  /^actually,?\s+i\s+(meant|want)/i,
  /^i\s+(meant|wanted)\s+/i,
  /^(please\s+)?(don'?t|stop)\s+doing/i,
  /^i\s+want\s+a\s+different/i,
];

const TOPIC_CHANGE_KEYWORDS = [
  "anyway",
  "moving on",
  "different question",
  "new topic",
  "something else",
  "change topic",
  "change of topic",
  "forget that",
  "never mind",
  "nevermind",
];

const POSITIVE_FEEDBACK = [
  /^(perfect|excellent|great|awesome|thanks|thank\s+you)!?$/i,
  /^(that'?s\s+)?(exactly|perfect|great|what\s+i\s+(wanted|needed))/i,
  /^(good|nice|helpful|useful)/i,
  /^(love\s+it|well\s+done|brilliant)/i,
];

const NEGATIVE_FEEDBACK = [
  /^(bad|terrible|useless|unhelpful)/i,
  /^(that'?s\s+)?(not\s+)?(helpful|useful|good)/i,
  /^(disappointing|frustrated|frustrating)/i,
];

/**
 * Resolve the evaluation storage directory for an agent
 */
function resolveEvaluationDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "evaluation");
}

/**
 * Resolve the path to an agent's self-evaluation file
 */
export function resolveEvaluationPath(agentId: string): string {
  return path.join(resolveEvaluationDir(agentId), EVALUATION_FILENAME);
}

/**
 * Generate a unique ID for a tracked response
 */
function generateResponseId(): string {
  return `eval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load tracked responses for an agent
 */
export async function loadTrackedResponses(agentId: string): Promise<TrackedResponse[]> {
  const filePath = resolveEvaluationPath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return Array.isArray(data.responses) ? data.responses : [];
  } catch {
    return [];
  }
}

/**
 * Save tracked responses for an agent
 */
export async function saveTrackedResponses(
  agentId: string,
  responses: TrackedResponse[],
): Promise<void> {
  const filePath = resolveEvaluationPath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify({ responses }, null, 2), "utf8");
}

/**
 * Detect outcome signal from a user message
 */
export function detectOutcomeSignal(message: string, previousQuery?: string): OutcomeSignal | null {
  const normalized = message.trim();

  if (!normalized) return null;

  // Check for explicit feedback first (highest priority)
  for (const pattern of POSITIVE_FEEDBACK) {
    if (pattern.test(normalized)) {
      return "explicit-positive";
    }
  }

  for (const pattern of NEGATIVE_FEEDBACK) {
    if (pattern.test(normalized)) {
      return "explicit-negative";
    }
  }

  // Check for correction
  for (const pattern of CORRECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return "correction";
    }
  }

  // Check for repetition
  for (const pattern of REPETITION_PATTERNS) {
    if (pattern.test(normalized)) {
      return "repetition";
    }
  }

  // Check for topic change
  const lowerMessage = normalized.toLowerCase();
  for (const keyword of TOPIC_CHANGE_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return "topic-change";
    }
  }

  // Check for adoption signals
  for (const pattern of ADOPTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return "adoption";
    }
  }

  // Check similarity to previous query before follow-up questions
  // (similar questions are likely repetitions, not new follow-up questions)
  if (previousQuery && calculateSimilarity(normalized, previousQuery) > 0.7) {
    return "repetition";
  }

  // Check for follow-up questions
  for (const pattern of FOLLOW_UP_PATTERNS) {
    if (pattern.test(normalized)) {
      return "follow-up-question";
    }
  }

  // Default to continuation if nothing else matches
  if (normalized.length > 10) {
    return "continuation";
  }

  return null;
}

/**
 * Calculate simple word-based similarity between two strings
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Calculate helpfulness score from signals
 */
export function calculateHelpfulnessScore(signals: OutcomeSignal[]): number {
  if (signals.length === 0) return 0;

  let totalWeight = 0;
  for (const signal of signals) {
    totalWeight += SIGNAL_WEIGHTS[signal];
  }

  // Normalize to -1 to 1 range, accounting for multiple signals
  const normalized = totalWeight / Math.max(1, Math.sqrt(signals.length));

  // Clamp to range
  return Math.max(-1, Math.min(1, normalized));
}

/**
 * Track a new response
 */
export async function trackResponse(
  agentId: string,
  sessionId: string,
  userQuery: string,
  response: string,
  options: {
    category?: string;
    toolCalls?: string[];
    maxHistorySize?: number;
  } = {},
): Promise<TrackedResponse> {
  const responses = await loadTrackedResponses(agentId);
  const maxHistory = options.maxHistorySize ?? defaultSelfEvaluationConfig.maxHistorySize;

  const tracked: TrackedResponse = {
    id: generateResponseId(),
    agentId,
    sessionId,
    userQuery,
    response: response.slice(0, MAX_RESPONSE_LENGTH),
    category: options.category,
    toolCalls: options.toolCalls,
    timestamp: new Date().toISOString(),
    signals: [],
    helpfulnessScore: 0,
    processedForLearning: false,
  };

  responses.push(tracked);

  // Trim old responses if over limit
  while (responses.length > maxHistory) {
    responses.shift();
  }

  await saveTrackedResponses(agentId, responses);
  return tracked;
}

/**
 * Record an outcome signal for the most recent response in a session
 */
export async function recordOutcome(
  agentId: string,
  sessionId: string,
  signal: OutcomeSignal,
): Promise<TrackedResponse | null> {
  const responses = await loadTrackedResponses(agentId);

  // Find the most recent response for this session
  const recentResponse = [...responses]
    .reverse()
    .find((r) => r.sessionId === sessionId && !r.processedForLearning);

  if (!recentResponse) return null;

  // Add signal if not already present
  if (!recentResponse.signals.includes(signal)) {
    recentResponse.signals.push(signal);
    recentResponse.helpfulnessScore = calculateHelpfulnessScore(recentResponse.signals);
  }

  await saveTrackedResponses(agentId, responses);
  return recentResponse;
}

/**
 * Get self-evaluation statistics for an agent
 */
export async function getSelfEvaluationStats(agentId: string): Promise<SelfEvaluationStats> {
  const responses = await loadTrackedResponses(agentId);

  const stats: SelfEvaluationStats = {
    totalResponses: responses.length,
    avgHelpfulness: 0,
    signalCounts: {
      "follow-up-question": 0,
      "topic-change": 0,
      adoption: 0,
      "explicit-positive": 0,
      "explicit-negative": 0,
      continuation: 0,
      repetition: 0,
      correction: 0,
    },
    byCategory: {},
    recentTrend: "stable",
    recentAvgScore: 0,
  };

  if (responses.length === 0) return stats;

  // Calculate totals
  let totalScore = 0;

  for (const response of responses) {
    totalScore += response.helpfulnessScore;

    // Count signals
    for (const signal of response.signals) {
      stats.signalCounts[signal]++;
    }

    // Track by category
    const category = response.category || "general";
    if (!stats.byCategory[category]) {
      stats.byCategory[category] = { count: 0, avgScore: 0 };
    }
    stats.byCategory[category].count++;
    stats.byCategory[category].avgScore += response.helpfulnessScore;
  }

  // Calculate averages
  stats.avgHelpfulness = totalScore / responses.length;

  for (const category of Object.keys(stats.byCategory)) {
    const cat = stats.byCategory[category];
    cat.avgScore = cat.avgScore / cat.count;
  }

  // Calculate recent trend (last 10 vs previous 10)
  const recent10 = responses.slice(-10);
  const previous10 = responses.slice(-20, -10);

  if (recent10.length > 0) {
    stats.recentAvgScore = recent10.reduce((s, r) => s + r.helpfulnessScore, 0) / recent10.length;
  }

  if (previous10.length >= 5 && recent10.length >= 5) {
    const prevAvg = previous10.reduce((s, r) => s + r.helpfulnessScore, 0) / previous10.length;
    const diff = stats.recentAvgScore - prevAvg;

    if (diff > 0.1) {
      stats.recentTrend = "improving";
    } else if (diff < -0.1) {
      stats.recentTrend = "declining";
    }
  }

  return stats;
}

/**
 * Process tracked responses and generate learnings
 */
export async function processForLearnings(
  agentId: string,
  config: Partial<SelfEvaluationConfig> = {},
): Promise<number> {
  const cfg = { ...defaultSelfEvaluationConfig, ...config };
  const responses = await loadTrackedResponses(agentId);
  let learningsGenerated = 0;

  for (const response of responses) {
    if (response.processedForLearning) continue;
    if (response.signals.length < cfg.minSignalsForLearning) continue;

    let learningGenerated = false;

    // Generate positive learning for high-score responses
    if (response.helpfulnessScore >= cfg.positiveThreshold) {
      const content = formatPositiveLearning(response);
      const result = await addLearning(agentId, {
        category: "pattern" as LearningCategory,
        content,
        confidence: scoreToConfidence(response.helpfulnessScore),
        source: "self_evaluation",
      });

      if (result) {
        learningsGenerated++;
        learningGenerated = true;
      }
    }

    // Generate correction learning for low-score responses
    if (response.helpfulnessScore <= cfg.negativeThreshold) {
      const content = formatNegativeLearning(response);
      const result = await addLearning(agentId, {
        category: "correction" as LearningCategory,
        content,
        confidence: scoreToConfidence(Math.abs(response.helpfulnessScore)),
        source: "self_evaluation",
      });

      if (result) {
        learningsGenerated++;
        learningGenerated = true;
      }
    }

    if (learningGenerated) {
      response.processedForLearning = true;
    }
  }

  await saveTrackedResponses(agentId, responses);
  return learningsGenerated;
}

/**
 * Format a positive learning from a tracked response
 */
function formatPositiveLearning(response: TrackedResponse): string {
  const queryPreview = response.userQuery.slice(0, 50);
  const signals = response.signals.filter((s) => SIGNAL_WEIGHTS[s] > 0);
  const signalDesc = signals.length > 0 ? ` (signals: ${signals.join(", ")})` : "";

  return `Effective approach for "${queryPreview}..."${signalDesc}`;
}

/**
 * Format a negative learning from a tracked response
 */
function formatNegativeLearning(response: TrackedResponse): string {
  const queryPreview = response.userQuery.slice(0, 50);
  const signals = response.signals.filter((s) => SIGNAL_WEIGHTS[s] < 0);
  const signalDesc = signals.length > 0 ? ` (issues: ${signals.join(", ")})` : "";

  return `Response needs improvement for "${queryPreview}..."${signalDesc}`;
}

/**
 * Convert score to confidence level
 */
function scoreToConfidence(score: number): "high" | "medium" | "low" {
  const absScore = Math.abs(score);
  if (absScore >= 0.6) return "high";
  if (absScore >= 0.3) return "medium";
  return "low";
}

/**
 * Get responses that need review (low scores but not yet processed)
 */
export async function getResponsesForReview(
  agentId: string,
  limit = 10,
): Promise<TrackedResponse[]> {
  const responses = await loadTrackedResponses(agentId);

  return responses
    .filter((r) => !r.processedForLearning && r.helpfulnessScore < 0)
    .sort((a, b) => a.helpfulnessScore - b.helpfulnessScore)
    .slice(0, limit);
}

/**
 * Get top performing responses
 */
export async function getTopResponses(agentId: string, limit = 10): Promise<TrackedResponse[]> {
  const responses = await loadTrackedResponses(agentId);

  return responses
    .filter((r) => r.signals.length > 0)
    .sort((a, b) => b.helpfulnessScore - a.helpfulnessScore)
    .slice(0, limit);
}

// Hook management
let evaluationHandler: InternalHookHandler | null = null;
let lastTrackedResponse: Map<string, TrackedResponse> = new Map();

/**
 * Register the self-evaluation hook
 */
export function registerSelfEvaluationHook(config: Partial<SelfEvaluationConfig> = {}): () => void {
  const cfg = { ...defaultSelfEvaluationConfig, ...config };

  if (!cfg.enabled) {
    return () => {};
  }

  evaluationHandler = async (event: InternalHookEvent): Promise<void> => {
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

    // Get the last tracked response for this session
    const lastResponse = lastTrackedResponse.get(sessionKey);

    // If we have a user message, check for outcome signals
    if (userMessage && lastResponse) {
      const signal = detectOutcomeSignal(userMessage, lastResponse.userQuery);

      if (signal) {
        try {
          await recordOutcome(agentId, sessionId || "default", signal);
        } catch (err) {
          console.error("[self-evaluation] Failed to record outcome:", err);
        }
      }
    }

    // Track the current response if it's substantial
    const responseText = payloads
      ?.filter((p) => p.text && !p.isError)
      .map((p) => p.text)
      .join("\n");

    if (responseText && responseText.length >= cfg.minResponseLength && userMessage) {
      try {
        const tracked = await trackResponse(
          agentId,
          sessionId || "default",
          userMessage,
          responseText,
          { maxHistorySize: cfg.maxHistorySize },
        );
        lastTrackedResponse.set(sessionKey, tracked);
      } catch (err) {
        console.error("[self-evaluation] Failed to track response:", err);
      }
    }
  };

  registerInternalHook("agent:turn:complete", evaluationHandler);

  return () => {
    if (evaluationHandler) {
      unregisterInternalHook("agent:turn:complete", evaluationHandler);
      evaluationHandler = null;
    }
    lastTrackedResponse.clear();
  };
}

/**
 * Clear the last tracked response cache (useful for testing)
 */
export function clearTrackedResponseCache(): void {
  lastTrackedResponse.clear();
}

/**
 * Set a tracked response in cache (useful for testing)
 */
export function setTrackedResponseCache(sessionKey: string, response: TrackedResponse): void {
  lastTrackedResponse.set(sessionKey, response);
}
