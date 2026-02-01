/**
 * Pattern detector unit tests
 *
 * Tests for pattern detection algorithms including time-based, event-based,
 * and context-based pattern detection.
 */

import { describe, expect, it } from "vitest";

import {
  defaultDetectorConfig,
  detectContextPatterns,
  detectEventPatterns,
  detectPatterns,
  detectTimePatterns,
  mergePatterns,
  type DetectorConfig,
} from "./detector.js";
import type {
  ContextObservationData,
  ContextPattern,
  EventObservationData,
  EventPattern,
  PatternObservation,
  TimeObservationData,
  TimePattern,
} from "./types.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createTimeObservation(
  hour: number,
  minute: number,
  dayOfWeek: number,
  action: string,
  timestamp?: Date,
): PatternObservation {
  return {
    type: "time-based",
    agentId: "test-agent",
    timestamp: timestamp ?? new Date(),
    data: {
      type: "time-based",
      hour,
      minute,
      dayOfWeek,
      action,
    } satisfies TimeObservationData,
  };
}

function createEventObservation(
  event: string,
  followUp: string,
  delaySeconds: number,
  timestamp?: Date,
): PatternObservation {
  return {
    type: "event-based",
    agentId: "test-agent",
    timestamp: timestamp ?? new Date(),
    data: {
      type: "event-based",
      event,
      followUp,
      delaySeconds,
    } satisfies EventObservationData,
  };
}

function createContextObservation(
  keywords: string[],
  need: string,
  similarityScore?: number,
  timestamp?: Date,
): PatternObservation {
  return {
    type: "context-based",
    agentId: "test-agent",
    timestamp: timestamp ?? new Date(),
    data: {
      type: "context-based",
      keywords,
      need,
      similarityScore,
    } satisfies ContextObservationData,
  };
}

// ============================================================================
// Default Config Tests
// ============================================================================

describe("defaultDetectorConfig", () => {
  it("extends defaultPatternConfig with detection-specific options", () => {
    expect(defaultDetectorConfig.timeClusterToleranceMinutes).toBe(30);
    expect(defaultDetectorConfig.timeConsistencyThreshold).toBe(0.6);
    expect(defaultDetectorConfig.minEventSequenceObservations).toBe(3);
    expect(defaultDetectorConfig.maxEventDelayVariation).toBe(0.5);
    expect(defaultDetectorConfig.minKeywordOverlapRatio).toBe(0.3);

    // Should also have base config
    expect(defaultDetectorConfig.minObservations).toBe(3);
    expect(defaultDetectorConfig.activationThreshold).toBe(0.4);
  });
});

// ============================================================================
// Time Pattern Detection Tests
// ============================================================================

describe("detectTimePatterns", () => {
  it("detects pattern from observations at similar times", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 15, 2, "Review PRs"),
      createTimeObservation(9, 5, 3, "Review PRs"),
      createTimeObservation(8, 55, 4, "Review PRs"),
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.type).toBe("time-based");
    expect(patterns[0]!.typicalAction).toBe("Review PRs");
    expect(patterns[0]!.observationCount).toBe(4);
    expect(patterns[0]!.trigger.kind).toBe("time-of-day");
  });

  it("separates patterns for different actions", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 10, 2, "Review PRs"),
      createTimeObservation(9, 5, 3, "Review PRs"),
      createTimeObservation(14, 0, 1, "Check email"),
      createTimeObservation(14, 10, 2, "Check email"),
      createTimeObservation(14, 5, 3, "Check email"),
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.typicalAction).sort()).toEqual(["Check email", "Review PRs"]);
  });

  it("separates patterns for different times", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 10, 2, "Review PRs"),
      createTimeObservation(9, 5, 3, "Review PRs"),
      createTimeObservation(16, 0, 1, "Review PRs"),
      createTimeObservation(16, 10, 2, "Review PRs"),
      createTimeObservation(16, 5, 3, "Review PRs"),
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(2);
    // Both should be "Review PRs" but at different times
    expect(patterns.every((p) => p.typicalAction === "Review PRs")).toBe(true);
  });

  it("does not detect pattern with too few observations", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 10, 2, "Review PRs"),
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(0);
  });

  it("detects day-of-week pattern when observations cluster on specific days", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Monday standup"), // Monday
      createTimeObservation(9, 5, 1, "Monday standup"), // Monday
      createTimeObservation(9, 10, 1, "Monday standup"), // Monday
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.trigger.kind).toBe("day-of-week");
    if (patterns[0]!.trigger.kind === "day-of-week") {
      expect(patterns[0]!.trigger.dayOfWeek).toBe(1); // Monday
    }
  });

  it("calculates confidence based on consistency", () => {
    // Highly consistent times
    const consistentObs = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 0, 2, "Review PRs"),
      createTimeObservation(9, 0, 3, "Review PRs"),
      createTimeObservation(9, 0, 4, "Review PRs"),
    ];

    // Less consistent times
    const inconsistentObs = [
      createTimeObservation(9, 0, 1, "Check email"),
      createTimeObservation(9, 25, 2, "Check email"),
      createTimeObservation(8, 45, 3, "Check email"),
      createTimeObservation(9, 20, 4, "Check email"),
    ];

    const consistentPatterns = detectTimePatterns(consistentObs, "test-agent");
    const inconsistentPatterns = detectTimePatterns(inconsistentObs, "test-agent");

    expect(consistentPatterns).toHaveLength(1);
    expect(inconsistentPatterns).toHaveLength(1);

    // Consistent pattern should have higher confidence
    expect(consistentPatterns[0]!.confidence).toBeGreaterThan(inconsistentPatterns[0]!.confidence);
  });

  it("respects custom config", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 10, 2, "Review PRs"),
    ];

    const customConfig: DetectorConfig = {
      ...defaultDetectorConfig,
      minObservations: 2, // Lower threshold
    };

    const patterns = detectTimePatterns(observations, "test-agent", customConfig);

    expect(patterns).toHaveLength(1);
  });

  it("sets active flag based on confidence threshold", () => {
    const observations = [
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 0, 2, "Review PRs"),
      createTimeObservation(9, 0, 3, "Review PRs"),
      createTimeObservation(9, 0, 4, "Review PRs"),
      createTimeObservation(9, 0, 5, "Review PRs"),
    ];

    const patterns = detectTimePatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    // With high consistency and many observations, should be active
    expect(patterns[0]!.active).toBe(true);
  });
});

// ============================================================================
// Event Pattern Detection Tests
// ============================================================================

describe("detectEventPatterns", () => {
  it("detects pattern from repeated event sequences", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 30),
      createEventObservation("tool:git_commit", "Create PR", 45),
      createEventObservation("tool:git_commit", "Create PR", 35),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.type).toBe("event-based");
    expect(patterns[0]!.trigger.kind).toBe("tool-call");
    if (patterns[0]!.trigger.kind === "tool-call") {
      expect(patterns[0]!.trigger.toolName).toBe("git_commit");
    }
    expect(patterns[0]!.typicalFollowUp).toBe("Create PR");
  });

  it("separates patterns for different event-followup pairs", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 30),
      createEventObservation("tool:git_commit", "Create PR", 45),
      createEventObservation("tool:git_commit", "Create PR", 35),
      createEventObservation("tool:test_run", "Fix tests", 60),
      createEventObservation("tool:test_run", "Fix tests", 90),
      createEventObservation("tool:test_run", "Fix tests", 75),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.typicalFollowUp).sort()).toEqual(["Create PR", "Fix tests"]);
  });

  it("does not detect pattern with too few observations", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 30),
      createEventObservation("tool:git_commit", "Create PR", 45),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(0);
  });

  it("calculates typical delay from observations", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 30),
      createEventObservation("tool:git_commit", "Create PR", 60),
      createEventObservation("tool:git_commit", "Create PR", 30),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.typicalDelaySeconds).toBe(40); // Average of 30, 60, 30
  });

  it("rejects patterns with highly variable delays", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 10),
      createEventObservation("tool:git_commit", "Create PR", 300),
      createEventObservation("tool:git_commit", "Create PR", 1000),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    // High delay variation should prevent pattern detection
    expect(patterns).toHaveLength(0);
  });

  it("parses different event types correctly", () => {
    const observations = [
      createEventObservation("command:/deploy", "Check logs", 10),
      createEventObservation("command:/deploy", "Check logs", 15),
      createEventObservation("command:/deploy", "Check logs", 12),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.trigger.kind).toBe("command");
    if (patterns[0]!.trigger.kind === "command") {
      expect(patterns[0]!.trigger.command).toBe("/deploy");
    }
  });

  it("parses session events correctly", () => {
    const observations = [
      createEventObservation("session:start", "Check status", 5),
      createEventObservation("session:start", "Check status", 8),
      createEventObservation("session:start", "Check status", 6),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.trigger.kind).toBe("session-event");
    if (patterns[0]!.trigger.kind === "session-event") {
      expect(patterns[0]!.trigger.event).toBe("start");
    }
  });

  it("parses error events correctly", () => {
    const observations = [
      createEventObservation("error:TypeError", "Debug code", 20),
      createEventObservation("error:TypeError", "Debug code", 25),
      createEventObservation("error:TypeError", "Debug code", 22),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.trigger.kind).toBe("error");
    if (patterns[0]!.trigger.kind === "error") {
      expect(patterns[0]!.trigger.errorType).toBe("TypeError");
    }
  });

  it("parses user mention events correctly", () => {
    const observations = [
      createEventObservation("mention:deploy,production", "Get staging URL", 10),
      createEventObservation("mention:deploy,production", "Get staging URL", 12),
      createEventObservation("mention:deploy,production", "Get staging URL", 11),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.trigger.kind).toBe("user-mention");
    if (patterns[0]!.trigger.kind === "user-mention") {
      expect(patterns[0]!.trigger.keywords).toEqual(["deploy", "production"]);
    }
  });

  it("sets reasonable expiration time", () => {
    const observations = [
      createEventObservation("tool:git_commit", "Create PR", 60),
      createEventObservation("tool:git_commit", "Create PR", 90),
      createEventObservation("tool:git_commit", "Create PR", 120),
    ];

    const patterns = detectEventPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    // Expiration should be at least max delay * 2 or 300 seconds
    expect(patterns[0]!.expirationSeconds).toBeGreaterThanOrEqual(240); // 120 * 2
  });
});

// ============================================================================
// Context Pattern Detection Tests
// ============================================================================

describe("detectContextPatterns", () => {
  it("detects pattern from observations with similar keywords and needs", () => {
    const observations = [
      createContextObservation(["deploy", "production"], "Staging URLs"),
      createContextObservation(["deployment", "prod"], "Staging URLs"),
      createContextObservation(["deploying", "release"], "Staging URLs"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.type).toBe("context-based");
    expect(patterns[0]!.typicalNeed).toBe("Staging URLs");
    expect(patterns[0]!.contextKeywords.length).toBeGreaterThan(0);
  });

  it("separates patterns for different needs", () => {
    const observations = [
      createContextObservation(["deploy", "production"], "Staging URLs"),
      createContextObservation(["deployment", "prod"], "Staging URLs"),
      createContextObservation(["deploy", "release"], "Staging URLs"),
      createContextObservation(["security", "auth"], "OWASP references"),
      createContextObservation(["authentication", "security"], "OWASP references"),
      createContextObservation(["secure", "oauth"], "OWASP references"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.typicalNeed).sort()).toEqual(["OWASP references", "Staging URLs"]);
  });

  it("does not detect pattern with too few observations", () => {
    const observations = [
      createContextObservation(["deploy", "production"], "Staging URLs"),
      createContextObservation(["deployment", "prod"], "Staging URLs"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(0);
  });

  it("selects most frequent keywords as representative", () => {
    const observations = [
      createContextObservation(["deploy", "production", "kubernetes"], "Staging URLs"),
      createContextObservation(["deploy", "production", "docker"], "Staging URLs"),
      createContextObservation(["deploy", "production", "aws"], "Staging URLs"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    // "deploy" and "production" appear in all observations
    expect(patterns[0]!.contextKeywords).toContain("deploy");
    expect(patterns[0]!.contextKeywords).toContain("production");
  });

  it("enables semantic matching when similarity scores are present", () => {
    const observations = [
      createContextObservation(["deploy"], "Staging URLs", 0.85),
      createContextObservation(["deploy"], "Staging URLs", 0.9),
      createContextObservation(["deploy"], "Staging URLs", 0.88),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.useSemanticMatching).toBe(true);
    // Threshold should be based on minimum observed score
    expect(patterns[0]!.relevanceThreshold).toBeLessThan(0.85);
  });

  it("disables semantic matching when no scores are present", () => {
    const observations = [
      createContextObservation(["deploy"], "Staging URLs"),
      createContextObservation(["deploy"], "Staging URLs"),
      createContextObservation(["deploy"], "Staging URLs"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.useSemanticMatching).toBe(false);
    expect(patterns[0]!.relevanceThreshold).toBe(0.5); // Default
  });

  it("clusters observations with sufficient keyword overlap", () => {
    const observations = [
      createContextObservation(["deploy", "kubernetes", "staging"], "K8s help"),
      createContextObservation(["kubernetes", "pods", "deploy"], "K8s help"),
      createContextObservation(["deployment", "kubernetes", "helm"], "K8s help"),
    ];

    const patterns = detectContextPatterns(observations, "test-agent");

    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.typicalNeed).toBe("K8s help");
  });
});

// ============================================================================
// Combined Detection Tests
// ============================================================================

describe("detectPatterns", () => {
  it("detects all pattern types simultaneously", () => {
    const observations: PatternObservation[] = [
      // Time observations
      createTimeObservation(9, 0, 1, "Review PRs"),
      createTimeObservation(9, 10, 2, "Review PRs"),
      createTimeObservation(9, 5, 3, "Review PRs"),
      // Event observations
      createEventObservation("tool:git_commit", "Create PR", 30),
      createEventObservation("tool:git_commit", "Create PR", 45),
      createEventObservation("tool:git_commit", "Create PR", 35),
      // Context observations
      createContextObservation(["deploy", "production"], "Staging URLs"),
      createContextObservation(["deployment", "prod"], "Staging URLs"),
      createContextObservation(["deploying", "release"], "Staging URLs"),
    ];

    const result = detectPatterns(observations, "test-agent");

    expect(result.timePatterns).toHaveLength(1);
    expect(result.eventPatterns).toHaveLength(1);
    expect(result.contextPatterns).toHaveLength(1);
    expect(result.allPatterns).toHaveLength(3);
  });

  it("returns empty arrays when no patterns detected", () => {
    const result = detectPatterns([], "test-agent");

    expect(result.timePatterns).toHaveLength(0);
    expect(result.eventPatterns).toHaveLength(0);
    expect(result.contextPatterns).toHaveLength(0);
    expect(result.allPatterns).toHaveLength(0);
  });
});

// ============================================================================
// Pattern Merging Tests
// ============================================================================

describe("mergePatterns", () => {
  it("adds new patterns when no matches exist", () => {
    const existing: TimePattern[] = [];
    const detected: TimePattern[] = [
      {
        id: "new-1",
        agentId: "test-agent",
        description: "Morning standup",
        type: "time-based",
        confidence: 0.5,
        observationCount: 3,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Review PRs",
        toleranceMinutes: 30,
      },
    ];

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("new-1");
  });

  it("updates existing pattern when match found", () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 1000 * 60 * 60);

    const existing: TimePattern[] = [
      {
        id: "existing-1",
        agentId: "test-agent",
        description: "Morning standup",
        type: "time-based",
        confidence: 0.4,
        observationCount: 2,
        firstObserved: earlier,
        lastObserved: earlier,
        active: false,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Review PRs",
        toleranceMinutes: 30,
      },
    ];

    const detected: TimePattern[] = [
      {
        id: "new-1",
        agentId: "test-agent",
        description: "Morning standup",
        type: "time-based",
        confidence: 0.6,
        observationCount: 3,
        firstObserved: now,
        lastObserved: now,
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 5 }, // Close enough time
        typicalAction: "Review PRs",
        toleranceMinutes: 30,
      },
    ];

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("existing-1"); // Keeps existing ID
    expect(merged[0]!.confidence).toBe(0.6); // Max of both
    expect(merged[0]!.observationCount).toBe(5); // Sum of both
    expect(merged[0]!.active).toBe(true); // Updated based on new confidence
  });

  it("matches event patterns by follow-up and trigger kind", () => {
    const existing: EventPattern[] = [
      {
        id: "existing-1",
        agentId: "test-agent",
        description: "Post-commit",
        type: "event-based",
        confidence: 0.4,
        observationCount: 2,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: false,
        trigger: { kind: "tool-call", toolName: "git_commit" },
        typicalFollowUp: "Create PR",
        expirationSeconds: 300,
      },
    ];

    const detected: EventPattern[] = [
      {
        id: "new-1",
        agentId: "test-agent",
        description: "Post-commit",
        type: "event-based",
        confidence: 0.5,
        observationCount: 3,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "tool-call", toolName: "git_push" }, // Different tool but same kind
        typicalFollowUp: "Create PR", // Same follow-up
        expirationSeconds: 300,
      },
    ];

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.observationCount).toBe(5); // Merged
  });

  it("matches context patterns by need and keyword overlap", () => {
    const existing: ContextPattern[] = [
      {
        id: "existing-1",
        agentId: "test-agent",
        description: "Deployment context",
        type: "context-based",
        confidence: 0.4,
        observationCount: 2,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: false,
        contextKeywords: ["deploy", "production"],
        relevanceThreshold: 0.5,
        typicalNeed: "Staging URLs",
        useSemanticMatching: false,
      },
    ];

    const detected: ContextPattern[] = [
      {
        id: "new-1",
        agentId: "test-agent",
        description: "Deployment context",
        type: "context-based",
        confidence: 0.5,
        observationCount: 3,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        contextKeywords: ["deploy", "release"], // Partial overlap
        relevanceThreshold: 0.5,
        typicalNeed: "Staging URLs", // Same need
        useSemanticMatching: false,
      },
    ];

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.observationCount).toBe(5);
  });

  it("does not merge patterns with different needs", () => {
    const existing: ContextPattern[] = [
      {
        id: "existing-1",
        agentId: "test-agent",
        description: "Deployment context",
        type: "context-based",
        confidence: 0.5,
        observationCount: 3,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        contextKeywords: ["deploy", "production"],
        relevanceThreshold: 0.5,
        typicalNeed: "Staging URLs",
        useSemanticMatching: false,
      },
    ];

    const detected: ContextPattern[] = [
      {
        id: "new-1",
        agentId: "test-agent",
        description: "Deployment context",
        type: "context-based",
        confidence: 0.5,
        observationCount: 3,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        contextKeywords: ["deploy", "production"],
        relevanceThreshold: 0.5,
        typicalNeed: "CI/CD help", // Different need
        useSemanticMatching: false,
      },
    ];

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(2);
  });

  it("enforces max patterns limit", () => {
    const existing: TimePattern[] = [];
    const detected: TimePattern[] = Array.from({ length: 150 }, (_, i) => ({
      id: `pattern-${i}`,
      agentId: "test-agent",
      description: `Pattern ${i}`,
      type: "time-based" as const,
      confidence: Math.random(),
      observationCount: 3,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      trigger: { kind: "time-of-day" as const, hour: i % 24, minute: 0 },
      typicalAction: `Action ${i}`,
      toleranceMinutes: 30,
    }));

    const merged = mergePatterns(existing, detected);

    expect(merged).toHaveLength(100); // defaultPatternConfig.maxPatternsPerAgent
  });

  it("keeps highest confidence patterns when limiting", () => {
    const detected: TimePattern[] = [
      {
        id: "high",
        agentId: "test-agent",
        description: "High confidence",
        type: "time-based",
        confidence: 0.9,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Important action",
        toleranceMinutes: 30,
      },
      {
        id: "low",
        agentId: "test-agent",
        description: "Low confidence",
        type: "time-based",
        confidence: 0.2,
        observationCount: 2,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: false,
        trigger: { kind: "time-of-day", hour: 14, minute: 0 },
        typicalAction: "Less important action",
        toleranceMinutes: 30,
      },
    ];

    const config: DetectorConfig = {
      ...defaultDetectorConfig,
      maxPatternsPerAgent: 1,
    };

    const merged = mergePatterns([], detected, config);

    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("high");
  });
});
