/**
 * Gimli Wrapper - The autonomous system that wraps around Gimli
 * 
 * This is the "meta-agent" that:
 * 1. Monitors Gimli for issues (test failures, errors, security)
 * 2. Triggers ADWs to fix problems automatically
 * 3. Keeps Gimli updated with upstream changes
 * 4. Tracks improvement metrics over time
 * 
 * The goal: Gimli maintains itself with minimal human intervention
 */

import { ADWExecutor } from './adw-executor';
import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

interface GimliHealth {
  testsPass: boolean;
  testsFailed: number;
  errorsInLogs: number;
  securityIssues: number;
  lastCheck: number;
}

interface UpstreamStatus {
  behind: number;
  ahead: number;
  lastSync: number;
  pendingChanges: string[];
}

interface WrapperMetrics {
  bugsFixed: number;
  testsFixed: number;
  securityIssuesResolved: number;
  upstreamSyncs: number;
  totalWorkflowRuns: number;
  successfulRuns: number;
  failedRuns: number;
}

interface ActiveWorkflow {
  id: string;
  name: string;
  status: 'running' | 'pending' | 'success' | 'failed';
  step?: string;
  startTime: number;
  duration?: string;
}

export class GimliWrapper {
  private executor: ADWExecutor;
  private gimliPath: string;
  private metricsPath: string;
  private metrics: WrapperMetrics;
  private isRunning: boolean = false;
  private activeWorkflows: Map<string, ActiveWorkflow> = new Map();

  constructor(options: {
    gimliPath: string;
    orchestratorPath: string;
  }) {
    this.gimliPath = options.gimliPath;
    this.metricsPath = join(options.orchestratorPath, 'metrics', 'wrapper-metrics.json');

    this.executor = new ADWExecutor({
      workflowsDir: join(options.orchestratorPath, 'adw'),
      runsDir: join(options.orchestratorPath, 'runs'),
      expertsDir: join(options.orchestratorPath, '..', 'experts'),
    });

    this.metrics = this.loadMetrics();
  }

  /**
   * Load metrics from disk
   */
  private loadMetrics(): WrapperMetrics {
    if (existsSync(this.metricsPath)) {
      return JSON.parse(readFileSync(this.metricsPath, 'utf-8'));
    }
    return {
      bugsFixed: 0,
      testsFixed: 0,
      securityIssuesResolved: 0,
      upstreamSyncs: 0,
      totalWorkflowRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
    };
  }

  /**
   * Save metrics to disk
   */
  private saveMetrics(): void {
    const dir = join(this.metricsPath, '..');
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2));
  }

  /**
   * Check Gimli's health
   */
  async checkHealth(): Promise<GimliHealth> {
    console.log('🔍 Checking Gimli health...');

    const health: GimliHealth = {
      testsPass: true,
      testsFailed: 0,
      errorsInLogs: 0,
      securityIssues: 0,
      lastCheck: Date.now(),
    };

    // Run tests (use bun with vitest)
    try {
      const testResult = execSync('bun x vitest run 2>&1', {
        cwd: this.gimliPath,
        encoding: 'utf-8',
        timeout: 300000, // 5 min timeout
      });

      // Parse test results
      const failMatch = testResult.match(/(\d+) failed/);
      if (failMatch) {
        health.testsFailed = parseInt(failMatch[1]);
        health.testsPass = false;
      }
    } catch (error: any) {
      // Test command failed
      health.testsPass = false;
      health.testsFailed = -1; // Unknown number
      console.error('  Test run failed:', error.message);
    }

    // Check logs for errors
    try {
      const today = new Date().toISOString().split('T')[0];
      const logPath = `/tmp/gimli/gimli-${today}.log`;
      if (existsSync(logPath)) {
        const logs = readFileSync(logPath, 'utf-8');
        const errorMatches = logs.match(/ERROR/gi);
        health.errorsInLogs = errorMatches?.length || 0;
      }
    } catch {
      // Log check failed, not critical
    }

    console.log(`  Tests: ${health.testsPass ? '✅ Pass' : `❌ ${health.testsFailed} failed`}`);
    console.log(`  Errors in logs: ${health.errorsInLogs}`);

    return health;
  }

  /**
   * Check upstream Gimli for updates
   */
  async checkUpstream(): Promise<UpstreamStatus> {
    console.log('🔄 Checking upstream Gimli...');

    const status: UpstreamStatus = {
      behind: 0,
      ahead: 0,
      lastSync: Date.now(),
      pendingChanges: [],
    };

    try {
      // Fetch upstream
      execSync('git fetch upstream 2>&1 || git fetch origin 2>&1', {
        cwd: this.gimliPath,
        encoding: 'utf-8',
      });

      // Check how many commits behind/ahead
      const behindAhead = execSync(
        'git rev-list --left-right --count HEAD...upstream/main 2>/dev/null || git rev-list --left-right --count HEAD...origin/main 2>/dev/null',
        { cwd: this.gimliPath, encoding: 'utf-8' }
      ).trim().split(/\s+/);

      status.ahead = parseInt(behindAhead[0]) || 0;
      status.behind = parseInt(behindAhead[1]) || 0;

      // Get list of new commits
      if (status.behind > 0) {
        const commits = execSync(
          `git log --oneline HEAD..upstream/main 2>/dev/null | head -10 || git log --oneline HEAD..origin/main 2>/dev/null | head -10`,
          { cwd: this.gimliPath, encoding: 'utf-8' }
        ).trim().split('\n');
        status.pendingChanges = commits;
      }
    } catch (error: any) {
      console.error('  Upstream check failed:', error.message);
    }

    console.log(`  Behind: ${status.behind} commits`);
    console.log(`  Ahead: ${status.ahead} commits`);

    return status;
  }

  /**
   * Run the self-improvement workflow
   */
  async runSelfImprove(): Promise<void> {
    console.log('🔧 Running self-improvement workflow...');

    this.metrics.totalWorkflowRuns++;

    try {
      const result = await this.executor.runWorkflow('self-improve', {
        focus: 'all',
        max_issues: 5,
        learning_mode: true,
      });

      if (result.status === 'success') {
        this.metrics.successfulRuns++;
        this.metrics.bugsFixed += result.stepResults.fix_issues?.fixed_count || 0;
        console.log(`  ✅ Self-improvement complete: ${result.metrics.stepsCompleted} steps`);
      } else {
        this.metrics.failedRuns++;
        console.log(`  ❌ Self-improvement failed: ${result.error}`);
      }
    } catch (error: any) {
      this.metrics.failedRuns++;
      console.error('  Self-improvement error:', error.message);
    }

    this.saveMetrics();
  }

  /**
   * Run the security audit workflow
   */
  async runSecurityAudit(): Promise<void> {
    console.log('🔒 Running security audit...');

    this.metrics.totalWorkflowRuns++;

    try {
      const result = await this.executor.runWorkflow('security-audit', {
        scope: 'full',
      });

      if (result.status === 'success') {
        this.metrics.successfulRuns++;
        const report = result.stepResults.synthesize_report;
        if (report?.critical_count > 0 || report?.high_count > 0) {
          console.log(`  ⚠️ Security issues found: ${report.critical_count} critical, ${report.high_count} high`);
        } else {
          console.log('  ✅ No critical security issues');
        }
      } else {
        this.metrics.failedRuns++;
        console.log(`  ❌ Security audit failed: ${result.error}`);
      }
    } catch (error: any) {
      this.metrics.failedRuns++;
      console.error('  Security audit error:', error.message);
    }

    this.saveMetrics();
  }

  /**
   * Fix failing tests automatically
   */
  async fixFailingTests(): Promise<void> {
    console.log('🩹 Running test-fix workflow...');

    this.metrics.totalWorkflowRuns++;

    try {
      const result = await this.executor.runWorkflow('test-fix', {
        max_fix_attempts: 3,
      });

      if (result.status === 'success') {
        this.metrics.successfulRuns++;
        this.metrics.testsFixed += result.stepResults.verify_fixes?.now_passing?.length || 0;
        console.log(`  ✅ Tests fixed: ${this.metrics.testsFixed}`);
      } else {
        this.metrics.failedRuns++;
        console.log(`  ❌ Test fix failed: ${result.error}`);
      }
    } catch (error: any) {
      this.metrics.failedRuns++;
      console.error('  Test fix error:', error.message);
    }

    this.saveMetrics();
  }

  /**
   * Sync with upstream Gimli
   */
  async syncUpstream(): Promise<void> {
    console.log('📥 Syncing with upstream Gimli...');

    try {
      // This would trigger the upstream sync workflow
      // For now, we'll do a simple merge
      execSync('git pull upstream main --no-edit 2>&1 || git pull origin main --no-edit 2>&1', {
        cwd: this.gimliPath,
        encoding: 'utf-8',
      });

      this.metrics.upstreamSyncs++;
      console.log('  ✅ Upstream sync complete');

      // Run tests after sync to catch any issues
      const health = await this.checkHealth();
      if (!health.testsPass) {
        console.log('  ⚠️ Tests failing after sync, attempting fixes...');
        await this.fixFailingTests();
      }
    } catch (error: any) {
      console.error('  Upstream sync failed:', error.message);
    }

    this.saveMetrics();
  }

  /**
   * The main autonomous loop
   */
  async runAutonomousLoop(): Promise<void> {
    if (this.isRunning) {
      console.log('Autonomous loop already running');
      return;
    }

    this.isRunning = true;
    console.log('🤖 Starting Gimli Wrapper autonomous loop...\n');

    try {
      // 1. Check health
      const health = await this.checkHealth();

      // 2. If tests failing, fix them
      if (!health.testsPass && health.testsFailed > 0) {
        await this.fixFailingTests();
      }

      // 3. Check for upstream updates
      const upstream = await this.checkUpstream();
      if (upstream.behind > 0) {
        console.log(`\n📦 ${upstream.behind} new commits available from upstream`);
        // Could auto-sync or just report
      }

      // 4. Run self-improvement
      await this.runSelfImprove();

      // 5. Print summary
      console.log('\n📊 Wrapper Metrics:');
      console.log(`  Total workflow runs: ${this.metrics.totalWorkflowRuns}`);
      console.log(`  Successful: ${this.metrics.successfulRuns}`);
      console.log(`  Failed: ${this.metrics.failedRuns}`);
      console.log(`  Bugs fixed: ${this.metrics.bugsFixed}`);
      console.log(`  Tests fixed: ${this.metrics.testsFixed}`);
      console.log(`  Upstream syncs: ${this.metrics.upstreamSyncs}`);

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): WrapperMetrics {
    return { ...this.metrics };
  }

  /**
   * Get available workflows
   */
  getWorkflows(): string[] {
    return this.executor.listWorkflows();
  }

  /**
   * Trigger a specific workflow manually
   */
  async triggerWorkflow(name: string, inputs: Record<string, any> = {}): Promise<any> {
    console.log(`🎯 Manually triggering workflow: ${name}`);
    
    const workflowId = `${name}-${Date.now()}`;
    const workflow: ActiveWorkflow = {
      id: workflowId,
      name,
      status: 'running',
      step: 'Starting...',
      startTime: Date.now(),
    };
    
    this.activeWorkflows.set(workflowId, workflow);
    
    try {
      const result = await this.executor.runWorkflow(name, inputs);
      workflow.status = 'success';
      workflow.step = 'Completed';
      this.metrics.totalWorkflowRuns++;
      this.metrics.successfulRuns++;
      this.saveMetrics();
      
      // Remove from active after 30 seconds
      setTimeout(() => this.activeWorkflows.delete(workflowId), 30000);
      
      return result;
    } catch (error) {
      workflow.status = 'failed';
      workflow.step = 'Failed';
      this.metrics.totalWorkflowRuns++;
      this.metrics.failedRuns++;
      this.saveMetrics();
      
      // Remove from active after 30 seconds
      setTimeout(() => this.activeWorkflows.delete(workflowId), 30000);
      
      throw error;
    }
  }

  /**
   * Get list of active/recent workflows
   */
  getActiveWorkflows(): ActiveWorkflow[] {
    const now = Date.now();
    return Array.from(this.activeWorkflows.values()).map(w => ({
      ...w,
      duration: this.formatDuration(now - w.startTime),
    }));
  }

  /**
   * Format duration in human readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

export default GimliWrapper;
