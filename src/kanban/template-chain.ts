/**
 * Template Chain System for End-to-End Feature Development
 *
 * Chains templates together for automated feature development workflows:
 * - Bug template → investigate → fix → test → review → document
 * - Feature template → design → implement → test → review → document
 * - Chore template → plan → execute → verify
 *
 * Based on TAC (Tactical Agentic Coding) principles:
 * - Grade 5: Templates (bug, feature, chore)
 * - Grade 6: Prompt chains / Agentic workflows
 *
 * @see ralphy/TAC_PRINCIPLES.md for full TAC documentation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Template types that can be used as chain entry points
 */
export type TemplateType = "bug" | "feature" | "chore";

/**
 * Stage types that form the workflow pipeline
 */
export type StageType =
  | "investigate"
  | "design"
  | "plan"
  | "implement"
  | "build"
  | "test"
  | "review"
  | "document"
  | "verify"
  | "cleanup";

/**
 * Status of a stage execution
 */
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/**
 * Result of running a stage
 */
export interface StageResult {
  stageId: string;
  stageType: StageType;
  status: StageStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  output?: string;
  artifacts?: StageArtifact[];
  error?: string;
  metrics?: StageMetrics;
  nextStageContext?: Record<string, unknown>;
}

/**
 * Artifact produced by a stage (files, reports, etc.)
 */
export interface StageArtifact {
  type: "file" | "report" | "diff" | "test-results" | "review-comments";
  path?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Metrics collected during stage execution
 */
export interface StageMetrics {
  tokensUsed?: number;
  filesChanged?: number;
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
  linesAdded?: number;
  linesRemoved?: number;
  reviewScore?: number;
  confidence?: number;
}

/**
 * Configuration for a single stage in the chain
 */
export interface StageConfig {
  type: StageType;
  prompt: string;
  required: boolean;
  timeout?: number;
  retryOnFailure?: boolean;
  maxRetries?: number;
  skipCondition?: (context: ChainContext) => boolean;
  validateOutput?: (result: StageResult) => boolean;
}

/**
 * Context passed between stages in the chain
 */
export interface ChainContext {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  templateType: TemplateType;
  currentStage: number;
  totalStages: number;
  stageResults: StageResult[];
  sharedContext: Record<string, unknown>;
  metadata: {
    startedAt: number;
    estimatedCompletionTime?: number;
    priority?: string;
    labels?: string[];
  };
}

/**
 * Template chain definition
 */
export interface TemplateChain {
  id: string;
  name: string;
  description: string;
  templateType: TemplateType;
  stages: StageConfig[];
  entryPrompt: string;
  exitCriteria: {
    minStagesCompleted: number;
    requireAllCritical: boolean;
    minConfidence: number;
  };
}

/**
 * Chain execution plan
 */
export interface ChainExecutionPlan {
  chainId: string;
  taskId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  stages: Array<{
    config: StageConfig;
    plannedOrder: number;
    estimatedDurationMs?: number;
  }>;
  context: ChainContext;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Result of executing a complete chain
 */
export interface ChainExecutionResult {
  planId: string;
  chainId: string;
  taskId: string;
  status: "completed" | "failed" | "partial";
  stagesCompleted: number;
  stagesTotal: number;
  stageResults: StageResult[];
  finalOutput?: string;
  summary: {
    success: boolean;
    confidence: number;
    recommendation: string;
    nextSteps?: string[];
  };
  metrics: {
    totalDurationMs: number;
    totalTokensUsed: number;
    filesChanged: number;
    testsRun: number;
    testsPassed: number;
  };
  artifacts: StageArtifact[];
}

/**
 * Dependencies for chain execution
 */
export interface ChainExecutorDeps {
  executeStage: (stage: StageConfig, context: ChainContext) => Promise<StageResult>;
  log: (level: "info" | "warn" | "error", message: string, data?: unknown) => void;
  now: () => number;
}

// ============================================================================
// Pre-defined Template Chains
// ============================================================================

/**
 * Bug fix workflow chain
 *
 * 1. Investigate: Analyze bug, reproduce, identify root cause
 * 2. Design: Plan the fix approach
 * 3. Implement: Write the fix
 * 4. Test: Run tests, add regression tests
 * 5. Review: Self-review for quality
 * 6. Document: Update changelog, add comments
 */
export const BUG_FIX_CHAIN: TemplateChain = {
  id: "bug-fix",
  name: "Bug Fix Workflow",
  description: "Complete bug investigation and fix pipeline",
  templateType: "bug",
  entryPrompt: `You are investigating and fixing a bug. Follow this structured process:

1. INVESTIGATE: Analyze the bug report, reproduce the issue, identify root cause
2. DESIGN: Plan your fix approach, consider edge cases
3. IMPLEMENT: Write the fix with proper error handling
4. TEST: Run existing tests, add regression test for this bug
5. REVIEW: Self-review your changes for quality and completeness
6. DOCUMENT: Update changelog, add code comments where needed

Request → Validate → Resolve pattern:
- Request: Clearly state what you're doing at each stage
- Validate: Check your work before moving on
- Resolve: Complete the stage with confidence or explain blockers`,
  stages: [
    {
      type: "investigate",
      prompt: `INVESTIGATE STAGE:
- Reproduce the bug
- Analyze stack traces and error messages
- Identify the root cause
- Document your findings

Output: Investigation report with root cause identified`,
      required: true,
      timeout: 120000,
    },
    {
      type: "design",
      prompt: `DESIGN STAGE:
- Based on investigation, plan your fix
- Consider multiple approaches if applicable
- Evaluate trade-offs
- Choose the best approach

Output: Fix approach with rationale`,
      required: true,
      timeout: 60000,
    },
    {
      type: "implement",
      prompt: `IMPLEMENT STAGE:
- Write the fix following the design
- Keep changes minimal and focused
- Add error handling where appropriate
- Follow existing code patterns

Output: Code changes (files modified)`,
      required: true,
      timeout: 180000,
      retryOnFailure: true,
      maxRetries: 2,
    },
    {
      type: "test",
      prompt: `TEST STAGE:
- Run the existing test suite
- Add a regression test for this specific bug
- Verify the fix works
- Check for unintended side effects

Output: Test results and new test file(s)`,
      required: true,
      timeout: 120000,
    },
    {
      type: "review",
      prompt: `REVIEW STAGE:
- Self-review all changes
- Check code quality and style
- Verify completeness of the fix
- Identify any remaining concerns

Output: Review notes with score`,
      required: true,
      timeout: 60000,
    },
    {
      type: "document",
      prompt: `DOCUMENT STAGE:
- Update changelog with the fix
- Add code comments for complex logic
- Update documentation if affected
- Prepare commit message

Output: Documentation updates`,
      required: false,
      timeout: 60000,
    },
  ],
  exitCriteria: {
    minStagesCompleted: 5,
    requireAllCritical: true,
    minConfidence: 0.8,
  },
};

/**
 * Feature development workflow chain
 *
 * 1. Design: Analyze requirements, design architecture
 * 2. Plan: Break down into tasks, identify dependencies
 * 3. Implement: Build the feature
 * 4. Test: Write and run tests
 * 5. Review: Code review
 * 6. Document: Update docs, add examples
 */
export const FEATURE_DEV_CHAIN: TemplateChain = {
  id: "feature-dev",
  name: "Feature Development Workflow",
  description: "Complete feature development from design to documentation",
  templateType: "feature",
  entryPrompt: `You are implementing a new feature. Follow this structured process:

1. DESIGN: Understand requirements, design the architecture
2. PLAN: Break down into implementable tasks
3. IMPLEMENT: Build the feature incrementally
4. TEST: Write comprehensive tests
5. REVIEW: Self-review for quality and standards
6. DOCUMENT: Update docs, add usage examples

Request → Validate → Resolve pattern:
- Request: Clearly state what you're doing at each stage
- Validate: Check your work before moving on
- Resolve: Complete the stage with confidence or explain blockers`,
  stages: [
    {
      type: "design",
      prompt: `DESIGN STAGE:
- Understand the feature requirements
- Analyze existing codebase patterns
- Design the architecture
- Identify integration points
- Consider edge cases and error handling

Output: Design document with architecture`,
      required: true,
      timeout: 180000,
    },
    {
      type: "plan",
      prompt: `PLAN STAGE:
- Break down design into implementation tasks
- Identify dependencies between tasks
- Estimate complexity for each task
- Prioritize the implementation order

Output: Implementation plan with task breakdown`,
      required: true,
      timeout: 60000,
    },
    {
      type: "implement",
      prompt: `IMPLEMENT STAGE:
- Follow the implementation plan
- Build incrementally, commit after each logical chunk
- Follow existing code patterns
- Add proper error handling
- Keep code clean and well-organized

Output: Implementation code (files created/modified)`,
      required: true,
      timeout: 300000,
      retryOnFailure: true,
      maxRetries: 3,
    },
    {
      type: "test",
      prompt: `TEST STAGE:
- Write unit tests for new code
- Add integration tests for feature flows
- Run the complete test suite
- Ensure coverage meets thresholds
- Fix any failing tests

Output: Test files and test results`,
      required: true,
      timeout: 180000,
    },
    {
      type: "review",
      prompt: `REVIEW STAGE:
- Self-review all changes
- Check against coding standards
- Verify feature completeness
- Identify potential improvements
- Check for security concerns

Output: Review notes with recommendations`,
      required: true,
      timeout: 120000,
    },
    {
      type: "document",
      prompt: `DOCUMENT STAGE:
- Update changelog
- Add/update API documentation
- Write usage examples
- Update README if needed
- Prepare PR description

Output: Documentation updates and PR description`,
      required: true,
      timeout: 120000,
    },
  ],
  exitCriteria: {
    minStagesCompleted: 6,
    requireAllCritical: true,
    minConfidence: 0.85,
  },
};

/**
 * Chore/maintenance workflow chain
 *
 * 1. Plan: Understand the maintenance task
 * 2. Build: Execute the maintenance
 * 3. Verify: Ensure nothing broke
 * 4. Cleanup: Clean up any temporary changes
 */
export const CHORE_CHAIN: TemplateChain = {
  id: "chore",
  name: "Chore/Maintenance Workflow",
  description: "Maintenance tasks like dependency updates, refactoring",
  templateType: "chore",
  entryPrompt: `You are performing a maintenance task. Follow this structured process:

1. PLAN: Understand what needs to be done
2. BUILD: Execute the maintenance task
3. VERIFY: Ensure nothing broke
4. CLEANUP: Clean up any temporary changes

Request → Validate → Resolve pattern:
- Request: Clearly state what you're doing at each stage
- Validate: Check your work before moving on
- Resolve: Complete the stage with confidence or explain blockers`,
  stages: [
    {
      type: "plan",
      prompt: `PLAN STAGE:
- Understand the maintenance task
- Identify affected areas
- Plan the approach
- Identify potential risks

Output: Maintenance plan`,
      required: true,
      timeout: 60000,
    },
    {
      type: "build",
      prompt: `BUILD STAGE:
- Execute the maintenance task
- Follow the plan
- Make changes carefully
- Keep track of what was changed

Output: Changes made`,
      required: true,
      timeout: 180000,
    },
    {
      type: "verify",
      prompt: `VERIFY STAGE:
- Run tests to ensure nothing broke
- Check that the maintenance goal was achieved
- Verify no regressions

Output: Verification results`,
      required: true,
      timeout: 120000,
    },
    {
      type: "cleanup",
      prompt: `CLEANUP STAGE:
- Remove any temporary files
- Clean up any debug code
- Update changelog if needed
- Prepare commit message

Output: Cleanup summary`,
      required: false,
      timeout: 60000,
    },
  ],
  exitCriteria: {
    minStagesCompleted: 3,
    requireAllCritical: true,
    minConfidence: 0.75,
  },
};

/**
 * Registry of all available template chains
 */
export const TEMPLATE_CHAINS: Record<TemplateType, TemplateChain> = {
  bug: BUG_FIX_CHAIN,
  feature: FEATURE_DEV_CHAIN,
  chore: CHORE_CHAIN,
};

// ============================================================================
// Chain Builder
// ============================================================================

/**
 * Build a custom chain from stages
 */
export function buildChain(
  id: string,
  name: string,
  templateType: TemplateType,
  stages: StageConfig[],
  options?: {
    description?: string;
    entryPrompt?: string;
    exitCriteria?: Partial<TemplateChain["exitCriteria"]>;
  },
): TemplateChain {
  return {
    id,
    name,
    description: options?.description ?? `Custom ${templateType} workflow`,
    templateType,
    stages,
    entryPrompt:
      options?.entryPrompt ??
      `You are executing a ${templateType} workflow with ${stages.length} stages.`,
    exitCriteria: {
      minStagesCompleted: options?.exitCriteria?.minStagesCompleted ?? stages.length - 1,
      requireAllCritical: options?.exitCriteria?.requireAllCritical ?? true,
      minConfidence: options?.exitCriteria?.minConfidence ?? 0.8,
    },
  };
}

/**
 * Create a stage configuration
 */
export function createStage(
  type: StageType,
  prompt: string,
  options?: Partial<Omit<StageConfig, "type" | "prompt">>,
): StageConfig {
  return {
    type,
    prompt,
    required: options?.required ?? true,
    timeout: options?.timeout ?? 120000,
    retryOnFailure: options?.retryOnFailure ?? false,
    maxRetries: options?.maxRetries ?? 1,
    skipCondition: options?.skipCondition,
    validateOutput: options?.validateOutput,
  };
}

// ============================================================================
// Chain Execution
// ============================================================================

/**
 * Create an execution plan for a chain
 */
export function createExecutionPlan(
  chain: TemplateChain,
  taskId: string,
  taskTitle: string,
  taskDescription?: string,
  metadata?: Partial<ChainContext["metadata"]>,
): ChainExecutionPlan {
  const now = Date.now();

  const context: ChainContext = {
    taskId,
    taskTitle,
    taskDescription,
    templateType: chain.templateType,
    currentStage: 0,
    totalStages: chain.stages.length,
    stageResults: [],
    sharedContext: {},
    metadata: {
      startedAt: now,
      ...metadata,
    },
  };

  return {
    chainId: chain.id,
    taskId,
    status: "pending",
    stages: chain.stages.map((config, index) => ({
      config,
      plannedOrder: index,
      estimatedDurationMs: config.timeout,
    })),
    context,
    createdAt: now,
  };
}

/**
 * Execute a complete chain
 */
export async function executeChain(
  chain: TemplateChain,
  plan: ChainExecutionPlan,
  deps: ChainExecutorDeps,
): Promise<ChainExecutionResult> {
  const startTime = deps.now();
  plan.status = "running";
  plan.startedAt = startTime;

  const stageResults: StageResult[] = [];
  const artifacts: StageArtifact[] = [];
  let totalTokens = 0;
  let filesChanged = 0;
  let testsRun = 0;
  let testsPassed = 0;

  deps.log("info", `Starting chain execution: ${chain.name}`, {
    chainId: chain.id,
    taskId: plan.taskId,
    stages: chain.stages.length,
  });

  // Execute stages sequentially
  for (let i = 0; i < plan.stages.length; i++) {
    const { config } = plan.stages[i];
    plan.context.currentStage = i;

    // Check skip condition
    if (config.skipCondition && config.skipCondition(plan.context)) {
      deps.log("info", `Skipping stage: ${config.type}`, { reason: "skip condition met" });
      const skipResult: StageResult = {
        stageId: `stage-${i}-${config.type}`,
        stageType: config.type,
        status: "skipped",
        startedAt: deps.now(),
        completedAt: deps.now(),
        durationMs: 0,
      };
      stageResults.push(skipResult);
      plan.context.stageResults.push(skipResult);
      continue;
    }

    deps.log("info", `Executing stage ${i + 1}/${plan.stages.length}: ${config.type}`);

    let result: StageResult;
    let attempts = 0;
    const maxAttempts = config.retryOnFailure ? (config.maxRetries ?? 1) + 1 : 1;

    // Retry loop
    while (attempts < maxAttempts) {
      attempts++;
      try {
        result = await deps.executeStage(config, plan.context);

        // Validate output if validator exists
        if (config.validateOutput && !config.validateOutput(result)) {
          if (attempts < maxAttempts) {
            deps.log("warn", `Stage validation failed, retrying`, {
              stage: config.type,
              attempt: attempts,
            });
            continue;
          }
          result.status = "failed";
          result.error = "Output validation failed";
        }

        break;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        deps.log("error", `Stage execution failed`, { stage: config.type, error: errorMsg });

        if (attempts >= maxAttempts) {
          result = {
            stageId: `stage-${i}-${config.type}`,
            stageType: config.type,
            status: "failed",
            startedAt: deps.now(),
            completedAt: deps.now(),
            error: errorMsg,
          };
          break;
        }
      }
    }

    stageResults.push(result!);
    plan.context.stageResults.push(result!);

    // Collect artifacts
    if (result!.artifacts) {
      artifacts.push(...result!.artifacts);
    }

    // Update metrics
    if (result!.metrics) {
      totalTokens += result!.metrics.tokensUsed ?? 0;
      filesChanged += result!.metrics.filesChanged ?? 0;
      testsRun += result!.metrics.testsRun ?? 0;
      testsPassed += result!.metrics.testsPassed ?? 0;
    }

    // Update shared context for next stage
    if (result!.nextStageContext) {
      Object.assign(plan.context.sharedContext, result!.nextStageContext);
    }

    // Check if required stage failed
    if (config.required && result!.status === "failed") {
      deps.log("error", `Required stage failed, stopping chain`, { stage: config.type });
      break;
    }
  }

  plan.completedAt = deps.now();
  const totalDuration = plan.completedAt - startTime;

  // Determine overall status
  const completedStages = stageResults.filter((r) => r.status === "completed").length;
  const failedRequired = stageResults.some(
    (r, i) => r.status === "failed" && plan.stages[i].config.required,
  );

  let status: ChainExecutionResult["status"];
  if (failedRequired) {
    status = "failed";
    plan.status = "failed";
  } else if (completedStages >= chain.exitCriteria.minStagesCompleted) {
    status = "completed";
    plan.status = "completed";
  } else {
    status = "partial";
    plan.status = "completed";
  }

  // Calculate confidence
  const avgConfidence =
    stageResults
      .filter((r) => r.metrics?.confidence !== undefined)
      .reduce((sum, r) => sum + (r.metrics?.confidence ?? 0), 0) /
      stageResults.filter((r) => r.metrics?.confidence !== undefined).length || 0;

  const confidence = avgConfidence || (completedStages / chain.stages.length) * 0.9;

  // Generate summary
  const summary = generateChainSummary(chain, stageResults, status, confidence);

  deps.log("info", `Chain execution completed`, {
    status,
    completedStages,
    totalStages: chain.stages.length,
    durationMs: totalDuration,
  });

  return {
    planId: `plan-${chain.id}-${plan.createdAt}`,
    chainId: chain.id,
    taskId: plan.taskId,
    status,
    stagesCompleted: completedStages,
    stagesTotal: chain.stages.length,
    stageResults,
    finalOutput: stageResults.map((r) => r.output).join("\n\n---\n\n"),
    summary,
    metrics: {
      totalDurationMs: totalDuration,
      totalTokensUsed: totalTokens,
      filesChanged,
      testsRun,
      testsPassed,
    },
    artifacts,
  };
}

/**
 * Generate a summary of the chain execution
 */
function generateChainSummary(
  chain: TemplateChain,
  results: StageResult[],
  status: ChainExecutionResult["status"],
  confidence: number,
): ChainExecutionResult["summary"] {
  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed");
  const skipped = results.filter((r) => r.status === "skipped").length;

  let recommendation: string;
  const nextSteps: string[] = [];

  if (status === "completed") {
    recommendation = `${chain.name} completed successfully with ${completed}/${chain.stages.length} stages.`;
    if (confidence >= chain.exitCriteria.minConfidence) {
      nextSteps.push("Ready for commit and PR creation");
    } else {
      nextSteps.push("Consider additional review due to lower confidence");
    }
  } else if (status === "partial") {
    recommendation = `${chain.name} partially completed. ${completed} stages succeeded, ${skipped} skipped.`;
    nextSteps.push("Review incomplete stages");
    nextSteps.push("Consider re-running failed stages");
  } else {
    recommendation = `${chain.name} failed. ${failed.length} stage(s) failed.`;
    for (const f of failed) {
      nextSteps.push(`Fix stage "${f.stageType}": ${f.error ?? "Unknown error"}`);
    }
  }

  return {
    success: status === "completed",
    confidence,
    recommendation,
    nextSteps: nextSteps.length > 0 ? nextSteps : undefined,
  };
}

// ============================================================================
// Chain Selection & Routing
// ============================================================================

/**
 * Detect the template type from task metadata
 */
export function detectTemplateType(
  labels: string[],
  title: string,
  description?: string,
): TemplateType {
  const labelSet = new Set(labels.map((l) => l.toLowerCase()));
  const content = `${title} ${description ?? ""}`.toLowerCase();

  // Check labels first
  if (labelSet.has("bug") || labelSet.has("bugfix") || labelSet.has("fix")) {
    return "bug";
  }
  if (
    labelSet.has("feature") ||
    labelSet.has("enhancement") ||
    labelSet.has("feat") ||
    labelSet.has("new")
  ) {
    return "feature";
  }
  if (
    labelSet.has("chore") ||
    labelSet.has("maintenance") ||
    labelSet.has("deps") ||
    labelSet.has("refactor")
  ) {
    return "chore";
  }

  // Check content
  if (content.includes("bug") || content.includes("fix") || content.includes("error")) {
    return "bug";
  }
  if (
    content.includes("feature") ||
    content.includes("implement") ||
    content.includes("add") ||
    content.includes("new")
  ) {
    return "feature";
  }
  if (
    content.includes("update") ||
    content.includes("upgrade") ||
    content.includes("refactor") ||
    content.includes("cleanup")
  ) {
    return "chore";
  }

  // Default to feature
  return "feature";
}

/**
 * Select the appropriate chain for a task
 */
export function selectChain(
  taskId: string,
  title: string,
  labels: string[],
  description?: string,
  customChains?: Record<TemplateType, TemplateChain>,
): TemplateChain {
  const templateType = detectTemplateType(labels, title, description);
  const chains = customChains ?? TEMPLATE_CHAINS;
  return chains[templateType];
}

// ============================================================================
// Chain Composition
// ============================================================================

/**
 * Compose multiple chains into a meta-chain
 *
 * Useful for complex workflows that span multiple template types,
 * e.g., a feature that requires bug fixes first
 */
export function composeChains(
  chains: TemplateChain[],
  options: {
    id: string;
    name: string;
    description?: string;
    transitionPrompts?: Record<string, string>;
  },
): TemplateChain {
  const allStages: StageConfig[] = [];

  for (let i = 0; i < chains.length; i++) {
    const chain = chains[i];
    // Add transition context if not the first chain
    if (i > 0 && options.transitionPrompts?.[chain.id]) {
      allStages.push(
        createStage(
          "plan",
          `TRANSITION: ${options.transitionPrompts[chain.id]}\n\nPreparing for ${chain.name}`,
          { required: false, timeout: 30000 },
        ),
      );
    }
    allStages.push(...chain.stages);
  }

  return buildChain(options.id, options.name, chains[0].templateType, allStages, {
    description:
      options.description ?? `Composed workflow: ${chains.map((c) => c.name).join(" → ")}`,
    entryPrompt: chains.map((c) => c.entryPrompt).join("\n\n---\n\n"),
  });
}

// ============================================================================
// Default Executor Factory
// ============================================================================

/**
 * Create default chain executor dependencies
 *
 * This is a factory for creating real executor deps that
 * integrate with the rest of the system
 */
export function createDefaultChainDeps(options?: {
  logFn?: ChainExecutorDeps["log"];
  stageExecutor?: ChainExecutorDeps["executeStage"];
}): ChainExecutorDeps {
  return {
    log:
      options?.logFn ??
      ((level, message, data) => {
        const prefix = `[template-chain] [${level.toUpperCase()}]`;
        if (data) {
          console.log(prefix, message, JSON.stringify(data, null, 2));
        } else {
          console.log(prefix, message);
        }
      }),
    executeStage:
      options?.stageExecutor ??
      (async (stage, context) => {
        // Default stub implementation - real implementation would use session spawning
        return {
          stageId: `stage-${context.currentStage}-${stage.type}`,
          stageType: stage.type,
          status: "completed",
          startedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 0,
          output: `Stage ${stage.type} completed (stub)`,
          metrics: { confidence: 0.8 },
        };
      }),
    now: () => Date.now(),
  };
}
