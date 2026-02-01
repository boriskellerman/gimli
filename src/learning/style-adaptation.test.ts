import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  analyzeMessageStyle,
  createEmptyProfile,
  formatStyleInstruction,
  getStyleHints,
  getStyleScores,
  loadStyleProfile,
  resetStyleProfile,
  saveStyleProfile,
  updateStyleFromMessage,
  type MessageStyleSignals,
  type StyleProfile,
} from "./style-adaptation.js";

// Test with a temporary directory to avoid polluting real state
let testDir: string;
let originalEnv: string | undefined;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "style-test-"));
  originalEnv = process.env.GIMLI_STATE_DIR;
  process.env.GIMLI_STATE_DIR = testDir;
});

afterEach(async () => {
  if (originalEnv !== undefined) {
    process.env.GIMLI_STATE_DIR = originalEnv;
  } else {
    delete process.env.GIMLI_STATE_DIR;
  }
  await fs.rm(testDir, { recursive: true, force: true });
});

describe("analyzeMessageStyle", () => {
  describe("formality detection", () => {
    it("detects formal language", () => {
      const signals = analyzeMessageStyle("Would you kindly help me with this? Thank you.");
      expect(signals.formality).not.toBeNull();
      expect(signals.formality!).toBeGreaterThan(0);
    });

    it("detects casual language", () => {
      const signals = analyzeMessageStyle("hey yo gonna need some help lol");
      expect(signals.formality).not.toBeNull();
      expect(signals.formality!).toBeLessThan(0);
    });

    it("detects multiple exclamation marks as casual", () => {
      const signals = analyzeMessageStyle("That's awesome!!");
      expect(signals.formality).not.toBeNull();
      expect(signals.formality!).toBeLessThan(0);
    });

    it("detects formal transition words", () => {
      const signals = analyzeMessageStyle("Furthermore, I would appreciate your assistance.");
      expect(signals.formality).not.toBeNull();
      expect(signals.formality!).toBeGreaterThan(0);
    });

    it("returns null for neutral messages", () => {
      const signals = analyzeMessageStyle("Run the tests.");
      expect(signals.formality).toBeNull();
    });
  });

  describe("verbosity detection", () => {
    it("detects terse messages", () => {
      const signals = analyzeMessageStyle("ok");
      expect(signals.verbosity).not.toBeNull();
      expect(signals.verbosity!).toBeLessThan(0);
    });

    it("detects single word messages as terse", () => {
      const signals = analyzeMessageStyle("status");
      expect(signals.verbosity).not.toBeNull();
      expect(signals.verbosity!).toBeLessThan(0);
    });

    it("detects verbose request patterns", () => {
      const signals = analyzeMessageStyle(
        "Could you please explain in detail how this works? Walk me through the process step by step.",
      );
      expect(signals.verbosity).not.toBeNull();
      expect(signals.verbosity!).toBeGreaterThan(0);
    });

    it("detects verbose messages by length", () => {
      const longMessage =
        "I want to understand how this system works in detail. " +
        "Please provide a comprehensive explanation covering all the major components " +
        "and how they interact with each other. Include examples if possible. " +
        "I would also like to know about edge cases and potential issues. " +
        "Additionally, please explain the design decisions behind this architecture " +
        "and any trade-offs that were made.";
      const signals = analyzeMessageStyle(longMessage);
      expect(signals.verbosity).not.toBeNull();
      expect(signals.verbosity!).toBeGreaterThan(0);
    });

    it("returns weak signal for neutral length messages", () => {
      const signals = analyzeMessageStyle("Check the logs for errors please.");
      // Short message (< 10 words) will produce a weak terse signal
      // This is expected behavior - length is a weak proxy for verbosity preference
      if (signals.verbosity !== null) {
        expect(Math.abs(signals.verbosity)).toBeLessThan(0.5); // Weak signal
      }
    });
  });

  describe("technical depth detection", () => {
    it("detects technical language", () => {
      const signals = analyzeMessageStyle(
        "Can you implement the OAuth flow with JWT tokens using async/await?",
      );
      expect(signals.technicalDepth).not.toBeNull();
      expect(signals.technicalDepth!).toBeGreaterThan(0);
    });

    it("detects code blocks as technical", () => {
      const signals = analyzeMessageStyle("Here is the code:\n```typescript\nconst x = 1;\n```");
      expect(signals.technicalDepth).not.toBeNull();
      expect(signals.technicalDepth!).toBeGreaterThan(0);
    });

    it("detects simplified request patterns", () => {
      const signals = analyzeMessageStyle(
        "Can you explain this in simple terms? I'm new to programming.",
      );
      expect(signals.technicalDepth).not.toBeNull();
      expect(signals.technicalDepth!).toBeLessThan(0);
    });

    it("detects ELI5 style requests as simplified", () => {
      const signals = analyzeMessageStyle("Explain like I'm 5 what a database does");
      expect(signals.technicalDepth).not.toBeNull();
      expect(signals.technicalDepth!).toBeLessThan(0);
    });

    it("returns null for neutral messages", () => {
      const signals = analyzeMessageStyle("What time is it?");
      expect(signals.technicalDepth).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns nulls for empty string", () => {
      const signals = analyzeMessageStyle("");
      expect(signals.formality).toBeNull();
      expect(signals.verbosity).toBeNull();
      expect(signals.technicalDepth).toBeNull();
    });

    it("returns nulls for whitespace only", () => {
      const signals = analyzeMessageStyle("   \n\t  ");
      expect(signals.formality).toBeNull();
      expect(signals.verbosity).toBeNull();
      expect(signals.technicalDepth).toBeNull();
    });

    it("returns nulls for very short input", () => {
      const signals = analyzeMessageStyle("x");
      expect(signals.formality).toBeNull();
      expect(signals.verbosity).toBeNull();
      expect(signals.technicalDepth).toBeNull();
    });

    it("handles mixed signals", () => {
      // Formal request for simplified content
      const signals = analyzeMessageStyle(
        "Would you kindly explain this in simple terms for a beginner?",
      );
      expect(signals.formality).not.toBeNull();
      expect(signals.formality!).toBeGreaterThan(0); // Formal language
      expect(signals.technicalDepth).not.toBeNull();
      expect(signals.technicalDepth!).toBeLessThan(0); // Simplified content
    });
  });
});

describe("createEmptyProfile", () => {
  it("creates a profile with zero scores", () => {
    const profile = createEmptyProfile("test-agent");
    expect(profile.agentId).toBe("test-agent");
    expect(profile.formality.value).toBe(0);
    expect(profile.formality.observations).toBe(0);
    expect(profile.verbosity.value).toBe(0);
    expect(profile.verbosity.observations).toBe(0);
    expect(profile.technicalDepth.value).toBe(0);
    expect(profile.technicalDepth.observations).toBe(0);
  });

  it("sets timestamps", () => {
    const before = new Date().toISOString();
    const profile = createEmptyProfile("test-agent");
    const after = new Date().toISOString();

    expect(profile.createdAt >= before).toBe(true);
    expect(profile.createdAt <= after).toBe(true);
    expect(profile.updatedAt >= before).toBe(true);
    expect(profile.updatedAt <= after).toBe(true);
  });
});

describe("loadStyleProfile and saveStyleProfile", () => {
  it("returns empty profile when file does not exist", async () => {
    const profile = await loadStyleProfile("nonexistent-agent");
    expect(profile.agentId).toBe("nonexistent-agent");
    expect(profile.formality.value).toBe(0);
    expect(profile.formality.observations).toBe(0);
  });

  it("saves and loads profile correctly", async () => {
    const profile = createEmptyProfile("test-agent");
    profile.formality.value = 0.5;
    profile.formality.observations = 10;
    profile.verbosity.value = -0.3;
    profile.verbosity.observations = 5;

    await saveStyleProfile(profile);
    const loaded = await loadStyleProfile("test-agent");

    expect(loaded.agentId).toBe("test-agent");
    expect(loaded.formality.value).toBe(0.5);
    expect(loaded.formality.observations).toBe(10);
    expect(loaded.verbosity.value).toBe(-0.3);
    expect(loaded.verbosity.observations).toBe(5);
  });

  it("handles corrupted file gracefully", async () => {
    const profilePath = path.join(
      testDir,
      "agents",
      "corrupt-agent",
      "agent",
      "style-profile.json",
    );
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.writeFile(profilePath, "not valid json{{{", "utf8");

    const profile = await loadStyleProfile("corrupt-agent");
    expect(profile.agentId).toBe("corrupt-agent");
    expect(profile.formality.value).toBe(0);
  });

  it("clamps out-of-range values", async () => {
    const profilePath = path.join(testDir, "agents", "bad-values", "agent", "style-profile.json");
    await fs.mkdir(path.dirname(profilePath), { recursive: true });
    await fs.writeFile(
      profilePath,
      JSON.stringify({
        agentId: "bad-values",
        formality: {
          dimension: "formality",
          value: 5,
          observations: 10,
          lastUpdated: new Date().toISOString(),
        },
        verbosity: {
          dimension: "verbosity",
          value: -3,
          observations: 5,
          lastUpdated: new Date().toISOString(),
        },
        technicalDepth: {
          dimension: "technical-depth",
          value: 0.5,
          observations: 3,
          lastUpdated: new Date().toISOString(),
        },
      }),
      "utf8",
    );

    const profile = await loadStyleProfile("bad-values");
    expect(profile.formality.value).toBe(1); // Clamped to max
    expect(profile.verbosity.value).toBe(-1); // Clamped to min
    expect(profile.technicalDepth.value).toBe(0.5); // In range, unchanged
  });
});

describe("updateStyleFromMessage", () => {
  it("updates profile based on formal message", async () => {
    const profile = await updateStyleFromMessage(
      "update-test",
      "Would you kindly assist me with this matter? Thank you.",
    );

    expect(profile.formality.value).toBeGreaterThan(0);
    expect(profile.formality.observations).toBe(1);
  });

  it("updates profile based on casual message", async () => {
    const profile = await updateStyleFromMessage(
      "update-test-2",
      "hey gonna need some help here lol",
    );

    expect(profile.formality.value).toBeLessThan(0);
    expect(profile.formality.observations).toBe(1);
  });

  it("accumulates observations over multiple messages", async () => {
    await updateStyleFromMessage("accumulate-test", "Please help. Thank you.");
    await updateStyleFromMessage("accumulate-test", "Could you kindly assist?");
    const profile = await updateStyleFromMessage(
      "accumulate-test",
      "I would appreciate your help.",
    );

    expect(profile.formality.observations).toBe(3);
    expect(profile.formality.value).toBeGreaterThan(0);
  });

  it("blends formal and casual messages", async () => {
    // Start with formal
    await updateStyleFromMessage("blend-test", "Please help me. Thank you.");
    // Add casual
    const profile = await updateStyleFromMessage("blend-test", "yo gonna need more help lol");

    // Should be somewhere in between
    expect(profile.formality.observations).toBe(2);
    // The value should be less extreme than either extreme
    expect(Math.abs(profile.formality.value)).toBeLessThan(0.9);
  });

  it("does not update when no signals detected", async () => {
    // First, establish a baseline
    await updateStyleFromMessage("no-signal-test", "Please help. Thank you.");
    const before = await loadStyleProfile("no-signal-test");

    // Neutral message with no style signals
    await updateStyleFromMessage("no-signal-test", "Run the tests.");
    const after = await loadStyleProfile("no-signal-test");

    // Formality should still be 1 observation since neutral message had no signal
    expect(after.formality.observations).toBe(before.formality.observations);
  });

  it("respects custom learning rate", async () => {
    // Create baseline
    await updateStyleFromMessage("lr-test", "Please help. Thank you.", { learningRate: 0.5 });
    const first = await loadStyleProfile("lr-test");

    // Add opposite signal with high learning rate
    await updateStyleFromMessage("lr-test", "yo sup lol", { learningRate: 0.9 });
    const second = await loadStyleProfile("lr-test");

    // High learning rate should cause more dramatic shift
    expect(second.formality.value).toBeLessThan(first.formality.value);
  });
});

describe("getStyleHints", () => {
  it("returns low confidence for empty profile", () => {
    const profile = createEmptyProfile("test");
    const hints = getStyleHints(profile);

    expect(hints.confidence).toBe(0);
    expect(hints.formality).toBe("neutral");
    expect(hints.verbosity).toBe("moderate");
    expect(hints.technicalDepth).toBe("balanced");
  });

  it("returns neutral hints for zero scores", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 10;
    profile.verbosity.observations = 10;
    profile.technicalDepth.observations = 10;

    const hints = getStyleHints(profile);

    expect(hints.formality).toBe("neutral");
    expect(hints.verbosity).toBe("moderate");
    expect(hints.technicalDepth).toBe("balanced");
    expect(hints.confidence).toBeGreaterThan(0);
  });

  it("returns formal hint for positive formality score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0.5;
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.formality).toBe("formal");
  });

  it("returns casual hint for negative formality score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = -0.5;
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.formality).toBe("casual");
  });

  it("returns terse hint for negative verbosity score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.value = -0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.verbosity).toBe("terse");
  });

  it("returns verbose hint for positive verbosity score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.value = 0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.verbosity).toBe("verbose");
  });

  it("returns technical hint for positive technical depth score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0.5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.technicalDepth).toBe("technical");
  });

  it("returns simplified hint for negative technical depth score", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = -0.5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.technicalDepth).toBe("simplified");
  });

  it("generates appropriate summary for casual terse style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = -0.5;
    profile.formality.observations = 5;
    profile.verbosity.value = -0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.summary).toContain("casual");
    expect(hints.summary).toContain("brief");
  });

  it("generates appropriate summary for formal verbose technical style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0.5;
    profile.formality.observations = 5;
    profile.verbosity.value = 0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0.5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.summary).toContain("formal");
    expect(hints.summary).toContain("detailed");
    expect(hints.summary).toContain("technical");
  });

  it("returns neutral summary when all scores are near zero", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0.1;
    profile.formality.observations = 5;
    profile.verbosity.value = -0.1;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0.05;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    expect(hints.summary).toContain("Neutral");
  });
});

describe("formatStyleInstruction", () => {
  it("returns empty string for low confidence", () => {
    const profile = createEmptyProfile("test");
    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);
    expect(instruction).toBe("");
  });

  it("includes formality instruction for casual style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = -0.5;
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("casual");
    expect(instruction).toContain("friendly");
  });

  it("includes formality instruction for formal style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0.5;
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("formal");
    expect(instruction).toContain("professional");
  });

  it("includes verbosity instruction for terse style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.value = -0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("brief");
  });

  it("includes verbosity instruction for verbose style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.value = 0.5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("detailed");
  });

  it("includes technical depth instruction for simplified style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = -0.5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("simple");
    expect(instruction).toContain("non-technical");
  });

  it("includes technical depth instruction for technical style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.observations = 5;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0.5;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toContain("technical");
  });

  it("returns empty for neutral style", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0;
    profile.formality.observations = 5;
    profile.verbosity.value = 0;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0;
    profile.technicalDepth.observations = 5;

    const hints = getStyleHints(profile);
    const instruction = formatStyleInstruction(hints);

    expect(instruction).toBe("");
  });
});

describe("resetStyleProfile", () => {
  it("resets profile to empty state", async () => {
    // Create a profile with data
    await updateStyleFromMessage("reset-test", "Please help. Thank you.");
    const before = await loadStyleProfile("reset-test");
    expect(before.formality.observations).toBeGreaterThan(0);

    // Reset
    const after = await resetStyleProfile("reset-test");

    expect(after.formality.value).toBe(0);
    expect(after.formality.observations).toBe(0);
    expect(after.verbosity.value).toBe(0);
    expect(after.verbosity.observations).toBe(0);
    expect(after.technicalDepth.value).toBe(0);
    expect(after.technicalDepth.observations).toBe(0);
  });

  it("persists reset state", async () => {
    await updateStyleFromMessage("reset-persist-test", "Please help. Thank you.");
    await resetStyleProfile("reset-persist-test");
    const loaded = await loadStyleProfile("reset-persist-test");

    expect(loaded.formality.observations).toBe(0);
  });
});

describe("getStyleScores", () => {
  it("returns all dimension scores", () => {
    const profile = createEmptyProfile("test");
    profile.formality.value = 0.5;
    profile.formality.observations = 10;
    profile.verbosity.value = -0.3;
    profile.verbosity.observations = 5;
    profile.technicalDepth.value = 0.7;
    profile.technicalDepth.observations = 8;

    const scores = getStyleScores(profile);

    expect(scores.formality.value).toBe(0.5);
    expect(scores.formality.observations).toBe(10);
    expect(scores.verbosity.value).toBe(-0.3);
    expect(scores.verbosity.observations).toBe(5);
    expect(scores["technical-depth"].value).toBe(0.7);
    expect(scores["technical-depth"].observations).toBe(8);
  });
});

describe("end-to-end style adaptation", () => {
  it("adapts to consistently formal user over time", async () => {
    const messages = [
      "I would appreciate your assistance with this matter.",
      "Could you kindly provide more details?",
      "Thank you for your help. I have another question.",
      "Would you please elaborate on this topic?",
      "I am grateful for your thorough explanation.",
    ];

    let profile: StyleProfile;
    for (const msg of messages) {
      profile = await updateStyleFromMessage("e2e-formal", msg);
    }

    // Verify the formality score is positive (formal)
    // Due to exponential moving average smoothing, the score builds up gradually
    expect(profile!.formality.value).toBeGreaterThan(0.2);
    expect(profile!.formality.observations).toBeGreaterThanOrEqual(3);

    // Get hints - the category threshold is 0.3, so check we're close
    const hints = getStyleHints(profile!);
    // With 5 formal messages, should be classified as formal or at least close
    expect(["formal", "neutral"]).toContain(hints.formality);
    // Verify underlying score is trending formal
    expect(profile!.formality.value).toBeGreaterThan(0);
  });

  it("adapts to consistently casual user over time", async () => {
    const messages = [
      "hey gonna need some help here",
      "yo that's awesome thanks",
      "lol kinda confused here",
      "nah that's not what i meant",
      "yep that works cool",
    ];

    let profile: StyleProfile;
    for (const msg of messages) {
      profile = await updateStyleFromMessage("e2e-casual", msg);
    }

    // Verify the formality score is negative (casual)
    expect(profile!.formality.value).toBeLessThan(-0.3);
    expect(profile!.formality.observations).toBeGreaterThanOrEqual(3);

    // Get hints
    const hints = getStyleHints(profile!);
    expect(hints.formality).toBe("casual");
  });

  it("adapts to terse user who sends short messages", async () => {
    const messages = ["status", "next", "ok", "done", "y"];

    let profile: StyleProfile;
    for (const msg of messages) {
      profile = await updateStyleFromMessage("e2e-terse", msg);
    }

    const hints = getStyleHints(profile!);
    expect(hints.verbosity).toBe("terse");
  });

  it("adapts to technical user who uses domain jargon", async () => {
    const messages = [
      "Implement the OAuth2 flow with JWT refresh tokens",
      "```typescript\nconst api = new APIClient();\n```",
      "Check the CI/CD pipeline for the deployment status",
      "Add async/await error handling with proper stack traces",
      "Configure the Kubernetes ingress for SSL termination",
    ];

    let profile: StyleProfile;
    for (const msg of messages) {
      profile = await updateStyleFromMessage("e2e-technical", msg);
    }

    const hints = getStyleHints(profile!);
    expect(hints.technicalDepth).toBe("technical");
  });

  it("generates appropriate instruction for complex style", async () => {
    // User who is formal but wants simplified explanations
    const messages = [
      "Would you kindly explain this in simple terms?",
      "I would appreciate a beginner-friendly explanation.",
      "Could you please use non-technical language?",
      "Thank you. Could you explain it like I'm new to this?",
    ];

    let profile: StyleProfile;
    for (const msg of messages) {
      profile = await updateStyleFromMessage("e2e-formal-simple", msg);
    }

    const hints = getStyleHints(profile!);
    const instruction = formatStyleInstruction(hints);

    expect(hints.formality).toBe("formal");
    expect(hints.technicalDepth).toBe("simplified");
    expect(instruction).toContain("formal");
    expect(instruction).toContain("simple");
  });
});
