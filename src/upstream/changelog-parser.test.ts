/**
 * Tests for the changelog parser
 */

import { describe, expect, it } from "vitest";

import {
  COMMIT_TYPE_LABELS,
  COMMIT_TYPE_PRIORITY,
  extractFeatureDescriptions,
  filterByScope,
  filterByType,
  formatChangelog,
  formatEntry,
  generateSummary,
  getBreakingChanges,
  getUniqueScopes,
  groupChangelog,
  parseChangelogFile,
  parseCommitMessage,
  parseCommitMessages,
  parseGitLog,
  sortByPriority,
  toChangelogEntry,
  type CommitType,
  type ParsedCommit,
} from "./changelog-parser.js";

describe("parseCommitMessage", () => {
  describe("conventional commit format", () => {
    it("parses a basic feat commit", () => {
      const result = parseCommitMessage("feat: add user authentication");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.type).toBe("feat");
      expect(result.commit.scope).toBeNull();
      expect(result.commit.description).toBe("add user authentication");
      expect(result.commit.breaking).toBe(false);
    });

    it("parses a commit with scope", () => {
      const result = parseCommitMessage("fix(cli): resolve argument parsing issue");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.type).toBe("fix");
      expect(result.commit.scope).toBe("cli");
      expect(result.commit.description).toBe("resolve argument parsing issue");
    });

    it("parses all standard commit types", () => {
      const types: CommitType[] = [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ];

      for (const type of types) {
        const result = parseCommitMessage(`${type}: some change`);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.commit.type).toBe(type);
        }
      }
    });

    it("handles type aliases", () => {
      const aliases = [
        { input: "feature: new thing", expected: "feat" },
        { input: "bugfix: fixed bug", expected: "fix" },
        { input: "hotfix: urgent fix", expected: "fix" },
        { input: "doc: update readme", expected: "docs" },
        { input: "performance: optimize query", expected: "perf" },
        { input: "tests: add unit tests", expected: "test" },
        { input: "deps: update lodash", expected: "chore" },
      ];

      for (const { input, expected } of aliases) {
        const result = parseCommitMessage(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.commit.type).toBe(expected);
        }
      }
    });
  });

  describe("breaking changes", () => {
    it("detects breaking change with ! indicator", () => {
      const result = parseCommitMessage("feat!: remove deprecated API");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.breaking).toBe(true);
      expect(result.commit.type).toBe("feat");
    });

    it("detects breaking change with scope and ! indicator", () => {
      const result = parseCommitMessage("fix(api)!: change response format");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.breaking).toBe(true);
      expect(result.commit.scope).toBe("api");
    });

    it("detects BREAKING CHANGE in body", () => {
      const message = `feat: update config format

BREAKING CHANGE: config.json is now config.yaml`;

      const result = parseCommitMessage(message);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.breaking).toBe(true);
      expect(result.commit.breakingDescription).toBe("config.json is now config.yaml");
    });

    it("detects BREAKING: in body", () => {
      const message = `refactor(core): restructure modules

BREAKING: module paths have changed`;

      const result = parseCommitMessage(message);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.breaking).toBe(true);
      expect(result.commit.breakingDescription).toBe("module paths have changed");
    });
  });

  describe("commit body", () => {
    it("extracts multi-line body", () => {
      const message = `feat(auth): add OAuth2 support

This adds OAuth2 authentication with support for:
- Google
- GitHub
- Microsoft

Closes #123`;

      const result = parseCommitMessage(message);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.body).toContain("Google");
      expect(result.commit.body).toContain("Closes #123");
    });

    it("handles empty body", () => {
      const result = parseCommitMessage("fix: typo in error message");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.body).toBeNull();
    });
  });

  describe("non-conventional commits", () => {
    it("parses non-conventional commits as unknown type", () => {
      const result = parseCommitMessage("Update dependencies");

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.type).toBe("unknown");
      expect(result.commit.description).toBe("Update dependencies");
    });

    it("handles empty message", () => {
      const result = parseCommitMessage("");

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBe("Empty commit message");
    });

    it("handles whitespace-only message", () => {
      const result = parseCommitMessage("   \n  ");

      expect(result.success).toBe(false);
    });
  });

  describe("metadata", () => {
    it("includes provided metadata", () => {
      const result = parseCommitMessage("feat: new feature", {
        hash: "abc1234567890",
        date: new Date("2024-01-15"),
        author: "Test User",
      });

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.commit.hash).toBe("abc1234567890");
      expect(result.commit.date).toEqual(new Date("2024-01-15"));
      expect(result.commit.author).toBe("Test User");
    });
  });
});

describe("parseCommitMessages", () => {
  it("parses array of string messages", () => {
    const messages = ["feat: add login", "fix: resolve crash", "docs: update readme"];

    const commits = parseCommitMessages(messages);

    expect(commits).toHaveLength(3);
    expect(commits[0].type).toBe("feat");
    expect(commits[1].type).toBe("fix");
    expect(commits[2].type).toBe("docs");
  });

  it("parses array of message objects with metadata", () => {
    const messages = [
      { message: "feat: new feature", hash: "abc123" },
      { message: "fix: bug fix", hash: "def456", author: "User" },
    ];

    const commits = parseCommitMessages(messages);

    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe("abc123");
    expect(commits[1].author).toBe("User");
  });

  it("filters out invalid messages", () => {
    const messages = [
      "feat: valid",
      "", // Empty - will be filtered
      "fix: also valid",
    ];

    const commits = parseCommitMessages(messages);

    expect(commits).toHaveLength(2);
  });
});

describe("groupChangelog", () => {
  const sampleCommits: ParsedCommit[] = [
    {
      type: "feat",
      scope: "auth",
      description: "add OAuth2",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "feat(auth): add OAuth2",
      hash: "abc123",
      date: null,
      author: null,
    },
    {
      type: "fix",
      scope: "cli",
      description: "fix crash",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "fix(cli): fix crash",
      hash: "def456",
      date: null,
      author: null,
    },
    {
      type: "feat",
      scope: null,
      description: "breaking feature",
      body: null,
      breaking: true,
      breakingDescription: "old API removed",
      raw: "feat!: breaking feature",
      hash: "ghi789",
      date: null,
      author: null,
    },
    {
      type: "perf",
      scope: "core",
      description: "optimize query",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "perf(core): optimize query",
      hash: "jkl012",
      date: null,
      author: null,
    },
  ];

  it("groups commits by category", () => {
    const grouped = groupChangelog(sampleCommits);

    expect(grouped.features).toHaveLength(2);
    expect(grouped.fixes).toHaveLength(1);
    expect(grouped.performance).toHaveLength(1);
    expect(grouped.totalCount).toBe(4);
  });

  it("extracts breaking changes", () => {
    const grouped = groupChangelog(sampleCommits);

    expect(grouped.breaking).toHaveLength(1);
    expect(grouped.breaking[0].breakingNotes).toBe("old API removed");
  });

  it("handles empty commits array", () => {
    const grouped = groupChangelog([]);

    expect(grouped.features).toHaveLength(0);
    expect(grouped.fixes).toHaveLength(0);
    expect(grouped.totalCount).toBe(0);
  });
});

describe("filterByType", () => {
  const commits: ParsedCommit[] = [
    {
      type: "feat",
      scope: null,
      description: "a",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
    {
      type: "fix",
      scope: null,
      description: "b",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
    {
      type: "docs",
      scope: null,
      description: "c",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
  ];

  it("filters by single type", () => {
    const result = filterByType(commits, ["feat"]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("feat");
  });

  it("filters by multiple types", () => {
    const result = filterByType(commits, ["feat", "fix"]);
    expect(result).toHaveLength(2);
  });
});

describe("filterByScope", () => {
  const commits: ParsedCommit[] = [
    {
      type: "feat",
      scope: "cli",
      description: "a",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
    {
      type: "fix",
      scope: "api",
      description: "b",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
    {
      type: "docs",
      scope: null,
      description: "c",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    },
  ];

  it("filters by scope", () => {
    const result = filterByScope(commits, ["cli"]);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBe("cli");
  });

  it("filters by null scope", () => {
    const result = filterByScope(commits, [null]);
    expect(result).toHaveLength(1);
    expect(result[0].scope).toBeNull();
  });
});

describe("getBreakingChanges", () => {
  it("returns only breaking changes", () => {
    const commits: ParsedCommit[] = [
      {
        type: "feat",
        scope: null,
        description: "a",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "feat",
        scope: null,
        description: "b",
        body: null,
        breaking: true,
        breakingDescription: "breaks",
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
    ];

    const result = getBreakingChanges(commits);
    expect(result).toHaveLength(1);
    expect(result[0].breaking).toBe(true);
  });
});

describe("getUniqueScopes", () => {
  it("extracts unique scopes", () => {
    const commits: ParsedCommit[] = [
      {
        type: "feat",
        scope: "cli",
        description: "a",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "fix",
        scope: "cli",
        description: "b",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "docs",
        scope: "api",
        description: "c",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "test",
        scope: null,
        description: "d",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
    ];

    const scopes = getUniqueScopes(commits);
    expect(scopes.size).toBe(2);
    expect(scopes.has("cli")).toBe(true);
    expect(scopes.has("api")).toBe(true);
  });
});

describe("sortByPriority", () => {
  it("sorts commits by type priority", () => {
    const commits: ParsedCommit[] = [
      {
        type: "chore",
        scope: null,
        description: "a",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "feat",
        scope: null,
        description: "b",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "fix",
        scope: null,
        description: "c",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
    ];

    const sorted = sortByPriority(commits);
    expect(sorted[0].type).toBe("feat");
    expect(sorted[1].type).toBe("fix");
    expect(sorted[2].type).toBe("chore");
  });

  it("uses scope as secondary sort", () => {
    const commits: ParsedCommit[] = [
      {
        type: "feat",
        scope: "z-last",
        description: "a",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "feat",
        scope: "a-first",
        description: "b",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
      {
        type: "feat",
        scope: null,
        description: "c",
        body: null,
        breaking: false,
        breakingDescription: null,
        raw: "",
        hash: null,
        date: null,
        author: null,
      },
    ];

    const sorted = sortByPriority(commits);
    expect(sorted[0].scope).toBe("a-first");
    expect(sorted[1].scope).toBe("z-last");
    expect(sorted[2].scope).toBeNull();
  });
});

describe("formatEntry", () => {
  it("formats a basic entry", () => {
    const entry = toChangelogEntry({
      type: "feat",
      scope: "cli",
      description: "add verbose flag",
      body: null,
      breaking: false,
      breakingDescription: null,
      raw: "",
      hash: "abc1234567",
      date: null,
      author: null,
    });

    const formatted = formatEntry(entry);
    expect(formatted).toBe("- **cli:** add verbose flag (abc1234)");
  });

  it("formats breaking change", () => {
    const entry = toChangelogEntry({
      type: "feat",
      scope: null,
      description: "remove old API",
      body: null,
      breaking: true,
      breakingDescription: null,
      raw: "",
      hash: null,
      date: null,
      author: null,
    });

    const formatted = formatEntry(entry);
    expect(formatted).toBe("- **BREAKING:** remove old API");
  });

  it("respects formatting options", () => {
    const entry = toChangelogEntry({
      type: "feat",
      scope: "cli",
      description: "new feature",
      body: null,
      breaking: true,
      breakingDescription: null,
      raw: "",
      hash: "abc1234567",
      date: null,
      author: null,
    });

    const formatted = formatEntry(entry, {
      includeScope: false,
      includeHash: false,
      includeBreaking: false,
    });
    expect(formatted).toBe("- new feature");
  });
});

describe("formatChangelog", () => {
  it("formats a complete changelog", () => {
    const commits = parseCommitMessages([
      "feat(auth): add login",
      "fix(cli): resolve crash",
      "feat!: breaking change",
    ]);

    const grouped = groupChangelog(commits);
    const formatted = formatChangelog(grouped, { title: "v1.0.0" });

    expect(formatted).toContain("# v1.0.0");
    expect(formatted).toContain("## Breaking Changes");
    expect(formatted).toContain("## Features");
    expect(formatted).toContain("## Bug Fixes");
  });
});

describe("parseGitLog", () => {
  it("parses git log output", () => {
    const gitLog = `abc1234567890
feat(cli): add new command
This adds a new CLI command for users.
---COMMIT---
def4567890abc
fix: resolve bug

BREAKING CHANGE: API changed
---COMMIT---`;

    const commits = parseGitLog(gitLog);

    expect(commits).toHaveLength(2);
    expect(commits[0].hash).toBe("abc1234567890");
    expect(commits[0].type).toBe("feat");
    expect(commits[0].scope).toBe("cli");
    expect(commits[1].breaking).toBe(true);
  });
});

describe("parseChangelogFile", () => {
  it("parses a CHANGELOG.md file", () => {
    const changelog = `# Changelog

## [1.2.0] - 2024-02-01

### Features

- Add new login feature
- Support OAuth2

### Bug Fixes

- Fix crash on startup

## [1.1.0] - 2024-01-15

- Initial release
`;

    const versions = parseChangelogFile(changelog);

    expect(versions.has("1.2.0")).toBe(true);
    expect(versions.has("1.1.0")).toBe(true);
    expect(versions.get("1.2.0")).toHaveLength(3);
  });

  it("handles different version formats", () => {
    const changelog = `## v2.0.0

- Feature A

## 1.0.0 (2024-01-01)

- Feature B
`;

    const versions = parseChangelogFile(changelog);

    expect(versions.has("2.0.0")).toBe(true);
    expect(versions.has("1.0.0 (2024-01-01)")).toBe(true);
  });
});

describe("extractFeatureDescriptions", () => {
  it("extracts and formats feature descriptions", () => {
    const commits = parseCommitMessages([
      "feat(auth): add OAuth2 support",
      "fix: resolve bug",
      "feat: improve performance",
    ]);

    const descriptions = extractFeatureDescriptions(commits);

    expect(descriptions).toHaveLength(2);
    expect(descriptions[0]).toBe("[auth] Add OAuth2 support");
    expect(descriptions[1]).toBe("Improve performance");
  });
});

describe("generateSummary", () => {
  it("generates a human-readable summary", () => {
    const commits = parseCommitMessages([
      "feat: new feature",
      "feat!: breaking feature",
      "fix: bug fix",
      "docs: update readme",
    ]);

    const summary = generateSummary(commits);

    expect(summary).toContain("1 breaking change(s)");
    expect(summary).toContain("2 new feature(s)");
    expect(summary).toContain("1 bug fix(es)");
  });

  it("handles empty commits", () => {
    const summary = generateSummary([]);
    expect(summary).toBe("No changes");
  });
});

describe("COMMIT_TYPE_LABELS", () => {
  it("has labels for all types", () => {
    const types: CommitType[] = [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
      "unknown",
    ];

    for (const type of types) {
      expect(COMMIT_TYPE_LABELS[type]).toBeDefined();
      expect(typeof COMMIT_TYPE_LABELS[type]).toBe("string");
    }
  });
});

describe("COMMIT_TYPE_PRIORITY", () => {
  it("has feat with highest priority", () => {
    expect(COMMIT_TYPE_PRIORITY.feat).toBeLessThan(COMMIT_TYPE_PRIORITY.fix);
    expect(COMMIT_TYPE_PRIORITY.feat).toBeLessThan(COMMIT_TYPE_PRIORITY.chore);
  });

  it("has unknown with lowest priority", () => {
    expect(COMMIT_TYPE_PRIORITY.unknown).toBeGreaterThan(COMMIT_TYPE_PRIORITY.feat);
    expect(COMMIT_TYPE_PRIORITY.unknown).toBeGreaterThan(COMMIT_TYPE_PRIORITY.chore);
  });
});
