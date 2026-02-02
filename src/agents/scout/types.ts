/**
 * Scout Agent Types
 *
 * Scout agents research the codebase before building. They investigate
 * architecture, dependencies, patterns, and tests to inform implementation.
 */

/**
 * Types of scouts available.
 */
export type ScoutType =
  | "architecture" // Investigates code structure and patterns
  | "dependency" // Analyzes dependencies and packages
  | "pattern" // Discovers coding conventions
  | "test" // Analyzes test coverage and patterns
  | "api" // Investigates API design
  | "security" // Security-focused analysis
  | "feature" // Composite: runs multiple scouts for feature planning
  | "bug"; // Composite: investigates bug root cause

/**
 * Depth of scout investigation.
 */
export type ScoutDepth = "quick" | "medium" | "deep";

/**
 * Status of a scout run.
 */
export type ScoutStatus =
  | "pending" // Not yet started
  | "running" // In progress
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "cancelled" // Cancelled by user
  | "timeout"; // Exceeded time limit

/**
 * Configuration for a scout run.
 */
export interface ScoutConfig {
  /** Type of scout to run */
  type: ScoutType;

  /** Query or target for the scout */
  query: string;

  /** Optional path scope for the scout */
  scope?: string;

  /** Depth of investigation */
  depth: ScoutDepth;

  /** Model to use for scout work */
  model?: string;

  /** Thinking level for the model */
  thinkingLevel?: string;

  /** Timeout in seconds */
  timeoutSeconds: number;

  /** Run scouts in parallel (for composite scouts) */
  parallel: boolean;

  /** Maximum concurrent scouts */
  maxConcurrent: number;
}

/**
 * Default scout configuration values.
 */
export const DEFAULT_SCOUT_CONFIG: Omit<ScoutConfig, "type" | "query"> = {
  depth: "medium",
  timeoutSeconds: 120,
  parallel: true,
  maxConcurrent: 4,
};

/**
 * Findings from an architecture scout.
 */
export interface ArchitectureFindings {
  /** Directory structure summary */
  structure: {
    directories: string[];
    fileCount: number;
    locEstimate: number;
  };

  /** Design patterns identified */
  patterns: Array<{
    name: string;
    location: string;
    description: string;
  }>;

  /** Module dependencies and flow */
  dependencies: Array<{
    from: string;
    to: string;
    type: "import" | "extends" | "implements" | "uses";
  }>;

  /** Extension points for new code */
  extensionPoints: Array<{
    location: string;
    description: string;
  }>;
}

/**
 * Findings from a dependency scout.
 */
export interface DependencyFindings {
  /** Current relevant dependencies */
  current: Array<{
    name: string;
    version: string;
    usedIn: string[];
    description?: string;
  }>;

  /** Recommended new dependencies */
  recommended: Array<{
    name: string;
    version: string;
    reason: string;
    pros: string[];
    cons: string[];
  }>;

  /** Dependencies to avoid */
  avoid: Array<{
    name: string;
    reason: string;
  }>;

  /** Security vulnerabilities found */
  vulnerabilities: Array<{
    package: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    fixAvailable: boolean;
  }>;
}

/**
 * Findings from a pattern scout.
 */
export interface PatternFindings {
  /** Naming conventions */
  naming: {
    files: string;
    functions: string;
    variables: string;
    types: string;
    examples: string[];
  };

  /** Error handling patterns */
  errorHandling: {
    pattern: string;
    errorClasses: string[];
    examples: Array<{
      file: string;
      snippet: string;
    }>;
  };

  /** Logging patterns */
  logging: {
    library: string;
    levels: string[];
    structured: boolean;
    examples: string[];
  };

  /** Other notable patterns */
  other: Array<{
    name: string;
    description: string;
    examples: string[];
  }>;
}

/**
 * Findings from a test scout.
 */
export interface TestFindings {
  /** Testing framework info */
  framework: {
    name: string;
    configFile?: string;
    runners: string[];
  };

  /** Test file locations and naming */
  structure: {
    pattern: string;
    directories: string[];
    exampleFiles: string[];
  };

  /** Coverage information */
  coverage: {
    overall?: number;
    byPath: Record<string, number>;
    gaps: Array<{
      path: string;
      description: string;
    }>;
  };

  /** Mocking patterns */
  mocking: {
    library: string;
    patterns: string[];
    examples: string[];
  };

  /** Fixture patterns */
  fixtures: {
    location?: string;
    pattern: string;
    examples: string[];
  };
}

/**
 * Findings from an API scout.
 */
export interface ApiFindings {
  /** Endpoint structure */
  endpoints: Array<{
    method: string;
    path: string;
    file: string;
    description?: string;
  }>;

  /** Request/response patterns */
  schemas: {
    requestValidation: string;
    responseFormat: string;
    examples: string[];
  };

  /** Authentication patterns */
  authentication: {
    method: string;
    middleware?: string;
    examples: string[];
  };

  /** Error response format */
  errorFormat: {
    structure: string;
    examples: string[];
  };
}

/**
 * Findings from a security scout.
 */
export interface SecurityFindings {
  /** Authentication mechanisms */
  authentication: {
    methods: string[];
    storage: string;
    vulnerabilities: string[];
  };

  /** Authorization patterns */
  authorization: {
    pattern: string;
    roles?: string[];
    gaps: string[];
  };

  /** Input validation */
  inputValidation: {
    library?: string;
    coverage: "full" | "partial" | "minimal" | "none";
    gaps: string[];
  };

  /** Secrets management */
  secrets: {
    method: string;
    issues: string[];
  };

  /** Other security concerns */
  concerns: Array<{
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    location?: string;
    recommendation: string;
  }>;
}

/**
 * Union type for all scout findings.
 */
export type ScoutFindings =
  | { type: "architecture"; data: ArchitectureFindings }
  | { type: "dependency"; data: DependencyFindings }
  | { type: "pattern"; data: PatternFindings }
  | { type: "test"; data: TestFindings }
  | { type: "api"; data: ApiFindings }
  | { type: "security"; data: SecurityFindings }
  | { type: "feature"; data: FeatureScoutFindings }
  | { type: "bug"; data: BugScoutFindings };

/**
 * Composite findings from a feature scout.
 */
export interface FeatureScoutFindings {
  /** Original feature query */
  query: string;

  /** Architecture findings if scout ran */
  architecture?: ArchitectureFindings;

  /** Pattern findings if scout ran */
  patterns?: PatternFindings;

  /** Dependency findings if scout ran */
  dependencies?: DependencyFindings;

  /** Test findings if scout ran */
  tests?: TestFindings;

  /** API findings if scout ran */
  api?: ApiFindings;

  /** Synthesized recommendations */
  recommendations: Array<{
    priority: number;
    action: string;
    rationale: string;
    files?: string[];
  }>;

  /** Suggested files to create/modify */
  suggestedChanges: Array<{
    path: string;
    action: "create" | "modify";
    purpose: string;
  }>;
}

/**
 * Composite findings from a bug scout.
 */
export interface BugScoutFindings {
  /** Bug description */
  description: string;

  /** Root cause analysis */
  rootCause: {
    likely: {
      description: string;
      file?: string;
      line?: number;
      confidence: number;
    };
    alternatives: Array<{
      description: string;
      file?: string;
      confidence: number;
    }>;
  };

  /** Error handling gaps */
  errorHandlingGaps: Array<{
    file: string;
    line?: number;
    issue: string;
  }>;

  /** Test coverage gaps */
  testGaps: Array<{
    description: string;
    suggestedTest: string;
  }>;

  /** Recommended fix approach */
  fixApproach: {
    steps: string[];
    files: string[];
    risks: string[];
  };

  /** Required tests for the fix */
  requiredTests: string[];
}

/**
 * A scout run result.
 */
export interface ScoutResult {
  /** Unique scout run ID */
  id: string;

  /** Scout type */
  type: ScoutType;

  /** Query that was investigated */
  query: string;

  /** Scope path if specified */
  scope?: string;

  /** Current status */
  status: ScoutStatus;

  /** When the scout started */
  startedAt: number;

  /** When the scout ended (if finished) */
  endedAt?: number;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Estimated cost in USD */
  costUsd?: number;

  /** Findings from the scout */
  findings?: ScoutFindings;

  /** Error message if failed */
  error?: string;

  /** Child scout IDs for composite scouts */
  childScouts?: string[];

  /** Session key for the scout sub-agent */
  sessionKey?: string;
}

/**
 * Scout run statistics.
 */
export interface ScoutStats {
  /** Total scouts run */
  total: number;

  /** Scouts by status */
  byStatus: Record<ScoutStatus, number>;

  /** Scouts by type */
  byType: Record<ScoutType, number>;

  /** Average duration by type (ms) */
  avgDurationByType: Record<ScoutType, number>;

  /** Average cost by type (USD) */
  avgCostByType: Record<ScoutType, number>;

  /** Total cost (USD) */
  totalCostUsd: number;
}

/**
 * Scout session storage format.
 */
export interface ScoutStore {
  /** Active and recent scout runs */
  runs: Record<string, ScoutResult>;

  /** Statistics */
  stats: ScoutStats;

  /** Last updated timestamp */
  lastUpdated: number;
}
