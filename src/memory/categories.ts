/**
 * Memory categorization system
 *
 * Categorizes memory chunks to enable filtered retrieval and better
 * organization of stored knowledge. Categories are inferred from content
 * using keyword patterns and structural analysis.
 */

/**
 * Memory category types
 */
export type MemoryCategory = "projects" | "people" | "preferences" | "decisions" | "general";

/**
 * Category metadata attached to a memory chunk
 */
export interface CategoryMetadata {
  /** Primary category for the memory */
  category: MemoryCategory;
  /** Confidence score for the categorization (0-1) */
  confidence: number;
  /** Secondary categories that may also apply */
  secondaryCategories?: MemoryCategory[];
  /** Keywords that influenced the categorization */
  matchedKeywords?: string[];
}

/**
 * Pattern set for category detection
 */
interface CategoryPattern {
  /** Keywords that strongly indicate this category */
  strongKeywords: RegExp[];
  /** Keywords that weakly suggest this category */
  weakKeywords: RegExp[];
  /** Structural patterns (e.g., headings, list formats) */
  structuralPatterns: RegExp[];
}

/**
 * Category detection patterns
 *
 * Each category has strong keywords (high confidence), weak keywords
 * (lower confidence), and structural patterns that indicate the category.
 */
const CATEGORY_PATTERNS: Record<MemoryCategory, CategoryPattern> = {
  projects: {
    strongKeywords: [
      /\bproject\b/i,
      /\brepository\b/i,
      /\bcodebase\b/i,
      /\bapplication\b/i,
      /\bfeature\b/i,
      /\bimplementation\b/i,
      /\bdeployment\b/i,
      /\brelease\b/i,
      /\bsprint\b/i,
      /\bmilestone\b/i,
      /\bbacklog\b/i,
      /\bepic\b/i,
      /\bstory\b/i,
      /\btask\b/i,
      /\bticket\b/i,
      /\bissue\b/i,
      /\bPR\b/,
      /\bpull request\b/i,
      /\bmerge\b/i,
      /\bbranch\b/i,
      /\bcommit\b/i,
    ],
    weakKeywords: [
      /\bbuild\b/i,
      /\btest\b/i,
      /\bcode\b/i,
      /\bmodule\b/i,
      /\bcomponent\b/i,
      /\bAPI\b/,
      /\bservice\b/i,
      /\bdatabase\b/i,
      /\bschema\b/i,
      /\binfrastructure\b/i,
      /\bCI\/CD\b/i,
      /\bpipeline\b/i,
      /\bversion\b/i,
      /\bdependenc(y|ies)\b/i,
    ],
    structuralPatterns: [
      /^#+\s*project/im,
      /^#+\s*feature/im,
      /^#+\s*implementation/im,
      /^#+\s*release/im,
      /^#+\s*sprint/im,
      /^#+\s*epic/im,
      /^\s*-\s*\[[ x]\]/im, // Task checkboxes
    ],
  },
  people: {
    strongKeywords: [
      /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/, // Proper names (FirstName LastName)
      /\b@\w+\b/, // @mentions
      /\bteam\s+member\b/i,
      /\bcolleague\b/i,
      /\bcontact\b/i,
      /\bmanager\b/i,
      /\bdeveloper\b/i,
      /\bengineer\b/i,
      /\bdesigner\b/i,
      /\bstakeholder\b/i,
      /\bclient\b/i,
      /\buser\b/i,
      /\bcustomer\b/i,
      /\bvendor\b/i,
      /\bpartner\b/i,
      /\bcontributor\b/i,
    ],
    weakKeywords: [
      /\bperson\b/i,
      /\bpeople\b/i,
      /\bname\b/i,
      /\bemail\b/i,
      /\bphone\b/i,
      /\brole\b/i,
      /\btitle\b/i,
      /\bresponsib(le|ility|ilities)\b/i,
      /\bowner\b/i,
      /\blead\b/i,
      /\bhead\b/i,
    ],
    structuralPatterns: [
      /^#+\s*team/im,
      /^#+\s*contacts?/im,
      /^#+\s*people/im,
      /^#+\s*who/im,
      /\b[A-Z][a-z]+\s*:\s*[A-Z]/m, // "Name: Role" format
    ],
  },
  preferences: {
    strongKeywords: [
      /\bprefer(ence|s|red)?\b/i,
      /\bsetting(s)?\b/i,
      /\bconfiguration\b/i,
      /\boption(s)?\b/i,
      /\bdefault(s)?\b/i,
      /\bstyle\b/i,
      /\bformat(ting)?\b/i,
      /\bconvention(s)?\b/i,
      /\bstandard(s)?\b/i,
      /\bguideline(s)?\b/i,
      /\brule(s)?\b/i,
      /\bpolic(y|ies)\b/i,
      /\balways\b/i,
      /\bnever\b/i,
      /\bshould\b/i,
      /\bmust\b/i,
      /\blike(s)?\b/i,
      /\bdislike(s)?\b/i,
      /\bfavorite\b/i,
    ],
    weakKeywords: [
      /\bwant(s)?\b/i,
      /\bneed(s)?\b/i,
      /\bexpect(s|ation)?\b/i,
      /\brequire(ment|s)?\b/i,
      /\bimportant\b/i,
      /\bpriority\b/i,
      /\bvalue(s)?\b/i,
      /\bapproach\b/i,
      /\bmethod\b/i,
      /\btechnique\b/i,
    ],
    structuralPatterns: [
      /^#+\s*preferences?/im,
      /^#+\s*settings?/im,
      /^#+\s*configuration/im,
      /^#+\s*guidelines?/im,
      /^#+\s*standards?/im,
      /^#+\s*conventions?/im,
      /^#+\s*rules?/im,
    ],
  },
  decisions: {
    strongKeywords: [
      /\bdecision\b/i,
      /\bdecided\b/i,
      /\bchoose\b/i,
      /\bchose\b/i,
      /\bchoice\b/i,
      /\bselect(ed|ion)?\b/i,
      /\bpick(ed)?\b/i,
      /\bopt(ed)?\s+(for|to)\b/i,
      /\bwent\s+with\b/i,
      /\bgoing\s+with\b/i,
      /\breason(ing)?\b/i,
      /\brationale\b/i,
      /\bjustification\b/i,
      /\bbecause\b/i,
      /\bwhy\b/i,
      /\btrade-?off\b/i,
      /\bpros?\s+(and|&)\s+cons?\b/i,
      /\balternative(s)?\b/i,
      /\bcomparison\b/i,
      /\bevaluation\b/i,
      /\bADR\b/, // Architecture Decision Record
      /\bRFC\b/, // Request for Comments
    ],
    weakKeywords: [
      /\boption(s)?\b/i,
      /\bapproach(es)?\b/i,
      /\bstrategy\b/i,
      /\bplan\b/i,
      /\bdirection\b/i,
      /\bpath\b/i,
      /\broute\b/i,
      /\bconclusion\b/i,
      /\boutcome\b/i,
      /\bresult\b/i,
    ],
    structuralPatterns: [
      /^#+\s*decision/im,
      /^#+\s*rationale/im,
      /^#+\s*why/im,
      /^#+\s*reasoning/im,
      /^#+\s*ADR/im,
      /^#+\s*RFC/im,
      /^#+\s*trade-?offs?/im,
      /^#+\s*alternatives?/im,
    ],
  },
  general: {
    strongKeywords: [],
    weakKeywords: [],
    structuralPatterns: [],
  },
};

/** Weight for strong keyword matches */
const STRONG_KEYWORD_WEIGHT = 0.15;
/** Weight for weak keyword matches */
const WEAK_KEYWORD_WEIGHT = 0.05;
/** Weight for structural pattern matches */
const STRUCTURAL_PATTERN_WEIGHT = 0.2;
/** Minimum confidence to assign a non-general category */
const MIN_CONFIDENCE_THRESHOLD = 0.2;
/** Maximum number of secondary categories */
const MAX_SECONDARY_CATEGORIES = 2;

/**
 * Score a text against a category's patterns
 */
function scoreCategory(
  text: string,
  category: MemoryCategory,
): { score: number; matchedKeywords: string[] } {
  if (category === "general") {
    return { score: 0, matchedKeywords: [] };
  }

  const patterns = CATEGORY_PATTERNS[category];
  let score = 0;
  const matchedKeywords: string[] = [];

  // Check strong keywords
  for (const pattern of patterns.strongKeywords) {
    const matches = text.match(pattern);
    if (matches) {
      score += STRONG_KEYWORD_WEIGHT;
      matchedKeywords.push(matches[0]);
    }
  }

  // Check weak keywords
  for (const pattern of patterns.weakKeywords) {
    const matches = text.match(pattern);
    if (matches) {
      score += WEAK_KEYWORD_WEIGHT;
      // Only add weak matches if we don't have too many
      if (matchedKeywords.length < 10) {
        matchedKeywords.push(matches[0]);
      }
    }
  }

  // Check structural patterns (only once each)
  for (const pattern of patterns.structuralPatterns) {
    if (pattern.test(text)) {
      score += STRUCTURAL_PATTERN_WEIGHT;
    }
  }

  // Cap score at 1.0
  return { score: Math.min(1.0, score), matchedKeywords };
}

/**
 * Categorize a memory chunk based on its content
 *
 * Analyzes the text to determine the most appropriate category.
 * Returns metadata including confidence and any secondary categories.
 */
export function categorizeMemory(text: string): CategoryMetadata {
  if (!text || text.trim().length === 0) {
    return {
      category: "general",
      confidence: 1.0,
    };
  }

  const categories: MemoryCategory[] = ["projects", "people", "preferences", "decisions"];
  const scores: Array<{
    category: MemoryCategory;
    score: number;
    matchedKeywords: string[];
  }> = [];

  for (const category of categories) {
    const { score, matchedKeywords } = scoreCategory(text, category);
    if (score > 0) {
      scores.push({ category, score, matchedKeywords });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // If no category scored above threshold, return general
  if (scores.length === 0 || scores[0].score < MIN_CONFIDENCE_THRESHOLD) {
    return {
      category: "general",
      confidence: 1.0 - (scores[0]?.score ?? 0),
    };
  }

  const primary = scores[0];
  const result: CategoryMetadata = {
    category: primary.category,
    confidence: primary.score,
    matchedKeywords: primary.matchedKeywords.slice(0, 5), // Limit keywords
  };

  // Find secondary categories (those with meaningful scores)
  const secondary = scores
    .slice(1)
    .filter((s) => s.score >= MIN_CONFIDENCE_THRESHOLD * 0.5)
    .slice(0, MAX_SECONDARY_CATEGORIES)
    .map((s) => s.category);

  if (secondary.length > 0) {
    result.secondaryCategories = secondary;
  }

  return result;
}

/**
 * Batch categorize multiple memory chunks
 *
 * Efficiently categorizes multiple texts at once.
 */
export function categorizeMemories(texts: string[]): CategoryMetadata[] {
  return texts.map((text) => categorizeMemory(text));
}

/**
 * Check if a text matches a specific category
 *
 * Returns true if the text's primary or secondary categories
 * include the target category.
 */
export function matchesCategory(text: string, targetCategory: MemoryCategory): boolean {
  if (targetCategory === "general") {
    return true; // Everything matches general
  }

  const metadata = categorizeMemory(text);

  if (metadata.category === targetCategory) {
    return true;
  }

  if (metadata.secondaryCategories?.includes(targetCategory)) {
    return true;
  }

  return false;
}

/**
 * Get all categories that apply to a text
 *
 * Returns the primary category plus any secondary categories.
 */
export function getApplicableCategories(text: string): MemoryCategory[] {
  const metadata = categorizeMemory(text);
  const categories: MemoryCategory[] = [metadata.category];

  if (metadata.secondaryCategories) {
    categories.push(...metadata.secondaryCategories);
  }

  // Always include general as a fallback
  if (!categories.includes("general")) {
    categories.push("general");
  }

  return categories;
}

/**
 * Filter memory results by category
 *
 * Takes an array of memory snippets and filters to those matching
 * the specified category (primary or secondary).
 */
export function filterByCategory<T extends { snippet: string }>(
  results: T[],
  category: MemoryCategory,
): T[] {
  if (category === "general") {
    return results; // No filtering for general
  }

  return results.filter((result) => matchesCategory(result.snippet, category));
}

/**
 * Get category statistics for a set of texts
 *
 * Returns counts and percentages for each category.
 */
export function getCategoryStats(texts: string[]): {
  counts: Record<MemoryCategory, number>;
  percentages: Record<MemoryCategory, number>;
  total: number;
} {
  const counts: Record<MemoryCategory, number> = {
    projects: 0,
    people: 0,
    preferences: 0,
    decisions: 0,
    general: 0,
  };

  for (const text of texts) {
    const metadata = categorizeMemory(text);
    counts[metadata.category]++;
  }

  const total = texts.length;
  const percentages: Record<MemoryCategory, number> = {
    projects: total > 0 ? (counts.projects / total) * 100 : 0,
    people: total > 0 ? (counts.people / total) * 100 : 0,
    preferences: total > 0 ? (counts.preferences / total) * 100 : 0,
    decisions: total > 0 ? (counts.decisions / total) * 100 : 0,
    general: total > 0 ? (counts.general / total) * 100 : 0,
  };

  return { counts, percentages, total };
}

/**
 * All available memory categories
 */
export const ALL_CATEGORIES: readonly MemoryCategory[] = [
  "projects",
  "people",
  "preferences",
  "decisions",
  "general",
] as const;

/**
 * Category display names for UI
 */
export const CATEGORY_DISPLAY_NAMES: Record<MemoryCategory, string> = {
  projects: "Projects",
  people: "People",
  preferences: "Preferences",
  decisions: "Decisions",
  general: "General",
};

/**
 * Category descriptions for help/documentation
 */
export const CATEGORY_DESCRIPTIONS: Record<MemoryCategory, string> = {
  projects:
    "Project-related information including features, tasks, releases, and technical implementations.",
  people: "Information about people, teams, contacts, roles, and responsibilities.",
  preferences: "User preferences, settings, conventions, guidelines, and coding standards.",
  decisions: "Decision records, rationale, trade-offs, and architectural choices.",
  general: "General information that doesn't fit into a specific category.",
};
