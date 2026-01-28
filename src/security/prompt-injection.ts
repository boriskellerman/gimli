/**
 * Prompt injection detection and content sanitization for Gimli.
 *
 * Detects common prompt injection patterns in external content
 * (emails, web pages, messages) before they reach the AI agent.
 * Uses an allowlist approach — known-safe operations only.
 */

export interface InjectionDetectionResult {
  /** Whether injection was detected */
  detected: boolean;
  /** Confidence level (0-1) */
  confidence: number;
  /** Which patterns matched */
  matchedPatterns: string[];
  /** Sanitized version of the content (injections removed) */
  sanitized: string;
}

/**
 * Patterns that indicate prompt injection attempts.
 * Each pattern has a name, regex, and confidence weight.
 */
const INJECTION_PATTERNS: Array<{
  name: string;
  pattern: RegExp;
  confidence: number;
}> = [
  // Direct instruction overrides
  {
    name: "system_prompt_override",
    pattern:
      /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|context)/i,
    confidence: 0.95,
  },
  {
    name: "new_instructions",
    pattern: /(?:new|updated|revised)\s+(?:instructions?|system\s+prompt|rules?)\s*:/i,
    confidence: 0.9,
  },
  {
    name: "role_assumption",
    pattern: /you\s+are\s+now\s+(?:a|an|the)\s+(?!user|customer|member)/i,
    confidence: 0.85,
  },
  {
    name: "jailbreak_attempt",
    pattern: /(?:DAN|developer\s+mode|unrestricted\s+mode|god\s+mode|sudo\s+mode)/i,
    confidence: 0.95,
  },

  // Data exfiltration attempts
  {
    name: "exfil_instructions",
    pattern:
      /(?:send|post|forward|copy|transfer|upload|exfiltrate)\s+(?:all|the|my|user)?\s*(?:data|messages?|keys?|credentials?|secrets?|passwords?|tokens?|files?|emails?)\s+(?:to|at|via)\s/i,
    confidence: 0.9,
  },
  {
    name: "url_exfil",
    pattern:
      /(?:fetch|curl|wget|request|GET|POST)\s+https?:\/\/(?!(?:localhost|127\.0\.0\.1|::1))/i,
    confidence: 0.6,
  },

  // Hidden instruction embedding
  {
    name: "hidden_text",
    pattern: /(?:<!--[\s\S]*?(?:instruction|execute|run|ignore)[\s\S]*?-->)/i,
    confidence: 0.85,
  },
  {
    name: "zero_width_chars",
    pattern: /[\u200B\u200C\u200D\u2060\uFEFF]{3,}/,
    confidence: 0.7,
  },
  {
    name: "invisible_instructions",
    pattern: /(?:\x00|\x01|\x02|\x03)/,
    confidence: 0.8,
  },

  // Command execution attempts
  {
    name: "shell_injection",
    pattern:
      /(?:execute|run|spawn|exec)\s+(?:the\s+)?(?:following\s+)?(?:command|script|shell|bash|code)\s*[:;]/i,
    confidence: 0.85,
  },

  // Social engineering
  {
    name: "urgency_manipulation",
    pattern:
      /(?:URGENT|CRITICAL|EMERGENCY)\s*:?\s*(?:immediately|right\s+now|without\s+delay)\s+(?:execute|run|send|forward|delete)/i,
    confidence: 0.75,
  },
  {
    name: "authority_impersonation",
    pattern: /(?:this\s+is\s+(?:your\s+)?(?:admin|administrator|owner|developer|system))\s*[:.]/i,
    confidence: 0.8,
  },

  // Encoding evasion
  {
    name: "base64_payload",
    pattern: /(?:decode|base64)\s*\(\s*["'][A-Za-z0-9+/=]{20,}["']\s*\)/i,
    confidence: 0.7,
  },
];

/**
 * Scan content for prompt injection patterns.
 */
export function detectPromptInjection(content: string): InjectionDetectionResult {
  const matchedPatterns: string[] = [];
  let maxConfidence = 0;

  for (const { name, pattern, confidence } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      matchedPatterns.push(name);
      maxConfidence = Math.max(maxConfidence, confidence);
    }
  }

  // Compound confidence: multiple pattern matches increase confidence
  const compoundConfidence =
    matchedPatterns.length > 1
      ? Math.min(1, maxConfidence + (matchedPatterns.length - 1) * 0.05)
      : maxConfidence;

  return {
    detected: matchedPatterns.length > 0,
    confidence: compoundConfidence,
    matchedPatterns,
    sanitized: sanitizeContent(content, matchedPatterns),
  };
}

/**
 * Sanitize content by removing or neutralizing injection attempts.
 */
function sanitizeContent(content: string, matchedPatterns: string[]): string {
  let sanitized = content;

  // Remove HTML comments that may contain hidden instructions
  if (matchedPatterns.includes("hidden_text")) {
    sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");
  }

  // Remove zero-width characters
  if (matchedPatterns.includes("zero_width_chars")) {
    sanitized = sanitized.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "");
  }

  // Remove null bytes and control characters
  if (matchedPatterns.includes("invisible_instructions")) {
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  }

  return sanitized;
}

/**
 * Content classification for the agent to understand risk level.
 */
export function classifyExternalContent(
  source: "email" | "web" | "message" | "file" | "unknown",
  content: string,
): {
  riskLevel: "safe" | "suspicious" | "dangerous";
  warnings: string[];
  processable: boolean;
} {
  const detection = detectPromptInjection(content);
  const warnings: string[] = [];

  if (detection.detected) {
    for (const pattern of detection.matchedPatterns) {
      warnings.push(`Prompt injection pattern detected: ${pattern}`);
    }
  }

  let riskLevel: "safe" | "suspicious" | "dangerous";
  if (detection.confidence >= 0.8) {
    riskLevel = "dangerous";
  } else if (detection.confidence >= 0.5 || detection.matchedPatterns.length > 0) {
    riskLevel = "suspicious";
  } else {
    riskLevel = "safe";
  }

  // External content from untrusted sources gets higher scrutiny
  if (source === "email" || source === "web") {
    if (riskLevel === "safe" && content.length > 10_000) {
      warnings.push("Large external content from untrusted source");
      riskLevel = "suspicious";
    }
  }

  return {
    riskLevel,
    warnings,
    processable: riskLevel !== "dangerous",
  };
}
