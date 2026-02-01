/**
 * Communication style adaptation
 *
 * Learns and adapts to user communication style by tracking:
 * - Formality level (formal vs casual)
 * - Verbosity (verbose vs terse)
 * - Technical depth (technical vs simplified)
 *
 * Maintains a rolling profile that adapts over time based on
 * observed user messages.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveStateDir } from "../config/paths.js";

/** Style dimensions that are tracked */
export type StyleDimension = "formality" | "verbosity" | "technical-depth";

/** Individual style score (-1 to 1 scale) */
export interface StyleScore {
  /** The dimension being scored */
  dimension: StyleDimension;
  /** Current value (-1 to 1, e.g., -1 = casual, 1 = formal) */
  value: number;
  /** Number of observations used to compute this score */
  observations: number;
  /** Last time this dimension was updated */
  lastUpdated: string;
}

/** Complete style profile for a user/agent pair */
export interface StyleProfile {
  /** Agent ID this profile belongs to */
  agentId: string;
  /** Formality score (-1 = casual, 1 = formal) */
  formality: StyleScore;
  /** Verbosity score (-1 = terse, 1 = verbose) */
  verbosity: StyleScore;
  /** Technical depth score (-1 = simplified, 1 = technical) */
  technicalDepth: StyleScore;
  /** When the profile was created */
  createdAt: string;
  /** When the profile was last modified */
  updatedAt: string;
}

/** Message analysis result */
export interface MessageStyleSignals {
  /** Formality signal (-1 to 1, or null if no signal) */
  formality: number | null;
  /** Verbosity signal (-1 to 1, or null if no signal) */
  verbosity: number | null;
  /** Technical depth signal (-1 to 1, or null if no signal) */
  technicalDepth: number | null;
}

/** Style adaptation hints for response generation */
export interface StyleHints {
  /** Target formality level description */
  formality: "casual" | "neutral" | "formal";
  /** Target verbosity level description */
  verbosity: "terse" | "moderate" | "verbose";
  /** Target technical depth level description */
  technicalDepth: "simplified" | "balanced" | "technical";
  /** Confidence in these hints (0-1) */
  confidence: number;
  /** Human-readable style summary */
  summary: string;
}

/** Configuration for style adaptation */
export interface StyleAdaptationConfig {
  /** Learning rate for style updates (0-1, higher = faster adaptation) */
  learningRate: number;
  /** Minimum observations before providing confident hints */
  minObservations: number;
  /** Decay factor for old observations (applied per day) */
  decayFactor: number;
  /** Weight given to message length signal for verbosity */
  lengthWeight: number;
}

export const defaultStyleConfig: StyleAdaptationConfig = {
  learningRate: 0.15,
  minObservations: 3,
  decayFactor: 0.98,
  lengthWeight: 0.3,
};

const STYLE_FILENAME = "style-profile.json";

// Formality indicators
const FORMAL_PATTERNS = [
  /\b(please|kindly|would you|could you|may i)\b/i,
  /\b(thank you|thanks for|appreciate|grateful)\b/i,
  /\b(sincerely|regards|respectfully|dear)\b/i,
  /\b(i would|i shall|one might|it would be)\b/i,
  /\b(furthermore|moreover|additionally|consequently)\b/i,
  /\b(hereby|herein|therefore|thus|hence)\b/i,
];

const CASUAL_PATTERNS = [
  /\b(hey|hi|yo|sup|heya)\b/i,
  /\b(gonna|wanna|gotta|kinda|sorta|lemme|gimme)\b/i,
  /\b(cool|awesome|nice|sweet|sick|dope|lit)\b/i,
  /!{2,}/, // Multiple exclamation marks
  /\b(lol|lmao|haha|hehe|rofl|omg|wtf)\b/i,
  /\b(nope|yep|yup|nah|yeah)\b/i,
  /\b(stuff|things|whatever|anyways|tho|tho)\b/i,
];

// Verbosity indicators
const TERSE_PATTERNS = [
  /^\s*\S+\s*$/, // Single word messages
  /^[^.!?]{1,20}[.!?]?\s*$/, // Very short sentences
  /\bk\b|\bok\b|\by\b|\bn\b/i, // Single letter responses
];

const VERBOSE_PATTERNS = [
  /\b(explain|elaborate|detail|describe|walk me through)\b/i,
  /\b(in other words|that is to say|to put it another way)\b/i,
  /\b(for example|for instance|such as|like for example)\b/i,
  /\b(first of all|secondly|thirdly|finally|in conclusion)\b/i,
  /\b(let me|allow me to|i want to|i would like to)\b/i,
];

// Technical depth indicators
const TECHNICAL_PATTERNS = [
  /\b(api|sdk|cli|gui|orm|jwt|oauth|http|tcp|udp|dns|ssl|tls)\b/i,
  /\b(algorithm|architecture|implementation|infrastructure)\b/i,
  /\b(async|await|promise|callback|closure|mutex|semaphore)\b/i,
  /\b(latency|throughput|scalability|optimization)\b/i,
  /\b(stack trace|heap|memory|garbage collection|runtime)\b/i,
  /\b(deployment|ci\/cd|container|kubernetes|docker)\b/i,
  /```[\s\S]*```/, // Code blocks
  /\b(function|class|interface|type|const|let|var)\b/, // Code keywords
];

const SIMPLIFIED_PATTERNS = [
  /\b(simple|easy|basic|straightforward|beginner)\b/i,
  /\b(what is|what are|what does|how do i|how can i)\b/i,
  /\b(explain like|eli5|in plain|in simple|layman)\b/i,
  /\b(without (the )?jargon|non-technical|for dummies)\b/i,
  /\b(newbie|noob|just started|new to|learning)\b/i,
];

/**
 * Resolve the path to an agent's style profile
 */
export function resolveStyleProfilePath(agentId: string): string {
  const id = normalizeAgentId(agentId);
  const root = resolveStateDir();
  return path.join(root, "agents", id, "agent", STYLE_FILENAME);
}

/**
 * Create a new empty style profile
 */
export function createEmptyProfile(agentId: string): StyleProfile {
  const now = new Date().toISOString();
  return {
    agentId,
    formality: { dimension: "formality", value: 0, observations: 0, lastUpdated: now },
    verbosity: { dimension: "verbosity", value: 0, observations: 0, lastUpdated: now },
    technicalDepth: { dimension: "technical-depth", value: 0, observations: 0, lastUpdated: now },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Load the style profile for an agent
 */
export async function loadStyleProfile(agentId: string): Promise<StyleProfile> {
  const filePath = resolveStyleProfilePath(agentId);

  try {
    const content = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(content);
    return validateProfile(data, agentId);
  } catch {
    return createEmptyProfile(agentId);
  }
}

/**
 * Validate and normalize a loaded profile
 */
function validateProfile(data: unknown, agentId: string): StyleProfile {
  if (!data || typeof data !== "object") {
    return createEmptyProfile(agentId);
  }

  const profile = data as Partial<StyleProfile>;
  const empty = createEmptyProfile(agentId);

  return {
    agentId: profile.agentId || agentId,
    formality: validateScore(profile.formality, "formality") || empty.formality,
    verbosity: validateScore(profile.verbosity, "verbosity") || empty.verbosity,
    technicalDepth:
      validateScore(profile.technicalDepth, "technical-depth") || empty.technicalDepth,
    createdAt: profile.createdAt || empty.createdAt,
    updatedAt: profile.updatedAt || empty.updatedAt,
  };
}

/**
 * Validate a style score
 */
function validateScore(score: unknown, dimension: StyleDimension): StyleScore | null {
  if (!score || typeof score !== "object") return null;

  const s = score as Partial<StyleScore>;
  if (typeof s.value !== "number" || typeof s.observations !== "number") return null;

  return {
    dimension,
    value: Math.max(-1, Math.min(1, s.value)),
    observations: Math.max(0, Math.floor(s.observations)),
    lastUpdated: s.lastUpdated || new Date().toISOString(),
  };
}

/**
 * Save the style profile for an agent
 */
export async function saveStyleProfile(profile: StyleProfile): Promise<void> {
  const filePath = resolveStyleProfilePath(profile.agentId);
  const dir = path.dirname(filePath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), "utf8");
}

/**
 * Analyze a message for style signals
 */
export function analyzeMessageStyle(message: string): MessageStyleSignals {
  if (!message || message.trim().length < 2) {
    return { formality: null, verbosity: null, technicalDepth: null };
  }

  const normalized = message.trim();

  return {
    formality: detectFormality(normalized),
    verbosity: detectVerbosity(normalized),
    technicalDepth: detectTechnicalDepth(normalized),
  };
}

/**
 * Detect formality level in a message
 * Returns -1 (casual) to 1 (formal), or null if no strong signal
 */
function detectFormality(message: string): number | null {
  let formalScore = 0;
  let casualScore = 0;

  for (const pattern of FORMAL_PATTERNS) {
    if (pattern.test(message)) {
      formalScore++;
    }
  }

  for (const pattern of CASUAL_PATTERNS) {
    if (pattern.test(message)) {
      casualScore++;
    }
  }

  // No strong signal
  if (formalScore === 0 && casualScore === 0) {
    return null;
  }

  // Compute normalized score
  const total = formalScore + casualScore;
  const rawScore = (formalScore - casualScore) / total;

  // Scale to -1 to 1 with dampening for weak signals
  const confidence = Math.min(1, total / 3);
  return rawScore * confidence;
}

/**
 * Detect verbosity level in a message
 * Returns -1 (terse) to 1 (verbose), or null if no strong signal
 */
function detectVerbosity(message: string): number | null {
  let terseScore = 0;
  let verboseScore = 0;

  // Check explicit patterns
  for (const pattern of TERSE_PATTERNS) {
    if (pattern.test(message)) {
      terseScore++;
    }
  }

  for (const pattern of VERBOSE_PATTERNS) {
    if (pattern.test(message)) {
      verboseScore++;
    }
  }

  // Use message length as a signal
  const words = message.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Short messages (< 10 words) lean terse
  if (wordCount < 10) {
    terseScore += 0.5;
  }
  // Long messages (> 50 words) lean verbose
  else if (wordCount > 50) {
    verboseScore += 0.5;
  }
  // Very long messages (> 100 words) strongly lean verbose
  if (wordCount > 100) {
    verboseScore += 0.5;
  }

  // No strong signal
  if (terseScore === 0 && verboseScore === 0) {
    return null;
  }

  const total = terseScore + verboseScore;
  const rawScore = (verboseScore - terseScore) / total;

  // Scale with confidence
  const confidence = Math.min(1, total / 2);
  return rawScore * confidence;
}

/**
 * Detect technical depth in a message
 * Returns -1 (simplified) to 1 (technical), or null if no strong signal
 */
function detectTechnicalDepth(message: string): number | null {
  let technicalScore = 0;
  let simplifiedScore = 0;

  for (const pattern of TECHNICAL_PATTERNS) {
    if (pattern.test(message)) {
      technicalScore++;
    }
  }

  for (const pattern of SIMPLIFIED_PATTERNS) {
    if (pattern.test(message)) {
      simplifiedScore++;
    }
  }

  // No strong signal
  if (technicalScore === 0 && simplifiedScore === 0) {
    return null;
  }

  const total = technicalScore + simplifiedScore;
  const rawScore = (technicalScore - simplifiedScore) / total;

  // Scale with confidence
  const confidence = Math.min(1, total / 2);
  return rawScore * confidence;
}

/**
 * Update a style score with a new observation
 * Uses exponential moving average for smooth adaptation
 */
function updateScore(
  current: StyleScore,
  newValue: number,
  config: StyleAdaptationConfig,
): StyleScore {
  const { learningRate } = config;

  // Apply time decay to current value
  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(current.lastUpdated).getTime()) / (24 * 60 * 60 * 1000),
  );
  const decayedWeight = Math.pow(config.decayFactor, daysSinceUpdate);

  // Exponential moving average with decay
  const effectiveObservations = current.observations * decayedWeight;
  const newObservations = effectiveObservations + 1;

  // Adaptive learning rate: faster when fewer observations
  const adaptiveLR = learningRate * (1 + 1 / Math.max(1, effectiveObservations));
  const clampedLR = Math.min(0.5, adaptiveLR);

  // Blend old and new values
  const newScoreValue = current.value * (1 - clampedLR) + newValue * clampedLR;

  return {
    dimension: current.dimension,
    value: Math.max(-1, Math.min(1, newScoreValue)),
    observations: Math.min(1000, Math.round(newObservations)), // Cap to prevent overflow
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Update the style profile based on a user message
 */
export async function updateStyleFromMessage(
  agentId: string,
  message: string,
  config: Partial<StyleAdaptationConfig> = {},
): Promise<StyleProfile> {
  const cfg = { ...defaultStyleConfig, ...config };
  const profile = await loadStyleProfile(agentId);
  const signals = analyzeMessageStyle(message);

  let updated = false;

  if (signals.formality !== null) {
    profile.formality = updateScore(profile.formality, signals.formality, cfg);
    updated = true;
  }

  if (signals.verbosity !== null) {
    profile.verbosity = updateScore(profile.verbosity, signals.verbosity, cfg);
    updated = true;
  }

  if (signals.technicalDepth !== null) {
    profile.technicalDepth = updateScore(profile.technicalDepth, signals.technicalDepth, cfg);
    updated = true;
  }

  if (updated) {
    profile.updatedAt = new Date().toISOString();
    await saveStyleProfile(profile);
  }

  return profile;
}

/**
 * Get style hints for response generation
 */
export function getStyleHints(
  profile: StyleProfile,
  config: Partial<StyleAdaptationConfig> = {},
): StyleHints {
  const cfg = { ...defaultStyleConfig, ...config };

  // Calculate confidence based on minimum observations
  const minObs = Math.min(
    profile.formality.observations,
    profile.verbosity.observations,
    profile.technicalDepth.observations,
  );
  const confidence = Math.min(1, minObs / cfg.minObservations);

  // Map scores to categorical values
  const formality = scoreToFormality(profile.formality.value);
  const verbosity = scoreToVerbosity(profile.verbosity.value);
  const technicalDepth = scoreToTechnicalDepth(profile.technicalDepth.value);

  // Generate summary
  const summary = generateStyleSummary(formality, verbosity, technicalDepth, confidence);

  return {
    formality,
    verbosity,
    technicalDepth,
    confidence,
    summary,
  };
}

/**
 * Convert formality score to categorical value
 */
function scoreToFormality(score: number): "casual" | "neutral" | "formal" {
  if (score < -0.3) return "casual";
  if (score > 0.3) return "formal";
  return "neutral";
}

/**
 * Convert verbosity score to categorical value
 */
function scoreToVerbosity(score: number): "terse" | "moderate" | "verbose" {
  if (score < -0.3) return "terse";
  if (score > 0.3) return "verbose";
  return "moderate";
}

/**
 * Convert technical depth score to categorical value
 */
function scoreToTechnicalDepth(score: number): "simplified" | "balanced" | "technical" {
  if (score < -0.3) return "simplified";
  if (score > 0.3) return "technical";
  return "balanced";
}

/**
 * Generate a human-readable style summary
 */
function generateStyleSummary(
  formality: "casual" | "neutral" | "formal",
  verbosity: "terse" | "moderate" | "verbose",
  technicalDepth: "simplified" | "balanced" | "technical",
  confidence: number,
): string {
  if (confidence < 0.3) {
    return "Not enough observations to determine communication style preferences.";
  }

  const parts: string[] = [];

  // Formality description
  if (formality === "casual") {
    parts.push("casual, informal tone");
  } else if (formality === "formal") {
    parts.push("formal, professional tone");
  }

  // Verbosity description
  if (verbosity === "terse") {
    parts.push("brief, concise responses");
  } else if (verbosity === "verbose") {
    parts.push("detailed, comprehensive responses");
  }

  // Technical depth description
  if (technicalDepth === "simplified") {
    parts.push("simplified, non-technical language");
  } else if (technicalDepth === "technical") {
    parts.push("technical, expert-level language");
  }

  if (parts.length === 0) {
    return "Neutral communication style with balanced formality, verbosity, and technical depth.";
  }

  const confidenceLabel =
    confidence >= 0.7 ? "strongly" : confidence >= 0.5 ? "moderately" : "slightly";

  return `User ${confidenceLabel} prefers: ${parts.join("; ")}.`;
}

/**
 * Format style hints as a prompt instruction
 */
export function formatStyleInstruction(hints: StyleHints): string {
  if (hints.confidence < 0.3) {
    return ""; // Not confident enough to provide instructions
  }

  const instructions: string[] = [];

  // Formality instruction
  if (hints.formality === "casual") {
    instructions.push("Use a casual, friendly tone. Contractions are fine.");
  } else if (hints.formality === "formal") {
    instructions.push("Use a formal, professional tone. Avoid contractions and slang.");
  }

  // Verbosity instruction
  if (hints.verbosity === "terse") {
    instructions.push("Keep responses brief and to the point. Avoid unnecessary elaboration.");
  } else if (hints.verbosity === "verbose") {
    instructions.push("Provide detailed explanations with examples when helpful.");
  }

  // Technical depth instruction
  if (hints.technicalDepth === "simplified") {
    instructions.push("Use simple, non-technical language. Explain jargon when unavoidable.");
  } else if (hints.technicalDepth === "technical") {
    instructions.push("Feel free to use technical terminology and assume domain knowledge.");
  }

  if (instructions.length === 0) {
    return "";
  }

  return `Communication style preferences: ${instructions.join(" ")}`;
}

/**
 * Reset the style profile for an agent
 */
export async function resetStyleProfile(agentId: string): Promise<StyleProfile> {
  const profile = createEmptyProfile(agentId);
  await saveStyleProfile(profile);
  return profile;
}

/**
 * Get the raw style scores for debugging/display
 */
export function getStyleScores(
  profile: StyleProfile,
): Record<StyleDimension, { value: number; observations: number }> {
  return {
    formality: { value: profile.formality.value, observations: profile.formality.observations },
    verbosity: { value: profile.verbosity.value, observations: profile.verbosity.observations },
    "technical-depth": {
      value: profile.technicalDepth.value,
      observations: profile.technicalDepth.observations,
    },
  };
}
