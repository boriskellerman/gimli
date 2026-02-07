/**
 * Task Tracker - Multi-Agent Task Management
 * 
 * Implements the task system pattern from IndyDevDan:
 * - Tasks with dependencies
 * - Builder + Validator pairing
 * - Status tracking and communication
 * - Automatic unblocking when dependencies complete
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface Task {
  id: string;
  name: string;
  description: string;
  owner: string;  // Agent name (e.g., "ComponentBuilder")
  ownerRole: 'builder' | 'validator' | 'orchestrator' | 'other';
  dependsOn: string[];  // Task IDs
  status: 'pending' | 'blocked' | 'running' | 'completed' | 'failed' | 'validated';
  result?: TaskResult;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  filesModified?: string[];
  errors?: string[];
  validationReport?: ValidationReport;
}

export interface ValidationReport {
  testsPass: boolean;
  lintPass: boolean;
  typeCheckPass: boolean;
  securityPass: boolean;
  issues: ValidationIssue[];
  recommendation: 'approve' | 'needs_work' | 'rejected';
}

export interface ValidationIssue {
  severity: 'critical' | 'warning' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface TeamMember {
  name: string;
  role: 'builder' | 'validator' | 'orchestrator';
  agentFile: string;
  focus?: string;
  validates?: string;  // For validators: which builder they validate
}

export interface Plan {
  id: string;
  name: string;
  objective: string;
  teamMembers: TeamMember[];
  tasks: Task[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export class TaskTracker {
  private dataDir: string;
  private plans: Map<string, Plan> = new Map();
  private activePlanId: string | null = null;

  constructor(options: { dataDir: string }) {
    this.dataDir = options.dataDir;
    
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    
    this.loadPlans();
  }

  /**
   * Load existing plans from disk
   */
  private loadPlans(): void {
    const indexPath = join(this.dataDir, 'plans-index.json');
    if (existsSync(indexPath)) {
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
      for (const planId of index.planIds || []) {
        const planPath = join(this.dataDir, `plan-${planId}.json`);
        if (existsSync(planPath)) {
          const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
          this.plans.set(planId, plan);
        }
      }
    }
  }

  /**
   * Save plans to disk
   */
  private savePlans(): void {
    // Save index
    const indexPath = join(this.dataDir, 'plans-index.json');
    writeFileSync(indexPath, JSON.stringify({
      planIds: Array.from(this.plans.keys()),
      updatedAt: Date.now(),
    }, null, 2));

    // Save individual plans
    for (const [planId, plan] of this.plans) {
      const planPath = join(this.dataDir, `plan-${planId}.json`);
      writeFileSync(planPath, JSON.stringify(plan, null, 2));
    }
  }

  /**
   * Create a new plan with team members and tasks
   */
  createPlan(config: {
    name: string;
    objective: string;
    teamMembers: TeamMember[];
    tasks: Omit<Task, 'id' | 'status' | 'createdAt'>[];
  }): Plan {
    const planId = `plan-${Date.now().toString(36)}`;
    
    const plan: Plan = {
      id: planId,
      name: config.name,
      objective: config.objective,
      teamMembers: config.teamMembers,
      tasks: config.tasks.map((t, i) => ({
        ...t,
        id: `${planId}-task-${i + 1}`,
        status: t.dependsOn.length === 0 ? 'pending' : 'blocked',
        createdAt: Date.now(),
      })),
      status: 'planning',
      createdAt: Date.now(),
    };

    this.plans.set(planId, plan);
    this.savePlans();
    
    return plan;
  }

  /**
   * Start executing a plan
   */
  startPlan(planId: string): void {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Plan not found: ${planId}`);
    
    plan.status = 'executing';
    this.activePlanId = planId;
    this.savePlans();
  }

  /**
   * Get the next available tasks (not blocked, not completed)
   */
  getAvailableTasks(planId?: string): Task[] {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) return [];

    return plan.tasks.filter(task => {
      if (task.status !== 'pending') return false;
      
      // Check all dependencies are completed or validated
      for (const depId of task.dependsOn) {
        const dep = plan.tasks.find(t => t.id === depId);
        if (!dep || !['completed', 'validated'].includes(dep.status)) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Start a task (mark as running)
   */
  startTask(taskId: string, planId?: string): Task {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) throw new Error('No active plan');

    const task = plan.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = 'running';
    task.startedAt = Date.now();
    this.savePlans();

    return task;
  }

  /**
   * Complete a task with result
   */
  completeTask(taskId: string, result: TaskResult, planId?: string): void {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) throw new Error('No active plan');

    const task = plan.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = result.success ? 'completed' : 'failed';
    task.result = result;
    task.completedAt = Date.now();

    // Unblock dependent tasks
    this.updateBlockedTasks(plan);
    this.savePlans();

    // Check if plan is complete
    this.checkPlanCompletion(plan);
  }

  /**
   * Mark a task as validated (by validator agent)
   */
  validateTask(taskId: string, report: ValidationReport, planId?: string): void {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) throw new Error('No active plan');

    const task = plan.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (report.recommendation === 'approve') {
      task.status = 'validated';
    } else if (report.recommendation === 'needs_work') {
      // Reset to pending so builder can retry
      task.status = 'pending';
    } else {
      task.status = 'failed';
    }

    task.result = {
      success: task.result?.success ?? true,
      output: task.result?.output,
      filesModified: task.result?.filesModified,
      errors: task.result?.errors,
      validationReport: report,
    };

    this.updateBlockedTasks(plan);
    this.savePlans();
    this.checkPlanCompletion(plan);
  }

  /**
   * Update blocked tasks when dependencies complete
   */
  private updateBlockedTasks(plan: Plan): void {
    for (const task of plan.tasks) {
      if (task.status !== 'blocked') continue;

      const allDepsComplete = task.dependsOn.every(depId => {
        const dep = plan.tasks.find(t => t.id === depId);
        return dep && ['completed', 'validated'].includes(dep.status);
      });

      if (allDepsComplete) {
        task.status = 'pending';
      }
    }
  }

  /**
   * Check if plan is complete
   */
  private checkPlanCompletion(plan: Plan): void {
    const allDone = plan.tasks.every(t => 
      ['completed', 'validated', 'failed'].includes(t.status)
    );

    if (allDone) {
      const anyFailed = plan.tasks.some(t => t.status === 'failed');
      plan.status = anyFailed ? 'failed' : 'completed';
      plan.completedAt = Date.now();
      this.savePlans();
    }
  }

  /**
   * Get plan status summary
   */
  getPlanStatus(planId?: string): {
    plan: Plan;
    summary: {
      total: number;
      pending: number;
      blocked: number;
      running: number;
      completed: number;
      validated: number;
      failed: number;
    };
  } | null {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) return null;

    const summary = {
      total: plan.tasks.length,
      pending: 0,
      blocked: 0,
      running: 0,
      completed: 0,
      validated: 0,
      failed: 0,
    };

    for (const task of plan.tasks) {
      summary[task.status]++;
    }

    return { plan, summary };
  }

  /**
   * Get all plans
   */
  getAllPlans(): Plan[] {
    return Array.from(this.plans.values());
  }

  /**
   * Find validator for a builder task
   */
  findValidatorTask(builderTaskId: string, planId?: string): Task | null {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) return null;

    // Find task that depends on this builder task and is owned by a validator
    return plan.tasks.find(t => 
      t.dependsOn.includes(builderTaskId) && 
      t.ownerRole === 'validator'
    ) || null;
  }

  /**
   * Get builder+validator pairs
   */
  getBuilderValidatorPairs(planId?: string): Array<{
    builder: Task;
    validator: Task | null;
  }> {
    const plan = this.plans.get(planId || this.activePlanId || '');
    if (!plan) return [];

    const builderTasks = plan.tasks.filter(t => t.ownerRole === 'builder');
    
    return builderTasks.map(builder => ({
      builder,
      validator: this.findValidatorTask(builder.id, planId),
    }));
  }
}

export default TaskTracker;
