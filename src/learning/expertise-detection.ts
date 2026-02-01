/**
 * Expertise detection from conversation patterns
 *
 * Analyzes user interactions to detect expertise levels per topic.
 * Tracks signals like question complexity, terminology usage,
 * explanation requests, and correction patterns to build a
 * per-topic expertise profile.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";

/** Expertise levels from novice to expert */
export type ExpertiseLevel = "novice" | "beginner" | "intermediate" | "advanced" | "expert";

/** Signals that inform expertise detection */
export type ExpertiseSignal =
  | "basic-question" // Simple what/how questions
  | "advanced-question" // Complex why/architecture questions
  | "terminology-usage" // Uses domain-specific terms
  | "terminology-confusion" // Asks what terms mean
  | "explanation-request" // Asks for detailed explanations
  | "shortcut-usage" // Uses abbreviations/shortcuts
  | "self-correction" // Corrects own understanding
  | "teaches-back" // Explains concepts back correctly
  | "error-recovery" // Handles errors independently
  | "context-awareness"; // Understands broader context

/** A recorded expertise signal */
export interface ExpertiseObservation {
  signal: ExpertiseSignal;
  topic: string;
  weight: number; // -1 to 1, negative = suggests lower expertise
  timestamp: string;
  evidence?: string; // Optional snippet showing the signal
}

/** Expertise profile for a specific topic */
export interface TopicExpertise {
  topic: string;
  level: ExpertiseLevel;
  confidence: number; // 0-1, how confident we are in the assessment
  observationCount: number;
  lastUpdated: string;
  signals: Record<ExpertiseSignal, number>; // Count per signal type
}

/** Full user expertise profile */
export interface ExpertiseProfile {
  userId: string;
  topics: TopicExpertise[];
  overallLevel: ExpertiseLevel;
  lastUpdated: string;
}

/** Response adjustment based on expertise */
export interface ExpertiseAdjustment {
  topic: string;
  level: ExpertiseLevel;
  adjustments: {
    detailLevel: "minimal" | "standard" | "detailed" | "comprehensive";
    terminology: "simplified" | "standard" | "technical";
    examples: "many" | "some" | "few" | "none";
    explanations: "step-by-step" | "overview" | "brief" | "assume-known";
  };
}

const EXPERTISE_FILENAME = "expertise-profile.json";

// Signal weights for expertise inference
const SIGNAL_WEIGHTS: Record<ExpertiseSignal, number> = {
  "basic-question": -0.3,
  "advanced-question": 0.4,
  "terminology-usage": 0.3,
  "terminology-confusion": -0.4,
  "explanation-request": -0.2,
  "shortcut-usage": 0.3,
  "self-correction": 0.1,
  "teaches-back": 0.5,
  "error-recovery": 0.3,
  "context-awareness": 0.4,
};

// Patterns for detecting expertise signals in messages
const BASIC_QUESTION_PATTERNS = [
  /\b(?:what\s+is|what's|what\s+are)\s+(?:a|an|the)?\s*(\w+)/i,
  /\b(?:how\s+do\s+(?:i|you)|how\s+to)\s+(\w+)/i,
  /\b(?:can\s+you\s+explain)\s+(?:what|how)/i,
  /\bwhat\s+does\s+(\w+)\s+(?:mean|do)\b/i,
  /\b(?:i\s+don't\s+(?:understand|know|get))\b/i,
  /\b(?:never\s+(?:used|seen|heard\s+of))\b/i,
];

const ADVANCED_QUESTION_PATTERNS = [
  /\b(?:why\s+(?:does|is|are|would))\s+.+\s+(?:instead\s+of|rather\s+than)/i,
  /\b(?:trade-?offs?\s+(?:between|of))\b/i,
  /\b(?:architecture|design\s+pattern|implementation\s+detail)/i,
  /\b(?:performance|optimization|scalability)\s+(?:implication|consideration)/i,
  /\b(?:edge\s+case|corner\s+case|race\s+condition)/i,
  /\b(?:under\s+the\s+hood|internally|behind\s+the\s+scenes)/i,
  /\b(?:best\s+practice|idiomatic|convention)\b/i,
];

const TERMINOLOGY_CONFUSION_PATTERNS = [
  /\bwhat\s+does\s+['"]?\w+['"]?\s+mean\b/i,
  /\b(?:i'm\s+not\s+(?:sure|familiar)\s+(?:what|with))\b/i,
  /\b(?:what's\s+the\s+difference\s+between)\b/i,
  /\b(?:is\s+that\s+the\s+same\s+as)\b/i,
  /\b(?:sorry|confused),?\s+(?:what|i\s+don't)\b/i,
];

const EXPLANATION_REQUEST_PATTERNS = [
  /\b(?:can\s+you\s+(?:explain|elaborate|break\s+(?:it\s+)?down))\b/i,
  /\b(?:step[\s-]by[\s-]step|in\s+detail|more\s+detail)\b/i,
  /\b(?:walk\s+me\s+through|help\s+me\s+understand)\b/i,
  /\b(?:eli5|explain\s+like\s+i'm\s+(?:5|five|a\s+beginner))\b/i,
];

const SHORTCUT_USAGE_PATTERNS = [
  /\b(?:just|simply|quickly)\s+(?:do|run|use|add)\b/i,
  /\b(?:the\s+usual|standard|default)\s+(?:way|approach|config)\b/i,
  /\b(?:you\s+know,?\s+(?:the|like))\b/i,
  /\b(?:skip\s+(?:the|to)|straight\s+to)\b/i,
];

const TEACHES_BACK_PATTERNS = [
  /\b(?:so\s+(?:basically|essentially|in\s+other\s+words))\b/i,
  /\b(?:if\s+i\s+understand\s+correctly)\b/i,
  /\b(?:let\s+me\s+(?:rephrase|summarize))\b/i,
  /\b(?:that\s+means|so\s+that's\s+why)\b/i,
];

const CONTEXT_AWARENESS_PATTERNS = [
  /\b(?:given\s+(?:that|the\s+(?:current|existing)))\b/i,
  /\b(?:considering|taking\s+into\s+account)\b/i,
  /\b(?:in\s+the\s+context\s+of|with\s+respect\s+to)\b/i,
  /\b(?:similar\s+to\s+(?:how|what)\s+we)\b/i,
];

// Technical terms by domain (for terminology usage detection)
const DOMAIN_TERMS: Record<string, RegExp[]> = {
  programming: [
    /\b(?:async|await|promise|callback|closure|recursion|polymorphism)\b/i,
    /\b(?:dependency\s+injection|inversion\s+of\s+control|factory\s+pattern)\b/i,
    /\b(?:mutex|semaphore|deadlock|race\s+condition)\b/i,
  ],
  database: [
    /\b(?:sql\s+join|index(?:ing)?|query\s+optimization|normalization|sharding)\b/i,
    /\b(?:acid|transaction|isolation\s+level)\b/i,
    /\b(?:denormalization|materialized\s+view|partition|foreign\s+key)\b/i,
  ],
  devops: [
    /\b(?:container|orchestration|kubernetes|helm|terraform)\b/i,
    /\b(?:ci\/cd|pipeline|artifact|deployment\s+strategy)\b/i,
    /\b(?:load\s+balancer|reverse\s+proxy|service\s+mesh)\b/i,
  ],
  security: [
    /\b(?:authentication|authorization|oauth|jwt|csrf)\b/i,
    /\b(?:encryption|hashing|salt|key\s+rotation)\b/i,
    /\b(?:vulnerability|injection|xss|privilege\s+escalation)\b/i,
  ],
  general: [
    /\b(?:api|sdk|cli|framework|library|module)\b/i,
    /\b(?:configuration|environment|deployment|staging)\b/i,
  ],
};

/**
 * Resolve the expertise storage directory for an agent
 */
function resolveExpertiseDir(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "learning");
}

/**
 * Resolve the path to an agent's expertise profile file
 */
export function resolveExpertisePath(agentId: string): string {
  return path.join(resolveExpertiseDir(agentId), EXPERTISE_FILENAME);
}

/**
 * Load expertise profile for an agent
 */
export async function loadExpertiseProfile(agentId: string): Promise<ExpertiseProfile> {
  const filePath = resolveExpertisePath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    // Return empty profile if file doesn't exist
    return {
      userId: agentId,
      topics: [],
      overallLevel: "beginner",
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * Save expertise profile for an agent
 */
export async function saveExpertiseProfile(
  agentId: string,
  profile: ExpertiseProfile,
): Promise<void> {
  const filePath = resolveExpertisePath(agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf8");
}

/**
 * Detect expertise signals from a user message
 */
export function detectExpertiseSignals(message: string, topic?: string): ExpertiseObservation[] {
  const observations: ExpertiseObservation[] = [];
  const normalizedMessage = message.trim();

  if (!normalizedMessage || normalizedMessage.length < 5) {
    return observations;
  }

  const detectedTopic = topic || inferTopic(normalizedMessage);
  const timestamp = new Date().toISOString();

  // Check for basic questions
  for (const pattern of BASIC_QUESTION_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "basic-question",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["basic-question"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for advanced questions
  for (const pattern of ADVANCED_QUESTION_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "advanced-question",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["advanced-question"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for terminology confusion
  for (const pattern of TERMINOLOGY_CONFUSION_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "terminology-confusion",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["terminology-confusion"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for explanation requests
  for (const pattern of EXPLANATION_REQUEST_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "explanation-request",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["explanation-request"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for shortcut usage
  for (const pattern of SHORTCUT_USAGE_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "shortcut-usage",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["shortcut-usage"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for teaching back (understanding demonstration)
  for (const pattern of TEACHES_BACK_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "teaches-back",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["teaches-back"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for context awareness
  for (const pattern of CONTEXT_AWARENESS_PATTERNS) {
    if (pattern.test(normalizedMessage)) {
      observations.push({
        signal: "context-awareness",
        topic: detectedTopic,
        weight: SIGNAL_WEIGHTS["context-awareness"],
        timestamp,
        evidence: extractEvidence(normalizedMessage, pattern),
      });
      break;
    }
  }

  // Check for domain terminology usage
  for (const [domain, patterns] of Object.entries(DOMAIN_TERMS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedMessage)) {
        observations.push({
          signal: "terminology-usage",
          topic: domain,
          weight: SIGNAL_WEIGHTS["terminology-usage"],
          timestamp,
          evidence: extractEvidence(normalizedMessage, pattern),
        });
        break;
      }
    }
  }

  return observations;
}

/**
 * Extract evidence snippet from message
 */
function extractEvidence(message: string, pattern: RegExp): string {
  const match = message.match(pattern);
  if (match) {
    // Return the matched portion with some context
    const start = Math.max(0, match.index! - 10);
    const end = Math.min(message.length, match.index! + match[0].length + 10);
    return message.slice(start, end).trim();
  }
  return message.slice(0, 50);
}

/**
 * Infer topic from message content
 */
export function inferTopic(message: string): string {
  const normalized = message.toLowerCase();

  // Check domain-specific patterns
  for (const [domain, patterns] of Object.entries(DOMAIN_TERMS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return domain;
      }
    }
  }

  // Check for common topic keywords
  const topicPatterns: Record<string, RegExp> = {
    typescript: /\b(?:typescript|ts|type\s+annotation|interface)\b/i,
    javascript: /\b(?:javascript|js|node|npm|es\d+)\b/i,
    python: /\b(?:python|pip|virtualenv|django|flask)\b/i,
    react: /\b(?:react|jsx|tsx|component|hook|useState|useEffect)\b/i,
    git: /\b(?:git|commit|branch|merge|rebase|pull\s+request)\b/i,
    docker: /\b(?:docker|container|image|dockerfile|compose)\b/i,
    testing: /\b(?:test|spec|jest|vitest|mocha|assertion)\b/i,
    api: /\b(?:api|rest|graphql|endpoint|request|response)\b/i,
  };

  for (const [topic, pattern] of Object.entries(topicPatterns)) {
    if (pattern.test(normalized)) {
      return topic;
    }
  }

  return "general";
}

/**
 * Update expertise profile with new observations
 */
export async function updateExpertise(
  agentId: string,
  observations: ExpertiseObservation[],
): Promise<ExpertiseProfile> {
  if (observations.length === 0) {
    return loadExpertiseProfile(agentId);
  }

  const profile = await loadExpertiseProfile(agentId);

  for (const obs of observations) {
    let topicExpertise = profile.topics.find((t) => t.topic === obs.topic);

    if (!topicExpertise) {
      topicExpertise = createEmptyTopicExpertise(obs.topic);
      profile.topics.push(topicExpertise);
    }

    // Update signal counts
    topicExpertise.signals[obs.signal] = (topicExpertise.signals[obs.signal] || 0) + 1;
    topicExpertise.observationCount++;
    topicExpertise.lastUpdated = obs.timestamp;

    // Recalculate level and confidence
    const { level, confidence } = calculateExpertiseLevel(topicExpertise);
    topicExpertise.level = level;
    topicExpertise.confidence = confidence;
  }

  // Update overall level
  profile.overallLevel = calculateOverallLevel(profile.topics);
  profile.lastUpdated = new Date().toISOString();

  await saveExpertiseProfile(agentId, profile);
  return profile;
}

/**
 * Create an empty topic expertise entry
 */
function createEmptyTopicExpertise(topic: string): TopicExpertise {
  return {
    topic,
    level: "beginner",
    confidence: 0,
    observationCount: 0,
    lastUpdated: new Date().toISOString(),
    signals: {
      "basic-question": 0,
      "advanced-question": 0,
      "terminology-usage": 0,
      "terminology-confusion": 0,
      "explanation-request": 0,
      "shortcut-usage": 0,
      "self-correction": 0,
      "teaches-back": 0,
      "error-recovery": 0,
      "context-awareness": 0,
    },
  };
}

/**
 * Calculate expertise level from signal counts
 */
function calculateExpertiseLevel(topic: TopicExpertise): {
  level: ExpertiseLevel;
  confidence: number;
} {
  const signals = topic.signals;

  // Calculate weighted score
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [signal, count] of Object.entries(signals)) {
    if (count > 0) {
      const weight = SIGNAL_WEIGHTS[signal as ExpertiseSignal];
      // Use log scaling to prevent high counts from dominating
      const scaledCount = Math.log2(count + 1);
      weightedSum += weight * scaledCount;
      totalWeight += Math.abs(weight) * scaledCount;
    }
  }

  // Normalize to -1 to 1 range
  const normalizedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Calculate confidence based on observation count
  const confidence = Math.min(1, topic.observationCount / 20);

  // Map score to expertise level
  let level: ExpertiseLevel;
  if (normalizedScore < -0.3) {
    level = "novice";
  } else if (normalizedScore < 0) {
    level = "beginner";
  } else if (normalizedScore < 0.3) {
    level = "intermediate";
  } else if (normalizedScore < 0.6) {
    level = "advanced";
  } else {
    level = "expert";
  }

  return { level, confidence };
}

/**
 * Calculate overall expertise level from all topics
 */
function calculateOverallLevel(topics: TopicExpertise[]): ExpertiseLevel {
  if (topics.length === 0) {
    return "beginner";
  }

  // Weight by confidence and recency
  const levelValues: Record<ExpertiseLevel, number> = {
    novice: 0,
    beginner: 1,
    intermediate: 2,
    advanced: 3,
    expert: 4,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  for (const topic of topics) {
    const weight = topic.confidence * topic.observationCount;
    weightedSum += levelValues[topic.level] * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return "beginner";
  }

  const avgValue = weightedSum / totalWeight;

  // Map back to level
  if (avgValue < 0.5) return "novice";
  if (avgValue < 1.5) return "beginner";
  if (avgValue < 2.5) return "intermediate";
  if (avgValue < 3.5) return "advanced";
  return "expert";
}

/**
 * Get expertise level for a specific topic
 */
export async function getTopicExpertise(
  agentId: string,
  topic: string,
): Promise<TopicExpertise | null> {
  const profile = await loadExpertiseProfile(agentId);
  return profile.topics.find((t) => t.topic === topic) || null;
}

/**
 * Get response adjustments based on expertise level
 */
export function getExpertiseAdjustment(expertise: TopicExpertise | null): ExpertiseAdjustment {
  const level = expertise?.level || "beginner";
  const topic = expertise?.topic || "general";

  const adjustmentMap: Record<ExpertiseLevel, ExpertiseAdjustment["adjustments"]> = {
    novice: {
      detailLevel: "comprehensive",
      terminology: "simplified",
      examples: "many",
      explanations: "step-by-step",
    },
    beginner: {
      detailLevel: "detailed",
      terminology: "simplified",
      examples: "some",
      explanations: "step-by-step",
    },
    intermediate: {
      detailLevel: "standard",
      terminology: "standard",
      examples: "some",
      explanations: "overview",
    },
    advanced: {
      detailLevel: "standard",
      terminology: "technical",
      examples: "few",
      explanations: "brief",
    },
    expert: {
      detailLevel: "minimal",
      terminology: "technical",
      examples: "none",
      explanations: "assume-known",
    },
  };

  return {
    topic,
    level,
    adjustments: adjustmentMap[level],
  };
}

/**
 * Format expertise profile as human-readable summary
 */
export function formatExpertiseSummary(profile: ExpertiseProfile): string {
  if (profile.topics.length === 0) {
    return "No expertise data collected yet.";
  }

  const sections: string[] = [];
  sections.push(`Overall Expertise: ${capitalizeFirst(profile.overallLevel)}`);
  sections.push("");
  sections.push("By Topic:");

  // Sort by confidence and observation count
  const sortedTopics = [...profile.topics].sort(
    (a, b) => b.confidence * b.observationCount - a.confidence * a.observationCount,
  );

  for (const topic of sortedTopics.slice(0, 10)) {
    const confidencePercent = Math.round(topic.confidence * 100);
    sections.push(
      `  - ${capitalizeFirst(topic.topic)}: ${capitalizeFirst(topic.level)} (${confidencePercent}% confidence, ${topic.observationCount} observations)`,
    );
  }

  return sections.join("\n");
}

/**
 * Capitalize first letter of a string
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Record a single observation and update the profile
 * Convenience function for real-time expertise tracking
 */
export async function recordExpertiseSignal(
  agentId: string,
  message: string,
  topic?: string,
): Promise<ExpertiseProfile> {
  const observations = detectExpertiseSignals(message, topic);
  return updateExpertise(agentId, observations);
}

/**
 * Get combined expertise for multiple related topics
 */
export async function getCombinedExpertise(
  agentId: string,
  topics: string[],
): Promise<ExpertiseAdjustment> {
  const profile = await loadExpertiseProfile(agentId);

  const relevantTopics = profile.topics.filter((t) => topics.includes(t.topic));

  if (relevantTopics.length === 0) {
    // Fall back to overall level
    return getExpertiseAdjustment({
      topic: topics[0] || "general",
      level: profile.overallLevel,
      confidence: 0.5,
      observationCount: 0,
      lastUpdated: profile.lastUpdated,
      signals: createEmptyTopicExpertise("").signals,
    });
  }

  // Use the lowest expertise level among relevant topics
  // (conservative approach: don't assume expertise)
  const levelOrder: ExpertiseLevel[] = ["novice", "beginner", "intermediate", "advanced", "expert"];
  let lowestLevel: ExpertiseLevel = "expert";

  for (const topic of relevantTopics) {
    if (levelOrder.indexOf(topic.level) < levelOrder.indexOf(lowestLevel)) {
      lowestLevel = topic.level;
    }
  }

  return getExpertiseAdjustment({
    topic: topics.join("+"),
    level: lowestLevel,
    confidence: Math.max(...relevantTopics.map((t) => t.confidence)),
    observationCount: relevantTopics.reduce((sum, t) => sum + t.observationCount, 0),
    lastUpdated: profile.lastUpdated,
    signals: createEmptyTopicExpertise("").signals,
  });
}
