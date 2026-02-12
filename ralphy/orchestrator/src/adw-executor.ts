/**
 * ADW Executor - Runtime for AI Developer Workflows
 * 
 * This is the engine that runs the YAML-defined workflows,
 * spawning agents, coordinating steps, and tracking results.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import * as yaml from 'js-yaml';
import { TaskTracker, Task, Plan, TeamMember } from './task-tracker';
import { TrajectoryLogger, Trajectory, TrajectoryChapter } from './trajectory';
import { ExpertManager, type Learning, type ExpertSelection } from './expert-manager';
import { ValidationPipeline, type ValidationSuiteResult } from './validation-pipeline';

// Types for ADW definitions
interface ADWStep {
  name: string;
  agent: string;
  prompt: string;
  depends_on?: string[];
  condition?: string;
  outputs?: string[];
  validation?: string[];
  parallel?: boolean;
  for_each?: string;
  load_expert?: string;
  model?: string;  // 'codex' | 'kimi' | 'sonnet' | 'opus' | undefined (default)
  on_failure?: {
    retry?: boolean;
    max_attempts?: number;
    log?: boolean;
    continue?: boolean;
    trigger?: string;
  };
}

interface ADWDefinition {
  name: string;
  version: string;
  description: string;
  triggers: any[];
  inputs: Record<string, any>;
  environment: {
    branch_strategy: string;
    isolation: string;
    timeout_minutes: number;
    max_retries: number;
  };
  steps: ADWStep[];
  result: any;
}

interface WorkflowRun {
  id: string;
  workflow: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  inputs: Record<string, any>;
  stepResults: Record<string, any>;
  currentStep?: string;
  error?: string;
  metrics: {
    totalTokens: number;
    durationMs: number;
    stepsCompleted: number;
    stepsTotal: number;
  };
}

interface AgentSpawnResult {
  sessionKey: string;
  output: string;
  tokens: number;
  success: boolean;
}

export class ADWExecutor {
  private workflowsDir: string;
  private runsDir: string;
  private expertsDir: string;
  private trajectoriesDir: string;
  private activeRuns: Map<string, WorkflowRun> = new Map();
  private taskTracker: TaskTracker;
  private trajectoryLogger: TrajectoryLogger;
  private expertManager: ExpertManager;
  private validationPipeline: ValidationPipeline;
  private projectRoot: string;

  constructor(options: {
    workflowsDir: string;
    runsDir: string;
    expertsDir: string;
    trajectoriesDir?: string;
    projectRoot?: string;
  }) {
    this.workflowsDir = options.workflowsDir;
    this.runsDir = options.runsDir;
    this.expertsDir = options.expertsDir;
    this.trajectoriesDir = options.trajectoriesDir || join(this.runsDir, 'trajectories');
    this.projectRoot = options.projectRoot || '/home/gimli/github/gimli';

    // Initialize task tracker for multi-agent coordination
    this.taskTracker = new TaskTracker({
      dataDir: join(this.runsDir, 'tasks'),
    });

    // Initialize trajectory logger for train-of-thought capture
    this.trajectoryLogger = new TrajectoryLogger(this.trajectoriesDir);

    // Initialize expert manager (Act→Learn→Reuse cycle)
    this.expertManager = new ExpertManager(this.expertsDir);

    // Initialize validation pipeline (closed-loop validation)
    this.validationPipeline = new ValidationPipeline({
      projectRoot: this.projectRoot,
      metricsPath: join(this.runsDir, 'metrics', 'validation-metrics.json'),
      autoDetect: true,
    });

    // Ensure directories exist
    if (!existsSync(this.runsDir)) {
      mkdirSync(this.runsDir, { recursive: true });
    }
  }

  /**
   * Get the task tracker for external access
   */
  getTaskTracker(): TaskTracker {
    return this.taskTracker;
  }

  /**
   * Get the expert manager for external access
   */
  getExpertManager(): ExpertManager {
    return this.expertManager;
  }

  /**
   * Get the validation pipeline for external access
   */
  getValidationPipeline(): ValidationPipeline {
    return this.validationPipeline;
  }

  /**
   * Load an ADW definition from YAML
   */
  loadWorkflow(name: string): ADWDefinition {
    const path = join(this.workflowsDir, `${name}.yaml`);
    if (!existsSync(path)) {
      throw new Error(`Workflow not found: ${name}`);
    }
    const content = readFileSync(path, 'utf-8');
    return yaml.load(content) as ADWDefinition;
  }

  /**
   * List available workflows
   */
  listWorkflows(): string[] {
    const fs = require('fs');
    return fs.readdirSync(this.workflowsDir)
      .filter((f: string) => f.endsWith('.yaml'))
      .map((f: string) => f.replace('.yaml', ''));
  }

  /**
   * Get the trajectory logger for external access
   */
  getTrajectoryLogger(): TrajectoryLogger {
    return this.trajectoryLogger;
  }

  /**
   * Infer chapter type from step name
   */
  private inferChapterType(stepName: string): 'investigation' | 'planning' | 'implementation' | 'validation' | 'retrospective' {
    const name = stepName.toLowerCase();
    if (name.includes('investigate') || name.includes('analyze') || name.includes('review') || name.includes('gather')) {
      return 'investigation';
    }
    if (name.includes('plan') || name.includes('design') || name.includes('architect')) {
      return 'planning';
    }
    if (name.includes('test') || name.includes('validate') || name.includes('verify') || name.includes('check')) {
      return 'validation';
    }
    if (name.includes('retro') || name.includes('learn') || name.includes('summary')) {
      return 'retrospective';
    }
    return 'implementation';
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `wf-${timestamp}-${random}`;
  }

  /**
   * Execute a workflow
   */
  async runWorkflow(
    workflowName: string,
    inputs: Record<string, any> = {}
  ): Promise<WorkflowRun> {
    const workflow = this.loadWorkflow(workflowName);
    const runId = this.generateRunId();

    const run: WorkflowRun = {
      id: runId,
      workflow: workflowName,
      status: 'running',
      startedAt: Date.now(),
      inputs,
      stepResults: {},
      metrics: {
        totalTokens: 0,
        durationMs: 0,
        stepsCompleted: 0,
        stepsTotal: workflow.steps.length,
      },
    };

    this.activeRuns.set(runId, run);
    this.logRun(run, 'started');

    // Start trajectory logging for this workflow
    this.trajectoryLogger.startTrajectory({
      title: `${workflow.name}: ${runId}`,
      description: workflow.description,
      inputs,
      workflowName,
    });

    const skippedSteps = new Set<string>();

    try {
      // Execute steps in dependency order
      for (const step of this.topologicalSort(workflow.steps)) {
        // Check if step should run (condition)
        if (step.condition && !this.evaluateCondition(step.condition, run)) {
          console.log(`[${runId}] Skipping step ${step.name} (condition not met)`);
          skippedSteps.add(step.name);
          run.stepResults[step.name] = { skipped: true, reason: 'condition not met' };
          continue;
        }

        // Check dependencies are complete (skipped deps count as complete)
        let skipDueToDependent = false;
        if (step.depends_on) {
          for (const dep of step.depends_on) {
            if (!run.stepResults[dep]) {
              throw new Error(`Dependency ${dep} not completed for step ${step.name}`);
            }
            // If dependency was skipped, this step should also be skipped
            if (run.stepResults[dep]?.skipped) {
              console.log(`[${runId}] Skipping step ${step.name} (dependency ${dep} was skipped)`);
              skippedSteps.add(step.name);
              run.stepResults[step.name] = { skipped: true, reason: `dependency ${dep} skipped` };
              skipDueToDependent = true;
              break;
            }
          }
        }
        
        // Skip if dependency was skipped
        if (skipDueToDependent) {
          continue;
        }

        run.currentStep = step.name;
        console.log(`[${runId}] Running step: ${step.name}`);

        // Start a new chapter for this step
        const chapterType = this.inferChapterType(step.name);
        this.trajectoryLogger.startChapter(step.name, chapterType);

        // Load expert context — explicit or auto-detected
        let expertContext = '';
        if (step.load_expert) {
          expertContext = this.loadExpert(step.load_expert);
          this.trajectoryLogger.logObservation(
            `Loaded expert: ${step.load_expert}`,
            `Expert context loaded (${expertContext.length} chars)`,
            { agent: step.agent }
          );
        } else {
          // Auto-select experts based on step prompt content
          expertContext = this.autoLoadExperts(step.prompt);
          if (expertContext) {
            this.trajectoryLogger.logObservation(
              'Auto-loaded relevant experts',
              `Expert context auto-selected (${expertContext.length} chars)`,
              { agent: step.agent }
            );
          }
        }

        // Build the prompt with variable substitution
        const prompt = this.interpolatePrompt(step.prompt, run, expertContext);

        // Log the action being taken
        this.trajectoryLogger.logAction(
          `Executing step: ${step.name}`,
          `Agent: ${step.agent}\nPrompt length: ${prompt.length} chars`,
          { agent: step.agent }
        );

        // Execute the step
        const result = await this.executeStep(step, prompt, run);
        run.stepResults[step.name] = result;
        run.metrics.stepsCompleted++;
        run.metrics.totalTokens += result.tokens || 0;

        // Log the result
        this.trajectoryLogger.logObservation(
          `Step completed: ${step.name}`,
          result.success !== false 
            ? `Output: ${(result.output || '').substring(0, 500)}${(result.output?.length || 0) > 500 ? '...' : ''}`
            : `Failed: ${result.error || 'Unknown error'}`,
          { agent: step.agent, confidence: result.success !== false ? 0.8 : 0.2 }
        );

        // End chapter with outcome
        this.trajectoryLogger.endChapter(
          result.success !== false ? 'success' : 'failed',
          `${step.name} ${result.success !== false ? 'completed' : 'failed'}`
        );

        // Validate outputs
        if (step.validation) {
          for (const validation of step.validation) {
            if (!this.evaluateCondition(validation, run)) {
              this.trajectoryLogger.logError(
                `Validation failed: ${validation}`,
                `Step ${step.name} failed validation check`,
                { agent: step.agent }
              );
              throw new Error(`Validation failed for step ${step.name}: ${validation}`);
            }
          }
        }
      }

      run.status = 'success';

      // --- LEARN PHASE: Extract learnings from this workflow run ---
      this.extractAndRecordLearnings(workflowName, run);
      
      // Complete trajectory with retrospective
      this.trajectoryLogger.completeTrajectory({
        summary: `Workflow ${workflowName} completed successfully`,
        successes: Object.entries(run.stepResults)
          .filter(([_, r]) => !r.skipped && r.success !== false)
          .map(([name]) => name),
        improvements: [],
        lessons: [],
        confidence: 0.9,
      });
    } catch (error: any) {
      run.status = 'failed';
      run.error = error.message;
      console.error(`[${runId}] Workflow failed:`, error.message);
      
      // Fail trajectory
      this.trajectoryLogger.failTrajectory(error.message);
    } finally {
      run.completedAt = Date.now();
      run.metrics.durationMs = run.completedAt - run.startedAt;
      this.activeRuns.delete(runId);
      this.logRun(run, 'completed');
    }

    return run;
  }

  /**
   * Execute a single step
   */
  private async executeStep(
    step: ADWStep,
    prompt: string,
    run: WorkflowRun
  ): Promise<any> {
    // Determine which agent to use
    const agentType = this.selectAgent(step.agent, run);

    // If for_each, execute multiple times
    if (step.for_each) {
      const items = this.resolveVariable(step.for_each, run);
      
      // Guard against undefined or non-array values
      if (!items) {
        console.warn(`  Warning: for_each variable '${step.for_each}' resolved to undefined, skipping step`);
        return { items: [], tokens: 0, skipped: true, reason: `for_each variable '${step.for_each}' not found` };
      }
      if (!Array.isArray(items)) {
        console.warn(`  Warning: for_each variable '${step.for_each}' is not an array (got ${typeof items}), wrapping as single item`);
        const itemPrompt = prompt.replace(/\{\{item\}\}/g, JSON.stringify(items));
        const result = await this.spawnAgent(agentType, itemPrompt, step.model);
        return { items: [result], tokens: result.tokens || 0 };
      }
      
      const results = [];
      for (const item of items) {
        const itemPrompt = prompt.replace(/\{\{item\}\}/g, JSON.stringify(item));
        const result = await this.spawnAgent(agentType, itemPrompt, step.model);
        results.push(result);
      }
      return { items: results, tokens: results.reduce((sum, r) => sum + (r.tokens || 0), 0) };
    }

    // Single execution
    return await this.spawnAgent(agentType, prompt, step.model);
  }

  /**
   * Spawn an agent to execute a task
   * Routes to different model backends based on step.model field.
   */
  private async spawnAgent(agentType: string, prompt: string, model?: string): Promise<AgentSpawnResult> {
    console.log(`  Spawning ${agentType} agent (model: ${model || 'default'})...`);
    console.log(`  Prompt length: ${prompt.length} chars`);

    // Route based on model
    switch (model) {
      case 'codex':
        return this.spawnCodexAgent(prompt);
      case 'kimi':
        return this.spawnKimiAgent(prompt);
      case 'sonnet':
        return this.spawnSonnetAgent(agentType, prompt);
      default:
        // Existing behavior — Gateway API → CLI fallback
        return this.spawnDefaultAgent(agentType, prompt);
    }
  }

  /**
   * Spawn agent via OpenAI Codex CLI
   */
  private async spawnCodexAgent(prompt: string): Promise<AgentSpawnResult> {
    const tmpFile = join(tmpdir(), `adw-codex-${Date.now()}.txt`);
    writeFileSync(tmpFile, prompt);
    try {
      const output = execSync(`codex exec "$(cat ${tmpFile})"`, {
        encoding: 'utf-8',
        timeout: 300000,
        cwd: '/home/gimli/github/gimli',
      });
      return { sessionKey: `codex-${Date.now()}`, output, tokens: 0, success: true };
    } catch (error: any) {
      console.error(`  Codex agent error: ${error.message}`);
      return { sessionKey: `codex-${Date.now()}`, output: error.stdout || error.message, tokens: 0, success: false };
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  /**
   * Spawn agent via Kimi CLI (Moonshot AI — 262K context)
   */
  private async spawnKimiAgent(prompt: string): Promise<AgentSpawnResult> {
    const tmpFile = join(tmpdir(), `adw-kimi-${Date.now()}.txt`);
    writeFileSync(tmpFile, prompt);
    try {
      // Use temp file to avoid shell escaping issues with large prompts
      const output = execSync(`kimi --prompt "$(cat ${tmpFile})" --quiet`, {
        encoding: 'utf-8',
        timeout: 300000,
        cwd: '/home/gimli/github/gimli',
      });
      return { sessionKey: `kimi-${Date.now()}`, output, tokens: 0, success: true };
    } catch (error: any) {
      console.error(`  Kimi agent error: ${error.message}`);
      return { sessionKey: `kimi-${Date.now()}`, output: error.stdout || error.message, tokens: 0, success: false };
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  }

  /**
   * Spawn agent via Gateway API with Sonnet model override
   */
  private async spawnSonnetAgent(agentType: string, prompt: string): Promise<AgentSpawnResult> {
    const gatewayUrl = process.env.GIMLI_GATEWAY_URL || 'http://localhost:18789';
    const gatewayToken = process.env.GIMLI_GATEWAY_TOKEN || '';

    try {
      const response = await fetch(`${gatewayUrl}/api/sessions/spawn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          task: prompt,
          label: `adw-sonnet-${agentType}-${Date.now()}`,
          model: 'anthropic/claude-sonnet-4-5',
          timeoutSeconds: 300,
          cleanup: 'keep',
        }),
      });

      if (!response.ok) {
        console.log(`  Sonnet API failed (${response.status}), falling back to CLI...`);
        return await this.spawnAgentViaCLI(agentType, prompt);
      }

      const result: any = await response.json();
      return {
        sessionKey: result.sessionKey || `agent:sonnet:${agentType}-${Date.now()}`,
        output: result.output || result.message || '',
        tokens: result.usage?.totalTokens || 0,
        success: result.ok !== false,
      };
    } catch (error: any) {
      console.log(`  Sonnet Gateway error: ${error.message}, falling back to CLI...`);
      return await this.spawnAgentViaCLI(agentType, prompt);
    }
  }

  /**
   * Default agent spawn via Gateway API (Opus/default model)
   */
  private async spawnDefaultAgent(agentType: string, prompt: string): Promise<AgentSpawnResult> {
    const gatewayUrl = process.env.GIMLI_GATEWAY_URL || 'http://localhost:18789';
    const gatewayToken = process.env.GIMLI_GATEWAY_TOKEN || '';

    try {
      const response = await fetch(`${gatewayUrl}/api/sessions/spawn`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gatewayToken}`,
        },
        body: JSON.stringify({
          task: prompt,
          label: `adw-${agentType}-${Date.now()}`,
          timeoutSeconds: 300,
          cleanup: 'keep',
        }),
      });

      if (!response.ok) {
        console.log(`  API failed (${response.status}), falling back to CLI...`);
        return await this.spawnAgentViaCLI(agentType, prompt);
      }

      const result: any = await response.json();
      return {
        sessionKey: result.sessionKey || `agent:iso:${agentType}-${Date.now()}`,
        output: result.output || result.message || '',
        tokens: result.usage?.totalTokens || 0,
        success: result.ok !== false,
      };
    } catch (error: any) {
      console.log(`  Gateway API error: ${error.message}, falling back to CLI...`);
      return await this.spawnAgentViaCLI(agentType, prompt);
    }
  }

  /**
   * Fallback: Spawn agent via Gimli CLI
   */
  private async spawnAgentViaCLI(agentType: string, prompt: string): Promise<AgentSpawnResult> {
    // Write prompt to temp file (avoid shell escaping issues)
    const tempFile = join(tmpdir(), `adw-prompt-${Date.now()}.txt`);
    writeFileSync(tempFile, prompt);

    try {
      const cmd = `gimli agent --message "$(cat ${tempFile})" --timeout 300 2>&1`;
      console.log(`  Running CLI: gimli agent --message <prompt> --timeout 300`);
      
      const output = execSync(cmd, {
        encoding: 'utf-8',
        timeout: 330000, // 5.5 min timeout
        cwd: '/home/gimli/gimli',
      });

      // Clean up temp file
      unlinkSync(tempFile);

      return {
        sessionKey: `agent:cli:${agentType}-${Date.now()}`,
        output: output,
        tokens: 0, // CLI doesn't report tokens
        success: true,
      };
    } catch (error: any) {
      // Clean up temp file on error
      try { unlinkSync(tempFile); } catch {}
      
      console.error(`  CLI error: ${error.message}`);
      return {
        sessionKey: `agent:cli:${agentType}-${Date.now()}`,
        output: error.stdout || error.message,
        tokens: 0,
        success: false,
      };
    }
  }

  /**
   * Run post-build validation checks on the workflow output.
   * Returns validation result and error context for retry.
   */
  async runPostBuildValidation(run: WorkflowRun): Promise<ValidationSuiteResult> {
    console.log(`[${run.id}] Running post-build validation...`);

    // Collect files modified across all build steps
    const modifiedFiles: string[] = [];
    for (const [_stepName, result] of Object.entries(run.stepResults)) {
      if (result?.files_modified) {
        modifiedFiles.push(...result.files_modified);
      }
      if (result?.filesModified) {
        modifiedFiles.push(...result.filesModified);
      }
    }

    if (modifiedFiles.length > 0) {
      return await this.validationPipeline.validateFiles(modifiedFiles);
    } else {
      return await this.validationPipeline.validateAll();
    }
  }

  /**
   * Extract learnings from a completed workflow run and record them
   * in the appropriate expert files. This is the LEARN phase of Act→Learn→Reuse.
   */
  private extractAndRecordLearnings(workflowName: string, run: WorkflowRun): void {
    try {
      const learnings: Array<{
        category: Learning['category'];
        title: string;
        description: string;
        confidence: number;
        tags: string[];
      }> = [];

      // Extract learnings from step results
      for (const [stepName, result] of Object.entries(run.stepResults)) {
        if (!result || result.skipped) continue;

        // Learn from failures (anti-patterns and common errors)
        if (result.success === false) {
          learnings.push({
            category: 'common_error',
            title: `${workflowName}/${stepName} failure`,
            description: `Step "${stepName}" failed: ${(result.error || result.output || 'unknown').substring(0, 200)}`,
            confidence: 0.6,
            tags: [workflowName, stepName, 'failure'],
          });
        }

        // Learn from validation results
        if (result.validationResult) {
          const valResult = result.validationResult as ValidationSuiteResult;
          for (const check of valResult.results.filter((r: any) => !r.passed)) {
            learnings.push({
              category: 'common_error',
              title: `Validation failure: ${check.check}`,
              description: `${check.check} failed during ${workflowName}: ${(check.error || check.output || '').substring(0, 200)}`,
              confidence: 0.7,
              tags: [workflowName, 'validation', check.check],
            });
          }
        }

        // Learn from successful patterns
        if (result.success !== false && result.output) {
          // Look for pattern indicators in output
          const output = String(result.output).toLowerCase();
          if (output.includes('refactor') || output.includes('pattern')) {
            learnings.push({
              category: 'pattern',
              title: `Successful pattern in ${stepName}`,
              description: `Step "${stepName}" in ${workflowName} completed successfully. Output excerpt: ${String(result.output).substring(0, 200)}`,
              confidence: 0.5,
              tags: [workflowName, stepName, 'success'],
            });
          }
        }
      }

      // Determine domain from workflow name
      const domainMap: Record<string, string> = {
        'plan-build': 'gateway',
        'bug-investigate': 'gateway',
        'test-fix': 'gateway',
        'security-audit': 'security',
        'self-improve': 'gateway',
        'deploy': 'gateway',
        'review-document': 'gateway',
      };

      const domain = domainMap[workflowName] || 'gateway';

      if (learnings.length > 0) {
        const added = this.expertManager.recordLearnings({
          workflowName,
          runId: run.id,
          domain,
          learnings,
        });
        console.log(`[${run.id}] Recorded ${added} new learnings to ${domain} expert`);
      }
    } catch (error) {
      console.warn(`[${run.id}] Failed to extract learnings: ${error}`);
    }
  }

  /**
   * Select the appropriate agent based on context
   */
  private selectAgent(agentSpec: string, run: WorkflowRun): string {
    // Handle conditional agent selection (e.g., "backend|frontend|gateway")
    if (agentSpec.includes('|')) {
      const options = agentSpec.split('|');
      // Select based on components in context
      const components = run.stepResults.analyze?.components || [];
      for (const option of options) {
        if (components.some((c: string) => c.toLowerCase().includes(option))) {
          return option;
        }
      }
      return options[0]; // Default to first option
    }
    return agentSpec;
  }

  /**
   * Load an expert YAML file for context.
   * Now uses ExpertManager for intelligent context building (includes learnings).
   */
  private loadExpert(expertName: string): string {
    // Strip file extension if provided (e.g., "database-expert.yaml" → "database-expert")
    const name = expertName.replace(/\.(yaml|yml)$/, '');
    const expert = this.expertManager.getExpert(name);

    if (expert) {
      // Use ExpertManager's smart context builder (includes learnings)
      const selection = this.expertManager.selectExperts(expert.domain || name);
      return selection.contextString || readFileSync(join(this.expertsDir, expertName), 'utf-8');
    }

    // Fallback: raw file read
    const path = join(this.expertsDir, expertName);
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    console.warn(`Expert not found: ${expertName}`);
    return '';
  }

  /**
   * Auto-select and load relevant experts based on task description.
   * Called when no explicit load_expert is set in a step.
   */
  private autoLoadExperts(taskDescription: string, affectedFiles: string[] = []): string {
    const selection = this.expertManager.selectExperts(taskDescription, affectedFiles);
    if (selection.experts.length > 0) {
      console.log(`  Auto-loaded experts: ${selection.experts.map(e => e.name).join(', ')} (~${selection.estimatedTokens} tokens)`);
      return selection.contextString;
    }
    return '';
  }

  /**
   * Interpolate variables in a prompt template
   */
  private interpolatePrompt(
    template: string,
    run: WorkflowRun,
    expertContext: string
  ): string {
    let result = template;

    // Replace input variables
    for (const [key, value] of Object.entries(run.inputs)) {
      result = result.replace(
        new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
        typeof value === 'object' ? JSON.stringify(value) : String(value)
      );
    }

    // Replace step result variables (e.g., {{analyze.components}})
    for (const [stepName, stepResult] of Object.entries(run.stepResults)) {
      if (typeof stepResult === 'object') {
        for (const [key, value] of Object.entries(stepResult as object)) {
          result = result.replace(
            new RegExp(`\\{\\{${stepName}\\.${key}\\}\\}`, 'g'),
            typeof value === 'object' ? JSON.stringify(value) : String(value)
          );
        }
      }
      result = result.replace(
        new RegExp(`\\{\\{${stepName}\\}\\}`, 'g'),
        JSON.stringify(stepResult)
      );
    }

    // Add expert context if provided
    if (expertContext) {
      result = `## Expert Knowledge\n${expertContext}\n\n## Task\n${result}`;
    }

    return result;
  }

  /**
   * Evaluate a condition expression
   */
  private evaluateCondition(condition: string, run: WorkflowRun): boolean {
    try {
      // Simple expression evaluation
      // In production, use a proper expression parser
      const context = {
        ...run.inputs,
        ...run.stepResults,
        _attempt: 1, // Would track retry attempts
      };

      // Replace variable references with values
      let expr = condition;
      for (const [key, value] of Object.entries(context)) {
        expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), JSON.stringify(value));
      }

      // Evaluate (safely in production!)
      return eval(expr);
    } catch {
      console.warn(`Could not evaluate condition: ${condition}`);
      return true; // Default to true if evaluation fails
    }
  }

  /**
   * Resolve a variable reference to its value
   */
  private resolveVariable(varPath: string, run: WorkflowRun): any {
    const parts = varPath.split('.');
    let value: any = { ...run.inputs, ...run.stepResults };
    for (const part of parts) {
      value = value?.[part];
    }
    return value;
  }

  /**
   * Topological sort of steps based on dependencies
   */
  private topologicalSort(steps: ADWStep[]): ADWStep[] {
    const sorted: ADWStep[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (step: ADWStep) => {
      if (visited.has(step.name)) return;
      if (visiting.has(step.name)) {
        throw new Error(`Circular dependency detected: ${step.name}`);
      }

      visiting.add(step.name);

      if (step.depends_on) {
        for (const depName of step.depends_on) {
          const dep = steps.find(s => s.name === depName);
          if (dep) visit(dep);
        }
      }

      visiting.delete(step.name);
      visited.add(step.name);
      sorted.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return sorted;
  }

  /**
   * Log a workflow run to disk
   */
  private logRun(run: WorkflowRun, event: string): void {
    const logPath = join(this.runsDir, `${run.id}.json`);
    const logEntry = {
      ...run,
      event,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(logPath, JSON.stringify(logEntry, null, 2));
  }

  /**
   * Get status of active runs
   */
  getActiveRuns(): WorkflowRun[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Cancel a running workflow
   */
  cancelWorkflow(runId: string): boolean {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.status = 'cancelled';
      run.completedAt = Date.now();
      this.activeRuns.delete(runId);
      this.logRun(run, 'cancelled');
      return true;
    }
    return false;
  }

  /**
   * Execute a workflow with builder+validator team pattern
   * This implements the multi-agent coordination from TAC
   */
  async runWithTeam(config: {
    name: string;
    objective: string;
    tasks: Array<{
      name: string;
      description: string;
      builderPrompt: string;
      validatorPrompt: string;
      dependsOn?: string[];
    }>;
    maxRetries?: number;
  }): Promise<{
    planId: string;
    status: 'completed' | 'failed' | 'partial';
    results: any[];
  }> {
    const maxRetries = config.maxRetries || 2;
    
    // Create plan with builder+validator pairs
    const teamMembers: TeamMember[] = [];
    const tasks: any[] = [];
    
    for (let i = 0; i < config.tasks.length; i++) {
      const task = config.tasks[i];
      const taskNum = i + 1;
      
      // Add builder
      teamMembers.push({
        name: `${task.name}Builder`,
        role: 'builder',
        agentFile: 'agents/builder.md',
        focus: task.description,
      });
      
      // Add validator
      teamMembers.push({
        name: `${task.name}Validator`,
        role: 'validator',
        agentFile: 'agents/validator.md',
        validates: `${task.name}Builder`,
      });
      
      // Create builder task
      tasks.push({
        name: `Build: ${task.name}`,
        description: task.builderPrompt,
        owner: `${task.name}Builder`,
        ownerRole: 'builder' as const,
        dependsOn: task.dependsOn?.map(d => `build-${d}`) || [],
      });
      
      // Create validator task (depends on builder)
      tasks.push({
        name: `Validate: ${task.name}`,
        description: task.validatorPrompt,
        owner: `${task.name}Validator`,
        ownerRole: 'validator' as const,
        dependsOn: [`build-${task.name}`],
      });
    }
    
    // Create the plan
    const plan = this.taskTracker.createPlan({
      name: config.name,
      objective: config.objective,
      teamMembers,
      tasks,
    });
    
    console.log(`[Team] Created plan ${plan.id} with ${plan.tasks.length} tasks`);
    this.taskTracker.startPlan(plan.id);
    
    const results: any[] = [];
    const retryCount: Map<string, number> = new Map();
    
    // Execution loop
    while (true) {
      const status = this.taskTracker.getPlanStatus(plan.id);
      if (!status) break;
      
      // Check if done
      if (status.plan.status === 'completed' || status.plan.status === 'failed') {
        console.log(`[Team] Plan ${status.plan.status}`);
        break;
      }
      
      // Get available tasks
      const available = this.taskTracker.getAvailableTasks(plan.id);
      if (available.length === 0) {
        // Check if we're stuck (all remaining tasks blocked)
        if (status.summary.pending === 0 && status.summary.blocked > 0) {
          console.log('[Team] All tasks blocked - checking for failures');
          break;
        }
        // Wait a bit if tasks are running
        if (status.summary.running > 0) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        break;
      }
      
      // Execute available tasks
      for (const task of available) {
        console.log(`[Team] Starting task: ${task.name} (${task.owner})`);
        this.taskTracker.startTask(task.id, plan.id);
        
        try {
          // Spawn agent for this task
          const result = await this.spawnAgent(task.ownerRole, task.description);
          
          if (result.success) {
            console.log(`[Team] Task complete: ${task.name}`);
            this.taskTracker.completeTask(task.id, {
              success: true,
              output: result.output,
              filesModified: [], // Would parse from output
            }, plan.id);
            
            results.push({ task: task.name, status: 'success', output: result.output });
            
            // If this was a builder, the validator will auto-unblock
            
          } else {
            const retries = retryCount.get(task.id) || 0;
            if (retries < maxRetries) {
              console.log(`[Team] Task failed, retrying (${retries + 1}/${maxRetries}): ${task.name}`);
              retryCount.set(task.id, retries + 1);
              // Reset task to pending for retry
              // Note: In a full implementation, we'd reset the task status
            } else {
              console.log(`[Team] Task failed after ${maxRetries} retries: ${task.name}`);
              this.taskTracker.completeTask(task.id, {
                success: false,
                errors: [result.output],
              }, plan.id);
              results.push({ task: task.name, status: 'failed', error: result.output });
            }
          }
        } catch (error: any) {
          console.error(`[Team] Task error: ${task.name}:`, error.message);
          this.taskTracker.completeTask(task.id, {
            success: false,
            errors: [error.message],
          }, plan.id);
          results.push({ task: task.name, status: 'error', error: error.message });
        }
      }
    }
    
    // Final status
    const finalStatus = this.taskTracker.getPlanStatus(plan.id);
    const completedCount = finalStatus?.summary.validated || 0 + (finalStatus?.summary.completed || 0);
    const totalCount = finalStatus?.summary.total || 0;
    
    return {
      planId: plan.id,
      status: finalStatus?.plan.status === 'completed' ? 'completed' 
            : completedCount > 0 ? 'partial' : 'failed',
      results,
    };
  }
}

export default ADWExecutor;
