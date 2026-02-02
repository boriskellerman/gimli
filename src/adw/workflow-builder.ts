/**
 * Workflow Builder - Fluent API for building ADW pipelines
 *
 * Provides a clean, chainable API for creating workflows:
 *
 * const workflow = createWorkflow("my-workflow")
 *   .addStep("step1", "First Step", async (input) => { ... })
 *   .addStep("step2", "Second Step", async (input) => { ... })
 *   .withRetry({ maxAttempts: 3 })
 *   .build();
 */

import type { StepDefinition, StepRetryConfig, WorkflowDefinition } from "./types.js";

export class WorkflowBuilder<TInput = unknown, TOutput = unknown, TContext = unknown> {
  private id: string;
  private name: string;
  private description?: string;
  private version?: string;
  private steps: StepDefinition<unknown, unknown, TContext>[] = [];
  private initContextFn?: (input: TInput) => TContext | Promise<TContext>;
  private transformOutputFn?: (
    stepResults: Map<string, unknown>,
    context: TContext,
  ) => TOutput | Promise<TOutput>;
  private defaultRetryConfig?: StepRetryConfig;
  private timeoutMs?: number;
  private abortOnError = true;

  constructor(id: string, name?: string) {
    this.id = id;
    this.name = name ?? id;
  }

  /**
   * Set workflow description
   */
  describe(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Set workflow version
   */
  setVersion(version: string): this {
    this.version = version;
    return this;
  }

  /**
   * Set context initializer
   */
  initContext(fn: (input: TInput) => TContext | Promise<TContext>): this {
    this.initContextFn = fn;
    return this;
  }

  /**
   * Set output transformer
   */
  transformOutput(
    fn: (stepResults: Map<string, unknown>, context: TContext) => TOutput | Promise<TOutput>,
  ): this {
    this.transformOutputFn = fn;
    return this;
  }

  /**
   * Add a step to the workflow
   */
  addStep<TStepInput = unknown, TStepOutput = unknown>(
    id: string,
    name: string,
    execute: (input: TStepInput, context: TContext) => Promise<TStepOutput>,
    options?: Partial<
      Omit<StepDefinition<TStepInput, TStepOutput, TContext>, "id" | "name" | "execute">
    >,
  ): this {
    this.steps.push({
      id,
      name,
      execute: execute as (input: unknown, context: TContext) => Promise<unknown>,
      ...options,
    } as StepDefinition<unknown, unknown, TContext>);
    return this;
  }

  /**
   * Add a validation step (no transformation, just validates)
   */
  addValidation<TData = unknown>(
    id: string,
    name: string,
    validate: (data: TData, context: TContext) => boolean | string | Promise<boolean | string>,
  ): this {
    this.steps.push({
      id,
      name,
      execute: async (input: unknown) => input,
      validate: validate as (
        input: unknown,
        context: TContext,
      ) => boolean | string | Promise<boolean | string>,
    });
    return this;
  }

  /**
   * Add a conditional step
   */
  addConditionalStep<TStepInput = unknown, TStepOutput = unknown>(
    id: string,
    name: string,
    condition: (context: TContext) => boolean | Promise<boolean>,
    execute: (input: TStepInput, context: TContext) => Promise<TStepOutput>,
    options?: Partial<
      Omit<
        StepDefinition<TStepInput, TStepOutput, TContext>,
        "id" | "name" | "execute" | "shouldSkip"
      >
    >,
  ): this {
    this.steps.push({
      id,
      name,
      execute: execute as (input: unknown, context: TContext) => Promise<unknown>,
      shouldSkip: async (ctx) => !(await condition(ctx)),
      ...options,
    } as StepDefinition<unknown, unknown, TContext>);
    return this;
  }

  /**
   * Set default retry configuration for all steps
   */
  withRetry(config: StepRetryConfig): this {
    this.defaultRetryConfig = config;
    return this;
  }

  /**
   * Set global timeout for the workflow
   */
  withTimeout(timeoutMs: number): this {
    this.timeoutMs = timeoutMs;
    return this;
  }

  /**
   * Continue execution even if a step fails
   */
  continueOnError(): this {
    this.abortOnError = false;
    return this;
  }

  /**
   * Build the workflow definition
   */
  build(): WorkflowDefinition<TInput, TOutput, TContext> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      steps: this.steps,
      initContext: this.initContextFn,
      transformOutput: this.transformOutputFn,
      defaultRetry: this.defaultRetryConfig,
      timeoutMs: this.timeoutMs,
      abortOnError: this.abortOnError,
    };
  }
}

/**
 * Create a new workflow builder
 */
export function createWorkflow<TInput = unknown, TOutput = unknown, TContext = unknown>(
  id: string,
  name?: string,
): WorkflowBuilder<TInput, TOutput, TContext> {
  return new WorkflowBuilder<TInput, TOutput, TContext>(id, name);
}

/**
 * Common ADW Patterns
 */

/**
 * Plan → Build pattern: First plan the work, then execute
 */
export function createPlanBuildWorkflow<TInput, TPlan, TOutput, TContext>(
  id: string,
  options: {
    plan: (input: TInput, context: TContext) => Promise<TPlan>;
    build: (plan: TPlan, context: TContext) => Promise<TOutput>;
    validatePlan?: (plan: TPlan) => boolean | string;
    initContext?: (input: TInput) => TContext | Promise<TContext>;
  },
): WorkflowDefinition<TInput, TOutput, TContext> {
  return createWorkflow<TInput, TOutput, TContext>(id, `${id} (Plan → Build)`)
    .describe("Plan the work, then execute it")
    .initContext(options.initContext ?? ((input) => input as unknown as TContext))
    .addStep("plan", "Plan", options.plan, {
      validateOutput: options.validatePlan,
    })
    .addStep("build", "Build", options.build)
    .build();
}

/**
 * Build → Test → Fix loop pattern
 */
export function createBuildTestFixWorkflow<TInput, TBuild, TTest, TOutput, TContext>(
  id: string,
  options: {
    build: (input: TInput, context: TContext) => Promise<TBuild>;
    test: (build: TBuild, context: TContext) => Promise<TTest>;
    fix: (test: TTest, context: TContext) => Promise<TOutput>;
    shouldFix?: (test: TTest) => boolean;
    initContext?: (input: TInput) => TContext | Promise<TContext>;
    maxFixAttempts?: number;
  },
): WorkflowDefinition<TInput, TOutput, TContext> {
  return createWorkflow<TInput, TOutput, TContext>(id, `${id} (Build → Test → Fix)`)
    .describe("Build, run tests, fix issues if needed")
    .initContext(options.initContext ?? ((input) => input as unknown as TContext))
    .addStep("build", "Build", options.build)
    .addStep("test", "Test", options.test)
    .addConditionalStep(
      "fix",
      "Fix",
      (ctx) => {
        // Check if fix is needed based on test results
        const testResult = (ctx as Record<string, unknown>).testResult as TTest | undefined;
        return testResult ? (options.shouldFix?.(testResult) ?? false) : false;
      },
      options.fix,
      { retry: { maxAttempts: options.maxFixAttempts ?? 3 } },
    )
    .build();
}

/**
 * Review → Document pattern for code review workflows
 */
export function createReviewDocumentWorkflow<TInput, TReview, TOutput, TContext>(
  id: string,
  options: {
    review: (input: TInput, context: TContext) => Promise<TReview>;
    document: (review: TReview, context: TContext) => Promise<TOutput>;
    validateReview?: (review: TReview) => boolean | string;
    initContext?: (input: TInput) => TContext | Promise<TContext>;
  },
): WorkflowDefinition<TInput, TOutput, TContext> {
  return createWorkflow<TInput, TOutput, TContext>(id, `${id} (Review → Document)`)
    .describe("Review code/content, then document findings")
    .initContext(options.initContext ?? ((input) => input as unknown as TContext))
    .addStep("review", "Review", options.review, {
      validateOutput: options.validateReview,
    })
    .addStep("document", "Document", options.document)
    .build();
}

/**
 * Scout → Plan → Build pattern for research-first workflows
 */
export function createScoutPlanBuildWorkflow<TInput, TScout, TPlan, TOutput, TContext>(
  id: string,
  options: {
    scout: (input: TInput, context: TContext) => Promise<TScout>;
    plan: (scout: TScout, context: TContext) => Promise<TPlan>;
    build: (plan: TPlan, context: TContext) => Promise<TOutput>;
    validatePlan?: (plan: TPlan) => boolean | string;
    initContext?: (input: TInput) => TContext | Promise<TContext>;
  },
): WorkflowDefinition<TInput, TOutput, TContext> {
  return createWorkflow<TInput, TOutput, TContext>(id, `${id} (Scout → Plan → Build)`)
    .describe("Research first, then plan, then execute")
    .initContext(options.initContext ?? ((input) => input as unknown as TContext))
    .addStep("scout", "Scout", options.scout)
    .addStep("plan", "Plan", options.plan, {
      validateOutput: options.validatePlan,
    })
    .addStep("build", "Build", options.build)
    .build();
}

/**
 * Parallel iteration pattern for comparing multiple approaches
 */
export function createIterationWorkflow<TInput, TIteration, TOutput, TContext>(
  id: string,
  options: {
    /** Generate variations to try */
    generateIterations: (input: TInput, context: TContext) => Promise<TInput[]>;
    /** Execute each iteration */
    executeIteration: (input: TInput, context: TContext) => Promise<TIteration>;
    /** Compare and select best result */
    selectBest: (iterations: TIteration[], context: TContext) => Promise<TOutput>;
    initContext?: (input: TInput) => TContext | Promise<TContext>;
  },
): WorkflowDefinition<TInput, TOutput, TContext> {
  return createWorkflow<TInput, TOutput, TContext>(id, `${id} (Parallel Iterations)`)
    .describe("Try multiple approaches, select the best")
    .initContext(options.initContext ?? ((input) => input as unknown as TContext))
    .addStep("generate", "Generate Iterations", options.generateIterations)
    .addStep("execute", "Execute Iterations", async (inputs: unknown, ctx) => {
      const iterations = inputs as TInput[];
      const results: TIteration[] = [];
      for (const input of iterations) {
        results.push(await options.executeIteration(input, ctx));
      }
      return results;
    })
    .addStep("select", "Select Best", options.selectBest)
    .build();
}
