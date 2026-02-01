/**
 * Preference extraction from conversation patterns
 *
 * Analyzes conversation history to extract implicit user preferences
 * including communication tone, detail level, topic interests, and
 * interaction patterns. Uses heuristic-based pattern analysis.
 */

import type { LearningConfidence } from "./extract-learnings.js";

/** Types of preferences that can be extracted */
export type PreferenceType =
  | "tone"
  | "detail-level"
  | "topic"
  | "timing"
  | "format"
  | "interaction-style";

/** Extracted preference with confidence scoring */
export interface ExtractedPreference {
  type: PreferenceType;
  key: string;
  value: string;
  confidence: number; // 0-1 scale
  evidenceCount: number;
  lastSeen: string;
}

/** Message in a conversation for analysis */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/** Configuration for preference extraction */
export interface PreferenceExtractionConfig {
  /** Minimum confidence threshold for including preferences */
  minConfidence: number;
  /** Minimum evidence count required */
  minEvidenceCount: number;
  /** Maximum messages to analyze */
  maxMessagesToAnalyze: number;
}

export const defaultExtractionConfig: PreferenceExtractionConfig = {
  minConfidence: 0.4,
  minEvidenceCount: 2,
  maxMessagesToAnalyze: 100,
};

// Tone indicators
const FORMAL_INDICATORS = [
  /\b(please|kindly|would you|could you)\b/i,
  /\b(thank you|thanks|appreciate)\b/i,
  /\b(sincerely|regards|respectfully)\b/i,
];

const CASUAL_INDICATORS = [
  /\b(hey|hi|yo|sup)\b/i,
  /\b(gonna|wanna|gotta|kinda|sorta)\b/i,
  /\b(cool|awesome|nice|sweet)\b/i,
  /!{2,}/,
  /\b(lol|lmao|haha)\b/i,
];

const DIRECT_INDICATORS = [
  /^(do|make|create|fix|change|update|delete|remove)\b/i,
  /^(just|simply)\b/i,
  /\bASAP\b/i,
];

// Detail level indicators
const BRIEF_PREFERENCE_INDICATORS = [
  /\b(brief|concise|short|quick|summary|tl;?dr)\b/i,
  /\b(just|only)\s+(the|a)\s+(answer|result|output)/i,
  /\bno\s+(need\s+for\s+)?(explanation|details?|context)\b/i,
  /\bkeep it (short|simple|brief)\b/i,
];

const DETAILED_PREFERENCE_INDICATORS = [
  /\b(explain|detail|elaborate|expand|describe)\b/i,
  /\b(why|how|what\s+is)\b.*\?/i,
  /\b(step[\s-]by[\s-]step|in[\s-]depth|thorough|comprehensive)\b/i,
  /\b(walk\s+me\s+through|break\s+(it\s+)?down)\b/i,
];

// Format preference indicators
const CODE_FORMAT_INDICATORS = [
  /\b(code|snippet|example|implementation)\b/i,
  /\b(show\s+me\s+the\s+code)\b/i,
  /```/,
];

const LIST_FORMAT_INDICATORS = [
  /\b(list|bullet|steps|items)\b/i,
  /\b(give\s+me\s+a\s+list|in\s+list\s+form)\b/i,
];

const PROSE_FORMAT_INDICATORS = [
  /\b(paragraph|narrative|prose|story)\b/i,
  /\b(explain\s+in\s+words|without\s+code)\b/i,
];

// Topic extraction patterns
const TOPIC_PATTERNS = [
  /(?:about|regarding|concerning|related\s+to)\s+([a-z][a-z\s-]+)/gi,
  /(?:help\s+(?:me\s+)?with)\s+([a-z][a-z\s-]+)/gi,
  /(?:working\s+on|building|creating)\s+(?:a\s+)?([a-z][a-z\s-]+)/gi,
  /(?:question\s+about|interested\s+in)\s+([a-z][a-z\s-]+)/gi,
];

// Timing patterns
const TIME_SENSITIVE_INDICATORS = [
  /\b(urgent|asap|immediately|now|quickly|hurry)\b/i,
  /\b(deadline|due|by\s+\w+day)\b/i,
];

const PATIENT_INDICATORS = [
  /\b(when\s+you\s+have\s+time|no\s+rush|whenever)\b/i,
  /\b(take\s+your\s+time|not\s+urgent)\b/i,
];

/**
 * Extract preferences from a conversation history
 */
export function extractPreferences(
  messages: ConversationMessage[],
  config: Partial<PreferenceExtractionConfig> = {},
): ExtractedPreference[] {
  const cfg = { ...defaultExtractionConfig, ...config };
  const preferences: Map<string, ExtractedPreference> = new Map();

  // Limit messages to analyze
  const messagesToAnalyze = messages.slice(-cfg.maxMessagesToAnalyze);
  const userMessages = messagesToAnalyze.filter((m) => m.role === "user");

  if (userMessages.length === 0) {
    return [];
  }

  // Analyze tone
  const tonePrefs = analyzeTone(userMessages);
  for (const pref of tonePrefs) {
    mergePreference(preferences, pref);
  }

  // Analyze detail level
  const detailPrefs = analyzeDetailLevel(userMessages);
  for (const pref of detailPrefs) {
    mergePreference(preferences, pref);
  }

  // Analyze format preferences
  const formatPrefs = analyzeFormatPreference(userMessages);
  for (const pref of formatPrefs) {
    mergePreference(preferences, pref);
  }

  // Extract topics of interest
  const topicPrefs = extractTopics(userMessages);
  for (const pref of topicPrefs) {
    mergePreference(preferences, pref);
  }

  // Analyze timing preferences
  const timingPrefs = analyzeTimingPreference(userMessages);
  for (const pref of timingPrefs) {
    mergePreference(preferences, pref);
  }

  // Analyze interaction style
  const stylePrefs = analyzeInteractionStyle(userMessages, messagesToAnalyze);
  for (const pref of stylePrefs) {
    mergePreference(preferences, pref);
  }

  // Filter by thresholds and return
  return Array.from(preferences.values()).filter(
    (p) => p.confidence >= cfg.minConfidence && p.evidenceCount >= cfg.minEvidenceCount,
  );
}

/**
 * Analyze communication tone from user messages
 */
function analyzeTone(messages: ConversationMessage[]): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  let formalCount = 0;
  let casualCount = 0;
  let directCount = 0;
  let lastTimestamp = "";

  for (const msg of messages) {
    const content = msg.content;
    lastTimestamp = msg.timestamp || new Date().toISOString();

    // Count formal indicators
    for (const pattern of FORMAL_INDICATORS) {
      if (pattern.test(content)) {
        formalCount++;
        break;
      }
    }

    // Count casual indicators
    for (const pattern of CASUAL_INDICATORS) {
      if (pattern.test(content)) {
        casualCount++;
        break;
      }
    }

    // Count direct indicators
    for (const pattern of DIRECT_INDICATORS) {
      if (pattern.test(content)) {
        directCount++;
        break;
      }
    }
  }

  const total = messages.length;

  if (formalCount > 0) {
    preferences.push({
      type: "tone",
      key: "formality",
      value: "formal",
      confidence: formalCount / total,
      evidenceCount: formalCount,
      lastSeen: lastTimestamp,
    });
  }

  if (casualCount > 0) {
    preferences.push({
      type: "tone",
      key: "formality",
      value: "casual",
      confidence: casualCount / total,
      evidenceCount: casualCount,
      lastSeen: lastTimestamp,
    });
  }

  if (directCount > 0) {
    preferences.push({
      type: "tone",
      key: "communication-style",
      value: "direct",
      confidence: directCount / total,
      evidenceCount: directCount,
      lastSeen: lastTimestamp,
    });
  }

  return preferences;
}

/**
 * Analyze preferred detail level
 */
function analyzeDetailLevel(messages: ConversationMessage[]): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  let briefCount = 0;
  let detailedCount = 0;
  let lastTimestamp = "";

  // Also analyze message length as a proxy for expected detail
  const avgLength =
    messages.reduce((sum, m) => sum + m.content.length, 0) / Math.max(1, messages.length);

  for (const msg of messages) {
    const content = msg.content;
    lastTimestamp = msg.timestamp || new Date().toISOString();

    for (const pattern of BRIEF_PREFERENCE_INDICATORS) {
      if (pattern.test(content)) {
        briefCount++;
        break;
      }
    }

    for (const pattern of DETAILED_PREFERENCE_INDICATORS) {
      if (pattern.test(content)) {
        detailedCount++;
        break;
      }
    }
  }

  const total = messages.length;

  // Explicit preferences from patterns
  if (briefCount > 0) {
    preferences.push({
      type: "detail-level",
      key: "response-length",
      value: "brief",
      confidence: Math.min(0.9, briefCount / total + 0.2),
      evidenceCount: briefCount,
      lastSeen: lastTimestamp,
    });
  }

  if (detailedCount > 0) {
    preferences.push({
      type: "detail-level",
      key: "response-length",
      value: "detailed",
      confidence: Math.min(0.9, detailedCount / total + 0.2),
      evidenceCount: detailedCount,
      lastSeen: lastTimestamp,
    });
  }

  // Infer from message length (weaker signal)
  if (avgLength < 50 && briefCount === 0 && detailedCount === 0) {
    preferences.push({
      type: "detail-level",
      key: "response-length",
      value: "brief",
      confidence: 0.3,
      evidenceCount: Math.min(3, messages.length),
      lastSeen: lastTimestamp,
    });
  } else if (avgLength > 200 && briefCount === 0 && detailedCount === 0) {
    preferences.push({
      type: "detail-level",
      key: "response-length",
      value: "detailed",
      confidence: 0.3,
      evidenceCount: Math.min(3, messages.length),
      lastSeen: lastTimestamp,
    });
  }

  return preferences;
}

/**
 * Analyze preferred output format
 */
function analyzeFormatPreference(messages: ConversationMessage[]): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  let codeCount = 0;
  let listCount = 0;
  let proseCount = 0;
  let lastTimestamp = "";

  for (const msg of messages) {
    const content = msg.content;
    lastTimestamp = msg.timestamp || new Date().toISOString();

    for (const pattern of CODE_FORMAT_INDICATORS) {
      if (pattern.test(content)) {
        codeCount++;
        break;
      }
    }

    for (const pattern of LIST_FORMAT_INDICATORS) {
      if (pattern.test(content)) {
        listCount++;
        break;
      }
    }

    for (const pattern of PROSE_FORMAT_INDICATORS) {
      if (pattern.test(content)) {
        proseCount++;
        break;
      }
    }
  }

  const total = messages.length;

  if (codeCount > 0) {
    preferences.push({
      type: "format",
      key: "output-format",
      value: "code-focused",
      confidence: Math.min(0.9, codeCount / total + 0.1),
      evidenceCount: codeCount,
      lastSeen: lastTimestamp,
    });
  }

  if (listCount > 0) {
    preferences.push({
      type: "format",
      key: "output-format",
      value: "list-format",
      confidence: Math.min(0.9, listCount / total + 0.1),
      evidenceCount: listCount,
      lastSeen: lastTimestamp,
    });
  }

  if (proseCount > 0) {
    preferences.push({
      type: "format",
      key: "output-format",
      value: "prose",
      confidence: Math.min(0.9, proseCount / total + 0.1),
      evidenceCount: proseCount,
      lastSeen: lastTimestamp,
    });
  }

  return preferences;
}

/**
 * Extract topics of interest from messages
 */
function extractTopics(messages: ConversationMessage[]): ExtractedPreference[] {
  const topicCounts: Map<string, { count: number; lastSeen: string }> = new Map();

  for (const msg of messages) {
    const content = msg.content;
    const timestamp = msg.timestamp || new Date().toISOString();

    for (const pattern of TOPIC_PATTERNS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const topic = normalizeTopic(match[1]);
        if (topic && topic.length >= 3 && topic.length <= 50) {
          const existing = topicCounts.get(topic);
          if (existing) {
            existing.count++;
            existing.lastSeen = timestamp;
          } else {
            topicCounts.set(topic, { count: 1, lastSeen: timestamp });
          }
        }
      }
    }
  }

  const preferences: ExtractedPreference[] = [];
  const total = messages.length;

  for (const [topic, data] of topicCounts) {
    preferences.push({
      type: "topic",
      key: "interest",
      value: topic,
      confidence: Math.min(0.8, data.count / total + 0.1),
      evidenceCount: data.count,
      lastSeen: data.lastSeen,
    });
  }

  // Sort by evidence count and return top topics
  return preferences.sort((a, b) => b.evidenceCount - a.evidenceCount).slice(0, 10);
}

/**
 * Normalize a topic string
 */
function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "");
}

/**
 * Analyze timing preferences
 */
function analyzeTimingPreference(messages: ConversationMessage[]): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  let urgentCount = 0;
  let patientCount = 0;
  let lastTimestamp = "";

  for (const msg of messages) {
    const content = msg.content;
    lastTimestamp = msg.timestamp || new Date().toISOString();

    for (const pattern of TIME_SENSITIVE_INDICATORS) {
      if (pattern.test(content)) {
        urgentCount++;
        break;
      }
    }

    for (const pattern of PATIENT_INDICATORS) {
      if (pattern.test(content)) {
        patientCount++;
        break;
      }
    }
  }

  const total = messages.length;

  if (urgentCount > 0) {
    preferences.push({
      type: "timing",
      key: "urgency",
      value: "time-sensitive",
      confidence: Math.min(0.9, urgentCount / total + 0.2),
      evidenceCount: urgentCount,
      lastSeen: lastTimestamp,
    });
  }

  if (patientCount > 0) {
    preferences.push({
      type: "timing",
      key: "urgency",
      value: "patient",
      confidence: Math.min(0.9, patientCount / total + 0.2),
      evidenceCount: patientCount,
      lastSeen: lastTimestamp,
    });
  }

  return preferences;
}

/**
 * Analyze interaction style from conversation patterns
 */
function analyzeInteractionStyle(
  userMessages: ConversationMessage[],
  allMessages: ConversationMessage[],
): ExtractedPreference[] {
  const preferences: ExtractedPreference[] = [];
  const lastTimestamp =
    userMessages.at(-1)?.timestamp || allMessages.at(-1)?.timestamp || new Date().toISOString();

  // Analyze question frequency
  const questionCount = userMessages.filter((m) => m.content.includes("?")).length;
  const questionRatio = questionCount / Math.max(1, userMessages.length);

  if (questionRatio > 0.5) {
    preferences.push({
      type: "interaction-style",
      key: "inquiry-style",
      value: "question-oriented",
      confidence: Math.min(0.8, questionRatio),
      evidenceCount: questionCount,
      lastSeen: lastTimestamp,
    });
  }

  // Analyze follow-up patterns (consecutive user messages)
  let followUpCount = 0;
  for (let i = 1; i < allMessages.length; i++) {
    if (allMessages[i].role === "user" && allMessages[i - 1].role === "user") {
      followUpCount++;
    }
  }

  if (followUpCount > 0) {
    preferences.push({
      type: "interaction-style",
      key: "follow-up",
      value: "iterative",
      confidence: Math.min(0.7, followUpCount / Math.max(1, userMessages.length) + 0.2),
      evidenceCount: followUpCount,
      lastSeen: lastTimestamp,
    });
  }

  // Analyze message complexity (sentence count as proxy)
  const avgSentences =
    userMessages.reduce((sum, m) => {
      const sentences = m.content.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      return sum + sentences.length;
    }, 0) / Math.max(1, userMessages.length);

  if (avgSentences <= 1.5) {
    preferences.push({
      type: "interaction-style",
      key: "message-complexity",
      value: "simple",
      confidence: 0.5,
      evidenceCount: Math.min(5, userMessages.length),
      lastSeen: lastTimestamp,
    });
  } else if (avgSentences >= 3) {
    preferences.push({
      type: "interaction-style",
      key: "message-complexity",
      value: "complex",
      confidence: 0.5,
      evidenceCount: Math.min(5, userMessages.length),
      lastSeen: lastTimestamp,
    });
  }

  return preferences;
}

/**
 * Merge a preference into the map, updating existing entries
 */
function mergePreference(
  preferences: Map<string, ExtractedPreference>,
  pref: ExtractedPreference,
): void {
  const key = `${pref.type}:${pref.key}:${pref.value}`;
  const existing = preferences.get(key);

  if (existing) {
    // Combine evidence and update confidence
    existing.evidenceCount += pref.evidenceCount;
    existing.confidence = Math.max(existing.confidence, pref.confidence);
    if (pref.lastSeen > existing.lastSeen) {
      existing.lastSeen = pref.lastSeen;
    }
  } else {
    preferences.set(key, { ...pref });
  }
}

/**
 * Convert confidence to LearningConfidence category
 */
export function toConfidenceLevel(confidence: number): LearningConfidence {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.4) return "medium";
  return "low";
}

/**
 * Format preferences as a human-readable summary
 */
export function formatPreferenceSummary(preferences: ExtractedPreference[]): string {
  if (preferences.length === 0) {
    return "No preferences detected.";
  }

  const byType: Map<PreferenceType, ExtractedPreference[]> = new Map();
  for (const pref of preferences) {
    const list = byType.get(pref.type) || [];
    list.push(pref);
    byType.set(pref.type, list);
  }

  const sections: string[] = [];

  const typeLabels: Record<PreferenceType, string> = {
    tone: "Communication Tone",
    "detail-level": "Detail Preferences",
    topic: "Topics of Interest",
    timing: "Timing",
    format: "Output Format",
    "interaction-style": "Interaction Style",
  };

  for (const [type, prefs] of byType) {
    const label = typeLabels[type] || type;
    const items = prefs
      .sort((a, b) => b.confidence - a.confidence)
      .map((p) => `${p.value} (${Math.round(p.confidence * 100)}%)`)
      .join(", ");
    sections.push(`${label}: ${items}`);
  }

  return sections.join("\n");
}
