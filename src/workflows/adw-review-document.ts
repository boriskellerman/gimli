/**
 * Review-Document AI Developer Workflow (ADW)
 *
 * A two-stage workflow that:
 * 1. Reviews: Analyzes code changes, identifies issues, generates feedback
 * 2. Documents: Extracts learnings, updates architecture docs, maintains expertise
 *
 * This workflow supports continuous learning by extracting knowledge from reviews.
 */

import {
  type ADWDefinition,
  type ADWContext,
  type ADWResult,
  type StageConfig,
  type TriggerType,
  type ADWLogger,
  DEFAULT_RETRY_CONFIG,
  executeADW,
  createConsoleLogger,
  createFileLogger,
} from "./adw-base.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for the review-document workflow
 */
export interface ReviewDocumentInput {
  /** Type of review */
  reviewType: "pr" | "commit" | "diff" | "codebase";
  /** The diff or changes to review */
  changes: string;
  /** PR number if applicable */
  prNumber?: number;
  /** Commit SHA if applicable */
  commitSha?: string;
  /** PR/commit title */
  title?: string;
  /** PR/commit description */
  description?: string;
  /** Files changed */
  filesChanged?: string[];
  /** Focus areas for review */
  focusAreas?: Array<"security" | "performance" | "maintainability" | "testing" | "documentation">;
  /** Whether to generate documentation updates */
  generateDocs?: boolean;
  /** Path to architecture docs to update */
  docsPath?: string;
  /** Path to expertise files to update */
  expertisePath?: string;
}

/**
 * Review finding from the review stage
 */
export interface ReviewFinding {
  /** Unique finding ID */
  id: string;
  /** Severity level */
  severity: "critical" | "major" | "minor" | "suggestion";
  /** Category of the finding */
  category: "security" | "bug" | "performance" | "maintainability" | "style" | "documentation";
  /** File and line (if applicable) */
  location?: {
    file: string;
    line?: number;
    endLine?: number;
  };
  /** Description of the issue */
  description: string;
  /** Suggested fix */
  suggestion?: string;
  /** Code example if applicable */
  codeExample?: string;
}

/**
 * Complete code review from the review stage
 */
export interface CodeReview {
  /** Overall summary */
  summary: string;
  /** Overall assessment */
  assessment: "approve" | "request_changes" | "comment";
  /** List of findings */
  findings: ReviewFinding[];
  /** Strengths identified */
  strengths: string[];
  /** Patterns observed (good or bad) */
  patterns: Array<{
    pattern: string;
    type: "good" | "bad";
    description: string;
  }>;
  /** Overall quality score (0-100) */
  qualityScore: number;
  /** Confidence in the review */
  confidence: number;
}

/**
 * Documentation update from the document stage
 */
export interface DocumentationUpdate {
  /** Type of update */
  type: "architecture" | "api" | "pattern" | "decision" | "expertise";
  /** File to update */
  file: string;
  /** Section to update */
  section?: string;
  /** Content to add or modify */
  content: string;
  /** Reason for the update */
  reason: string;
}

/**
 * Learning extracted from the review
 */
export interface ExtractedLearning {
  /** Learning category */
  category: "pattern" | "anti-pattern" | "best-practice" | "decision" | "context";
  /** Title of the learning */
  title: string;
  /** Detailed description */
  description: string;
  /** Related files or components */
  relatedTo: string[];
  /** Confidence level */
  confidence: "high" | "medium" | "low";
  /** Whether this should update expertise files */
  shouldPersist: boolean;
}

/**
 * Documentation result from the document stage
 */
export interface DocumentationResult {
  /** Updates to make */
  updates: DocumentationUpdate[];
  /** Learnings extracted */
  learnings: ExtractedLearning[];
  /** Summary of changes */
  summary: string;
}

// ============================================================================
// Stage Definitions
// ============================================================================

const REVIEW_STAGE: StageConfig = {
  id: "review",
  name: "Code Review",
  description: "Analyze code changes and identify issues",
  agent: {
    thinking: "high",
    systemPromptAdditions: `You are an expert code reviewer with deep knowledge of software best practices.

Your job is to:
1. Analyze the code changes thoroughly
2. Identify bugs, security issues, and performance problems
3. Assess code quality and maintainability
4. Recognize good patterns and potential improvements
5. Provide actionable feedback

Focus areas:
- Security vulnerabilities (injection, auth issues, data exposure)
- Bugs and logic errors
- Performance bottlenecks
- Code clarity and maintainability
- Test coverage and quality
- Documentation completeness

For each finding:
- Assign a severity (critical/major/minor/suggestion)
- Explain the issue clearly
- Provide a concrete suggestion for improvement
- Include code examples when helpful

Also identify:
- Strengths and good patterns to encourage
- Recurring patterns (good or bad) in the codebase
- Overall quality assessment

Be constructive and educational, not just critical.`,
  },
  timeoutSeconds: 300,
  required: true,
};

const DOCUMENT_STAGE: StageConfig = {
  id: "document",
  name: "Extract Learnings",
  description: "Extract learnings and update documentation",
  agent: {
    thinking: "medium",
    systemPromptAdditions: `You are extracting learnings and updating documentation based on a code review.

Your job is to:
1. Extract reusable patterns and anti-patterns from the review
2. Identify decisions that should be documented
3. Update architecture documentation if needed
4. Maintain expertise files for future reference

Focus on:
- Patterns that could apply elsewhere in the codebase
- Decisions that explain "why" something is done a certain way
- Context that would help future developers
- Best practices specific to this codebase

For each learning:
- Categorize it appropriately
- Describe it clearly and concisely
- Note what it relates to (files, components, concepts)
- Assess confidence and whether it should be persisted

Documentation updates should:
- Be specific and actionable
- Include the reason for the update
- Reference the relevant review findings`,
  },
  timeoutSeconds: 300,
  required: false,
  dependsOn: ["review"],
};

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Create the review-document workflow definition
 */
export function createReviewDocumentDefinition(options?: Partial<ADWDefinition>): ADWDefinition {
  return {
    id: "review-document",
    name: "Review and Document",
    description: "Review code changes and extract learnings for documentation",
    version: "1.0.0",
    stages: [REVIEW_STAGE, DOCUMENT_STAGE],
    retryConfig: {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
    },
    totalTimeoutSeconds: 900, // 15 minutes
    tags: ["review", "documentation", "learning"],
    ...options,
  };
}

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build the prompt for the review stage
 */
function buildReviewPrompt(input: ReviewDocumentInput): string {
  const lines: string[] = [
    "# Code Review Request",
    "",
    `## Review Type: ${input.reviewType.toUpperCase()}`,
    "",
  ];

  if (input.title) {
    lines.push(`## Title: ${input.title}`, "");
  }

  if (input.description) {
    lines.push("## Description", input.description, "");
  }

  if (input.prNumber) {
    lines.push(`**PR Number**: #${input.prNumber}`, "");
  }

  if (input.commitSha) {
    lines.push(`**Commit**: ${input.commitSha}`, "");
  }

  if (input.filesChanged && input.filesChanged.length > 0) {
    lines.push("## Files Changed");
    for (const file of input.filesChanged) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (input.focusAreas && input.focusAreas.length > 0) {
    lines.push("## Focus Areas");
    for (const area of input.focusAreas) {
      lines.push(`- ${area}`);
    }
    lines.push("");
  }

  lines.push("## Changes to Review", "```diff", input.changes, "```", "");

  lines.push(
    "## Instructions",
    "Perform a thorough code review of the changes above.",
    "",
    "Provide:",
    "1. Overall summary and assessment (approve/request_changes/comment)",
    "2. List of findings with severity, category, and suggestions",
    "3. Identified strengths and good patterns",
    "4. Quality score (0-100)",
    "",
    "Be thorough but constructive.",
  );

  return lines.join("\n");
}

/**
 * Build the prompt for the document stage
 */
function buildDocumentPrompt(input: ReviewDocumentInput, context: ADWContext): string {
  const reviewResult = context.stageResults.get("review");
  const reviewOutput = reviewResult?.output || "No review available";

  const lines: string[] = [
    "# Extract Learnings and Update Documentation",
    "",
    "## Code Review Summary",
    reviewOutput,
    "",
  ];

  if (input.filesChanged && input.filesChanged.length > 0) {
    lines.push("## Files Reviewed");
    for (const file of input.filesChanged) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  lines.push(
    "## Instructions",
    "Based on the review above, extract learnings and identify documentation updates.",
    "",
  );

  if (input.generateDocs) {
    lines.push("### Documentation Updates", "Identify any updates needed for:");

    if (input.docsPath) {
      lines.push(`- Architecture docs at: ${input.docsPath}`);
    }
    if (input.expertisePath) {
      lines.push(`- Expertise files at: ${input.expertisePath}`);
    }
    lines.push("");
  }

  lines.push(
    "### Learning Extraction",
    "Extract:",
    "- Reusable patterns (good and bad)",
    "- Important decisions and their rationale",
    "- Context that would help future developers",
    "- Best practices specific to this codebase",
    "",
    "For each learning, note:",
    "- Category (pattern/anti-pattern/best-practice/decision/context)",
    "- Clear description",
    "- Related files/components",
    "- Confidence level",
    "- Whether it should be persisted to expertise files",
  );

  return lines.join("\n");
}

/**
 * Build prompt for a stage based on context
 */
function buildPrompt(stage: StageConfig, context: ADWContext): string {
  const input = context.input as unknown as ReviewDocumentInput;

  switch (stage.id) {
    case "review":
      return buildReviewPrompt(input);
    case "document":
      return buildDocumentPrompt(input, context);
    default:
      throw new Error(`Unknown stage: ${stage.id}`);
  }
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute the review-document workflow
 */
export async function executeReviewDocument(
  input: ReviewDocumentInput,
  trigger: { type: TriggerType; source?: string; metadata?: Record<string, unknown> },
  options?: {
    workingDir?: string;
    logger?: ADWLogger;
    resultsDir?: string;
    logFile?: string;
  },
): Promise<ADWResult> {
  const definition = createReviewDocumentDefinition();

  // Create logger
  let logger = options?.logger;
  if (!logger) {
    logger = options?.logFile
      ? createFileLogger(options.logFile, "review-document")
      : createConsoleLogger("review-document");
  }

  return executeADW(definition, input as unknown as Record<string, unknown>, trigger, buildPrompt, {
    workingDir: options?.workingDir,
    logger,
    resultsDir: options?.resultsDir,
  });
}

// ============================================================================
// Result Parsing
// ============================================================================

/**
 * Parse code review from the review stage output
 */
export function parseCodeReview(output: string): CodeReview | null {
  try {
    // Extract summary
    const summaryMatch = output.match(
      /(?:summary|overview)[:\s]*([^\n]+(?:\n(?![#*-]|\d+\.)[^\n]+)*)/i,
    );
    const summary = summaryMatch ? summaryMatch[1].trim() : output.split("\n")[0] || "";

    // Determine assessment
    let assessment: "approve" | "request_changes" | "comment" = "comment";
    if (/\bapprove[d]?\b/i.test(output) && !/request[s]?\s*changes/i.test(output)) {
      assessment = "approve";
    } else if (/request[s]?\s*changes/i.test(output)) {
      assessment = "request_changes";
    }

    // Extract findings
    const findings: ReviewFinding[] = [];
    const findingMatches = output.matchAll(/(?:finding|issue|problem)[:\s]*([^\n]+)/gi);
    let findingId = 1;
    for (const match of findingMatches) {
      findings.push({
        id: `finding-${findingId++}`,
        severity: "minor",
        category: "maintainability",
        description: match[1].trim(),
      });
    }

    // Extract severity-based findings
    const severityPatterns = [
      { severity: "critical", pattern: /(?:critical|severe)[:\s]*([^\n]+)/gi },
      { severity: "major", pattern: /(?:major|important)[:\s]*([^\n]+)/gi },
      { severity: "minor", pattern: /(?:minor|small)[:\s]*([^\n]+)/gi },
      { severity: "suggestion", pattern: /(?:suggest|consider)[:\s]*([^\n]+)/gi },
    ] as const;

    for (const { severity, pattern } of severityPatterns) {
      const matches = output.matchAll(pattern);
      for (const match of matches) {
        const desc = match[1].trim();
        if (!findings.some((f) => f.description === desc)) {
          findings.push({
            id: `finding-${findingId++}`,
            severity,
            category: "maintainability",
            description: desc,
          });
        }
      }
    }

    // Extract strengths
    const strengths: string[] = [];
    const strengthMatches = output.matchAll(/(?:strength|good|positive)[:\s]*([^\n]+)/gi);
    for (const match of strengthMatches) {
      strengths.push(match[1].trim());
    }

    // Extract patterns
    const patterns: CodeReview["patterns"] = [];
    const goodPatternMatches = output.matchAll(/good\s*pattern[:\s]*([^\n]+)/gi);
    for (const match of goodPatternMatches) {
      patterns.push({
        pattern: match[1].trim(),
        type: "good",
        description: match[1].trim(),
      });
    }
    const badPatternMatches = output.matchAll(/(?:bad|anti)[- ]?pattern[:\s]*([^\n]+)/gi);
    for (const match of badPatternMatches) {
      patterns.push({
        pattern: match[1].trim(),
        type: "bad",
        description: match[1].trim(),
      });
    }

    // Extract quality score
    const scoreMatch = output.match(/(?:quality|score)[:\s]*(\d+)/i);
    const qualityScore = scoreMatch ? Math.min(100, parseInt(scoreMatch[1], 10)) : 70;

    return {
      summary,
      assessment,
      findings,
      strengths,
      patterns,
      qualityScore,
      confidence: 0.7,
    };
  } catch {
    return null;
  }
}

/**
 * Parse documentation result from the document stage output
 */
export function parseDocumentationResult(output: string): DocumentationResult | null {
  try {
    const updates: DocumentationUpdate[] = [];
    const learnings: ExtractedLearning[] = [];

    // Extract documentation updates
    const updateMatches = output.matchAll(
      /(?:update|change|add\s+to)[:\s]*[`"]?([^\s`"]+)[`"]?[:\s]*([^\n]+)/gi,
    );
    for (const match of updateMatches) {
      updates.push({
        type: "pattern",
        file: match[1],
        content: match[2].trim(),
        reason: "Extracted from code review",
      });
    }

    // Extract learnings
    const learningMatches = output.matchAll(
      /(?:learning|pattern|best\s*practice|decision)[:\s]*([^\n]+)/gi,
    );
    let learningId = 1;
    for (const match of learningMatches) {
      learnings.push({
        category: "pattern",
        title: `Learning ${learningId++}`,
        description: match[1].trim(),
        relatedTo: [],
        confidence: "medium",
        shouldPersist: true,
      });
    }

    // Extract summary
    const summaryMatch = output.match(/(?:summary|overview)[:\s]*([^\n]+(?:\n(?![#*-])[^\n]+)*)/i);
    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : `Extracted ${learnings.length} learnings and ${updates.length} documentation updates`;

    return {
      updates,
      learnings,
      summary,
    };
  } catch {
    return null;
  }
}

/**
 * Get structured results from a review-document execution
 */
export function getReviewDocumentResults(result: ADWResult): {
  review: CodeReview | null;
  documentation: DocumentationResult | null;
} {
  const reviewStage = result.stageResults.find((s) => s.stageId === "review");
  const documentStage = result.stageResults.find((s) => s.stageId === "document");

  return {
    review: reviewStage?.output ? parseCodeReview(reviewStage.output) : null,
    documentation: documentStage?.output ? parseDocumentationResult(documentStage.output) : null,
  };
}

/**
 * Format code review as markdown
 */
export function formatReviewAsMarkdown(review: CodeReview): string {
  const lines: string[] = [
    "# Code Review",
    "",
    `**Assessment**: ${review.assessment.toUpperCase().replace("_", " ")}`,
    `**Quality Score**: ${review.qualityScore}/100`,
    "",
    "## Summary",
    review.summary,
    "",
  ];

  if (review.findings.length > 0) {
    lines.push("## Findings", "");

    // Group by severity
    const bySeverity = {
      critical: review.findings.filter((f) => f.severity === "critical"),
      major: review.findings.filter((f) => f.severity === "major"),
      minor: review.findings.filter((f) => f.severity === "minor"),
      suggestion: review.findings.filter((f) => f.severity === "suggestion"),
    };

    for (const [severity, findings] of Object.entries(bySeverity)) {
      if (findings.length > 0) {
        lines.push(
          `### ${severity.charAt(0).toUpperCase() + severity.slice(1)} (${findings.length})`,
        );
        for (const finding of findings) {
          lines.push(`- **${finding.category}**: ${finding.description}`);
          if (finding.suggestion) {
            lines.push(`  - *Suggestion*: ${finding.suggestion}`);
          }
        }
        lines.push("");
      }
    }
  }

  if (review.strengths.length > 0) {
    lines.push("## Strengths");
    for (const strength of review.strengths) {
      lines.push(`- ${strength}`);
    }
    lines.push("");
  }

  if (review.patterns.length > 0) {
    lines.push("## Patterns Observed");
    for (const pattern of review.patterns) {
      const icon = pattern.type === "good" ? "✅" : "⚠️";
      lines.push(`- ${icon} **${pattern.type}**: ${pattern.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format learnings as YAML for expertise files
 */
export function formatLearningsAsYaml(learnings: ExtractedLearning[]): string {
  const persistable = learnings.filter((l) => l.shouldPersist);

  if (persistable.length === 0) {
    return "# No learnings to persist";
  }

  const lines: string[] = [
    "# Extracted Learnings",
    `# Generated: ${new Date().toISOString()}`,
    "",
    "learnings:",
  ];

  for (const learning of persistable) {
    lines.push(
      `  - category: ${learning.category}`,
      `    title: "${learning.title.replace(/"/g, '\\"')}"`,
      `    description: |`,
      `      ${learning.description.split("\n").join("\n      ")}`,
      `    confidence: ${learning.confidence}`,
    );

    if (learning.relatedTo.length > 0) {
      lines.push(`    related_to:`);
      for (const rel of learning.relatedTo) {
        lines.push(`      - "${rel}"`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
