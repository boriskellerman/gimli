/**
 * Plan-Build AI Developer Workflow (ADW)
 *
 * A two-stage workflow that:
 * 1. Plans: Analyzes requirements and creates a structured implementation plan
 * 2. Builds: Implements the plan step by step with commits per sub-task
 *
 * This workflow follows the TAC principle of breaking complex tasks into
 * deterministic stages with clear handoffs.
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
 * Input for the plan-build workflow
 */
export interface PlanBuildInput {
  /** Feature request or issue description */
  request: string;
  /** Optional context about the codebase */
  codebaseContext?: string;
  /** Optional constraints or requirements */
  constraints?: string[];
  /** Whether to commit after each step */
  commitPerStep?: boolean;
  /** Branch name to work on */
  branch?: string;
  /** Files that are relevant to the task */
  relevantFiles?: string[];
}

/**
 * Structured plan output from the planning stage
 */
export interface ImplementationPlan {
  /** Summary of the task */
  summary: string;
  /** Detailed sub-tasks */
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    files: string[];
    estimatedComplexity: "low" | "medium" | "high";
    dependencies?: string[];
  }>;
  /** Success criteria */
  successCriteria: string[];
  /** Potential risks */
  risks: string[];
  /** Estimated total effort */
  estimatedEffort: string;
}

/**
 * Build result from the implementation stage
 */
export interface BuildResult {
  /** Completed tasks */
  completedTasks: string[];
  /** Files modified */
  filesModified: string[];
  /** Commits created */
  commits?: string[];
  /** Test results */
  testsRun?: boolean;
  testsPassed?: boolean;
  /** Any issues encountered */
  issues?: string[];
}

// ============================================================================
// Stage Definitions
// ============================================================================

const PLANNING_STAGE: StageConfig = {
  id: "plan",
  name: "Planning",
  description: "Analyze requirements and create a structured implementation plan",
  agent: {
    thinking: "high",
    systemPromptAdditions: `You are a software architect creating an implementation plan.

Your job is to:
1. Analyze the feature request thoroughly
2. Break it down into clear, actionable sub-tasks
3. Identify which files need to be created or modified
4. Consider dependencies between tasks
5. Identify potential risks and edge cases

Output your plan in a structured format with:
- Summary of the task
- List of sub-tasks with descriptions
- Files to modify for each task
- Success criteria
- Potential risks

Be specific and practical. Each sub-task should be completable in a single focused session.`,
  },
  timeoutSeconds: 300,
  required: true,
};

const BUILDING_STAGE: StageConfig = {
  id: "build",
  name: "Implementation",
  description: "Implement the plan step by step",
  agent: {
    thinking: "medium",
    systemPromptAdditions: `You are implementing a feature according to a plan.

Your job is to:
1. Follow the implementation plan precisely
2. Implement each sub-task in order
3. Write clean, well-documented code
4. Run tests after implementation
5. Create clear commit messages for each step

Important guidelines:
- Follow existing code patterns in the codebase
- Add tests for new functionality
- Update documentation as needed
- Report any issues or blockers

After completing each sub-task, summarize what was done and any issues encountered.`,
  },
  timeoutSeconds: 600,
  required: true,
  dependsOn: ["plan"],
};

// ============================================================================
// Workflow Definition
// ============================================================================

/**
 * Create the plan-build workflow definition
 */
export function createPlanBuildDefinition(options?: Partial<ADWDefinition>): ADWDefinition {
  return {
    id: "plan-build",
    name: "Plan and Build",
    description: "Plan a feature implementation and then build it step by step",
    version: "1.0.0",
    stages: [PLANNING_STAGE, BUILDING_STAGE],
    retryConfig: {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 2,
    },
    totalTimeoutSeconds: 1800, // 30 minutes
    tags: ["feature", "implementation"],
    ...options,
  };
}

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Build the prompt for the planning stage
 */
function buildPlanningPrompt(input: PlanBuildInput): string {
  const lines: string[] = [
    "# Feature Implementation Planning",
    "",
    "## Feature Request",
    input.request,
    "",
  ];

  if (input.codebaseContext) {
    lines.push("## Codebase Context", input.codebaseContext, "");
  }

  if (input.constraints && input.constraints.length > 0) {
    lines.push("## Constraints");
    for (const constraint of input.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push("");
  }

  if (input.relevantFiles && input.relevantFiles.length > 0) {
    lines.push("## Relevant Files");
    for (const file of input.relevantFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  lines.push(
    "## Instructions",
    "Create a detailed implementation plan for this feature request.",
    "Break it down into specific, actionable tasks.",
    "Include success criteria and potential risks.",
    "",
    "Format your response as a structured plan that can be followed step by step.",
  );

  return lines.join("\n");
}

/**
 * Build the prompt for the building stage
 */
function buildImplementationPrompt(input: PlanBuildInput, context: ADWContext): string {
  const planResult = context.stageResults.get("plan");
  const planOutput = planResult?.output || "No plan available";

  const lines: string[] = [
    "# Feature Implementation",
    "",
    "## Original Request",
    input.request,
    "",
    "## Implementation Plan",
    planOutput,
    "",
    "## Instructions",
    "Implement the feature according to the plan above.",
    "Work through each task in order.",
  ];

  if (input.commitPerStep) {
    lines.push("Create a commit after completing each major task.");
  }

  if (input.branch) {
    lines.push(`Work on branch: ${input.branch}`);
  }

  lines.push(
    "",
    "After implementation:",
    "1. Run any relevant tests",
    "2. Verify the success criteria are met",
    "3. List all files modified",
    "4. Report any issues encountered",
  );

  return lines.join("\n");
}

/**
 * Build prompt for a stage based on context
 */
function buildPrompt(stage: StageConfig, context: ADWContext): string {
  const input = context.input as unknown as PlanBuildInput;

  switch (stage.id) {
    case "plan":
      return buildPlanningPrompt(input);
    case "build":
      return buildImplementationPrompt(input, context);
    default:
      throw new Error(`Unknown stage: ${stage.id}`);
  }
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute the plan-build workflow
 */
export async function executePlanBuild(
  input: PlanBuildInput,
  trigger: { type: TriggerType; source?: string; metadata?: Record<string, unknown> },
  options?: {
    workingDir?: string;
    logger?: ADWLogger;
    resultsDir?: string;
    logFile?: string;
  },
): Promise<ADWResult> {
  const definition = createPlanBuildDefinition();

  // Create logger
  let logger = options?.logger;
  if (!logger) {
    logger = options?.logFile
      ? createFileLogger(options.logFile, "plan-build")
      : createConsoleLogger("plan-build");
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
 * Parse the plan from the planning stage output
 */
export function parsePlanFromOutput(output: string): ImplementationPlan | null {
  try {
    // Try to extract structured content
    const tasks: ImplementationPlan["tasks"] = [];
    const successCriteria: string[] = [];
    const risks: string[] = [];

    // Extract summary (first paragraph or section)
    const summaryMatch = output.match(
      /(?:^|\n)(?:##?\s*)?(?:Summary|Overview)[:\n]?\s*([^\n]+(?:\n[^\n#]+)*)/i,
    );
    const summary = summaryMatch
      ? summaryMatch[1].trim()
      : output.split("\n")[0] || "No summary available";

    // Extract tasks (look for numbered lists or task sections)
    const taskMatches = output.matchAll(
      /(?:^|\n)(?:[-*]|\d+[.)])\s*(?:\*\*)?([^:\n*]+)(?:\*\*)?[:\s]*([^\n]*(?:\n(?![-*]|\d+[.)])[^\n]+)*)/g,
    );

    let taskId = 1;
    for (const match of taskMatches) {
      const title = match[1].trim();
      const description = match[2].trim();

      // Skip non-task items
      if (title.toLowerCase().includes("risk") || title.toLowerCase().includes("criteria")) {
        continue;
      }

      tasks.push({
        id: `task-${taskId++}`,
        title,
        description,
        files: [], // Would need more parsing
        estimatedComplexity: "medium",
      });
    }

    // Extract success criteria
    const criteriaMatch = output.match(
      /(?:success\s*criteria|acceptance\s*criteria)[:\n]?\s*((?:[-*]\s*[^\n]+\n?)+)/i,
    );
    if (criteriaMatch) {
      const criteriaLines = criteriaMatch[1].match(/[-*]\s*([^\n]+)/g) || [];
      for (const line of criteriaLines) {
        successCriteria.push(line.replace(/^[-*]\s*/, "").trim());
      }
    }

    // Extract risks
    const risksMatch = output.match(/(?:risks?|concerns?)[:\n]?\s*((?:[-*]\s*[^\n]+\n?)+)/i);
    if (risksMatch) {
      const riskLines = risksMatch[1].match(/[-*]\s*([^\n]+)/g) || [];
      for (const line of riskLines) {
        risks.push(line.replace(/^[-*]\s*/, "").trim());
      }
    }

    return {
      summary,
      tasks:
        tasks.length > 0
          ? tasks
          : [
              {
                id: "task-1",
                title: "Implementation",
                description: output,
                files: [],
                estimatedComplexity: "medium",
              },
            ],
      successCriteria:
        successCriteria.length > 0 ? successCriteria : ["Feature works as described"],
      risks: risks.length > 0 ? risks : [],
      estimatedEffort: "Unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Parse build result from implementation stage output
 */
export function parseBuildResult(output: string): BuildResult {
  const filesModified: string[] = [];
  const commits: string[] = [];
  const issues: string[] = [];
  const completedTasks: string[] = [];

  // Extract file paths
  const fileMatches = output.matchAll(
    /(?:modified|created|updated|changed)[:\s]*[`"]?([^\s`"]+\.\w+)[`"]?/gi,
  );
  for (const match of fileMatches) {
    if (!filesModified.includes(match[1])) {
      filesModified.push(match[1]);
    }
  }

  // Extract commits
  const commitMatches = output.matchAll(/commit[:\s]*[`"]?([a-f0-9]{7,40})[`"]?/gi);
  for (const match of commitMatches) {
    commits.push(match[1]);
  }

  // Check for test results
  const testsRun = /tests?\s+(?:ran|passed|failed)/i.test(output);
  const testsPassed = testsRun && !/tests?\s+failed/i.test(output);

  // Extract completed tasks
  const completedMatches = output.matchAll(/(?:completed|done|finished)[:\s]*([^\n]+)/gi);
  for (const match of completedMatches) {
    completedTasks.push(match[1].trim());
  }

  // Extract issues
  const issueMatches = output.matchAll(/(?:issue|problem|error|warning)[:\s]*([^\n]+)/gi);
  for (const match of issueMatches) {
    issues.push(match[1].trim());
  }

  return {
    completedTasks,
    filesModified,
    commits: commits.length > 0 ? commits : undefined,
    testsRun,
    testsPassed,
    issues: issues.length > 0 ? issues : undefined,
  };
}

/**
 * Get structured results from a plan-build execution
 */
export function getPlanBuildResults(result: ADWResult): {
  plan: ImplementationPlan | null;
  build: BuildResult | null;
} {
  const planStage = result.stageResults.find((s) => s.stageId === "plan");
  const buildStage = result.stageResults.find((s) => s.stageId === "build");

  return {
    plan: planStage?.output ? parsePlanFromOutput(planStage.output) : null,
    build: buildStage?.output ? parseBuildResult(buildStage.output) : null,
  };
}
