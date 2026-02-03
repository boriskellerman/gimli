/**
 * Git Worktree Manager - Parallel Agent Execution
 * 
 * Uses git worktrees to let multiple agents work on the codebase
 * simultaneously without conflicts. Each agent gets an isolated
 * copy of the repo at a specific branch.
 * 
 * This enables:
 * - Parallel bug fixing (multiple bugs at once)
 * - A/B testing (different approaches to same problem)
 * - Feature branches without switching contexts
 */

import { execSync, exec } from 'child_process';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join, basename } from 'path';

interface Worktree {
  path: string;
  branch: string;
  commit: string;
  createdAt: number;
  agentId?: string;
  status: 'active' | 'completed' | 'failed' | 'abandoned';
}

interface WorktreeConfig {
  repoPath: string;
  worktreesDir: string;
  maxWorktrees: number;
  cleanupAfterHours: number;
}

export class WorktreeManager {
  private config: WorktreeConfig;
  private activeWorktrees: Map<string, Worktree> = new Map();

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = {
      repoPath: config.repoPath || '/home/gimli/github/gimli',
      worktreesDir: config.worktreesDir || '/home/gimli/github/gimli-worktrees',
      maxWorktrees: config.maxWorktrees || 5,
      cleanupAfterHours: config.cleanupAfterHours || 24,
    };

    // Ensure worktrees directory exists
    if (!existsSync(this.config.worktreesDir)) {
      mkdirSync(this.config.worktreesDir, { recursive: true });
    }

    // Load existing worktrees
    this.loadExistingWorktrees();
  }

  /**
   * Load existing worktrees from git
   */
  private loadExistingWorktrees(): void {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });

      const entries = output.trim().split('\n\n');
      for (const entry of entries) {
        const lines = entry.split('\n');
        const pathLine = lines.find(l => l.startsWith('worktree '));
        const branchLine = lines.find(l => l.startsWith('branch '));
        const commitLine = lines.find(l => l.startsWith('HEAD '));

        if (pathLine && pathLine.includes(this.config.worktreesDir)) {
          const path = pathLine.replace('worktree ', '');
          const branch = branchLine?.replace('branch refs/heads/', '') || 'unknown';
          const commit = commitLine?.replace('HEAD ', '') || 'unknown';

          this.activeWorktrees.set(path, {
            path,
            branch,
            commit,
            createdAt: Date.now(), // Approximate
            status: 'active',
          });
        }
      }
    } catch (error) {
      console.warn('Could not load existing worktrees:', error);
    }
  }

  /**
   * Create a new worktree for an agent
   */
  async createWorktree(options: {
    branchName: string;
    baseBranch?: string;
    agentId?: string;
  }): Promise<Worktree> {
    const { branchName, baseBranch = 'main', agentId } = options;

    // Check limits
    if (this.activeWorktrees.size >= this.config.maxWorktrees) {
      // Try to cleanup old worktrees first
      await this.cleanupOldWorktrees();
      
      if (this.activeWorktrees.size >= this.config.maxWorktrees) {
        throw new Error(`Maximum worktrees (${this.config.maxWorktrees}) reached`);
      }
    }

    const worktreePath = join(this.config.worktreesDir, branchName);

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      const existing = this.activeWorktrees.get(worktreePath);
      if (existing) {
        console.log(`Reusing existing worktree: ${worktreePath}`);
        return existing;
      }
      // Clean up orphaned directory
      rmSync(worktreePath, { recursive: true, force: true });
    }

    console.log(`Creating worktree: ${branchName} from ${baseBranch}`);

    try {
      // Create new branch and worktree
      execSync(
        `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`,
        {
          cwd: this.config.repoPath,
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );

      // Get the commit hash
      const commit = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      const worktree: Worktree = {
        path: worktreePath,
        branch: branchName,
        commit,
        createdAt: Date.now(),
        agentId,
        status: 'active',
      };

      this.activeWorktrees.set(worktreePath, worktree);
      console.log(`  ✅ Created worktree at ${worktreePath}`);

      return worktree;
    } catch (error: any) {
      // Branch might already exist, try without -b
      try {
        execSync(
          `git worktree add "${worktreePath}" ${branchName}`,
          {
            cwd: this.config.repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
          }
        );

        const commit = execSync('git rev-parse HEAD', {
          cwd: worktreePath,
          encoding: 'utf-8',
        }).trim();

        const worktree: Worktree = {
          path: worktreePath,
          branch: branchName,
          commit,
          createdAt: Date.now(),
          agentId,
          status: 'active',
        };

        this.activeWorktrees.set(worktreePath, worktree);
        return worktree;
      } catch (retryError: any) {
        throw new Error(`Failed to create worktree: ${retryError.message}`);
      }
    }
  }

  /**
   * Run a command in a worktree
   */
  runInWorktree(worktreePath: string, command: string): string {
    if (!this.activeWorktrees.has(worktreePath)) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    return execSync(command, {
      cwd: worktreePath,
      encoding: 'utf-8',
      timeout: 300000, // 5 min timeout
    });
  }

  /**
   * Commit changes in a worktree
   */
  commitInWorktree(worktreePath: string, message: string): string {
    const worktree = this.activeWorktrees.get(worktreePath);
    if (!worktree) {
      throw new Error(`Worktree not found: ${worktreePath}`);
    }

    try {
      // Stage all changes
      execSync('git add -A', { cwd: worktreePath, encoding: 'utf-8' });

      // Check if there are changes to commit
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });

      if (!status.trim()) {
        return 'No changes to commit';
      }

      // Commit
      execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: worktreePath,
        encoding: 'utf-8',
      });

      // Get new commit hash
      const commit = execSync('git rev-parse HEAD', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      worktree.commit = commit;
      return commit;
    } catch (error: any) {
      throw new Error(`Commit failed: ${error.message}`);
    }
  }

  /**
   * Merge a worktree branch back to main
   */
  async mergeWorktree(worktreePath: string, options: {
    targetBranch?: string;
    deleteAfterMerge?: boolean;
  } = {}): Promise<{ success: boolean; message: string }> {
    const { targetBranch = 'main', deleteAfterMerge = true } = options;
    const worktree = this.activeWorktrees.get(worktreePath);
    
    if (!worktree) {
      return { success: false, message: `Worktree not found: ${worktreePath}` };
    }

    try {
      // Switch to target branch in main repo
      execSync(`git checkout ${targetBranch}`, {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });

      // Merge the worktree branch
      execSync(`git merge ${worktree.branch} --no-edit`, {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });

      worktree.status = 'completed';

      if (deleteAfterMerge) {
        await this.removeWorktree(worktreePath);
      }

      return { success: true, message: `Merged ${worktree.branch} into ${targetBranch}` };
    } catch (error: any) {
      worktree.status = 'failed';
      return { success: false, message: `Merge failed: ${error.message}` };
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(worktreePath: string): Promise<void> {
    const worktree = this.activeWorktrees.get(worktreePath);
    
    try {
      // Remove the worktree
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });

      // Delete the branch if it was a feature branch
      if (worktree && worktree.branch !== 'main' && worktree.branch !== 'master') {
        try {
          execSync(`git branch -D ${worktree.branch}`, {
            cwd: this.config.repoPath,
            encoding: 'utf-8',
          });
        } catch {
          // Branch might be in use elsewhere
        }
      }
    } catch (error: any) {
      // Force cleanup
      if (existsSync(worktreePath)) {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      execSync('git worktree prune', {
        cwd: this.config.repoPath,
        encoding: 'utf-8',
      });
    }

    this.activeWorktrees.delete(worktreePath);
    console.log(`  🗑️ Removed worktree: ${worktreePath}`);
  }

  /**
   * Cleanup old worktrees
   */
  async cleanupOldWorktrees(): Promise<number> {
    const cutoff = Date.now() - (this.config.cleanupAfterHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [path, worktree] of this.activeWorktrees) {
      if (worktree.createdAt < cutoff || worktree.status === 'abandoned') {
        await this.removeWorktree(path);
        cleaned++;
      }
    }

    // Also prune any orphaned worktrees
    execSync('git worktree prune', {
      cwd: this.config.repoPath,
      encoding: 'utf-8',
    });

    return cleaned;
  }

  /**
   * Get all active worktrees
   */
  getWorktrees(): Worktree[] {
    return Array.from(this.activeWorktrees.values());
  }

  /**
   * Get a specific worktree
   */
  getWorktree(path: string): Worktree | undefined {
    return this.activeWorktrees.get(path);
  }

  /**
   * Create multiple worktrees for parallel A/B testing
   */
  async createParallelWorktrees(options: {
    prefix: string;
    count: number;
    baseBranch?: string;
  }): Promise<Worktree[]> {
    const { prefix, count, baseBranch = 'main' } = options;
    const worktrees: Worktree[] = [];

    for (let i = 0; i < count; i++) {
      const branchName = `${prefix}-variant-${i + 1}`;
      try {
        const worktree = await this.createWorktree({
          branchName,
          baseBranch,
          agentId: `agent-${i + 1}`,
        });
        worktrees.push(worktree);
      } catch (error: any) {
        console.error(`Failed to create worktree ${branchName}:`, error.message);
      }
    }

    return worktrees;
  }
}

export default WorktreeManager;
