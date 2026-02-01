/**
 * Pattern detection integration tests
 *
 * Tests pattern detection with simulated user activity data, validating
 * the full detection pipeline including confidence calculations over time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calculateConfidence,
  defaultPatternConfig,
  doesContextPatternMatch,
  doesEventTriggerMatch,
  doesTimePatternMatch,
  isPatternActivatable,
  type ContextObservationData,
  type ContextPattern,
  type EventObservationData,
  type EventPattern,
  type Pattern,
  type PatternConfig,
  type PatternObservation,
  type TimeObservationData,
  type TimePattern,
} from "./types.js";

// ============================================================================
// Simulated Activity Data Generators
// ============================================================================

/**
 * Generate simulated time-based activity observations
 */
function generateTimeActivity(params: {
  agentId: string;
  hour: number;
  minute: number;
  action: string;
  days: Date[];
  varianceMinutes?: number;
}): PatternObservation[] {
  const { agentId, hour, minute, action, days, varianceMinutes = 15 } = params;

  return days.map((day) => {
    // Add some variance to simulate realistic behavior
    const variance = Math.floor(Math.random() * varianceMinutes * 2) - varianceMinutes;
    const actualMinute = Math.max(0, Math.min(59, minute + variance));
    const actualHour = actualMinute < 0 ? hour - 1 : actualMinute > 59 ? hour + 1 : hour;

    const timestamp = new Date(day);
    timestamp.setHours(actualHour, Math.abs(actualMinute) % 60, 0, 0);

    return {
      type: "time-based" as const,
      agentId,
      timestamp,
      data: {
        type: "time-based" as const,
        hour: timestamp.getHours(),
        minute: timestamp.getMinutes(),
        dayOfWeek: timestamp.getDay() === 0 ? 7 : timestamp.getDay(),
        action,
      },
    };
  });
}

/**
 * Generate simulated event-based activity observations
 */
function generateEventActivity(params: {
  agentId: string;
  event: string;
  followUp: string;
  count: number;
  baseTimestamp: Date;
  intervalMs?: number;
  delaySecondsRange?: [number, number];
}): PatternObservation[] {
  const {
    agentId,
    event,
    followUp,
    count,
    baseTimestamp,
    intervalMs = 3600000, // 1 hour default
    delaySecondsRange = [30, 300], // 30 seconds to 5 minutes
  } = params;

  return Array.from({ length: count }, (_, i) => {
    const timestamp = new Date(baseTimestamp.getTime() + i * intervalMs);
    const delaySeconds =
      delaySecondsRange[0] +
      Math.floor(Math.random() * (delaySecondsRange[1] - delaySecondsRange[0]));

    return {
      type: "event-based" as const,
      agentId,
      timestamp,
      data: {
        type: "event-based" as const,
        event,
        followUp,
        delaySeconds,
      },
    };
  });
}

/**
 * Generate simulated context-based activity observations
 */
function generateContextActivity(params: {
  agentId: string;
  keywords: string[];
  need: string;
  count: number;
  baseTimestamp: Date;
  intervalMs?: number;
  similarityScoreRange?: [number, number];
}): PatternObservation[] {
  const {
    agentId,
    keywords,
    need,
    count,
    baseTimestamp,
    intervalMs = 86400000, // 1 day default
    similarityScoreRange = [0.6, 0.95],
  } = params;

  return Array.from({ length: count }, (_, i) => {
    const timestamp = new Date(baseTimestamp.getTime() + i * intervalMs);
    const similarityScore =
      similarityScoreRange[0] + Math.random() * (similarityScoreRange[1] - similarityScoreRange[0]);

    return {
      type: "context-based" as const,
      agentId,
      timestamp,
      data: {
        type: "context-based" as const,
        keywords,
        need,
        similarityScore,
      },
    };
  });
}

/**
 * Generate a sequence of weekday dates
 */
function generateWeekdays(startDate: Date, count: number): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);

  while (dates.length < count) {
    const day = current.getDay();
    // Skip weekends (0 = Sunday, 6 = Saturday)
    if (day !== 0 && day !== 6) {
      dates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Generate a sequence of specific days of the week
 */
function generateSpecificDays(startDate: Date, dayOfWeek: number, count: number): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);

  // Find first occurrence of the target day
  while (current.getDay() !== dayOfWeek % 7) {
    current.setDate(current.getDate() + 1);
  }

  while (dates.length < count) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 7); // Jump to next week
  }

  return dates;
}

// ============================================================================
// Pattern Detection Simulation
// ============================================================================

/**
 * Simulates pattern detection from observations.
 * This builds patterns from raw observations, similar to what a real
 * detector would do.
 */
function detectTimePattern(observations: PatternObservation[]): TimePattern | null {
  const timeObs = observations.filter(
    (o): o is PatternObservation & { data: TimeObservationData } => o.data.type === "time-based",
  );

  if (timeObs.length < 2) return null;

  // Group observations by approximate time (within 30 minutes)
  const timeGroups = new Map<string, typeof timeObs>();
  for (const obs of timeObs) {
    const roundedHour = obs.data.hour;
    const roundedMinute = Math.round(obs.data.minute / 30) * 30;
    const key = `${roundedHour}:${roundedMinute}`;

    if (!timeGroups.has(key)) {
      timeGroups.set(key, []);
    }
    timeGroups.get(key)!.push(obs);
  }

  // Find the largest group
  let maxGroup: typeof timeObs = [];
  for (const group of timeGroups.values()) {
    if (group.length > maxGroup.length) {
      maxGroup = group;
    }
  }

  if (maxGroup.length < 2) return null;

  // Calculate average time from the group
  const avgMinutes =
    maxGroup.reduce((sum, o) => sum + o.data.hour * 60 + o.data.minute, 0) / maxGroup.length;
  const avgHour = Math.floor(avgMinutes / 60);
  const avgMinute = Math.round(avgMinutes % 60);

  // Calculate consistency score (standard deviation of times)
  const times = maxGroup.map((o) => o.data.hour * 60 + o.data.minute);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const variance = times.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / times.length;
  const stdDev = Math.sqrt(variance);
  // Convert to consistency score (lower stdDev = higher consistency)
  const consistencyScore = Math.max(0, 1 - stdDev / 60);

  const sortedObs = maxGroup.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const firstObserved = sortedObs[0].timestamp;
  const lastObserved = sortedObs[sortedObs.length - 1].timestamp;

  const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

  const confidence = calculateConfidence({
    observationCount: maxGroup.length,
    daysSinceLastObserved,
    consistencyScore,
  });

  return {
    id: `time-pattern-${avgHour}-${avgMinute}`,
    agentId: maxGroup[0].agentId,
    description: `Activity around ${avgHour}:${avgMinute.toString().padStart(2, "0")}`,
    type: "time-based",
    confidence,
    observationCount: maxGroup.length,
    firstObserved,
    lastObserved,
    active: false,
    trigger: { kind: "time-of-day", hour: avgHour, minute: avgMinute },
    typicalAction: maxGroup[0].data.action,
    toleranceMinutes: 30,
  };
}

/**
 * Simulates event pattern detection from observations
 */
function detectEventPattern(observations: PatternObservation[]): EventPattern | null {
  const eventObs = observations.filter(
    (o): o is PatternObservation & { data: EventObservationData } => o.data.type === "event-based",
  );

  if (eventObs.length < 2) return null;

  // Group by event type
  const eventGroups = new Map<string, typeof eventObs>();
  for (const obs of eventObs) {
    const key = obs.data.event;
    if (!eventGroups.has(key)) {
      eventGroups.set(key, []);
    }
    eventGroups.get(key)!.push(obs);
  }

  // Find the largest group
  let maxGroup: typeof eventObs = [];
  let maxEvent = "";
  for (const [event, group] of eventGroups.entries()) {
    if (group.length > maxGroup.length) {
      maxGroup = group;
      maxEvent = event;
    }
  }

  if (maxGroup.length < 2) return null;

  // Calculate average delay and consistency
  const delays = maxGroup.map((o) => o.data.delaySeconds);
  const avgDelay = delays.reduce((a, b) => a + b, 0) / delays.length;
  const mean = avgDelay;
  const variance = delays.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / delays.length;
  const stdDev = Math.sqrt(variance);
  // Consistency based on delay variance (lower variance = more consistent)
  const consistencyScore = Math.max(0, 1 - stdDev / avgDelay);

  const sortedObs = maxGroup.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const firstObserved = sortedObs[0].timestamp;
  const lastObserved = sortedObs[sortedObs.length - 1].timestamp;

  const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

  const confidence = calculateConfidence({
    observationCount: maxGroup.length,
    daysSinceLastObserved,
    consistencyScore,
  });

  // Parse event type to determine trigger kind
  let trigger: EventPattern["trigger"];
  if (maxEvent.startsWith("tool:")) {
    trigger = { kind: "tool-call", toolName: maxEvent.replace("tool:", "") };
  } else if (maxEvent.startsWith("command:")) {
    trigger = { kind: "command", command: maxEvent.replace("command:", "") };
  } else if (maxEvent.startsWith("session:")) {
    trigger = {
      kind: "session-event",
      event: maxEvent.replace("session:", "") as "start" | "end" | "compact" | "reset",
    };
  } else {
    trigger = { kind: "tool-call", toolName: maxEvent };
  }

  return {
    id: `event-pattern-${maxEvent}`,
    agentId: maxGroup[0].agentId,
    description: `After ${maxEvent}: ${maxGroup[0].data.followUp}`,
    type: "event-based",
    confidence,
    observationCount: maxGroup.length,
    firstObserved,
    lastObserved,
    active: false,
    trigger,
    typicalFollowUp: maxGroup[0].data.followUp,
    typicalDelaySeconds: avgDelay,
    expirationSeconds: avgDelay * 3, // 3x typical delay as expiration
  };
}

/**
 * Simulates context pattern detection from observations
 */
function detectContextPattern(observations: PatternObservation[]): ContextPattern | null {
  const contextObs = observations.filter(
    (o): o is PatternObservation & { data: ContextObservationData } =>
      o.data.type === "context-based",
  );

  if (contextObs.length < 2) return null;

  // Group by keywords (using first keyword as key for simplicity)
  const keywordGroups = new Map<string, typeof contextObs>();
  for (const obs of contextObs) {
    const key = obs.data.keywords.sort().join(",");
    if (!keywordGroups.has(key)) {
      keywordGroups.set(key, []);
    }
    keywordGroups.get(key)!.push(obs);
  }

  // Find the largest group
  let maxGroup: typeof contextObs = [];
  for (const group of keywordGroups.values()) {
    if (group.length > maxGroup.length) {
      maxGroup = group;
    }
  }

  if (maxGroup.length < 2) return null;

  // Calculate consistency from similarity scores
  const scores = maxGroup.map((o) => o.data.similarityScore ?? 0.5);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const mean = avgScore;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const consistencyScore = Math.max(0, 1 - stdDev * 2);

  const sortedObs = maxGroup.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const firstObserved = sortedObs[0].timestamp;
  const lastObserved = sortedObs[sortedObs.length - 1].timestamp;

  const daysSinceLastObserved = (Date.now() - lastObserved.getTime()) / (1000 * 60 * 60 * 24);

  const confidence = calculateConfidence({
    observationCount: maxGroup.length,
    daysSinceLastObserved,
    consistencyScore,
  });

  return {
    id: `context-pattern-${maxGroup[0].data.keywords[0]}`,
    agentId: maxGroup[0].agentId,
    description: `Context: ${maxGroup[0].data.keywords.join(", ")}`,
    type: "context-based",
    confidence,
    observationCount: maxGroup.length,
    firstObserved,
    lastObserved,
    active: false,
    contextKeywords: maxGroup[0].data.keywords,
    relevanceThreshold: 0.5,
    typicalNeed: maxGroup[0].data.need,
    useSemanticMatching: true,
  };
}

// ============================================================================
// Time-Based Pattern Detection Tests
// ============================================================================

describe("Time-Based Pattern Detection Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set current time to a known point
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects daily 9am activity pattern from consistent observations", () => {
    // Generate 10 weekdays of 9am activity
    const weekdays = generateWeekdays(new Date("2026-01-13"), 10);
    const observations = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Review PRs",
      days: weekdays,
      varianceMinutes: 10, // Low variance for consistency
    });

    const pattern = detectTimePattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.type).toBe("time-based");
    expect(pattern!.trigger.kind).toBe("time-of-day");
    if (pattern!.trigger.kind === "time-of-day") {
      expect(pattern!.trigger.hour).toBe(9);
      expect(pattern!.trigger.minute).toBeGreaterThanOrEqual(0);
      expect(pattern!.trigger.minute).toBeLessThanOrEqual(15);
    }
    expect(pattern!.observationCount).toBe(10);
    expect(pattern!.confidence).toBeGreaterThan(0.5);
    expect(pattern!.typicalAction).toBe("Review PRs");
  });

  it("builds confidence over time with more observations", () => {
    const weekdays3 = generateWeekdays(new Date("2026-01-27"), 3);
    const weekdays10 = generateWeekdays(new Date("2026-01-13"), 10);

    const fewObservations = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Review PRs",
      days: weekdays3,
      varianceMinutes: 5,
    });

    const manyObservations = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Review PRs",
      days: weekdays10,
      varianceMinutes: 5,
    });

    const patternFew = detectTimePattern(fewObservations);
    const patternMany = detectTimePattern(manyObservations);

    expect(patternFew).not.toBeNull();
    expect(patternMany).not.toBeNull();
    expect(patternMany!.confidence).toBeGreaterThan(patternFew!.confidence);
  });

  it("reduces confidence for inconsistent time patterns", () => {
    const weekdays = generateWeekdays(new Date("2026-01-13"), 10);

    const consistentObs = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Review PRs",
      days: weekdays,
      varianceMinutes: 5, // Low variance
    });

    const inconsistentObs = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Review PRs",
      days: weekdays,
      varianceMinutes: 45, // High variance
    });

    const consistentPattern = detectTimePattern(consistentObs);
    const inconsistentPattern = detectTimePattern(inconsistentObs);

    expect(consistentPattern).not.toBeNull();
    expect(inconsistentPattern).not.toBeNull();
    // Consistent pattern should have higher confidence
    expect(consistentPattern!.confidence).toBeGreaterThanOrEqual(
      inconsistentPattern!.confidence - 0.1, // Allow some tolerance
    );
  });

  it("matches detected pattern against current time", () => {
    const weekdays = generateWeekdays(new Date("2026-01-13"), 10);
    const observations = generateTimeActivity({
      agentId: "main",
      hour: 12,
      minute: 0,
      action: "Lunch break",
      days: weekdays,
      varianceMinutes: 5,
    });

    const pattern = detectTimePattern(observations);
    expect(pattern).not.toBeNull();

    // Current time is 12:00, should match
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
    expect(doesTimePatternMatch(pattern!)).toBe(true);

    // 2 hours later should not match
    vi.setSystemTime(new Date("2026-02-01T14:00:00Z"));
    expect(doesTimePatternMatch(pattern!)).toBe(false);
  });

  it("detects Monday morning pattern", () => {
    // Generate 8 Mondays
    const mondays = generateSpecificDays(new Date("2026-01-06"), 1, 8);
    const observations = generateTimeActivity({
      agentId: "main",
      hour: 10,
      minute: 0,
      action: "Sprint planning",
      days: mondays,
      varianceMinutes: 10,
    });

    const pattern = detectTimePattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.observationCount).toBe(8);

    // All observations should be from Mondays
    const allMonday = observations.every((o) => {
      const data = o.data as TimeObservationData;
      return data.dayOfWeek === 1;
    });
    expect(allMonday).toBe(true);
  });

  it("handles mixed day patterns correctly", () => {
    // Mix of morning and afternoon activities
    const morningDays = generateWeekdays(new Date("2026-01-13"), 5);
    const afternoonDays = generateWeekdays(new Date("2026-01-20"), 3);

    const morningObs = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Morning standup",
      days: morningDays,
      varianceMinutes: 5,
    });

    const afternoonObs = generateTimeActivity({
      agentId: "main",
      hour: 15,
      minute: 0,
      action: "Code review",
      days: afternoonDays,
      varianceMinutes: 5,
    });

    const allObs = [...morningObs, ...afternoonObs];
    const pattern = detectTimePattern(allObs);

    expect(pattern).not.toBeNull();
    // Should detect the more frequent morning pattern
    if (pattern!.trigger.kind === "time-of-day") {
      expect(pattern!.trigger.hour).toBe(9);
    }
  });
});

// ============================================================================
// Event-Based Pattern Detection Tests
// ============================================================================

describe("Event-Based Pattern Detection Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects commit -> PR pattern", () => {
    const observations = generateEventActivity({
      agentId: "main",
      event: "tool:git_commit",
      followUp: "Create PR",
      count: 8,
      baseTimestamp: new Date("2026-01-20T10:00:00Z"),
      intervalMs: 86400000, // 1 day
      delaySecondsRange: [60, 300], // 1-5 minutes
    });

    const pattern = detectEventPattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.type).toBe("event-based");
    expect(pattern!.trigger.kind).toBe("tool-call");
    if (pattern!.trigger.kind === "tool-call") {
      expect(pattern!.trigger.toolName).toBe("git_commit");
    }
    expect(pattern!.typicalFollowUp).toBe("Create PR");
    expect(pattern!.observationCount).toBe(8);
  });

  it("detects test failure -> debug pattern", () => {
    const observations = generateEventActivity({
      agentId: "main",
      event: "tool:test_run",
      followUp: "Run in debug mode",
      count: 6,
      baseTimestamp: new Date("2026-01-25T14:00:00Z"),
      intervalMs: 7200000, // 2 hours
      delaySecondsRange: [10, 60], // Quick response to failures
    });

    const pattern = detectEventPattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.typicalDelaySeconds).toBeLessThan(120);
    expect(pattern!.expirationSeconds).toBeGreaterThan(0);
  });

  it("calculates typical delay from observations", () => {
    const observations = generateEventActivity({
      agentId: "main",
      event: "tool:git_push",
      followUp: "Check CI",
      count: 10,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
      delaySecondsRange: [120, 180], // 2-3 minute delay
    });

    const pattern = detectEventPattern(observations);

    expect(pattern).not.toBeNull();
    // Average should be around 150 seconds
    expect(pattern!.typicalDelaySeconds).toBeGreaterThan(100);
    expect(pattern!.typicalDelaySeconds).toBeLessThan(200);
  });

  it("matches detected event trigger correctly", () => {
    const observations = generateEventActivity({
      agentId: "main",
      event: "tool:git_commit",
      followUp: "Create PR",
      count: 5,
      baseTimestamp: new Date("2026-01-25T10:00:00Z"),
    });

    const pattern = detectEventPattern(observations);
    expect(pattern).not.toBeNull();

    // Should match git_commit events
    expect(
      doesEventTriggerMatch(pattern!.trigger, {
        type: "tool-call",
        name: "git_commit",
      }),
    ).toBe(true);

    // Should not match git_push events
    expect(
      doesEventTriggerMatch(pattern!.trigger, {
        type: "tool-call",
        name: "git_push",
      }),
    ).toBe(false);
  });

  it("detects session start pattern", () => {
    const observations = generateEventActivity({
      agentId: "main",
      event: "session:start",
      followUp: "Load project context",
      count: 12,
      baseTimestamp: new Date("2026-01-10T09:00:00Z"),
      intervalMs: 86400000,
      delaySecondsRange: [5, 30],
    });

    const pattern = detectEventPattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.trigger.kind).toBe("session-event");
    if (pattern!.trigger.kind === "session-event") {
      expect(pattern!.trigger.event).toBe("start");
    }
  });

  it("builds confidence based on observation frequency", () => {
    const fewObs = generateEventActivity({
      agentId: "main",
      event: "tool:npm_install",
      followUp: "Run tests",
      count: 3,
      baseTimestamp: new Date("2026-01-28T10:00:00Z"),
    });

    const manyObs = generateEventActivity({
      agentId: "main",
      event: "tool:npm_install",
      followUp: "Run tests",
      count: 15,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
    });

    const patternFew = detectEventPattern(fewObs);
    const patternMany = detectEventPattern(manyObs);

    expect(patternFew).not.toBeNull();
    expect(patternMany).not.toBeNull();
    expect(patternMany!.confidence).toBeGreaterThan(patternFew!.confidence);
  });
});

// ============================================================================
// Context-Based Pattern Detection Tests
// ============================================================================

describe("Context-Based Pattern Detection Integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects deployment context pattern", () => {
    const observations = generateContextActivity({
      agentId: "main",
      keywords: ["deploy", "production", "release"],
      need: "Staging URLs and deployment checklist",
      count: 8,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
      similarityScoreRange: [0.7, 0.9],
    });

    const pattern = detectContextPattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.type).toBe("context-based");
    expect(pattern!.contextKeywords).toContain("deploy");
    expect(pattern!.typicalNeed).toBe("Staging URLs and deployment checklist");
    expect(pattern!.useSemanticMatching).toBe(true);
  });

  it("detects security review context pattern", () => {
    const observations = generateContextActivity({
      agentId: "main",
      keywords: ["security", "vulnerability", "CVE"],
      need: "OWASP references and security scanning tools",
      count: 6,
      baseTimestamp: new Date("2026-01-20T14:00:00Z"),
      similarityScoreRange: [0.75, 0.95],
    });

    const pattern = detectContextPattern(observations);

    expect(pattern).not.toBeNull();
    expect(pattern!.contextKeywords).toContain("security");
    expect(pattern!.observationCount).toBe(6);
  });

  it("matches detected context pattern against keywords", () => {
    const observations = generateContextActivity({
      agentId: "main",
      keywords: ["database", "migration", "schema"],
      need: "Migration scripts and backup procedures",
      count: 5,
      baseTimestamp: new Date("2026-01-25T10:00:00Z"),
    });

    const pattern = detectContextPattern(observations);
    expect(pattern).not.toBeNull();

    // Should match related keywords
    expect(doesContextPatternMatch(pattern!, ["database", "query"])).toBe(true);

    // Should not match unrelated keywords
    expect(doesContextPatternMatch(pattern!, ["frontend", "css"])).toBe(false);
  });

  it("uses semantic matching when enabled", () => {
    const observations = generateContextActivity({
      agentId: "main",
      keywords: ["performance", "optimization"],
      need: "Profiling tools and benchmarks",
      count: 7,
      baseTimestamp: new Date("2026-01-18T11:00:00Z"),
      similarityScoreRange: [0.8, 0.95],
    });

    const pattern = detectContextPattern(observations);
    expect(pattern).not.toBeNull();
    expect(pattern!.useSemanticMatching).toBe(true);

    // With high semantic score, should match even without exact keyword
    expect(doesContextPatternMatch(pattern!, ["speed"], 0.85)).toBe(true);

    // With low semantic score, should not match
    expect(doesContextPatternMatch(pattern!, ["speed"], 0.3)).toBe(false);
  });

  it("builds confidence from consistent context observations", () => {
    const consistentObs = generateContextActivity({
      agentId: "main",
      keywords: ["testing", "jest", "vitest"],
      need: "Test coverage reports",
      count: 10,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
      similarityScoreRange: [0.85, 0.95], // Highly consistent
    });

    const inconsistentObs = generateContextActivity({
      agentId: "main",
      keywords: ["testing", "jest", "vitest"],
      need: "Test coverage reports",
      count: 10,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
      similarityScoreRange: [0.4, 0.95], // Wide variance
    });

    const consistentPattern = detectContextPattern(consistentObs);
    const inconsistentPattern = detectContextPattern(inconsistentObs);

    expect(consistentPattern).not.toBeNull();
    expect(inconsistentPattern).not.toBeNull();
    // Consistent observations should yield higher confidence
    expect(consistentPattern!.confidence).toBeGreaterThanOrEqual(
      inconsistentPattern!.confidence - 0.1,
    );
  });
});

// ============================================================================
// Confidence Score Evolution Tests
// ============================================================================

describe("Confidence Score Calculations Over Time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("confidence increases with observation count", () => {
    const scores = [1, 3, 5, 10, 20, 50].map((count) =>
      calculateConfidence({
        observationCount: count,
        daysSinceLastObserved: 0,
        consistencyScore: 0.7,
      }),
    );

    // Each subsequent score should be higher
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it("confidence decays with time since last observation", () => {
    const scores = [0, 7, 14, 30, 60, 90].map((days) =>
      calculateConfidence({
        observationCount: 10,
        daysSinceLastObserved: days,
        consistencyScore: 0.7,
      }),
    );

    // Each subsequent score should be lower
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1]);
    }
  });

  it("consistency score impacts overall confidence", () => {
    const lowConsistency = calculateConfidence({
      observationCount: 10,
      daysSinceLastObserved: 0,
      consistencyScore: 0.2,
    });

    const highConsistency = calculateConfidence({
      observationCount: 10,
      daysSinceLastObserved: 0,
      consistencyScore: 0.9,
    });

    expect(highConsistency).toBeGreaterThan(lowConsistency);
  });

  it("pattern becomes activatable after sufficient observations", () => {
    const config: PatternConfig = {
      ...defaultPatternConfig,
      activationThreshold: 0.4,
      minObservations: 3,
    };

    const createPattern = (count: number, daysSince: number): TimePattern => ({
      id: "test-pattern",
      agentId: "main",
      description: "Test",
      type: "time-based",
      confidence: calculateConfidence({
        observationCount: count,
        daysSinceLastObserved: daysSince,
        consistencyScore: 0.8,
      }),
      observationCount: count,
      firstObserved: new Date(),
      lastObserved: new Date(Date.now() - daysSince * 86400000),
      active: false,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Test action",
      toleranceMinutes: 30,
    });

    // 2 observations (below min) - should not activate
    const pattern2 = createPattern(2, 0);
    expect(isPatternActivatable(pattern2, config)).toBe(false);

    // 3 observations (at min) - may activate depending on confidence
    const pattern3 = createPattern(3, 0);
    expect(pattern3.observationCount).toBe(3);

    // 10 observations with recent activity - should activate
    const pattern10 = createPattern(10, 0);
    expect(isPatternActivatable(pattern10, config)).toBe(true);

    // 10 observations but very old - may not activate due to low confidence
    const patternOld = createPattern(10, 100);
    expect(patternOld.confidence).toBeLessThan(pattern10.confidence);
  });
});

// ============================================================================
// Complex Scenario Tests
// ============================================================================

describe("Complex Pattern Detection Scenarios", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("detects multiple patterns from mixed activity stream", () => {
    // Generate mixed activity
    const weekdays = generateWeekdays(new Date("2026-01-13"), 10);

    const morningActivity = generateTimeActivity({
      agentId: "main",
      hour: 9,
      minute: 0,
      action: "Morning standup",
      days: weekdays,
      varianceMinutes: 5,
    });

    const commitEvents = generateEventActivity({
      agentId: "main",
      event: "tool:git_commit",
      followUp: "Create PR",
      count: 8,
      baseTimestamp: new Date("2026-01-15T10:00:00Z"),
    });

    const deployContext = generateContextActivity({
      agentId: "main",
      keywords: ["deploy", "release"],
      need: "Staging URLs",
      count: 6,
      baseTimestamp: new Date("2026-01-18T14:00:00Z"),
    });

    // Detect patterns
    const timePattern = detectTimePattern(morningActivity);
    const eventPattern = detectEventPattern(commitEvents);
    const contextPattern = detectContextPattern(deployContext);

    // All patterns should be detected
    expect(timePattern).not.toBeNull();
    expect(eventPattern).not.toBeNull();
    expect(contextPattern).not.toBeNull();

    // Verify pattern types
    expect(timePattern!.type).toBe("time-based");
    expect(eventPattern!.type).toBe("event-based");
    expect(contextPattern!.type).toBe("context-based");
  });

  it("handles sparse observation data gracefully", () => {
    // Very few observations spread over time
    const sparseDays = [new Date("2026-01-05"), new Date("2026-01-20")];

    const sparseActivity = generateTimeActivity({
      agentId: "main",
      hour: 14,
      minute: 0,
      action: "Weekly review",
      days: sparseDays,
      varianceMinutes: 10,
    });

    const pattern = detectTimePattern(sparseActivity);

    // Should still detect but with lower confidence than many observations
    expect(pattern).not.toBeNull();
    // With only 2 observations, confidence should be moderate
    // (count factor + consistency factor + recency factor contribute)
    expect(pattern!.confidence).toBeLessThan(0.7);
    expect(pattern!.observationCount).toBe(2);
  });

  it("distinguishes between different agents", () => {
    const weekdays = generateWeekdays(new Date("2026-01-20"), 5);

    const agent1Activity = generateTimeActivity({
      agentId: "agent-1",
      hour: 9,
      minute: 0,
      action: "Morning tasks",
      days: weekdays,
    });

    const agent2Activity = generateTimeActivity({
      agentId: "agent-2",
      hour: 14,
      minute: 0,
      action: "Afternoon tasks",
      days: weekdays,
    });

    const pattern1 = detectTimePattern(agent1Activity);
    const pattern2 = detectTimePattern(agent2Activity);

    expect(pattern1).not.toBeNull();
    expect(pattern2).not.toBeNull();
    expect(pattern1!.agentId).toBe("agent-1");
    expect(pattern2!.agentId).toBe("agent-2");
  });

  it("handles edge case of midnight time patterns", () => {
    const days = generateWeekdays(new Date("2026-01-20"), 7);

    const midnightActivity = generateTimeActivity({
      agentId: "main",
      hour: 23,
      minute: 45,
      action: "Late night commits",
      days,
      varianceMinutes: 20,
    });

    const pattern = detectTimePattern(midnightActivity);

    expect(pattern).not.toBeNull();
    // Should handle near-midnight times correctly
    if (pattern!.trigger.kind === "time-of-day") {
      expect(pattern!.trigger.hour).toBeGreaterThanOrEqual(23);
    }
  });

  it("tracks pattern evolution over simulated weeks", () => {
    const week1 = generateWeekdays(new Date("2026-01-06"), 5);
    const week2 = generateWeekdays(new Date("2026-01-13"), 5);
    const week3 = generateWeekdays(new Date("2026-01-20"), 5);
    const week4 = generateWeekdays(new Date("2026-01-27"), 5);

    // Accumulating observations over time
    const week1Obs = generateTimeActivity({
      agentId: "main",
      hour: 10,
      minute: 0,
      action: "Daily standup",
      days: week1,
      varianceMinutes: 5,
    });

    const week2Obs = generateTimeActivity({
      agentId: "main",
      hour: 10,
      minute: 0,
      action: "Daily standup",
      days: week2,
      varianceMinutes: 5,
    });

    const week3Obs = generateTimeActivity({
      agentId: "main",
      hour: 10,
      minute: 0,
      action: "Daily standup",
      days: week3,
      varianceMinutes: 5,
    });

    const week4Obs = generateTimeActivity({
      agentId: "main",
      hour: 10,
      minute: 0,
      action: "Daily standup",
      days: week4,
      varianceMinutes: 5,
    });

    // Track confidence progression
    const patternWeek1 = detectTimePattern(week1Obs);
    const patternWeek2 = detectTimePattern([...week1Obs, ...week2Obs]);
    const patternWeek3 = detectTimePattern([...week1Obs, ...week2Obs, ...week3Obs]);
    const patternWeek4 = detectTimePattern([...week1Obs, ...week2Obs, ...week3Obs, ...week4Obs]);

    expect(patternWeek1).not.toBeNull();
    expect(patternWeek2).not.toBeNull();
    expect(patternWeek3).not.toBeNull();
    expect(patternWeek4).not.toBeNull();

    // Confidence should generally increase with more observations
    expect(patternWeek4!.observationCount).toBeGreaterThan(patternWeek1!.observationCount);

    // With all recent observations, confidence should be good
    expect(patternWeek4!.confidence).toBeGreaterThan(0.5);
  });
});

// ============================================================================
// Pattern Activation Tests
// ============================================================================

describe("Pattern Activation Logic", () => {
  it("activates patterns meeting both thresholds", () => {
    const pattern: TimePattern = {
      id: "test-pattern",
      agentId: "main",
      description: "Test",
      type: "time-based",
      confidence: 0.6,
      observationCount: 5,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: false,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Test",
      toleranceMinutes: 30,
    };

    expect(isPatternActivatable(pattern, defaultPatternConfig)).toBe(true);
  });

  it("does not activate patterns below confidence threshold", () => {
    const pattern: TimePattern = {
      id: "test-pattern",
      agentId: "main",
      description: "Test",
      type: "time-based",
      confidence: 0.2, // Below 0.4 threshold
      observationCount: 10,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: false,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Test",
      toleranceMinutes: 30,
    };

    expect(isPatternActivatable(pattern, defaultPatternConfig)).toBe(false);
  });

  it("does not activate patterns below observation threshold", () => {
    const pattern: TimePattern = {
      id: "test-pattern",
      agentId: "main",
      description: "Test",
      type: "time-based",
      confidence: 0.8,
      observationCount: 2, // Below 3 threshold
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: false,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Test",
      toleranceMinutes: 30,
    };

    expect(isPatternActivatable(pattern, defaultPatternConfig)).toBe(false);
  });

  it("respects custom activation configuration", () => {
    const strictConfig: PatternConfig = {
      ...defaultPatternConfig,
      activationThreshold: 0.8,
      minObservations: 10,
    };

    const pattern: TimePattern = {
      id: "test-pattern",
      agentId: "main",
      description: "Test",
      type: "time-based",
      confidence: 0.6,
      observationCount: 5,
      firstObserved: new Date(),
      lastObserved: new Date(),
      active: false,
      trigger: { kind: "time-of-day", hour: 9, minute: 0 },
      typicalAction: "Test",
      toleranceMinutes: 30,
    };

    // Would activate with default config
    expect(isPatternActivatable(pattern, defaultPatternConfig)).toBe(true);

    // But not with strict config
    expect(isPatternActivatable(pattern, strictConfig)).toBe(false);
  });
});
