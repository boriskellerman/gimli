/**
 * Pattern types unit tests
 *
 * Tests for pattern type definitions, matching logic, and utility functions.
 */

import { describe, expect, it } from "vitest";

import {
  calculateConfidence,
  defaultPatternConfig,
  doesContextPatternMatch,
  doesEventTriggerMatch,
  doesTimePatternMatch,
  formatPatternDescription,
  formatTimePatternTrigger,
  getDayOfWeekName,
  isPatternActivatable,
  shouldArchivePattern,
  type ContextPattern,
  type EventPattern,
  type EventPatternTrigger,
  type TimePattern,
} from "./types.js";

// ============================================================================
// Configuration Tests
// ============================================================================

describe("defaultPatternConfig", () => {
  it("has expected default values", () => {
    expect(defaultPatternConfig.activationThreshold).toBe(0.4);
    expect(defaultPatternConfig.minObservations).toBe(3);
    expect(defaultPatternConfig.archiveAfterDays).toBe(90);
    expect(defaultPatternConfig.maxPatternsPerAgent).toBe(100);
    expect(defaultPatternConfig.autoSuggestReminders).toBe(true);
    expect(defaultPatternConfig.reminderSuggestionThreshold).toBe(0.6);
  });
});

// ============================================================================
// Confidence Calculation Tests
// ============================================================================

describe("calculateConfidence", () => {
  it("returns low confidence for few observations", () => {
    const confidence = calculateConfidence({
      observationCount: 1,
      daysSinceLastObserved: 0,
      consistencyScore: 0.5,
    });

    expect(confidence).toBeLessThan(0.5);
  });

  it("returns higher confidence for more observations", () => {
    const lowObservations = calculateConfidence({
      observationCount: 2,
      daysSinceLastObserved: 0,
      consistencyScore: 0.5,
    });

    const highObservations = calculateConfidence({
      observationCount: 10,
      daysSinceLastObserved: 0,
      consistencyScore: 0.5,
    });

    expect(highObservations).toBeGreaterThan(lowObservations);
  });

  it("decreases confidence for older observations", () => {
    const recent = calculateConfidence({
      observationCount: 5,
      daysSinceLastObserved: 0,
      consistencyScore: 0.5,
    });

    const old = calculateConfidence({
      observationCount: 5,
      daysSinceLastObserved: 30,
      consistencyScore: 0.5,
    });

    expect(recent).toBeGreaterThan(old);
  });

  it("increases confidence for higher consistency", () => {
    const lowConsistency = calculateConfidence({
      observationCount: 5,
      daysSinceLastObserved: 0,
      consistencyScore: 0.2,
    });

    const highConsistency = calculateConfidence({
      observationCount: 5,
      daysSinceLastObserved: 0,
      consistencyScore: 0.9,
    });

    expect(highConsistency).toBeGreaterThan(lowConsistency);
  });

  it("clamps confidence to 0-1 range", () => {
    const maxConfidence = calculateConfidence({
      observationCount: 100,
      daysSinceLastObserved: 0,
      consistencyScore: 1.0,
    });

    const minConfidence = calculateConfidence({
      observationCount: 0,
      daysSinceLastObserved: 365,
      consistencyScore: 0,
    });

    expect(maxConfidence).toBeLessThanOrEqual(1);
    expect(minConfidence).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Pattern Activation Tests
// ============================================================================

describe("isPatternActivatable", () => {
  const basePattern: TimePattern = {
    id: "pattern-001",
    agentId: "main",
    description: "Test pattern",
    type: "time-based",
    confidence: 0.5,
    observationCount: 5,
    firstObserved: new Date(),
    lastObserved: new Date(),
    active: false,
    trigger: { kind: "time-of-day", hour: 9, minute: 0 },
    typicalAction: "Review PRs",
    toleranceMinutes: 30,
  };

  it("returns true when pattern meets both thresholds", () => {
    expect(isPatternActivatable(basePattern)).toBe(true);
  });

  it("returns false when confidence below threshold", () => {
    const pattern = { ...basePattern, confidence: 0.2 };
    expect(isPatternActivatable(pattern)).toBe(false);
  });

  it("returns false when observation count below threshold", () => {
    const pattern = { ...basePattern, observationCount: 1 };
    expect(isPatternActivatable(pattern)).toBe(false);
  });

  it("respects custom config", () => {
    const customConfig = {
      ...defaultPatternConfig,
      activationThreshold: 0.8,
      minObservations: 10,
    };

    expect(isPatternActivatable(basePattern, customConfig)).toBe(false);

    const highConfidencePattern = { ...basePattern, confidence: 0.9, observationCount: 15 };
    expect(isPatternActivatable(highConfidencePattern, customConfig)).toBe(true);
  });
});

describe("shouldArchivePattern", () => {
  const basePattern: TimePattern = {
    id: "pattern-001",
    agentId: "main",
    description: "Test pattern",
    type: "time-based",
    confidence: 0.5,
    observationCount: 5,
    firstObserved: new Date(),
    lastObserved: new Date(),
    active: false,
    trigger: { kind: "time-of-day", hour: 9, minute: 0 },
    typicalAction: "Review PRs",
    toleranceMinutes: 30,
  };

  it("returns false for recently observed pattern", () => {
    const pattern = { ...basePattern, lastObserved: new Date() };
    expect(shouldArchivePattern(pattern)).toBe(false);
  });

  it("returns true for pattern not observed in archive period", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 100); // 100 days ago
    const pattern = { ...basePattern, lastObserved: oldDate };

    expect(shouldArchivePattern(pattern)).toBe(true);
  });

  it("respects custom archive days config", () => {
    const customConfig = { ...defaultPatternConfig, archiveAfterDays: 30 };

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 35);
    const pattern = { ...basePattern, lastObserved: thirtyDaysAgo };

    expect(shouldArchivePattern(pattern, new Date(), customConfig)).toBe(true);
  });
});

// ============================================================================
// Time Pattern Matching Tests
// ============================================================================

describe("doesTimePatternMatch", () => {
  describe("time-of-day trigger", () => {
    it("matches when current time is within tolerance", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Morning standup",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Review PRs",
        toleranceMinutes: 30,
      };

      // 9:15 AM should match 9:00 AM with 30 minute tolerance
      const matchingTime = new Date("2026-01-15T09:15:00");
      expect(doesTimePatternMatch(pattern, matchingTime)).toBe(true);
    });

    it("does not match when outside tolerance", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Morning standup",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Review PRs",
        toleranceMinutes: 15,
      };

      // 10:00 AM should not match 9:00 AM with 15 minute tolerance
      const nonMatchingTime = new Date("2026-01-15T10:00:00");
      expect(doesTimePatternMatch(pattern, nonMatchingTime)).toBe(false);
    });

    it("respects days of week constraint", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Weekday standup",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "time-of-day", hour: 9, minute: 0 },
        typicalAction: "Review PRs",
        toleranceMinutes: 30,
        daysOfWeek: [1, 2, 3, 4, 5], // Monday-Friday
      };

      // Wednesday at 9:00 should match
      const wednesday = new Date("2026-01-15T09:00:00"); // Wednesday
      expect(doesTimePatternMatch(pattern, wednesday)).toBe(true);

      // Saturday at 9:00 should not match
      const saturday = new Date("2026-01-18T09:00:00"); // Saturday
      expect(doesTimePatternMatch(pattern, saturday)).toBe(false);
    });
  });

  describe("day-of-week trigger", () => {
    it("matches the correct day", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Friday planning",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "day-of-week", dayOfWeek: 5 }, // Friday
        typicalAction: "Write status update",
        toleranceMinutes: 30,
      };

      // Friday should match (2026-01-16 is Friday)
      const friday = new Date("2026-01-16T12:00:00");
      expect(doesTimePatternMatch(pattern, friday)).toBe(true);

      // Monday should not match (2026-01-19 is Monday)
      const monday = new Date("2026-01-19T12:00:00");
      expect(doesTimePatternMatch(pattern, monday)).toBe(false);
    });

    it("matches day and time when hour specified", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Friday afternoon planning",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "day-of-week", dayOfWeek: 5, hour: 16, minute: 0 }, // Friday 4 PM
        typicalAction: "Write status update",
        toleranceMinutes: 30,
      };

      // Friday at 4:15 PM should match (2026-01-16 is Friday)
      const fridayAfternoon = new Date("2026-01-16T16:15:00");
      expect(doesTimePatternMatch(pattern, fridayAfternoon)).toBe(true);

      // Friday at 9:00 AM should not match
      const fridayMorning = new Date("2026-01-16T09:00:00");
      expect(doesTimePatternMatch(pattern, fridayMorning)).toBe(false);
    });
  });

  describe("interval trigger", () => {
    it("matches when interval has elapsed", () => {
      const lastTriggered = new Date("2026-01-15T10:00:00");
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Hourly check",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "interval", intervalMinutes: 60, lastTriggered },
        typicalAction: "Check notifications",
        toleranceMinutes: 0,
      };

      // 2 hours later should match
      const twoHoursLater = new Date("2026-01-15T12:00:00");
      expect(doesTimePatternMatch(pattern, twoHoursLater)).toBe(true);

      // 30 minutes later should not match
      const thirtyMinutesLater = new Date("2026-01-15T10:30:00");
      expect(doesTimePatternMatch(pattern, thirtyMinutesLater)).toBe(false);
    });

    it("matches when never triggered before", () => {
      const pattern: TimePattern = {
        id: "pattern-001",
        agentId: "main",
        description: "Hourly check",
        type: "time-based",
        confidence: 0.7,
        observationCount: 10,
        firstObserved: new Date(),
        lastObserved: new Date(),
        active: true,
        trigger: { kind: "interval", intervalMinutes: 60 }, // No lastTriggered
        typicalAction: "Check notifications",
        toleranceMinutes: 0,
      };

      expect(doesTimePatternMatch(pattern)).toBe(true);
    });
  });
});

// ============================================================================
// Event Pattern Matching Tests
// ============================================================================

describe("doesEventTriggerMatch", () => {
  describe("tool-call trigger", () => {
    it("matches correct tool name", () => {
      const trigger: EventPatternTrigger = { kind: "tool-call", toolName: "git_commit" };
      const event = { type: "tool-call", name: "git_commit" };

      expect(doesEventTriggerMatch(trigger, event)).toBe(true);
    });

    it("does not match different tool name", () => {
      const trigger: EventPatternTrigger = { kind: "tool-call", toolName: "git_commit" };
      const event = { type: "tool-call", name: "git_push" };

      expect(doesEventTriggerMatch(trigger, event)).toBe(false);
    });

    it("matches result pattern when provided", () => {
      const trigger: EventPatternTrigger = {
        kind: "tool-call",
        toolName: "test_run",
        resultPattern: "FAIL",
      };

      expect(
        doesEventTriggerMatch(trigger, {
          type: "tool-call",
          name: "test_run",
          message: "Tests FAILED: 3 failures",
        }),
      ).toBe(true);

      expect(
        doesEventTriggerMatch(trigger, {
          type: "tool-call",
          name: "test_run",
          message: "All tests passed",
        }),
      ).toBe(false);
    });
  });

  describe("error trigger", () => {
    it("matches any error when no type specified", () => {
      const trigger: EventPatternTrigger = { kind: "error" };
      const event = { type: "error", name: "TypeError" };

      expect(doesEventTriggerMatch(trigger, event)).toBe(true);
    });

    it("matches specific error type", () => {
      const trigger: EventPatternTrigger = { kind: "error", errorType: "SyntaxError" };

      expect(doesEventTriggerMatch(trigger, { type: "error", name: "SyntaxError" })).toBe(true);
      expect(doesEventTriggerMatch(trigger, { type: "error", name: "TypeError" })).toBe(false);
    });

    it("matches message pattern", () => {
      const trigger: EventPatternTrigger = {
        kind: "error",
        messagePattern: "undefined.*not.*function",
      };

      expect(
        doesEventTriggerMatch(trigger, {
          type: "error",
          message: "undefined is not a function",
        }),
      ).toBe(true);
    });
  });

  describe("command trigger", () => {
    it("matches exact command", () => {
      const trigger: EventPatternTrigger = { kind: "command", command: "/reset" };

      expect(doesEventTriggerMatch(trigger, { type: "command", name: "/reset" })).toBe(true);
      expect(doesEventTriggerMatch(trigger, { type: "command", name: "/new" })).toBe(false);
    });
  });

  describe("session-event trigger", () => {
    it("matches session event type", () => {
      const trigger: EventPatternTrigger = { kind: "session-event", event: "start" };

      expect(doesEventTriggerMatch(trigger, { type: "session-event", name: "start" })).toBe(true);
      expect(doesEventTriggerMatch(trigger, { type: "session-event", name: "end" })).toBe(false);
    });
  });

  describe("user-mention trigger", () => {
    it("matches when any keyword is present", () => {
      const trigger: EventPatternTrigger = {
        kind: "user-mention",
        keywords: ["deploy", "release", "production"],
      };

      expect(
        doesEventTriggerMatch(trigger, {
          type: "user-mention",
          keywords: ["deploying", "to", "staging"],
        }),
      ).toBe(true);

      expect(
        doesEventTriggerMatch(trigger, {
          type: "user-mention",
          keywords: ["testing", "locally"],
        }),
      ).toBe(false);
    });

    it("is case insensitive", () => {
      const trigger: EventPatternTrigger = {
        kind: "user-mention",
        keywords: ["Deploy"],
      };

      expect(
        doesEventTriggerMatch(trigger, {
          type: "user-mention",
          keywords: ["DEPLOYING"],
        }),
      ).toBe(true);
    });
  });
});

// ============================================================================
// Context Pattern Matching Tests
// ============================================================================

describe("doesContextPatternMatch", () => {
  it("matches when keyword is present", () => {
    const pattern: ContextPattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Deployment context",
      type: "context-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      contextKeywords: ["deploy", "release", "production"],
      relevanceThreshold: 0.5,
      typicalNeed: "Staging URLs",
      useSemanticMatching: false,
    };

    expect(doesContextPatternMatch(pattern, ["deployment", "process"])).toBe(true);
    expect(doesContextPatternMatch(pattern, ["testing", "locally"])).toBe(false);
  });

  it("uses semantic score when enabled and provided", () => {
    const pattern: ContextPattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Deployment context",
      type: "context-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      contextKeywords: ["deploy"],
      relevanceThreshold: 0.6,
      typicalNeed: "Staging URLs",
      useSemanticMatching: true,
    };

    // High semantic score should match
    expect(doesContextPatternMatch(pattern, ["shipping"], 0.8)).toBe(true);

    // Low semantic score should not match
    expect(doesContextPatternMatch(pattern, ["shipping"], 0.4)).toBe(false);
  });

  it("falls back to keyword match when semantic matching enabled but no score", () => {
    const pattern: ContextPattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Deployment context",
      type: "context-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      contextKeywords: ["deploy"],
      relevanceThreshold: 0.6,
      typicalNeed: "Staging URLs",
      useSemanticMatching: true,
    };

    expect(doesContextPatternMatch(pattern, ["deploying"])).toBe(true);
  });
});

// ============================================================================
// Formatting Tests
// ============================================================================

describe("getDayOfWeekName", () => {
  it("returns correct day names", () => {
    expect(getDayOfWeekName(1)).toBe("Monday");
    expect(getDayOfWeekName(2)).toBe("Tuesday");
    expect(getDayOfWeekName(3)).toBe("Wednesday");
    expect(getDayOfWeekName(4)).toBe("Thursday");
    expect(getDayOfWeekName(5)).toBe("Friday");
    expect(getDayOfWeekName(6)).toBe("Saturday");
    expect(getDayOfWeekName(7)).toBe("Sunday");
  });

  it("returns Unknown for invalid day", () => {
    expect(getDayOfWeekName(0)).toBe("");
    expect(getDayOfWeekName(8)).toBe("Unknown");
  });
});

describe("formatTimePatternTrigger", () => {
  it("formats time-of-day trigger", () => {
    expect(formatTimePatternTrigger({ kind: "time-of-day", hour: 9, minute: 0 })).toBe("9:00 AM");
    expect(formatTimePatternTrigger({ kind: "time-of-day", hour: 14, minute: 30 })).toBe("2:30 PM");
    expect(formatTimePatternTrigger({ kind: "time-of-day", hour: 0, minute: 0 })).toBe("12:00 AM");
    expect(formatTimePatternTrigger({ kind: "time-of-day", hour: 12, minute: 0 })).toBe("12:00 PM");
  });

  it("formats day-of-week trigger", () => {
    expect(formatTimePatternTrigger({ kind: "day-of-week", dayOfWeek: 5 })).toBe("Friday");
    expect(
      formatTimePatternTrigger({ kind: "day-of-week", dayOfWeek: 1, hour: 9, minute: 0 }),
    ).toBe("Monday at 9:00 AM");
  });

  it("formats interval trigger", () => {
    expect(formatTimePatternTrigger({ kind: "interval", intervalMinutes: 30 })).toBe(
      "every 30 minutes",
    );
    expect(formatTimePatternTrigger({ kind: "interval", intervalMinutes: 60 })).toBe(
      "every 1 hour",
    );
    expect(formatTimePatternTrigger({ kind: "interval", intervalMinutes: 120 })).toBe(
      "every 2 hours",
    );
    expect(formatTimePatternTrigger({ kind: "interval", intervalMinutes: 90 })).toBe(
      "every 1h 30m",
    );
  });
});

describe("formatPatternDescription", () => {
  it("formats time-based pattern", () => {
    const pattern: TimePattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Morning standup",
      type: "time-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Review PRs",
      toleranceMinutes: 30,
    };

    expect(formatPatternDescription(pattern)).toBe("9:00 AM: Review PRs");
  });

  it("formats event-based pattern", () => {
    const pattern: EventPattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Post-commit",
      type: "event-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      trigger: { kind: "tool-call", toolName: "git_commit" },
      typicalFollowUp: "Create PR",
      expirationSeconds: 300,
    };

    expect(formatPatternDescription(pattern)).toBe("After tool-call: Create PR");
  });

  it("formats context-based pattern", () => {
    const pattern: ContextPattern = {
      id: "pattern-001",
      agentId: "main",
      description: "Deployment context",
      type: "context-based",
      confidence: 0.7,
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: true,
      contextKeywords: ["deploy", "release"],
      relevanceThreshold: 0.5,
      typicalNeed: "Staging URLs",
      useSemanticMatching: false,
    };

    expect(formatPatternDescription(pattern)).toBe(
      "When discussing [deploy, release]: Staging URLs",
    );
  });
});
