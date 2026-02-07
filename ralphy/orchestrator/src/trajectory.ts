/**
 * Trajectory - Train of thought logging for agent workflows
 * 
 * Trajectories capture the "train of thought" for completed tasks,
 * stored as logical chapters. They help future agents understand
 * past decisions and reasoning.
 * 
 * Based on: https://github.com/AgentWorkforce/trajectories
 * Reference: @khaliqgant's multi-agent article
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

export interface TrajectoryEvent {
  /** Event ID */
  id: string;
  /** Timestamp */
  timestamp: number;
  /** Event type */
  type: 'decision' | 'action' | 'observation' | 'reasoning' | 'error' | 'checkpoint';
  /** Event title/summary */
  title: string;
  /** Detailed content */
  content: string;
  /** Agent that produced this event */
  agent?: string;
  /** Confidence score (0-1) if applicable */
  confidence?: number;
  /** Token usage for this event */
  tokens?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

export interface TrajectoryChapter {
  /** Chapter ID */
  id: string;
  /** Chapter title */
  title: string;
  /** Chapter type */
  type: 'investigation' | 'planning' | 'implementation' | 'validation' | 'retrospective';
  /** Events in this chapter */
  events: TrajectoryEvent[];
  /** Chapter start time */
  startedAt: number;
  /** Chapter end time */
  completedAt?: number;
  /** Chapter outcome */
  outcome?: 'success' | 'partial' | 'failed' | 'skipped';
  /** Summary of the chapter */
  summary?: string;
}

export interface TrajectoryTask {
  /** Task title */
  title: string;
  /** Task description */
  description?: string;
  /** Original inputs */
  inputs?: Record<string, any>;
  /** Task type/workflow name */
  workflowName?: string;
}

export interface TrajectoryRetrospective {
  /** Summary of what was accomplished */
  summary: string;
  /** What went well */
  successes: string[];
  /** What could be improved */
  improvements: string[];
  /** Lessons learned */
  lessons: string[];
  /** Overall confidence in the work */
  confidence: number;
  /** Time spent (ms) */
  durationMs: number;
  /** Total tokens used */
  totalTokens: number;
}

export interface Trajectory {
  /** Unique trajectory ID */
  id: string;
  /** Version for schema evolution */
  version: string;
  /** Creation timestamp */
  createdAt: number;
  /** Completion timestamp */
  completedAt?: number;
  /** The task this trajectory documents */
  task: TrajectoryTask;
  /** Chapters of work */
  chapters: TrajectoryChapter[];
  /** Final retrospective */
  retrospective?: TrajectoryRetrospective;
  /** Overall status */
  status: 'in_progress' | 'completed' | 'failed' | 'abandoned';
  /** Tags for searchability */
  tags?: string[];
}

// ============================================================================
// Trajectory Logger
// ============================================================================

export class TrajectoryLogger {
  private storageDir: string;
  private activeTrajectory: Trajectory | null = null;
  private activeChapter: TrajectoryChapter | null = null;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true });
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Start a new trajectory for a task
   */
  startTrajectory(task: TrajectoryTask): Trajectory {
    const trajectory: Trajectory = {
      id: this.generateId('traj'),
      version: '1.0.0',
      createdAt: Date.now(),
      task,
      chapters: [],
      status: 'in_progress',
      tags: [],
    };

    this.activeTrajectory = trajectory;
    this.save();
    
    console.log(`[Trajectory] Started: ${trajectory.id} - ${task.title}`);
    return trajectory;
  }

  /**
   * Start a new chapter within the trajectory
   */
  startChapter(title: string, type: TrajectoryChapter['type']): TrajectoryChapter {
    if (!this.activeTrajectory) {
      throw new Error('No active trajectory. Call startTrajectory first.');
    }

    // Close any existing chapter
    if (this.activeChapter) {
      this.endChapter();
    }

    const chapter: TrajectoryChapter = {
      id: this.generateId('chap'),
      title,
      type,
      events: [],
      startedAt: Date.now(),
    };

    this.activeChapter = chapter;
    this.activeTrajectory.chapters.push(chapter);
    this.save();

    console.log(`[Trajectory] Chapter: ${title} (${type})`);
    return chapter;
  }

  /**
   * Log an event to the current chapter
   */
  logEvent(event: Omit<TrajectoryEvent, 'id' | 'timestamp'>): TrajectoryEvent {
    if (!this.activeTrajectory) {
      console.warn('[Trajectory] No active trajectory, event not logged');
      return { id: 'none', timestamp: Date.now(), ...event };
    }

    // Auto-create a chapter if none exists
    if (!this.activeChapter) {
      this.startChapter('Default', 'implementation');
    }

    const fullEvent: TrajectoryEvent = {
      id: this.generateId('evt'),
      timestamp: Date.now(),
      ...event,
    };

    this.activeChapter!.events.push(fullEvent);
    this.save();

    // Log brief summary
    const confidenceStr = event.confidence ? ` (conf: ${(event.confidence * 100).toFixed(0)}%)` : '';
    console.log(`[Trajectory] Event: ${event.type} - ${event.title}${confidenceStr}`);

    return fullEvent;
  }

  /**
   * Log a decision
   */
  logDecision(title: string, content: string, options?: {
    agent?: string;
    confidence?: number;
    alternatives?: string[];
    rationale?: string;
  }): TrajectoryEvent {
    return this.logEvent({
      type: 'decision',
      title,
      content,
      agent: options?.agent,
      confidence: options?.confidence,
      metadata: {
        alternatives: options?.alternatives,
        rationale: options?.rationale,
      },
    });
  }

  /**
   * Log an action taken
   */
  logAction(title: string, content: string, options?: {
    agent?: string;
    tokens?: number;
    result?: string;
  }): TrajectoryEvent {
    return this.logEvent({
      type: 'action',
      title,
      content,
      agent: options?.agent,
      tokens: options?.tokens,
      metadata: {
        result: options?.result,
      },
    });
  }

  /**
   * Log an observation or finding
   */
  logObservation(title: string, content: string, options?: {
    agent?: string;
    confidence?: number;
    source?: string;
  }): TrajectoryEvent {
    return this.logEvent({
      type: 'observation',
      title,
      content,
      agent: options?.agent,
      confidence: options?.confidence,
      metadata: {
        source: options?.source,
      },
    });
  }

  /**
   * Log reasoning/thought process
   */
  logReasoning(title: string, content: string, options?: {
    agent?: string;
    confidence?: number;
  }): TrajectoryEvent {
    return this.logEvent({
      type: 'reasoning',
      title,
      content,
      agent: options?.agent,
      confidence: options?.confidence,
    });
  }

  /**
   * Log an error
   */
  logError(title: string, content: string, options?: {
    agent?: string;
    recoverable?: boolean;
    stack?: string;
  }): TrajectoryEvent {
    return this.logEvent({
      type: 'error',
      title,
      content,
      agent: options?.agent,
      metadata: {
        recoverable: options?.recoverable,
        stack: options?.stack,
      },
    });
  }

  /**
   * Log a checkpoint (good for resumability)
   */
  logCheckpoint(title: string, state: Record<string, any>): TrajectoryEvent {
    return this.logEvent({
      type: 'checkpoint',
      title,
      content: JSON.stringify(state, null, 2),
      metadata: { stateKeys: Object.keys(state) },
    });
  }

  /**
   * End the current chapter with an outcome
   */
  endChapter(outcome?: TrajectoryChapter['outcome'], summary?: string): void {
    if (!this.activeChapter) return;

    this.activeChapter.completedAt = Date.now();
    this.activeChapter.outcome = outcome || 'success';
    this.activeChapter.summary = summary;
    this.activeChapter = null;
    this.save();
  }

  /**
   * Complete the trajectory with a retrospective
   */
  completeTrajectory(retrospective: Omit<TrajectoryRetrospective, 'durationMs' | 'totalTokens'>): Trajectory | null {
    if (!this.activeTrajectory) {
      console.warn('[Trajectory] No active trajectory to complete');
      return null;
    }

    // Close any open chapter
    if (this.activeChapter) {
      this.endChapter();
    }

    // Calculate totals
    const totalTokens = this.activeTrajectory.chapters.reduce((sum, chapter) =>
      sum + chapter.events.reduce((eSum, event) => eSum + (event.tokens || 0), 0), 0
    );

    this.activeTrajectory.completedAt = Date.now();
    this.activeTrajectory.status = 'completed';
    this.activeTrajectory.retrospective = {
      ...retrospective,
      durationMs: this.activeTrajectory.completedAt - this.activeTrajectory.createdAt,
      totalTokens,
    };

    this.save();

    console.log(`[Trajectory] Completed: ${this.activeTrajectory.id}`);
    console.log(`  Duration: ${(this.activeTrajectory.retrospective.durationMs / 1000).toFixed(1)}s`);
    console.log(`  Tokens: ${totalTokens}`);
    console.log(`  Confidence: ${(retrospective.confidence * 100).toFixed(0)}%`);

    const completed = this.activeTrajectory;
    this.activeTrajectory = null;
    return completed;
  }

  /**
   * Mark trajectory as failed
   */
  failTrajectory(error: string): Trajectory | null {
    if (!this.activeTrajectory) return null;

    this.logError('Trajectory Failed', error);

    return this.completeTrajectory({
      summary: `Failed: ${error}`,
      successes: [],
      improvements: ['Fix the root cause of failure'],
      lessons: ['Error handling needs improvement'],
      confidence: 0,
    });
  }

  /**
   * Get the active trajectory
   */
  getActiveTrajectory(): Trajectory | null {
    return this.activeTrajectory;
  }

  /**
   * Save trajectory to disk
   */
  private save(): void {
    if (!this.activeTrajectory) return;

    const path = join(this.storageDir, `${this.activeTrajectory.id}.json`);
    writeFileSync(path, JSON.stringify(this.activeTrajectory, null, 2));
  }

  /**
   * Load a trajectory by ID
   */
  load(id: string): Trajectory | null {
    const path = join(this.storageDir, `${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  /**
   * List all trajectories
   */
  list(): Trajectory[] {
    if (!existsSync(this.storageDir)) return [];
    
    return readdirSync(this.storageDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(readFileSync(join(this.storageDir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Trajectory[];
  }

  /**
   * Search trajectories by text
   */
  search(query: string): Trajectory[] {
    const q = query.toLowerCase();
    return this.list().filter(t => 
      t.task.title.toLowerCase().includes(q) ||
      t.task.description?.toLowerCase().includes(q) ||
      t.tags?.some(tag => tag.toLowerCase().includes(q)) ||
      t.chapters.some(c => 
        c.title.toLowerCase().includes(q) ||
        c.events.some(e => 
          e.title.toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q)
        )
      )
    );
  }

  /**
   * Get recent trajectories
   */
  recent(count: number = 10): Trajectory[] {
    return this.list()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, count);
  }
}
