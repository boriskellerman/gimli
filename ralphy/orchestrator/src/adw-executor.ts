/**
 * ADW Executor - Runtime for AI Developer Workflows
 * 
 * This is the engine that runs the YAML-defined workflows,
 * spawning agents, coordinating steps, and tracking results.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

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
  private activeRuns: Map<string, WorkflowRun> = new Map();

  constructor(options: {
    workflowsDir: string;
    runsDir: string;
    expertsDir: string;
  }) {
    this.workflowsDir = options.workflowsDir;
    this.runsDir = options.runsDir;
    this.expertsDir = options.expertsDir;

    // Ensure directories exist
    if (!existsSync(this.runsDir)) {
      mkdirSync(this.runsDir, { recursive: true });
    }
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

        // Load expert if specified
        let expertContext = '';
        if (step.load_expert) {
          expertContext = this.loadExpert(step.load_expert);
        }

        // Build the prompt with variable substitution
        const prompt = this.interpolatePrompt(step.prompt, run, expertContext);

        // Execute the step
        const result = await this.executeStep(step, prompt, run);
        run.stepResults[step.name] = result;
        run.metrics.stepsCompleted++;
        run.metrics.totalTokens += result.tokens || 0;

        // Validate outputs
        if (step.validation) {
          for (const validation of step.validation) {
            if (!this.evaluateCondition(validation, run)) {
              throw new Error(`Validation failed for step ${step.name}: ${validation}`);
            }
          }
        }
      }

      run.status = 'success';
    } catch (error: any) {
      run.status = 'failed';
      run.error = error.message;
      console.error(`[${runId}] Workflow failed:`, error.message);
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
      const results = [];
      for (const item of items) {
        const itemPrompt = prompt.replace(/\{\{item\}\}/g, JSON.stringify(item));
        const result = await this.spawnAgent(agentType, itemPrompt);
        results.push(result);
      }
      return { items: results, tokens: results.reduce((sum, r) => sum + (r.tokens || 0), 0) };
    }

    // Single execution
    return await this.spawnAgent(agentType, prompt);
  }

  /**
   * Spawn an agent to execute a task
   * This integrates with Gimli's sessions_spawn
   */
  private async spawnAgent(agentType: string, prompt: string): Promise<AgentSpawnResult> {
    // In production, this would use Gimli's sessions_spawn tool
    // For now, we'll simulate the interface
    
    console.log(`  Spawning ${agentType} agent...`);
    console.log(`  Prompt length: ${prompt.length} chars`);

    // This is where we'd call sessions_spawn
    // const result = await sessionsSpawn({
    //   task: prompt,
    //   label: `adw-${agentType}`,
    //   timeoutSeconds: 300,
    // });

    // Simulated response structure
    return {
      sessionKey: `agent:iso:${agentType}-${Date.now()}`,
      output: `[Agent ${agentType} would execute here]`,
      tokens: 1000, // Would come from actual usage
      success: true,
    };
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
   * Load an expert YAML file for context
   */
  private loadExpert(expertName: string): string {
    const path = join(this.expertsDir, expertName);
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    console.warn(`Expert not found: ${expertName}`);
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
}

export default ADWExecutor;
