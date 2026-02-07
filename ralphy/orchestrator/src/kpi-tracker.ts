/**
 * KPI Tracker
 * 
 * Tracks real performance metrics for the TAC Orchestrator:
 * - Presence: Minutes of human attention required
 * - Task Size: Current task complexity
 * - Streak: Consecutive successful runs
 * - Attempts: Average retries per task
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

interface KPIState {
  // Presence tracking (human attention minutes)
  humanInteractions: number;
  lastInteractionTime: number;
  presenceMinutes: number;
  
  // Streak tracking
  consecutiveSuccesses: number;
  lastRunSuccess: boolean;
  
  // Attempts tracking
  totalAttempts: number;
  totalTasks: number;
  
  // Task tracking
  currentTaskSize: 'S' | 'M' | 'L' | 'XL';
  
  // Timestamps
  lastUpdated: number;
  periodStart: number; // Reset daily
}

interface KPIs {
  presence: number;    // Minutes of human attention needed
  taskSize: string;    // S/M/L/XL
  streak: number;      // Consecutive successes
  attempts: number;    // Avg retries per task
}

const DEFAULT_STATE: KPIState = {
  humanInteractions: 0,
  lastInteractionTime: 0,
  presenceMinutes: 0,
  consecutiveSuccesses: 0,
  lastRunSuccess: true,
  totalAttempts: 0,
  totalTasks: 0,
  currentTaskSize: 'M',
  lastUpdated: Date.now(),
  periodStart: Date.now(),
};

export class KPITracker {
  private statePath: string;
  private state: KPIState;
  private tasksPath: string;

  constructor(options: {
    orchestratorPath: string;
    tasksPath?: string;
  }) {
    this.statePath = join(options.orchestratorPath, 'metrics', 'kpi-state.json');
    this.tasksPath = options.tasksPath || '/home/gimli/gimli/TASKS.md';
    this.state = this.loadState();
    
    // Reset daily
    this.checkDailyReset();
  }

  /**
   * Load state from disk
   */
  private loadState(): KPIState {
    if (existsSync(this.statePath)) {
      try {
        return JSON.parse(readFileSync(this.statePath, 'utf-8'));
      } catch {
        return { ...DEFAULT_STATE };
      }
    }
    return { ...DEFAULT_STATE };
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    const dir = dirname(this.statePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.state.lastUpdated = Date.now();
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Check if we need to reset for a new day
   */
  private checkDailyReset(): void {
    const now = new Date();
    const periodStart = new Date(this.state.periodStart);
    
    if (now.toDateString() !== periodStart.toDateString()) {
      // New day - reset some metrics
      this.state.presenceMinutes = 0;
      this.state.humanInteractions = 0;
      this.state.periodStart = Date.now();
      this.saveState();
    }
  }

  /**
   * Record a workflow run result
   */
  recordWorkflowRun(success: boolean): void {
    this.state.totalTasks++;
    this.state.totalAttempts++;
    
    if (success) {
      this.state.consecutiveSuccesses++;
      this.state.lastRunSuccess = true;
    } else {
      this.state.consecutiveSuccesses = 0;
      this.state.lastRunSuccess = false;
    }
    
    this.saveState();
  }

  /**
   * Record a retry/additional attempt on current task
   */
  recordRetry(): void {
    this.state.totalAttempts++;
    this.saveState();
  }

  /**
   * Record human interaction (escalation, question, etc.)
   */
  recordHumanInteraction(durationMinutes: number = 5): void {
    this.state.humanInteractions++;
    this.state.presenceMinutes += durationMinutes;
    this.state.lastInteractionTime = Date.now();
    this.saveState();
  }

  /**
   * Set current task size based on TASKS.md analysis
   */
  private analyzeTaskSize(): 'S' | 'M' | 'L' | 'XL' {
    if (!existsSync(this.tasksPath)) {
      return 'M';
    }

    try {
      const content = readFileSync(this.tasksPath, 'utf-8');
      
      // Find tasks in "In Progress"
      const inProgressMatch = content.match(/## In Progress\n([\s\S]*?)(?=## |$)/);
      if (!inProgressMatch) {
        return 'M';
      }

      const inProgress = inProgressMatch[1];
      
      // Count tasks and estimate size
      const taskCount = (inProgress.match(/### \[TASK-/g) || []).length;
      const descLength = inProgress.length;

      // Heuristic sizing
      if (taskCount === 0) return 'S';
      if (descLength > 2000 || taskCount > 3) return 'XL';
      if (descLength > 1000 || taskCount > 1) return 'L';
      if (descLength > 500) return 'M';
      return 'S';
    } catch {
      return 'M';
    }
  }

  /**
   * Get current KPIs
   */
  getKPIs(): KPIs {
    this.checkDailyReset();
    
    const avgAttempts = this.state.totalTasks > 0
      ? this.state.totalAttempts / this.state.totalTasks
      : 1.0;

    return {
      presence: this.state.presenceMinutes,
      taskSize: this.analyzeTaskSize(),
      streak: this.state.consecutiveSuccesses,
      attempts: Math.round(avgAttempts * 10) / 10, // 1 decimal
    };
  }

  /**
   * Get detailed state for debugging
   */
  getState(): KPIState {
    return { ...this.state };
  }

  /**
   * Force a specific task size (for manual override)
   */
  setTaskSize(size: 'S' | 'M' | 'L' | 'XL'): void {
    this.state.currentTaskSize = size;
    this.saveState();
  }
}

export default KPITracker;
