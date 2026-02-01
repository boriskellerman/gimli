import { describe, expect, it } from "vitest";
import {
  ALL_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_DISPLAY_NAMES,
  categorizeMemories,
  categorizeMemory,
  filterByCategory,
  getApplicableCategories,
  getCategoryStats,
  matchesCategory,
  type MemoryCategory,
} from "./categories.js";

describe("categorizeMemory", () => {
  describe("projects category", () => {
    it("should categorize project-related content", () => {
      const result = categorizeMemory(
        "Working on the new feature for project Alpha. Need to implement the API endpoint.",
      );
      expect(result.category).toBe("projects");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect repository and codebase mentions", () => {
      const result = categorizeMemory(
        "The repository has been updated with the latest changes. The codebase needs refactoring.",
      );
      expect(result.category).toBe("projects");
    });

    it("should detect sprint and milestone content", () => {
      const result = categorizeMemory(
        "Sprint 5 goals: Complete the deployment pipeline and reach the Q2 milestone.",
      );
      expect(result.category).toBe("projects");
    });

    it("should detect PR and merge mentions", () => {
      const result = categorizeMemory(
        "Created a PR for the bug fix. Waiting for review before merge.",
      );
      expect(result.category).toBe("projects");
    });

    it("should detect task checkboxes as structural pattern", () => {
      const result = categorizeMemory("## Tasks\n- [x] Complete design\n- [ ] Implement feature");
      expect(result.category).toBe("projects");
    });
  });

  describe("people category", () => {
    it("should categorize people-related content with names", () => {
      const result = categorizeMemory(
        "John Smith is the project lead. Contact him for architecture decisions.",
      );
      expect(result.category).toBe("people");
    });

    it("should detect @mentions", () => {
      const result = categorizeMemory(
        "The team member @alice is the developer. Contact @bob the engineer for help.",
      );
      expect(result.category).toBe("people");
    });

    it("should detect role-based content", () => {
      const result = categorizeMemory(
        "Our team includes Sarah the developer, Mike the designer, and Jane the stakeholder who manages clients.",
      );
      expect(result.category).toBe("people");
    });

    it("should detect team headings", () => {
      const result = categorizeMemory("## Team\n\nSarah: Lead Developer\nMike: Designer");
      expect(result.category).toBe("people");
    });

    it("should detect contacts heading", () => {
      const result = categorizeMemory("## Contacts\n\nEmail: team@example.com");
      expect(result.category).toBe("people");
    });
  });

  describe("preferences category", () => {
    it("should categorize preference-related content", () => {
      const result = categorizeMemory(
        "I prefer using TypeScript with strict mode. Always use ESLint for linting.",
      );
      expect(result.category).toBe("preferences");
    });

    it("should detect settings and configuration", () => {
      const result = categorizeMemory(
        "The default settings should include dark mode. Configuration lives in config.json.",
      );
      expect(result.category).toBe("preferences");
    });

    it("should detect coding standards", () => {
      const result = categorizeMemory(
        "Our coding conventions require 2-space indentation. Follow the style guide.",
      );
      expect(result.category).toBe("preferences");
    });

    it("should detect must/should/never patterns", () => {
      const result = categorizeMemory(
        "You must always write tests. Never commit directly to main.",
      );
      expect(result.category).toBe("preferences");
    });

    it("should detect guidelines heading", () => {
      const result = categorizeMemory("## Guidelines\n\n- Use descriptive variable names");
      expect(result.category).toBe("preferences");
    });
  });

  describe("decisions category", () => {
    it("should categorize decision-related content", () => {
      const result = categorizeMemory(
        "We decided to use React instead of Vue. The decision was based on team expertise.",
      );
      expect(result.category).toBe("decisions");
    });

    it("should detect choice and selection language", () => {
      const result = categorizeMemory(
        "After evaluation, we chose PostgreSQL. This selection was made because of its reliability.",
      );
      expect(result.category).toBe("decisions");
    });

    it("should detect rationale and reasoning", () => {
      const result = categorizeMemory(
        "The rationale for this approach is performance. Our reasoning considers both speed and maintainability.",
      );
      expect(result.category).toBe("decisions");
    });

    it("should detect trade-offs and alternatives", () => {
      const result = categorizeMemory(
        "The trade-off is complexity vs flexibility. We considered several alternatives before deciding.",
      );
      expect(result.category).toBe("decisions");
    });

    it("should detect ADR and RFC mentions", () => {
      const result = categorizeMemory("ADR 001: Use microservices architecture. RFC approved.");
      expect(result.category).toBe("decisions");
    });

    it("should detect decision headings", () => {
      const result = categorizeMemory("## Decision\n\nWe will use GraphQL for the API layer.");
      expect(result.category).toBe("decisions");
    });
  });

  describe("general category", () => {
    it("should return general for empty text", () => {
      const result = categorizeMemory("");
      expect(result.category).toBe("general");
      expect(result.confidence).toBe(1.0);
    });

    it("should return general for whitespace-only text", () => {
      const result = categorizeMemory("   \n\t  ");
      expect(result.category).toBe("general");
    });

    it("should return general for uncategorizable content", () => {
      const result = categorizeMemory("The weather is nice today.");
      expect(result.category).toBe("general");
    });

    it("should return general when no patterns match strongly enough", () => {
      const result = categorizeMemory("Some random notes about nothing specific.");
      expect(result.category).toBe("general");
    });
  });

  describe("confidence scores", () => {
    it("should have higher confidence for multiple strong matches", () => {
      const weakResult = categorizeMemory("Working on a feature.");
      const strongResult = categorizeMemory(
        "Working on project feature implementation for the sprint milestone deployment release.",
      );
      expect(strongResult.confidence).toBeGreaterThan(weakResult.confidence);
    });

    it("should cap confidence at 1.0", () => {
      const result = categorizeMemory(
        "Project feature implementation deployment release sprint milestone " +
          "repository codebase application task ticket issue PR pull request merge branch commit",
      );
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe("secondary categories", () => {
    it("should include secondary categories when multiple match", () => {
      const result = categorizeMemory(
        "John Smith decided to implement the new project feature using React.",
      );
      expect(result.secondaryCategories).toBeDefined();
      expect(result.secondaryCategories!.length).toBeGreaterThan(0);
    });

    it("should limit secondary categories", () => {
      const result = categorizeMemory(
        "John Smith prefers React for the project. The decision was made based on team preference.",
      );
      if (result.secondaryCategories) {
        expect(result.secondaryCategories.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe("matched keywords", () => {
    it("should include matched keywords in metadata", () => {
      const result = categorizeMemory("The project repository has a new feature implementation.");
      expect(result.matchedKeywords).toBeDefined();
      expect(result.matchedKeywords!.length).toBeGreaterThan(0);
    });

    it("should limit matched keywords", () => {
      const result = categorizeMemory(
        "Project feature implementation deployment release sprint milestone " +
          "repository codebase application task ticket issue PR pull request merge branch commit",
      );
      expect(result.matchedKeywords!.length).toBeLessThanOrEqual(5);
    });
  });
});

describe("categorizeMemories", () => {
  it("should batch categorize multiple texts", () => {
    const texts = [
      "Working on the project feature implementation for the sprint.",
      "John Smith is the lead developer. Contact Sarah the designer.",
      "We prefer using TypeScript. Always format code with Prettier. Never use var.",
      "Decided to use PostgreSQL because of the trade-offs. The rationale was performance.",
      "The weather is nice.",
    ];
    const results = categorizeMemories(texts);
    expect(results.length).toBe(5);
    expect(results[0].category).toBe("projects");
    expect(results[1].category).toBe("people");
    expect(results[2].category).toBe("preferences");
    expect(results[3].category).toBe("decisions");
    expect(results[4].category).toBe("general");
  });

  it("should handle empty array", () => {
    const results = categorizeMemories([]);
    expect(results).toEqual([]);
  });
});

describe("matchesCategory", () => {
  it("should return true for primary category match", () => {
    expect(matchesCategory("Working on the project feature.", "projects")).toBe(true);
  });

  it("should return true for secondary category match", () => {
    const text = "John Smith decided to implement the project feature.";
    // This should match both people and projects/decisions
    const metadata = categorizeMemory(text);
    const primaryMatches = matchesCategory(text, metadata.category);
    expect(primaryMatches).toBe(true);
  });

  it("should return true for general category always", () => {
    expect(matchesCategory("Working on the project.", "general")).toBe(true);
    expect(matchesCategory("Random text.", "general")).toBe(true);
  });

  it("should return false for non-matching category", () => {
    expect(matchesCategory("Working on the project feature.", "people")).toBe(false);
  });
});

describe("getApplicableCategories", () => {
  it("should include primary category", () => {
    const categories = getApplicableCategories("Working on the project feature.");
    expect(categories).toContain("projects");
  });

  it("should include secondary categories", () => {
    const categories = getApplicableCategories(
      "John Smith decided to implement the project feature.",
    );
    expect(categories.length).toBeGreaterThan(1);
  });

  it("should always include general as fallback", () => {
    const categories = getApplicableCategories("Working on the project feature.");
    expect(categories).toContain("general");
  });

  it("should not duplicate general", () => {
    const categories = getApplicableCategories("Random uncategorizable text.");
    const generalCount = categories.filter((c) => c === "general").length;
    expect(generalCount).toBe(1);
  });
});

describe("filterByCategory", () => {
  const testResults = [
    { snippet: "Working on the project feature implementation for the sprint.", score: 0.9 },
    { snippet: "John Smith is the lead developer. Contact Sarah the designer.", score: 0.8 },
    {
      snippet: "We always prefer using TypeScript. Never use any. Should format with Prettier.",
      score: 0.7,
    },
    {
      snippet:
        "Decided to use PostgreSQL because of the trade-offs. The rationale was performance.",
      score: 0.6,
    },
    { snippet: "Random uncategorized text.", score: 0.5 },
  ];

  it("should filter to projects category", () => {
    const filtered = filterByCategory(testResults, "projects");
    expect(filtered.length).toBe(1);
    expect(filtered[0].snippet).toContain("project");
  });

  it("should filter to people category", () => {
    const filtered = filterByCategory(testResults, "people");
    expect(filtered.length).toBe(1);
    expect(filtered[0].snippet).toContain("John Smith");
  });

  it("should filter to preferences category", () => {
    const filtered = filterByCategory(testResults, "preferences");
    expect(filtered.length).toBe(1);
    expect(filtered[0].snippet).toContain("prefer");
  });

  it("should filter to decisions category", () => {
    const filtered = filterByCategory(testResults, "decisions");
    expect(filtered.length).toBe(1);
    expect(filtered[0].snippet).toContain("Decided");
  });

  it("should return all for general category", () => {
    const filtered = filterByCategory(testResults, "general");
    expect(filtered.length).toBe(testResults.length);
  });

  it("should handle empty array", () => {
    const filtered = filterByCategory([], "projects");
    expect(filtered).toEqual([]);
  });
});

describe("getCategoryStats", () => {
  it("should count categories correctly", () => {
    const texts = [
      "Working on the project feature implementation for the sprint.",
      "Another project task for the milestone release.",
      "John Smith is the lead developer. Sarah is the designer.",
      "We always prefer TypeScript. Never use var. Should use ESLint.",
      "Random text.",
    ];
    const stats = getCategoryStats(texts);
    expect(stats.total).toBe(5);
    expect(stats.counts.projects).toBe(2);
    expect(stats.counts.people).toBe(1);
    expect(stats.counts.preferences).toBe(1);
    expect(stats.counts.general).toBe(1);
  });

  it("should calculate percentages correctly", () => {
    const texts = [
      "Working on the project feature implementation.",
      "Another project task for the sprint.",
      "Third project milestone release.",
      "Fourth project deployment.",
    ];
    const stats = getCategoryStats(texts);
    expect(stats.percentages.projects).toBe(100);
  });

  it("should handle empty array", () => {
    const stats = getCategoryStats([]);
    expect(stats.total).toBe(0);
    expect(stats.counts.projects).toBe(0);
    expect(stats.percentages.projects).toBe(0);
  });
});

describe("constants", () => {
  it("should have all categories in ALL_CATEGORIES", () => {
    const expected: MemoryCategory[] = [
      "projects",
      "people",
      "preferences",
      "decisions",
      "general",
    ];
    expect(ALL_CATEGORIES).toEqual(expected);
  });

  it("should have display names for all categories", () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_DISPLAY_NAMES[category]).toBeDefined();
      expect(typeof CATEGORY_DISPLAY_NAMES[category]).toBe("string");
    }
  });

  it("should have descriptions for all categories", () => {
    for (const category of ALL_CATEGORIES) {
      expect(CATEGORY_DESCRIPTIONS[category]).toBeDefined();
      expect(typeof CATEGORY_DESCRIPTIONS[category]).toBe("string");
      expect(CATEGORY_DESCRIPTIONS[category].length).toBeGreaterThan(0);
    }
  });
});

describe("edge cases", () => {
  it("should handle very long text", () => {
    const longText = "project feature implementation sprint ".repeat(100);
    const result = categorizeMemory(longText);
    expect(result.category).toBe("projects");
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });

  it("should handle special characters", () => {
    const result = categorizeMemory("Working on the project feature implementation!!! @#$%^&*()");
    expect(result.category).toBe("projects");
  });

  it("should handle unicode characters", () => {
    const result = categorizeMemory("Working on the project feature.");
    expect(result).toBeDefined();
  });

  it("should handle mixed case", () => {
    const result = categorizeMemory("WORKING ON THE PROJECT FEATURE deployment RELEASE");
    expect(result.category).toBe("projects");
  });

  it("should handle newlines and formatting", () => {
    const result = categorizeMemory(
      "## Project\n\n- Feature 1\n- Feature 2\n\nImplementation notes.",
    );
    expect(result.category).toBe("projects");
  });
});
