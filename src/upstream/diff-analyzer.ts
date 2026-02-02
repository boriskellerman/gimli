/**
 * Diff analyzer for categorizing upstream changes
 *
 * This module analyzes git diffs from upstream repositories to categorize
 * changes by type (feature, bugfix, security, breaking, refactor, docs, etc.)
 * to help prioritize what to sync.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Primary change category
 */
export type ChangeCategory =
  | "feature"
  | "bugfix"
  | "security"
  | "breaking"
  | "refactor"
  | "docs"
  | "test"
  | "chore"
  | "performance"
  | "dependency";

/**
 * Priority level for changes
 */
export type ChangePriority = "critical" | "high" | "medium" | "low";

/**
 * Confidence level for category detection
 */
export type DetectionConfidence = "high" | "medium" | "low";

/**
 * A single file change within a diff
 */
export interface FileChange {
  /** File path */
  path: string;
  /** Change type: added, deleted, modified, renamed */
  changeType: "added" | "deleted" | "modified" | "renamed";
  /** Old path (for renames) */
  oldPath?: string;
  /** Lines added */
  additions: number;
  /** Lines deleted */
  deletions: number;
  /** The actual diff hunks */
  hunks: DiffHunk[];
}

/**
 * A diff hunk (section of changes)
 */
export interface DiffHunk {
  /** Starting line in old file */
  oldStart: number;
  /** Number of lines in old file */
  oldLines: number;
  /** Starting line in new file */
  newStart: number;
  /** Number of lines in new file */
  newLines: number;
  /** The actual diff content */
  content: string;
}

/**
 * Analysis result for a single file
 */
export interface FileAnalysis {
  /** File path */
  path: string;
  /** Detected categories for this file */
  categories: ChangeCategory[];
  /** Security signals detected */
  securitySignals: SecuritySignal[];
  /** Breaking change signals */
  breakingSignals: BreakingSignal[];
  /** Overall confidence */
  confidence: DetectionConfidence;
  /** Number of lines added */
  additions?: number;
  /** Number of lines deleted */
  deletions?: number;
}

/**
 * Security signal detected in a diff
 */
export interface SecuritySignal {
  /** Type of security concern */
  type:
    | "authentication"
    | "authorization"
    | "encryption"
    | "input-validation"
    | "secrets"
    | "vulnerability-fix"
    | "dependency-security";
  /** Description of the signal */
  description: string;
  /** Line number in diff (if applicable) */
  line?: number;
  /** Severity assessment */
  severity: "critical" | "high" | "medium" | "low";
}

/**
 * Breaking change signal detected in a diff
 */
export interface BreakingSignal {
  /** Type of breaking change */
  type:
    | "api-removal"
    | "api-signature"
    | "behavior-change"
    | "type-change"
    | "config-change"
    | "dependency-major";
  /** Description of the signal */
  description: string;
  /** Line number in diff (if applicable) */
  line?: number;
}

/**
 * Complete analysis result for a commit or PR
 */
export interface DiffAnalysis {
  /** Overall primary category */
  primaryCategory: ChangeCategory;
  /** All detected categories */
  categories: ChangeCategory[];
  /** Is this a security-related change? */
  isSecurity: boolean;
  /** Is this a breaking change? */
  isBreaking: boolean;
  /** Priority for syncing */
  priority: ChangePriority;
  /** Overall confidence */
  confidence: DetectionConfidence;
  /** Per-file analysis */
  files: FileAnalysis[];
  /** All security signals */
  securitySignals: SecuritySignal[];
  /** All breaking signals */
  breakingSignals: BreakingSignal[];
  /** Summary description */
  summary: string;
}

/**
 * Input for diff analysis
 */
export interface DiffInput {
  /** Raw diff content (unified diff format) */
  diff: string;
  /** Commit message (if available) */
  commitMessage?: string;
  /** PR title (if available) */
  prTitle?: string;
  /** PR body/description (if available) */
  prBody?: string;
  /** Labels (if available) */
  labels?: string[];
}

// ============================================================================
// Detection Patterns
// ============================================================================

// Security-related patterns in code
const SECURITY_CODE_PATTERNS = [
  // Authentication/Authorization
  {
    pattern: /(?:auth|login|logout|session|token|jwt|oauth|saml)/i,
    type: "authentication" as const,
  },
  {
    pattern: /(?:permission|rbac|acl|role|privilege|access.?control)/i,
    type: "authorization" as const,
  },
  // Encryption/Crypto
  {
    pattern: /(?:encrypt|decrypt|hash|bcrypt|argon|scrypt|pbkdf|cipher)/i,
    type: "encryption" as const,
  },
  { pattern: /(?:crypto|hmac|signature|sign|verify)/i, type: "encryption" as const },
  // Input validation
  {
    pattern: /(?:sanitize|escape|validate|xss|injection|sqli)/i,
    type: "input-validation" as const,
  },
  { pattern: /(?:csp|cors|csrf|nonce|origin)/i, type: "input-validation" as const },
  // Secrets
  { pattern: /(?:secret|password|credential|api.?key|private.?key)/i, type: "secrets" as const },
  { pattern: /(?:\.env|secrets?\.|credentials?\.)/i, type: "secrets" as const },
];

// Security-related patterns in commit messages
const SECURITY_MESSAGE_PATTERNS = [
  { pattern: /\bsecurity\b/i, type: "vulnerability-fix" as const, severity: "high" as const },
  {
    pattern: /\bvulnerability\b/i,
    type: "vulnerability-fix" as const,
    severity: "critical" as const,
  },
  {
    pattern: /\bcve-\d{4}-\d+/i,
    type: "vulnerability-fix" as const,
    severity: "critical" as const,
  },
  {
    pattern: /\bfix(?:es)?\s+(?:xss|injection|csrf)/i,
    type: "vulnerability-fix" as const,
    severity: "high" as const,
  },
  { pattern: /\bdependabot\b/i, type: "dependency-security" as const, severity: "medium" as const },
  {
    pattern: /\bsecurity\s+update/i,
    type: "dependency-security" as const,
    severity: "high" as const,
  },
];

// Breaking change patterns in code
const BREAKING_CODE_PATTERNS = [
  // Function/method removal or signature changes (look for removed exports)
  { pattern: /^-\s*(?:export\s+)?(?:async\s+)?function\s+\w+/m, type: "api-removal" as const },
  { pattern: /^-\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=/m, type: "api-removal" as const },
  { pattern: /^-\s*(?:export\s+)?class\s+\w+/m, type: "api-removal" as const },
  { pattern: /^-\s*(?:export\s+)?interface\s+\w+/m, type: "type-change" as const },
  { pattern: /^-\s*(?:export\s+)?type\s+\w+/m, type: "type-change" as const },
];

// Breaking change patterns in commit messages
const BREAKING_MESSAGE_PATTERNS = [
  { pattern: /\bBREAKING\s*(?:CHANGE)?:?/i, type: "behavior-change" as const },
  {
    pattern:
      /\b(?:removes?|deprecates?)\s+(?:deprecated\s+)?(?:support|api|function|method|endpoint)/i,
    type: "api-removal" as const,
  },
  { pattern: /\brename[sd]?\s+(?:api|function|method|class)/i, type: "api-signature" as const },
  { pattern: /\bmigration\s+(?:is\s+)?required/i, type: "config-change" as const },
  { pattern: /\brequires?\s+(?:a\s+)?migration/i, type: "config-change" as const },
  { pattern: /\bupgrade[sd]?\s+(?:major|breaking)/i, type: "dependency-major" as const },
];

// Category detection patterns for commit messages
const CATEGORY_MESSAGE_PATTERNS: Array<{ pattern: RegExp; category: ChangeCategory }> = [
  // Feature (including feat!: for breaking features)
  { pattern: /^feat(?:\(.+\))?!?:/i, category: "feature" },
  {
    pattern: /\b(?:add|implement|introduce|new)\s+(?:feature|support|functionality)/i,
    category: "feature",
  },
  // Bugfix
  { pattern: /^fix(?:\(.+\))?:/i, category: "bugfix" },
  {
    pattern: /\b(?:fix|fixes|fixed|resolve|resolves|resolved|close|closes|closed)\s+#?\d+/i,
    category: "bugfix",
  },
  { pattern: /\b(?:bugfix|hotfix|patch)\b/i, category: "bugfix" },
  // Refactor
  { pattern: /^refactor(?:\(.+\))?:/i, category: "refactor" },
  { pattern: /\b(?:refactor|restructure|reorganize|cleanup|clean.?up)\b/i, category: "refactor" },
  // Docs
  { pattern: /^docs(?:\(.+\))?:/i, category: "docs" },
  { pattern: /\b(?:documentation|readme|doc|docs)\b/i, category: "docs" },
  // Test
  { pattern: /^test(?:\(.+\))?:/i, category: "test" },
  { pattern: /\b(?:test|tests|testing|spec|specs)\b/i, category: "test" },
  // Chore
  { pattern: /^chore(?:\(.+\))?:/i, category: "chore" },
  { pattern: /\b(?:chore|maintenance|housekeeping)\b/i, category: "chore" },
  // Performance
  { pattern: /^perf(?:\(.+\))?:/i, category: "performance" },
  {
    pattern: /\b(?:performance|perf|optimize|optimization|speed|faster)\b/i,
    category: "performance",
  },
  // Dependency
  { pattern: /^(?:deps|build)(?:\(.+\))?:/i, category: "dependency" },
  {
    pattern: /\b(?:upgrade|update|bump)\s+(?:dependencies?|deps?|packages?|version)/i,
    category: "dependency",
  },
];

// File path patterns for category hints
const FILE_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: ChangeCategory }> = [
  // Test files
  { pattern: /\.(?:test|spec)\.[jt]sx?$/i, category: "test" },
  { pattern: /(?:__tests__|__mocks__|test|tests|spec|specs)\//i, category: "test" },
  // Documentation
  { pattern: /\.(?:md|mdx|rst|txt)$/i, category: "docs" },
  { pattern: /(?:docs?|documentation)\//i, category: "docs" },
  { pattern: /^readme/i, category: "docs" },
  // Config/Chore
  { pattern: /\.(?:json|ya?ml|toml|ini|conf|config)$/i, category: "chore" },
  { pattern: /(?:\.github|\.circleci|\.gitlab)/i, category: "chore" },
  { pattern: /(?:eslint|prettier|babel|webpack|rollup|vite)/i, category: "chore" },
  // Dependencies
  { pattern: /(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml)/i, category: "dependency" },
  { pattern: /(?:requirements\.txt|Gemfile|Cargo\.toml|go\.mod)/i, category: "dependency" },
];

// ============================================================================
// Parser Functions
// ============================================================================

/**
 * Parse a unified diff into structured file changes
 */
export function parseDiff(diff: string): FileChange[] {
  const files: FileChange[] = [];
  const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  const hunkPattern = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/gm;

  let match: RegExpExecArray | null;
  const fileMatches: Array<{ start: number; oldPath: string; newPath: string }> = [];

  // Find all file headers
  while ((match = filePattern.exec(diff)) !== null) {
    fileMatches.push({
      start: match.index,
      oldPath: match[1],
      newPath: match[2],
    });
  }

  // Process each file
  for (let i = 0; i < fileMatches.length; i++) {
    const fileMatch = fileMatches[i];
    const nextStart = i < fileMatches.length - 1 ? fileMatches[i + 1].start : diff.length;
    const fileContent = diff.slice(fileMatch.start, nextStart);

    // Determine change type
    let changeType: FileChange["changeType"] = "modified";
    if (fileContent.includes("new file mode")) {
      changeType = "added";
    } else if (fileContent.includes("deleted file mode")) {
      changeType = "deleted";
    } else if (fileMatch.oldPath !== fileMatch.newPath) {
      changeType = "renamed";
    }

    // Parse hunks
    const hunks: DiffHunk[] = [];
    let hunkMatch: RegExpExecArray | null;
    const localHunkPattern = new RegExp(hunkPattern.source, "gm");

    while ((hunkMatch = localHunkPattern.exec(fileContent)) !== null) {
      const hunkStart = hunkMatch.index + hunkMatch[0].length;
      const nextHunk = localHunkPattern.exec(fileContent);
      localHunkPattern.lastIndex = hunkMatch.index + hunkMatch[0].length;

      const hunkEnd = nextHunk ? nextHunk.index : fileContent.length;
      const hunkContent = fileContent.slice(hunkStart, hunkEnd);

      hunks.push({
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: parseInt(hunkMatch[2] || "1", 10),
        newStart: parseInt(hunkMatch[3], 10),
        newLines: parseInt(hunkMatch[4] || "1", 10),
        content: hunkContent,
      });
    }

    // Count additions and deletions
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      const lines = hunk.content.split("\n");
      for (const line of lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    files.push({
      path: fileMatch.newPath,
      changeType,
      oldPath: changeType === "renamed" ? fileMatch.oldPath : undefined,
      additions,
      deletions,
      hunks,
    });
  }

  return files;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Detect security signals in a file change
 */
function detectSecuritySignals(file: FileChange): SecuritySignal[] {
  const signals: SecuritySignal[] = [];

  for (const hunk of file.hunks) {
    const lines = hunk.content.split("\n");
    let lineNumber = hunk.newStart;

    for (const line of lines) {
      // Only analyze added lines
      if (line.startsWith("+") && !line.startsWith("+++")) {
        for (const { pattern, type } of SECURITY_CODE_PATTERNS) {
          if (pattern.test(line)) {
            signals.push({
              type,
              description: `Security-related code change: ${type}`,
              line: lineNumber,
              severity: "medium",
            });
            break; // One signal per line
          }
        }
        lineNumber++;
      } else if (!line.startsWith("-")) {
        lineNumber++;
      }
    }
  }

  return deduplicateSignals(signals);
}

/**
 * Detect breaking change signals in a file change
 */
function detectBreakingSignals(file: FileChange): BreakingSignal[] {
  const signals: BreakingSignal[] = [];
  const fullContent = file.hunks.map((h) => h.content).join("\n");

  for (const { pattern, type } of BREAKING_CODE_PATTERNS) {
    if (pattern.test(fullContent)) {
      signals.push({
        type,
        description: `Potential breaking change: ${type}`,
      });
    }
  }

  return signals;
}

/**
 * Analyze a single file change
 */
function analyzeFile(file: FileChange): FileAnalysis {
  const categories: ChangeCategory[] = [];
  let confidence: DetectionConfidence = "medium";

  // Check file path patterns
  for (const { pattern, category } of FILE_CATEGORY_PATTERNS) {
    if (pattern.test(file.path)) {
      if (!categories.includes(category)) {
        categories.push(category);
      }
    }
  }

  // Detect security signals
  const securitySignals = detectSecuritySignals(file);
  if (securitySignals.length > 0) {
    if (!categories.includes("security")) {
      categories.unshift("security"); // High priority
    }
    confidence = "high";
  }

  // Detect breaking signals
  const breakingSignals = detectBreakingSignals(file);
  if (breakingSignals.length > 0) {
    if (!categories.includes("breaking")) {
      categories.unshift("breaking"); // High priority
    }
    confidence = "high";
  }

  // Default to feature/refactor based on change type and size
  if (categories.length === 0) {
    if (file.changeType === "added" && file.additions > 50) {
      categories.push("feature");
    } else if (file.changeType === "modified" && file.deletions > file.additions) {
      categories.push("refactor");
    } else {
      categories.push("chore");
    }
    confidence = "low";
  }

  return {
    path: file.path,
    categories,
    securitySignals,
    breakingSignals,
    confidence,
  };
}

/**
 * Detect categories from commit message and metadata
 */
function detectCategoriesFromMessage(input: DiffInput): ChangeCategory[] {
  const categories: ChangeCategory[] = [];
  const text = [input.commitMessage, input.prTitle, input.prBody].filter(Boolean).join(" ");

  // Check conventional commit prefixes and patterns
  for (const { pattern, category } of CATEGORY_MESSAGE_PATTERNS) {
    if (pattern.test(text)) {
      if (!categories.includes(category)) {
        categories.push(category);
      }
    }
  }

  // Check labels
  if (input.labels) {
    for (const label of input.labels) {
      const normalized = label.toLowerCase();
      if (normalized.includes("bug") || normalized.includes("fix")) {
        if (!categories.includes("bugfix")) categories.push("bugfix");
      }
      if (normalized.includes("feature") || normalized.includes("enhancement")) {
        if (!categories.includes("feature")) categories.push("feature");
      }
      if (normalized.includes("security")) {
        if (!categories.includes("security")) categories.unshift("security");
      }
      if (normalized.includes("breaking")) {
        if (!categories.includes("breaking")) categories.unshift("breaking");
      }
      if (normalized.includes("docs") || normalized.includes("documentation")) {
        if (!categories.includes("docs")) categories.push("docs");
      }
    }
  }

  return categories;
}

/**
 * Detect security signals from commit message
 */
function detectSecurityFromMessage(input: DiffInput): SecuritySignal[] {
  const signals: SecuritySignal[] = [];
  const text = [input.commitMessage, input.prTitle, input.prBody].filter(Boolean).join(" ");

  for (const { pattern, type, severity } of SECURITY_MESSAGE_PATTERNS) {
    if (pattern.test(text)) {
      signals.push({
        type,
        description: `Security indicator in commit message`,
        severity,
      });
    }
  }

  return deduplicateSignals(signals);
}

/**
 * Detect breaking signals from commit message
 */
function detectBreakingFromMessage(input: DiffInput): BreakingSignal[] {
  const signals: BreakingSignal[] = [];
  const text = [input.commitMessage, input.prTitle, input.prBody].filter(Boolean).join(" ");

  for (const { pattern, type } of BREAKING_MESSAGE_PATTERNS) {
    if (pattern.test(text)) {
      signals.push({
        type,
        description: `Breaking change indicator in commit message`,
      });
    }
  }

  return signals;
}

/**
 * Determine priority based on analysis
 */
function determinePriority(
  categories: ChangeCategory[],
  isSecurity: boolean,
  isBreaking: boolean,
  securitySignals: SecuritySignal[],
): ChangePriority {
  // Critical: security vulnerabilities
  if (isSecurity && securitySignals.some((s) => s.severity === "critical")) {
    return "critical";
  }

  // High: security fixes, breaking changes, high-severity security
  if (isSecurity || isBreaking) {
    return "high";
  }

  // High: bugfixes
  if (categories.includes("bugfix")) {
    return "high";
  }

  // Medium: features, performance
  if (categories.includes("feature") || categories.includes("performance")) {
    return "medium";
  }

  // Low: docs, tests, chores, refactors
  return "low";
}

/**
 * Generate a summary of the analysis
 */
function generateSummary(
  primaryCategory: ChangeCategory,
  categories: ChangeCategory[],
  isSecurity: boolean,
  isBreaking: boolean,
  fileCount: number,
): string {
  const parts: string[] = [];

  if (isSecurity) {
    parts.push("Security-related");
  }
  if (isBreaking) {
    parts.push("Breaking");
  }

  parts.push(primaryCategory);

  if (categories.length > 1) {
    const others = categories.filter((c) => c !== primaryCategory).slice(0, 2);
    if (others.length > 0) {
      parts.push(`(also: ${others.join(", ")})`);
    }
  }

  parts.push(`affecting ${fileCount} file${fileCount === 1 ? "" : "s"}`);

  return parts.join(" ");
}

/**
 * Deduplicate security signals by type
 */
function deduplicateSignals(signals: SecuritySignal[]): SecuritySignal[] {
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = s.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Determine overall confidence from file analyses
 */
function determineOverallConfidence(
  files: FileAnalysis[],
  messageCategories: ChangeCategory[],
): DetectionConfidence {
  // High confidence if we have message-based detection
  if (messageCategories.length > 0) {
    return "high";
  }

  // Check file confidences
  const highCount = files.filter((f) => f.confidence === "high").length;
  const mediumCount = files.filter((f) => f.confidence === "medium").length;

  if (highCount > files.length / 2) return "high";
  if (mediumCount > files.length / 2) return "medium";
  return "low";
}

// ============================================================================
// Main Analysis Function
// ============================================================================

/**
 * Analyze a diff and categorize the changes
 *
 * This is the main entry point for diff analysis. It parses the diff,
 * analyzes each file, and combines the results with commit message
 * analysis to produce a comprehensive categorization.
 */
export function analyzeDiff(input: DiffInput): DiffAnalysis {
  // Parse the diff
  const fileChanges = parseDiff(input.diff);

  // Analyze each file
  const fileAnalyses = fileChanges.map(analyzeFile);

  // Detect categories from commit message
  const messageCategories = detectCategoriesFromMessage(input);

  // Collect all categories
  const allCategories = new Set<ChangeCategory>();
  for (const cat of messageCategories) {
    allCategories.add(cat);
  }
  for (const file of fileAnalyses) {
    for (const cat of file.categories) {
      allCategories.add(cat);
    }
  }

  // Detect security signals
  const messageSecuritySignals = detectSecurityFromMessage(input);
  const allSecuritySignals = [
    ...messageSecuritySignals,
    ...fileAnalyses.flatMap((f) => f.securitySignals),
  ];
  const isSecurity = allSecuritySignals.length > 0;
  if (isSecurity) {
    allCategories.add("security");
  }

  // Detect breaking signals
  const messageBreakingSignals = detectBreakingFromMessage(input);
  const allBreakingSignals = [
    ...messageBreakingSignals,
    ...fileAnalyses.flatMap((f) => f.breakingSignals),
  ];
  const isBreaking = allBreakingSignals.length > 0;
  if (isBreaking) {
    allCategories.add("breaking");
  }

  // Determine categories array with priority ordering
  const categoryPriority: ChangeCategory[] = [
    "security",
    "breaking",
    "bugfix",
    "feature",
    "performance",
    "refactor",
    "dependency",
    "test",
    "docs",
    "chore",
  ];
  const categories = categoryPriority.filter((c) => allCategories.has(c));

  // Determine primary category (first in priority order)
  const primaryCategory = categories[0] || "chore";

  // Determine priority
  const priority = determinePriority(categories, isSecurity, isBreaking, allSecuritySignals);

  // Determine confidence
  const confidence = determineOverallConfidence(fileAnalyses, messageCategories);

  // Generate summary
  const summary = generateSummary(
    primaryCategory,
    categories,
    isSecurity,
    isBreaking,
    fileChanges.length,
  );

  return {
    primaryCategory,
    categories,
    isSecurity,
    isBreaking,
    priority,
    confidence,
    files: fileAnalyses,
    securitySignals: deduplicateSignals(allSecuritySignals),
    breakingSignals: allBreakingSignals,
    summary,
  };
}

/**
 * Quick check if a diff likely contains security changes
 *
 * Lightweight check for prioritization before full analysis.
 */
export function hasSecurityIndicators(input: DiffInput): boolean {
  const text = [input.diff, input.commitMessage, input.prTitle, input.prBody]
    .filter(Boolean)
    .join(" ");

  for (const { pattern } of SECURITY_MESSAGE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  for (const { pattern } of SECURITY_CODE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}

/**
 * Quick check if a diff likely contains breaking changes
 *
 * Lightweight check for prioritization before full analysis.
 */
export function hasBreakingIndicators(input: DiffInput): boolean {
  const text = [input.diff, input.commitMessage, input.prTitle, input.prBody]
    .filter(Boolean)
    .join(" ");

  for (const { pattern } of BREAKING_MESSAGE_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  return false;
}
