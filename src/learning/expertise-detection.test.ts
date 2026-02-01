import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectExpertiseSignals,
  formatExpertiseSummary,
  getCombinedExpertise,
  getExpertiseAdjustment,
  getTopicExpertise,
  inferTopic,
  loadExpertiseProfile,
  recordExpertiseSignal,
  resolveExpertisePath,
  saveExpertiseProfile,
  updateExpertise,
  type ExpertiseObservation,
  type ExpertiseProfile,
  type TopicExpertise,
} from "./expertise-detection.js";

// Mock the state directory to use temp dir
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => testDir,
}));

// Mock normalizeAgentId to return the input as-is
vi.mock("../routing/session-key.js", () => ({
  normalizeAgentId: (id: string) => id,
}));

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "expertise-test-"));
});

afterEach(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("detectExpertiseSignals", () => {
  it("returns empty array for empty message", () => {
    expect(detectExpertiseSignals("")).toEqual([]);
    expect(detectExpertiseSignals("   ")).toEqual([]);
    expect(detectExpertiseSignals("hi")).toEqual([]); // Too short
  });

  describe("basic question detection", () => {
    it("detects 'what is' questions", () => {
      const signals = detectExpertiseSignals("What is a promise in JavaScript?");
      const basicQ = signals.find((s) => s.signal === "basic-question");

      expect(basicQ).toBeDefined();
      expect(basicQ!.weight).toBeLessThan(0);
    });

    it("detects 'how do I' questions", () => {
      const signals = detectExpertiseSignals("How do I install this package?");
      const basicQ = signals.find((s) => s.signal === "basic-question");

      expect(basicQ).toBeDefined();
    });

    it("detects confusion indicators", () => {
      const signals = detectExpertiseSignals("I don't understand how this works");
      const basicQ = signals.find((s) => s.signal === "basic-question");

      expect(basicQ).toBeDefined();
    });

    it("detects 'never used' statements", () => {
      const signals = detectExpertiseSignals("I've never used Docker before");
      const basicQ = signals.find((s) => s.signal === "basic-question");

      expect(basicQ).toBeDefined();
    });
  });

  describe("advanced question detection", () => {
    it("detects trade-off questions", () => {
      const signals = detectExpertiseSignals(
        "What are the trade-offs between using Redis vs Memcached for caching?",
      );
      const advancedQ = signals.find((s) => s.signal === "advanced-question");

      expect(advancedQ).toBeDefined();
      expect(advancedQ!.weight).toBeGreaterThan(0);
    });

    it("detects architecture questions", () => {
      const signals = detectExpertiseSignals(
        "How does the architecture handle horizontal scaling?",
      );
      const advancedQ = signals.find((s) => s.signal === "advanced-question");

      expect(advancedQ).toBeDefined();
    });

    it("detects performance-related questions", () => {
      const signals = detectExpertiseSignals(
        "What are the performance implications of this approach?",
      );
      const advancedQ = signals.find((s) => s.signal === "advanced-question");

      expect(advancedQ).toBeDefined();
    });

    it("detects edge case awareness", () => {
      const signals = detectExpertiseSignals("What about the edge case where the input is empty?");
      const advancedQ = signals.find((s) => s.signal === "advanced-question");

      expect(advancedQ).toBeDefined();
    });

    it("detects best practice questions", () => {
      const signals = detectExpertiseSignals("What's the best practice for error handling here?");
      const advancedQ = signals.find((s) => s.signal === "advanced-question");

      expect(advancedQ).toBeDefined();
    });
  });

  describe("terminology confusion detection", () => {
    it("detects asking for term definitions", () => {
      const signals = detectExpertiseSignals("What does 'polymorphism' mean?");
      const confusion = signals.find((s) => s.signal === "terminology-confusion");

      expect(confusion).toBeDefined();
      expect(confusion!.weight).toBeLessThan(0);
    });

    it("detects unfamiliarity statements", () => {
      const signals = detectExpertiseSignals("I'm not familiar with this concept");
      const confusion = signals.find((s) => s.signal === "terminology-confusion");

      expect(confusion).toBeDefined();
    });

    it("detects difference questions", () => {
      const signals = detectExpertiseSignals("What's the difference between var and let?");
      const confusion = signals.find((s) => s.signal === "terminology-confusion");

      expect(confusion).toBeDefined();
    });
  });

  describe("explanation request detection", () => {
    it("detects explicit explanation requests", () => {
      const signals = detectExpertiseSignals("Can you explain how this works?");
      const explReq = signals.find((s) => s.signal === "explanation-request");

      expect(explReq).toBeDefined();
    });

    it("detects step-by-step requests", () => {
      const signals = detectExpertiseSignals("Please walk me through the process step-by-step");
      const explReq = signals.find((s) => s.signal === "explanation-request");

      expect(explReq).toBeDefined();
    });

    it("detects ELI5 requests", () => {
      const signals = detectExpertiseSignals("ELI5 how DNS works");
      const explReq = signals.find((s) => s.signal === "explanation-request");

      expect(explReq).toBeDefined();
    });
  });

  describe("shortcut usage detection", () => {
    it("detects quick action requests", () => {
      const signals = detectExpertiseSignals("Just quickly run the tests");
      const shortcut = signals.find((s) => s.signal === "shortcut-usage");

      expect(shortcut).toBeDefined();
      expect(shortcut!.weight).toBeGreaterThan(0);
    });

    it("detects references to standard approaches", () => {
      const signals = detectExpertiseSignals("Use the usual way to configure this");
      const shortcut = signals.find((s) => s.signal === "shortcut-usage");

      expect(shortcut).toBeDefined();
    });
  });

  describe("teaches-back detection", () => {
    it("detects rephrasing for understanding", () => {
      const signals = detectExpertiseSignals(
        "So basically, the middleware intercepts all requests?",
      );
      const teachBack = signals.find((s) => s.signal === "teaches-back");

      expect(teachBack).toBeDefined();
      expect(teachBack!.weight).toBeGreaterThan(0);
    });

    it("detects understanding confirmation", () => {
      const signals = detectExpertiseSignals(
        "If I understand correctly, this handles authentication",
      );
      const teachBack = signals.find((s) => s.signal === "teaches-back");

      expect(teachBack).toBeDefined();
    });
  });

  describe("context awareness detection", () => {
    it("detects contextual considerations", () => {
      const signals = detectExpertiseSignals(
        "Given the current architecture, we should avoid that",
      );
      const contextAware = signals.find((s) => s.signal === "context-awareness");

      expect(contextAware).toBeDefined();
      expect(contextAware!.weight).toBeGreaterThan(0);
    });

    it("detects references to existing patterns", () => {
      const signals = detectExpertiseSignals("Similar to how we handle auth in the other module");
      const contextAware = signals.find((s) => s.signal === "context-awareness");

      expect(contextAware).toBeDefined();
    });
  });

  describe("terminology usage detection", () => {
    it("detects programming terminology", () => {
      const signals = detectExpertiseSignals(
        "The async function returns a promise that resolves after the callback",
      );
      const termUsage = signals.find((s) => s.signal === "terminology-usage");

      expect(termUsage).toBeDefined();
      expect(termUsage!.topic).toBe("programming");
    });

    it("detects database terminology", () => {
      const signals = detectExpertiseSignals(
        "We need query optimization with proper indexing on the table",
      );
      const termUsage = signals.find((s) => s.signal === "terminology-usage");

      expect(termUsage).toBeDefined();
      expect(termUsage!.topic).toBe("database");
    });

    it("detects security terminology", () => {
      const signals = detectExpertiseSignals("Make sure to validate against XSS and CSRF attacks");
      const termUsage = signals.find((s) => s.signal === "terminology-usage");

      expect(termUsage).toBeDefined();
      expect(termUsage!.topic).toBe("security");
    });
  });
});

describe("inferTopic", () => {
  it("infers typescript topic", () => {
    expect(inferTopic("How do I add type annotations in TypeScript?")).toBe("typescript");
  });

  it("infers react topic", () => {
    expect(inferTopic("My useState hook is not updating")).toBe("react");
  });

  it("infers git topic", () => {
    expect(inferTopic("How do I rebase my branch?")).toBe("git");
  });

  it("infers docker topic", () => {
    expect(inferTopic("The dockerfile has an error")).toBe("docker");
  });

  it("falls back to general for unknown topics", () => {
    expect(inferTopic("How do I fix this thing?")).toBe("general");
  });

  it("detects domain from terminology", () => {
    expect(inferTopic("The mutex is causing a deadlock")).toBe("programming");
  });
});

describe("updateExpertise", () => {
  it("returns existing profile for empty observations", async () => {
    const agentId = "test-agent";
    const profile = await updateExpertise(agentId, []);

    expect(profile.userId).toBe(agentId);
    expect(profile.topics).toEqual([]);
    expect(profile.overallLevel).toBe("beginner");
  });

  it("creates topic entry for new observation", async () => {
    const agentId = "test-agent";
    const observations: ExpertiseObservation[] = [
      {
        signal: "basic-question",
        topic: "typescript",
        weight: -0.3,
        timestamp: new Date().toISOString(),
      },
    ];

    const profile = await updateExpertise(agentId, observations);

    expect(profile.topics.length).toBe(1);
    expect(profile.topics[0].topic).toBe("typescript");
    expect(profile.topics[0].signals["basic-question"]).toBe(1);
  });

  it("accumulates observations for existing topic", async () => {
    const agentId = "test-agent";
    const timestamp = new Date().toISOString();

    // First observation
    await updateExpertise(agentId, [
      { signal: "basic-question", topic: "react", weight: -0.3, timestamp },
    ]);

    // Second observation
    const profile = await updateExpertise(agentId, [
      { signal: "basic-question", topic: "react", weight: -0.3, timestamp },
    ]);

    expect(profile.topics[0].signals["basic-question"]).toBe(2);
    expect(profile.topics[0].observationCount).toBe(2);
  });

  it("updates expertise level based on signals", async () => {
    const agentId = "test-agent";
    const timestamp = new Date().toISOString();

    // Add many advanced signals
    const advancedObservations: ExpertiseObservation[] = Array(10)
      .fill(null)
      .map(() => ({
        signal: "advanced-question" as const,
        topic: "database",
        weight: 0.4,
        timestamp,
      }));

    const profile = await updateExpertise(agentId, advancedObservations);
    const dbTopic = profile.topics.find((t) => t.topic === "database");

    expect(dbTopic).toBeDefined();
    expect(["intermediate", "advanced", "expert"]).toContain(dbTopic!.level);
  });
});

describe("getTopicExpertise", () => {
  it("returns null for non-existent topic", async () => {
    const result = await getTopicExpertise("test-agent", "unknown-topic");
    expect(result).toBeNull();
  });

  it("returns topic expertise after recording", async () => {
    const agentId = "test-agent";
    const timestamp = new Date().toISOString();

    await updateExpertise(agentId, [
      { signal: "terminology-usage", topic: "devops", weight: 0.3, timestamp },
    ]);

    const result = await getTopicExpertise(agentId, "devops");

    expect(result).toBeDefined();
    expect(result!.topic).toBe("devops");
    expect(result!.signals["terminology-usage"]).toBe(1);
  });
});

describe("getExpertiseAdjustment", () => {
  it("returns comprehensive adjustments for novice", () => {
    const expertise: TopicExpertise = {
      topic: "test",
      level: "novice",
      confidence: 0.8,
      observationCount: 10,
      lastUpdated: new Date().toISOString(),
      signals: {} as TopicExpertise["signals"],
    };

    const adjustment = getExpertiseAdjustment(expertise);

    expect(adjustment.level).toBe("novice");
    expect(adjustment.adjustments.detailLevel).toBe("comprehensive");
    expect(adjustment.adjustments.terminology).toBe("simplified");
    expect(adjustment.adjustments.examples).toBe("many");
    expect(adjustment.adjustments.explanations).toBe("step-by-step");
  });

  it("returns minimal adjustments for expert", () => {
    const expertise: TopicExpertise = {
      topic: "test",
      level: "expert",
      confidence: 0.9,
      observationCount: 50,
      lastUpdated: new Date().toISOString(),
      signals: {} as TopicExpertise["signals"],
    };

    const adjustment = getExpertiseAdjustment(expertise);

    expect(adjustment.level).toBe("expert");
    expect(adjustment.adjustments.detailLevel).toBe("minimal");
    expect(adjustment.adjustments.terminology).toBe("technical");
    expect(adjustment.adjustments.examples).toBe("none");
    expect(adjustment.adjustments.explanations).toBe("assume-known");
  });

  it("returns beginner adjustments for null expertise", () => {
    const adjustment = getExpertiseAdjustment(null);

    expect(adjustment.level).toBe("beginner");
    expect(adjustment.adjustments.detailLevel).toBe("detailed");
  });

  it("returns intermediate adjustments for intermediate level", () => {
    const expertise: TopicExpertise = {
      topic: "test",
      level: "intermediate",
      confidence: 0.6,
      observationCount: 20,
      lastUpdated: new Date().toISOString(),
      signals: {} as TopicExpertise["signals"],
    };

    const adjustment = getExpertiseAdjustment(expertise);

    expect(adjustment.level).toBe("intermediate");
    expect(adjustment.adjustments.detailLevel).toBe("standard");
    expect(adjustment.adjustments.terminology).toBe("standard");
    expect(adjustment.adjustments.examples).toBe("some");
    expect(adjustment.adjustments.explanations).toBe("overview");
  });
});

describe("recordExpertiseSignal", () => {
  it("detects signals and updates profile in one call", async () => {
    const agentId = "test-agent";
    const message = "What is a promise in JavaScript?";

    const profile = await recordExpertiseSignal(agentId, message);

    expect(profile.topics.length).toBeGreaterThan(0);
    // Should have detected basic-question
    const jsOrProgTopic = profile.topics.find(
      (t) => t.topic === "javascript" || t.topic === "programming",
    );
    expect(jsOrProgTopic).toBeDefined();
  });

  it("uses provided topic when specified", async () => {
    const agentId = "test-agent";
    const message = "What is this thing?";

    const profile = await recordExpertiseSignal(agentId, message, "custom-topic");

    const customTopic = profile.topics.find((t) => t.topic === "custom-topic");
    expect(customTopic).toBeDefined();
  });
});

describe("getCombinedExpertise", () => {
  it("returns beginner adjustment for no matching topics", async () => {
    const agentId = "test-agent";
    const adjustment = await getCombinedExpertise(agentId, ["unknown1", "unknown2"]);

    expect(adjustment.level).toBe("beginner");
  });

  it("returns lowest expertise level among relevant topics", async () => {
    const agentId = "test-agent";
    const timestamp = new Date().toISOString();

    // Create one advanced topic and one beginner topic
    await updateExpertise(agentId, [
      // Advanced in typescript
      ...Array(10)
        .fill(null)
        .map(() => ({
          signal: "advanced-question" as const,
          topic: "typescript",
          weight: 0.4,
          timestamp,
        })),
      // Beginner in react
      ...Array(10)
        .fill(null)
        .map(() => ({
          signal: "basic-question" as const,
          topic: "react",
          weight: -0.3,
          timestamp,
        })),
    ]);

    const adjustment = await getCombinedExpertise(agentId, ["typescript", "react"]);

    // Should use the lower level (react is beginner/novice)
    expect(["novice", "beginner"]).toContain(adjustment.level);
  });
});

describe("formatExpertiseSummary", () => {
  it("returns message for empty profile", () => {
    const profile: ExpertiseProfile = {
      userId: "test",
      topics: [],
      overallLevel: "beginner",
      lastUpdated: new Date().toISOString(),
    };

    const summary = formatExpertiseSummary(profile);
    expect(summary).toBe("No expertise data collected yet.");
  });

  it("formats profile with topics", () => {
    const profile: ExpertiseProfile = {
      userId: "test",
      topics: [
        {
          topic: "typescript",
          level: "intermediate",
          confidence: 0.7,
          observationCount: 15,
          lastUpdated: new Date().toISOString(),
          signals: {} as TopicExpertise["signals"],
        },
        {
          topic: "react",
          level: "beginner",
          confidence: 0.5,
          observationCount: 8,
          lastUpdated: new Date().toISOString(),
          signals: {} as TopicExpertise["signals"],
        },
      ],
      overallLevel: "intermediate",
      lastUpdated: new Date().toISOString(),
    };

    const summary = formatExpertiseSummary(profile);

    expect(summary).toContain("Overall Expertise: Intermediate");
    expect(summary).toContain("Typescript: Intermediate");
    expect(summary).toContain("React: Beginner");
    expect(summary).toContain("70% confidence");
    expect(summary).toContain("15 observations");
  });

  it("sorts topics by confidence and observation count", () => {
    const profile: ExpertiseProfile = {
      userId: "test",
      topics: [
        {
          topic: "low-priority",
          level: "beginner",
          confidence: 0.3,
          observationCount: 3,
          lastUpdated: new Date().toISOString(),
          signals: {} as TopicExpertise["signals"],
        },
        {
          topic: "high-priority",
          level: "advanced",
          confidence: 0.9,
          observationCount: 30,
          lastUpdated: new Date().toISOString(),
          signals: {} as TopicExpertise["signals"],
        },
      ],
      overallLevel: "intermediate",
      lastUpdated: new Date().toISOString(),
    };

    const summary = formatExpertiseSummary(profile);

    // High priority should appear first
    const highIdx = summary.indexOf("High-priority");
    const lowIdx = summary.indexOf("Low-priority");
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

describe("persistence", () => {
  it("persists and loads profile correctly", async () => {
    const agentId = "persist-test";
    const timestamp = new Date().toISOString();

    // Create profile with observations
    await updateExpertise(agentId, [
      { signal: "terminology-usage", topic: "security", weight: 0.3, timestamp },
      { signal: "advanced-question", topic: "security", weight: 0.4, timestamp },
    ]);

    // Load profile fresh
    const loaded = await loadExpertiseProfile(agentId);

    expect(loaded.topics.length).toBe(1);
    expect(loaded.topics[0].topic).toBe("security");
    expect(loaded.topics[0].signals["terminology-usage"]).toBe(1);
    expect(loaded.topics[0].signals["advanced-question"]).toBe(1);
  });

  it("creates directory structure as needed", async () => {
    const agentId = "new-agent";
    const profile: ExpertiseProfile = {
      userId: agentId,
      topics: [],
      overallLevel: "beginner",
      lastUpdated: new Date().toISOString(),
    };

    await saveExpertiseProfile(agentId, profile);

    const filePath = resolveExpertisePath(agentId);
    const exists = await fs
      .access(filePath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });
});

describe("expertise level calculation", () => {
  it("calculates novice for many basic signals", async () => {
    const agentId = "novice-test";
    const timestamp = new Date().toISOString();

    const observations = [
      ...Array(5).fill({ signal: "basic-question", topic: "test", weight: -0.3, timestamp }),
      ...Array(3).fill({
        signal: "terminology-confusion",
        topic: "test",
        weight: -0.4,
        timestamp,
      }),
      ...Array(3).fill({ signal: "explanation-request", topic: "test", weight: -0.2, timestamp }),
    ];

    const profile = await updateExpertise(agentId, observations);
    const topic = profile.topics.find((t) => t.topic === "test");

    expect(["novice", "beginner"]).toContain(topic!.level);
  });

  it("calculates expert for many advanced signals", async () => {
    const agentId = "expert-test";
    const timestamp = new Date().toISOString();

    const observations = [
      ...Array(8).fill({ signal: "advanced-question", topic: "test", weight: 0.4, timestamp }),
      ...Array(5).fill({ signal: "teaches-back", topic: "test", weight: 0.5, timestamp }),
      ...Array(4).fill({ signal: "context-awareness", topic: "test", weight: 0.4, timestamp }),
      ...Array(3).fill({ signal: "terminology-usage", topic: "test", weight: 0.3, timestamp }),
    ];

    const profile = await updateExpertise(agentId, observations);
    const topic = profile.topics.find((t) => t.topic === "test");

    expect(["advanced", "expert"]).toContain(topic!.level);
  });

  it("increases confidence with more observations", async () => {
    const agentId = "confidence-test";
    const timestamp = new Date().toISOString();

    // Few observations
    await updateExpertise(agentId, [
      { signal: "basic-question", topic: "test", weight: -0.3, timestamp },
    ]);

    let profile = await loadExpertiseProfile(agentId);
    const lowConfidence = profile.topics[0].confidence;

    // Many more observations
    const moreObservations = Array(20).fill({
      signal: "basic-question",
      topic: "test",
      weight: -0.3,
      timestamp,
    });
    profile = await updateExpertise(agentId, moreObservations);
    const highConfidence = profile.topics[0].confidence;

    expect(highConfidence).toBeGreaterThan(lowConfidence);
  });
});
