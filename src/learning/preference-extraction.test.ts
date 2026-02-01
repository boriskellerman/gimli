import { describe, expect, it } from "vitest";
import {
  extractPreferences,
  formatPreferenceSummary,
  toConfidenceLevel,
  type ConversationMessage,
  type ExtractedPreference,
} from "./preference-extraction.js";

describe("extractPreferences", () => {
  it("returns empty array for empty messages", () => {
    expect(extractPreferences([])).toEqual([]);
  });

  it("returns empty array for assistant-only messages", () => {
    const messages: ConversationMessage[] = [
      { role: "assistant", content: "Hello, how can I help?" },
      { role: "assistant", content: "Here is the answer." },
    ];
    expect(extractPreferences(messages)).toEqual([]);
  });

  describe("tone detection", () => {
    it("detects formal tone from polite language", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Please help me with this issue." },
        { role: "user", content: "Would you kindly explain the process?" },
        { role: "user", content: "Thank you for your assistance." },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const formalPref = prefs.find((p) => p.type === "tone" && p.value === "formal");

      expect(formalPref).toBeDefined();
      expect(formalPref!.confidence).toBeGreaterThan(0.5);
      expect(formalPref!.evidenceCount).toBeGreaterThanOrEqual(2);
    });

    it("detects casual tone from informal language", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Hey, gonna need some help here!" },
        { role: "user", content: "yo that's kinda cool" },
        { role: "user", content: "awesome, wanna try something else?" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const casualPref = prefs.find((p) => p.type === "tone" && p.value === "casual");

      expect(casualPref).toBeDefined();
      expect(casualPref!.evidenceCount).toBeGreaterThanOrEqual(2);
    });

    it("detects direct communication style", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Fix the bug in auth.ts" },
        { role: "user", content: "Create a new component for the header" },
        { role: "user", content: "Delete the old config file" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const directPref = prefs.find((p) => p.key === "communication-style" && p.value === "direct");

      expect(directPref).toBeDefined();
      expect(directPref!.evidenceCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("detail level detection", () => {
    it("detects preference for brief responses", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Give me a brief summary of the changes" },
        { role: "user", content: "Keep it short please" },
        { role: "user", content: "Just the answer, no explanation needed" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const briefPref = prefs.find((p) => p.type === "detail-level" && p.value === "brief");

      expect(briefPref).toBeDefined();
      expect(briefPref!.confidence).toBeGreaterThan(0.4);
    });

    it("detects preference for detailed responses", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Can you explain how this works step-by-step?" },
        { role: "user", content: "Walk me through the entire process" },
        { role: "user", content: "Why does this happen? Please elaborate." },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const detailedPref = prefs.find((p) => p.type === "detail-level" && p.value === "detailed");

      expect(detailedPref).toBeDefined();
      expect(detailedPref!.confidence).toBeGreaterThan(0.4);
    });

    it("infers brief preference from short messages", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "status?" },
        { role: "user", content: "next step" },
        { role: "user", content: "ok" },
        { role: "user", content: "done?" },
        { role: "user", content: "show it" },
      ];

      const prefs = extractPreferences(messages, { minConfidence: 0.2, minEvidenceCount: 2 });
      const briefPref = prefs.find((p) => p.type === "detail-level" && p.value === "brief");

      // Should infer brief from short average message length
      expect(briefPref).toBeDefined();
    });
  });

  describe("format preference detection", () => {
    it("detects preference for code-focused output", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Show me the code for this" },
        { role: "user", content: "I need a code snippet" },
        { role: "user", content: "Give me an implementation example" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const codePref = prefs.find((p) => p.type === "format" && p.value === "code-focused");

      expect(codePref).toBeDefined();
    });

    it("detects preference for list format", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Give me a list of options" },
        { role: "user", content: "What are the steps?" },
        { role: "user", content: "List all the items please" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const listPref = prefs.find((p) => p.type === "format" && p.value === "list-format");

      expect(listPref).toBeDefined();
    });
  });

  describe("topic extraction", () => {
    it("extracts topics of interest", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "I have a question about authentication" },
        { role: "user", content: "Help me with authentication flow" },
        { role: "user", content: "More questions about authentication" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const topicPref = prefs.find((p) => p.type === "topic" && p.value.includes("authentication"));

      expect(topicPref).toBeDefined();
      expect(topicPref!.evidenceCount).toBeGreaterThanOrEqual(2);
    });

    it("extracts multiple topics and sorts by frequency", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Help me with typescript" },
        { role: "user", content: "Question about typescript" },
        { role: "user", content: "Working on a react component" },
        { role: "user", content: "More about typescript please" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const topicPrefs = prefs.filter((p) => p.type === "topic");

      // typescript should have higher evidence count
      const tsPref = topicPrefs.find((p) => p.value.includes("typescript"));
      expect(tsPref).toBeDefined();
      expect(tsPref!.evidenceCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("timing preference detection", () => {
    it("detects time-sensitive preference", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "I need this urgently!" },
        { role: "user", content: "ASAP please" },
        { role: "user", content: "This has a deadline tomorrow" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const urgentPref = prefs.find((p) => p.type === "timing" && p.value === "time-sensitive");

      expect(urgentPref).toBeDefined();
    });

    it("detects patient preference", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "When you have time, can you look at this?" },
        { role: "user", content: "No rush on this one" },
        { role: "user", content: "Take your time with the review" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const patientPref = prefs.find((p) => p.type === "timing" && p.value === "patient");

      expect(patientPref).toBeDefined();
    });
  });

  describe("interaction style detection", () => {
    it("detects question-oriented style", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "How does this work?" },
        { role: "user", content: "What's the best approach?" },
        { role: "user", content: "Why is it structured this way?" },
        { role: "user", content: "Can you explain the difference?" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const questionPref = prefs.find(
        (p) => p.type === "interaction-style" && p.value === "question-oriented",
      );

      expect(questionPref).toBeDefined();
      expect(questionPref!.confidence).toBeGreaterThan(0.5);
    });

    it("detects iterative style from follow-up messages", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Start with this" },
        { role: "user", content: "Actually, also add this" },
        { role: "user", content: "One more thing" },
        { role: "assistant", content: "Done" },
        { role: "user", content: "Now change it" },
        { role: "user", content: "And fix this too" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const iterativePref = prefs.find(
        (p) => p.type === "interaction-style" && p.value === "iterative",
      );

      expect(iterativePref).toBeDefined();
    });
  });

  describe("configuration options", () => {
    it("respects minConfidence threshold", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Please help me." },
        { role: "user", content: "Regular message here" },
        { role: "user", content: "Another regular message" },
        { role: "user", content: "One more message" },
        { role: "user", content: "And yet another" },
      ];

      // Low threshold should return more results
      const lowThreshold = extractPreferences(messages, {
        minConfidence: 0.1,
        minEvidenceCount: 1,
      });
      const highThreshold = extractPreferences(messages, {
        minConfidence: 0.8,
        minEvidenceCount: 1,
      });

      expect(lowThreshold.length).toBeGreaterThanOrEqual(highThreshold.length);
    });

    it("respects minEvidenceCount threshold", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Please help me." },
        { role: "user", content: "Regular message" },
      ];

      const lowEvidence = extractPreferences(messages, { minConfidence: 0.1, minEvidenceCount: 1 });
      const highEvidence = extractPreferences(messages, {
        minConfidence: 0.1,
        minEvidenceCount: 5,
      });

      expect(lowEvidence.length).toBeGreaterThan(highEvidence.length);
    });

    it("respects maxMessagesToAnalyze limit", () => {
      const messages: ConversationMessage[] = Array.from({ length: 200 }, (_, i) => ({
        role: "user" as const,
        content: `Message ${i}: Please help me.`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));

      // Should only analyze last 50 messages
      const prefs = extractPreferences(messages, { maxMessagesToAnalyze: 50, minEvidenceCount: 1 });

      // Evidence count should be capped at 50 (max analyzed)
      const formalPref = prefs.find((p) => p.type === "tone" && p.value === "formal");
      expect(formalPref).toBeDefined();
      expect(formalPref!.evidenceCount).toBeLessThanOrEqual(50);
    });
  });

  describe("timestamp handling", () => {
    it("uses the most recent timestamp", () => {
      const messages: ConversationMessage[] = [
        { role: "user", content: "Please help me.", timestamp: "2024-01-01T00:00:00Z" },
        { role: "user", content: "Thank you.", timestamp: "2024-01-02T00:00:00Z" },
      ];

      const prefs = extractPreferences(messages, { minEvidenceCount: 2 });
      const formalPref = prefs.find((p) => p.type === "tone" && p.value === "formal");

      expect(formalPref).toBeDefined();
      expect(formalPref!.lastSeen).toBe("2024-01-02T00:00:00Z");
    });
  });
});

describe("toConfidenceLevel", () => {
  it("returns high for confidence >= 0.7", () => {
    expect(toConfidenceLevel(0.7)).toBe("high");
    expect(toConfidenceLevel(0.9)).toBe("high");
    expect(toConfidenceLevel(1.0)).toBe("high");
  });

  it("returns medium for confidence >= 0.4 and < 0.7", () => {
    expect(toConfidenceLevel(0.4)).toBe("medium");
    expect(toConfidenceLevel(0.5)).toBe("medium");
    expect(toConfidenceLevel(0.69)).toBe("medium");
  });

  it("returns low for confidence < 0.4", () => {
    expect(toConfidenceLevel(0.0)).toBe("low");
    expect(toConfidenceLevel(0.2)).toBe("low");
    expect(toConfidenceLevel(0.39)).toBe("low");
  });
});

describe("formatPreferenceSummary", () => {
  it("returns no preferences message for empty array", () => {
    expect(formatPreferenceSummary([])).toBe("No preferences detected.");
  });

  it("formats preferences by type", () => {
    const preferences: ExtractedPreference[] = [
      {
        type: "tone",
        key: "formality",
        value: "formal",
        confidence: 0.8,
        evidenceCount: 5,
        lastSeen: "2024-01-01T00:00:00Z",
      },
      {
        type: "detail-level",
        key: "response-length",
        value: "brief",
        confidence: 0.6,
        evidenceCount: 3,
        lastSeen: "2024-01-01T00:00:00Z",
      },
    ];

    const summary = formatPreferenceSummary(preferences);

    expect(summary).toContain("Communication Tone:");
    expect(summary).toContain("formal");
    expect(summary).toContain("80%");
    expect(summary).toContain("Detail Preferences:");
    expect(summary).toContain("brief");
  });

  it("sorts preferences by confidence within each type", () => {
    const preferences: ExtractedPreference[] = [
      {
        type: "format",
        key: "output-format",
        value: "prose",
        confidence: 0.3,
        evidenceCount: 2,
        lastSeen: "2024-01-01T00:00:00Z",
      },
      {
        type: "format",
        key: "output-format",
        value: "code-focused",
        confidence: 0.9,
        evidenceCount: 10,
        lastSeen: "2024-01-01T00:00:00Z",
      },
    ];

    const summary = formatPreferenceSummary(preferences);

    // code-focused (90%) should appear before prose (30%)
    const codeIndex = summary.indexOf("code-focused");
    const proseIndex = summary.indexOf("prose");
    expect(codeIndex).toBeLessThan(proseIndex);
  });
});
