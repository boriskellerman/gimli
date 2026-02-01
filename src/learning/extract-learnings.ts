/**
 * Learning extraction from conversations
 *
 * Analyzes conversation content to extract learnings about user preferences,
 * corrections, patterns, and tool usage. Provides the core extraction logic
 * for the learning system.
 */

/**
 * Categories of learnings that can be extracted
 */
export type LearningCategory = "preference" | "correction" | "pattern" | "tool-usage";

/**
 * Confidence level for extracted learnings
 */
export type LearningConfidence = "high" | "medium" | "low";

/**
 * Source of a learning
 */
export type LearningSource =
  | "user_message"
  | "success_pattern"
  | "file"
  | "conversation"
  | "system"
  | "self_evaluation"
  | "reminder_feedback";

/**
 * A learning extracted from conversation or other sources
 */
export interface ExtractedLearning {
  /** The learning content/description */
  content: string;
  /** Category of the learning */
  category: LearningCategory;
  /** Confidence level */
  confidence: LearningConfidence;
  /** Source of the learning */
  source: LearningSource;
  /** Related context or topic */
  context?: string;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Options for learning extraction
 */
export interface ExtractionOptions {
  /** Minimum confidence threshold */
  minConfidence?: LearningConfidence;
  /** Categories to extract */
  categories?: LearningCategory[];
  /** Maximum learnings to extract per message */
  maxPerMessage?: number;
}

/**
 * Result of learning extraction
 */
export interface ExtractionResult {
  /** Extracted learnings */
  learnings: ExtractedLearning[];
  /** Number of messages analyzed */
  messagesAnalyzed: number;
  /** Processing timestamp */
  timestamp: string;
}

/**
 * Default extraction options
 */
export const defaultExtractionOptions: ExtractionOptions = {
  minConfidence: "low",
  categories: ["preference", "correction", "pattern", "tool-usage"],
  maxPerMessage: 3,
};

/**
 * Extract learnings from a user message
 */
export function extractFromMessage(
  message: string,
  options: ExtractionOptions = defaultExtractionOptions,
): ExtractedLearning[] {
  const learnings: ExtractedLearning[] = [];

  // Preference indicators
  if (/\b(prefer|like|want|always|never)\b/i.test(message)) {
    learnings.push({
      content: message.slice(0, 200),
      category: "preference",
      confidence: "medium",
      source: "user_message",
    });
  }

  // Correction indicators
  if (/\b(no|wrong|incorrect|actually|instead)\b/i.test(message)) {
    learnings.push({
      content: message.slice(0, 200),
      category: "correction",
      confidence: "high",
      source: "user_message",
    });
  }

  // Limit results
  const max = options.maxPerMessage ?? 3;
  return learnings.slice(0, max);
}

/**
 * Extract learnings from a conversation history
 */
export function extractFromConversation(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  options: ExtractionOptions = defaultExtractionOptions,
): ExtractionResult {
  const allLearnings: ExtractedLearning[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const extracted = extractFromMessage(msg.content, options);
      allLearnings.push(...extracted);
    }
  }

  return {
    learnings: allLearnings,
    messagesAnalyzed: messages.length,
    timestamp: new Date().toISOString(),
  };
}
