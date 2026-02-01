/**
 * Changelog Parser for OpenClaw Upstream Sync
 *
 * Parses conventional commit messages and changelog entries to extract
 * meaningful feature descriptions, categorized by type and scope.
 *
 * Supports:
 * - Conventional Commits (feat, fix, docs, refactor, test, chore, etc.)
 * - Breaking changes (BREAKING CHANGE: or !)
 * - Scopes (e.g., feat(cli): ...)
 * - Multi-line commit bodies
 */

/**
 * Commit types recognized by the parser
 */
export type CommitType =
  | "feat"
  | "fix"
  | "docs"
  | "style"
  | "refactor"
  | "perf"
  | "test"
  | "build"
  | "ci"
  | "chore"
  | "revert"
  | "unknown";

/**
 * Human-readable labels for commit types
 */
export const COMMIT_TYPE_LABELS: Record<CommitType, string> = {
  feat: "Features",
  fix: "Bug Fixes",
  docs: "Documentation",
  style: "Styles",
  refactor: "Code Refactoring",
  perf: "Performance Improvements",
  test: "Tests",
  build: "Build System",
  ci: "Continuous Integration",
  chore: "Chores",
  revert: "Reverts",
  unknown: "Other Changes",
};

/**
 * Priority for changelog ordering (lower = more important)
 */
export const COMMIT_TYPE_PRIORITY: Record<CommitType, number> = {
  feat: 1,
  fix: 2,
  perf: 3,
  refactor: 4,
  docs: 5,
  test: 6,
  build: 7,
  ci: 8,
  style: 9,
  chore: 10,
  revert: 11,
  unknown: 12,
};

/**
 * A parsed commit entry
 */
export interface ParsedCommit {
  /** The commit type (feat, fix, etc.) */
  type: CommitType;

  /** The scope (optional, e.g., 'cli' in 'feat(cli): ...') */
  scope: string | null;

  /** The commit description/subject line */
  description: string;

  /** The commit body (optional, multi-line) */
  body: string | null;

  /** Whether this is a breaking change */
  breaking: boolean;

  /** Breaking change description (if any) */
  breakingDescription: string | null;

  /** The original raw message */
  raw: string;

  /** Commit hash (if available) */
  hash: string | null;

  /** Commit date (if available) */
  date: Date | null;

  /** Author (if available) */
  author: string | null;
}

/**
 * A categorized changelog entry
 */
export interface ChangelogEntry {
  /** The type category */
  type: CommitType;

  /** Human-readable type label */
  typeLabel: string;

  /** The scope (if any) */
  scope: string | null;

  /** The description */
  description: string;

  /** Extended details from body */
  details: string | null;

  /** Whether this is breaking */
  breaking: boolean;

  /** Breaking change notes */
  breakingNotes: string | null;

  /** Associated commit hash */
  hash: string | null;
}

/**
 * Grouped changelog organized by type
 */
export interface GroupedChangelog {
  /** Breaking changes (extracted from all types) */
  breaking: ChangelogEntry[];

  /** Features */
  features: ChangelogEntry[];

  /** Bug fixes */
  fixes: ChangelogEntry[];

  /** Performance improvements */
  performance: ChangelogEntry[];

  /** Documentation changes */
  docs: ChangelogEntry[];

  /** All other changes grouped by type */
  other: Record<CommitType, ChangelogEntry[]>;

  /** Total count of entries */
  totalCount: number;
}

/**
 * Parse result with optional error
 */
export type ParseResult =
  | { success: true; commit: ParsedCommit }
  | { success: false; error: string; raw: string };

/**
 * Regular expression for conventional commit format
 * Matches: type(scope)!: description
 *
 * Groups:
 * 1. type (required)
 * 2. scope (optional, in parentheses)
 * 3. breaking indicator (optional, !)
 * 4. description (required)
 */
const CONVENTIONAL_COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

/**
 * Breaking change patterns in commit body
 */
const BREAKING_CHANGE_PATTERNS = [
  /^BREAKING\s*CHANGE:\s*(.+)$/im,
  /^BREAKING:\s*(.+)$/im,
  /^BREAKING-CHANGE:\s*(.+)$/im,
];

/**
 * Valid conventional commit types
 */
const VALID_TYPES = new Set<CommitType>([
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
]);

/**
 * Parse a single commit message into structured format
 *
 * @param message - The commit message (subject + optional body)
 * @param metadata - Optional metadata (hash, date, author)
 * @returns Parse result with structured commit or error
 */
export function parseCommitMessage(
  message: string,
  metadata?: { hash?: string; date?: Date; author?: string },
): ParseResult {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return { success: false, error: "Empty commit message", raw: message };
  }

  // Split into subject and body
  const lines = trimmedMessage.split(/\r?\n/);
  const subject = lines[0].trim();
  const bodyLines = lines.slice(1).join("\n").trim();
  const body = bodyLines || null;

  // Try to parse as conventional commit
  const match = subject.match(CONVENTIONAL_COMMIT_REGEX);

  if (!match) {
    // Not a conventional commit - still extract what we can
    return {
      success: true,
      commit: {
        type: "unknown",
        scope: null,
        description: subject,
        body,
        breaking: false,
        breakingDescription: null,
        raw: message,
        hash: metadata?.hash ?? null,
        date: metadata?.date ?? null,
        author: metadata?.author ?? null,
      },
    };
  }

  const [, rawType, scope, breakingIndicator, description] = match;
  const type = normalizeType(rawType);
  const hasBreakingIndicator = breakingIndicator === "!";

  // Check for breaking change in body
  let breakingDescription: string | null = null;
  if (body) {
    for (const pattern of BREAKING_CHANGE_PATTERNS) {
      const breakingMatch = body.match(pattern);
      if (breakingMatch) {
        breakingDescription = breakingMatch[1].trim();
        break;
      }
    }
  }

  const breaking = hasBreakingIndicator || breakingDescription !== null;

  return {
    success: true,
    commit: {
      type,
      scope: scope?.trim() ?? null,
      description: description.trim(),
      body,
      breaking,
      breakingDescription,
      raw: message,
      hash: metadata?.hash ?? null,
      date: metadata?.date ?? null,
      author: metadata?.author ?? null,
    },
  };
}

/**
 * Normalize commit type to known types
 */
function normalizeType(rawType: string): CommitType {
  const normalized = rawType.toLowerCase().trim();

  if (VALID_TYPES.has(normalized as CommitType)) {
    return normalized as CommitType;
  }

  // Handle common aliases
  const aliases: Record<string, CommitType> = {
    feature: "feat",
    features: "feat",
    bugfix: "fix",
    bug: "fix",
    hotfix: "fix",
    documentation: "docs",
    doc: "docs",
    performance: "perf",
    tests: "test",
    testing: "test",
    refact: "refactor",
    maintain: "chore",
    maintenance: "chore",
    deps: "chore",
    dependency: "chore",
    dependencies: "chore",
  };

  return aliases[normalized] ?? "unknown";
}

/**
 * Parse multiple commit messages
 *
 * @param messages - Array of commit messages
 * @returns Array of parsed commits (successful parses only)
 */
export function parseCommitMessages(
  messages: Array<string | { message: string; hash?: string; date?: Date; author?: string }>,
): ParsedCommit[] {
  const results: ParsedCommit[] = [];

  for (const input of messages) {
    const message = typeof input === "string" ? input : input.message;
    const metadata = typeof input === "string" ? undefined : input;
    const result = parseCommitMessage(message, metadata);

    if (result.success) {
      results.push(result.commit);
    }
  }

  return results;
}

/**
 * Convert a parsed commit to a changelog entry
 */
export function toChangelogEntry(commit: ParsedCommit): ChangelogEntry {
  return {
    type: commit.type,
    typeLabel: COMMIT_TYPE_LABELS[commit.type],
    scope: commit.scope,
    description: commit.description,
    details: commit.body,
    breaking: commit.breaking,
    breakingNotes: commit.breakingDescription,
    hash: commit.hash,
  };
}

/**
 * Group parsed commits into a structured changelog
 *
 * @param commits - Array of parsed commits
 * @returns Grouped changelog organized by type
 */
export function groupChangelog(commits: ParsedCommit[]): GroupedChangelog {
  const result: GroupedChangelog = {
    breaking: [],
    features: [],
    fixes: [],
    performance: [],
    docs: [],
    other: {} as Record<CommitType, ChangelogEntry[]>,
    totalCount: commits.length,
  };

  for (const commit of commits) {
    const entry = toChangelogEntry(commit);

    // Add to breaking changes if applicable
    if (commit.breaking) {
      result.breaking.push(entry);
    }

    // Categorize by type
    switch (commit.type) {
      case "feat":
        result.features.push(entry);
        break;
      case "fix":
        result.fixes.push(entry);
        break;
      case "perf":
        result.performance.push(entry);
        break;
      case "docs":
        result.docs.push(entry);
        break;
      default:
        if (!result.other[commit.type]) {
          result.other[commit.type] = [];
        }
        result.other[commit.type].push(entry);
        break;
    }
  }

  return result;
}

/**
 * Filter commits by type
 *
 * @param commits - Array of parsed commits
 * @param types - Types to include
 * @returns Filtered commits
 */
export function filterByType(commits: ParsedCommit[], types: CommitType[]): ParsedCommit[] {
  const typeSet = new Set(types);
  return commits.filter((c) => typeSet.has(c.type));
}

/**
 * Filter commits by scope
 *
 * @param commits - Array of parsed commits
 * @param scopes - Scopes to include (null matches commits without scope)
 * @returns Filtered commits
 */
export function filterByScope(commits: ParsedCommit[], scopes: (string | null)[]): ParsedCommit[] {
  const scopeSet = new Set(scopes);
  return commits.filter((c) => scopeSet.has(c.scope));
}

/**
 * Get only breaking changes
 *
 * @param commits - Array of parsed commits
 * @returns Commits that are breaking changes
 */
export function getBreakingChanges(commits: ParsedCommit[]): ParsedCommit[] {
  return commits.filter((c) => c.breaking);
}

/**
 * Get unique scopes from commits
 *
 * @param commits - Array of parsed commits
 * @returns Set of unique scopes (null not included)
 */
export function getUniqueScopes(commits: ParsedCommit[]): Set<string> {
  const scopes = new Set<string>();
  for (const commit of commits) {
    if (commit.scope) {
      scopes.add(commit.scope);
    }
  }
  return scopes;
}

/**
 * Sort commits by type priority (features first, chores last)
 *
 * @param commits - Array of parsed commits
 * @returns Sorted commits
 */
export function sortByPriority(commits: ParsedCommit[]): ParsedCommit[] {
  return [...commits].sort((a, b) => {
    const priorityDiff = COMMIT_TYPE_PRIORITY[a.type] - COMMIT_TYPE_PRIORITY[b.type];
    if (priorityDiff !== 0) return priorityDiff;
    // Secondary sort by scope (null last)
    if (a.scope && !b.scope) return -1;
    if (!a.scope && b.scope) return 1;
    if (a.scope && b.scope) return a.scope.localeCompare(b.scope);
    return 0;
  });
}

/**
 * Format a changelog entry as a markdown line
 *
 * @param entry - The changelog entry
 * @param options - Formatting options
 * @returns Formatted markdown string
 */
export function formatEntry(
  entry: ChangelogEntry,
  options: { includeScope?: boolean; includeHash?: boolean; includeBreaking?: boolean } = {},
): string {
  const { includeScope = true, includeHash = true, includeBreaking = true } = options;

  let line = "- ";

  // Add breaking indicator
  if (includeBreaking && entry.breaking) {
    line += "**BREAKING:** ";
  }

  // Add scope
  if (includeScope && entry.scope) {
    line += `**${entry.scope}:** `;
  }

  // Add description
  line += entry.description;

  // Add hash
  if (includeHash && entry.hash) {
    const shortHash = entry.hash.substring(0, 7);
    line += ` (${shortHash})`;
  }

  return line;
}

/**
 * Format a grouped changelog as markdown
 *
 * @param changelog - Grouped changelog
 * @param options - Formatting options
 * @returns Formatted markdown string
 */
export function formatChangelog(
  changelog: GroupedChangelog,
  options: {
    includeScope?: boolean;
    includeHash?: boolean;
    includeEmpty?: boolean;
    title?: string;
  } = {},
): string {
  const { includeScope = true, includeHash = true, includeEmpty = false, title } = options;

  const sections: string[] = [];

  if (title) {
    sections.push(`# ${title}\n`);
  }

  // Breaking changes first
  if (changelog.breaking.length > 0) {
    sections.push("## Breaking Changes\n");
    for (const entry of changelog.breaking) {
      sections.push(formatEntry(entry, { includeScope, includeHash, includeBreaking: false }));
      if (entry.breakingNotes) {
        sections.push(`  > ${entry.breakingNotes}`);
      }
    }
    sections.push("");
  }

  // Features
  if (changelog.features.length > 0 || includeEmpty) {
    sections.push("## Features\n");
    for (const entry of changelog.features) {
      if (!entry.breaking) {
        // Already listed in breaking
        sections.push(formatEntry(entry, { includeScope, includeHash }));
      }
    }
    sections.push("");
  }

  // Fixes
  if (changelog.fixes.length > 0 || includeEmpty) {
    sections.push("## Bug Fixes\n");
    for (const entry of changelog.fixes) {
      if (!entry.breaking) {
        sections.push(formatEntry(entry, { includeScope, includeHash }));
      }
    }
    sections.push("");
  }

  // Performance
  if (changelog.performance.length > 0) {
    sections.push("## Performance\n");
    for (const entry of changelog.performance) {
      if (!entry.breaking) {
        sections.push(formatEntry(entry, { includeScope, includeHash }));
      }
    }
    sections.push("");
  }

  // Documentation
  if (changelog.docs.length > 0) {
    sections.push("## Documentation\n");
    for (const entry of changelog.docs) {
      sections.push(formatEntry(entry, { includeScope, includeHash }));
    }
    sections.push("");
  }

  // Other categories
  const otherTypes = Object.keys(changelog.other) as CommitType[];
  const sortedOtherTypes = otherTypes.sort(
    (a, b) => COMMIT_TYPE_PRIORITY[a] - COMMIT_TYPE_PRIORITY[b],
  );

  for (const type of sortedOtherTypes) {
    const entries = changelog.other[type];
    if (entries.length > 0) {
      sections.push(`## ${COMMIT_TYPE_LABELS[type]}\n`);
      for (const entry of entries) {
        if (!entry.breaking) {
          sections.push(formatEntry(entry, { includeScope, includeHash }));
        }
      }
      sections.push("");
    }
  }

  return sections.join("\n").trim();
}

/**
 * Parse a git log output into structured commits
 *
 * Expected format (from `git log --format="%H%n%s%n%b%n---COMMIT---"`):
 * <hash>
 * <subject>
 * <body>
 * ---COMMIT---
 *
 * @param gitLog - Raw git log output
 * @returns Array of parsed commits
 */
export function parseGitLog(gitLog: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  const entries = gitLog.split("---COMMIT---").filter((e) => e.trim());

  for (const entry of entries) {
    const lines = entry.trim().split(/\r?\n/);
    if (lines.length < 2) continue;

    const hash = lines[0].trim();
    const subject = lines[1].trim();
    const body = lines.slice(2).join("\n").trim() || null;

    const message = body ? `${subject}\n\n${body}` : subject;
    const result = parseCommitMessage(message, { hash });

    if (result.success) {
      commits.push(result.commit);
    }
  }

  return commits;
}

/**
 * Parse a CHANGELOG.md file to extract version entries
 *
 * Supports common formats:
 * - ## [1.0.0] - 2024-01-01
 * - ## 1.0.0 (2024-01-01)
 * - ## v1.0.0
 *
 * @param changelog - Raw changelog content
 * @returns Map of version to entries
 */
export function parseChangelogFile(changelog: string): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  const versionPattern = /^##\s+\[?v?(\d+\.\d+\.\d+[^\]]*)\]?/;

  let currentVersion: string | null = null;
  let currentEntries: string[] = [];

  for (const line of changelog.split(/\r?\n/)) {
    const versionMatch = line.match(versionPattern);

    if (versionMatch) {
      // Save previous version's entries
      if (currentVersion) {
        versions.set(currentVersion, currentEntries);
      }

      currentVersion = versionMatch[1];
      currentEntries = [];
    } else if (currentVersion && line.startsWith("- ")) {
      currentEntries.push(line.substring(2).trim());
    }
  }

  // Save last version
  if (currentVersion) {
    versions.set(currentVersion, currentEntries);
  }

  return versions;
}

/**
 * Extract feature descriptions suitable for user-facing summaries
 *
 * @param commits - Array of parsed commits
 * @returns Array of feature descriptions
 */
export function extractFeatureDescriptions(commits: ParsedCommit[]): string[] {
  return commits
    .filter((c) => c.type === "feat")
    .map((c) => {
      let desc = c.description;
      // Capitalize first letter
      desc = desc.charAt(0).toUpperCase() + desc.slice(1);
      // Add scope context if present
      if (c.scope) {
        desc = `[${c.scope}] ${desc}`;
      }
      return desc;
    });
}

/**
 * Generate a summary of changes
 *
 * @param commits - Array of parsed commits
 * @returns Human-readable summary
 */
export function generateSummary(commits: ParsedCommit[]): string {
  const grouped = groupChangelog(commits);
  const parts: string[] = [];

  if (grouped.breaking.length > 0) {
    parts.push(`${grouped.breaking.length} breaking change(s)`);
  }

  if (grouped.features.length > 0) {
    parts.push(`${grouped.features.length} new feature(s)`);
  }

  if (grouped.fixes.length > 0) {
    parts.push(`${grouped.fixes.length} bug fix(es)`);
  }

  if (grouped.performance.length > 0) {
    parts.push(`${grouped.performance.length} performance improvement(s)`);
  }

  const otherCount = Object.values(grouped.other).reduce((sum, arr) => sum + arr.length, 0);
  if (otherCount > 0) {
    parts.push(`${otherCount} other change(s)`);
  }

  if (parts.length === 0) {
    return "No changes";
  }

  return parts.join(", ");
}
