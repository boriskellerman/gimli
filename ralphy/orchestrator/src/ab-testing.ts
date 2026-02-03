/**
 * A/B Testing System for Fixes
 * 
 * Runs multiple agent approaches in parallel, evaluates results,
 * and selects the best fix. This increases confidence in fixes
 * and helps the system learn which approaches work best.
 * 
 * How it works:
 * 1. Create N worktrees (variants)
 * 2. Spawn an agent in each with slightly different prompts
 * 3. Run tests in each variant
 * 4. Score each solution
 * 5. Pick the winner (or human review if close)
 */

import { WorktreeManager } from './worktree-manager';
import { ADWExecutor } from './adw-executor';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface Variant {
  id: string;
  worktreePath: string;
  branch: string;
  approach: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startTime?: number;
  endTime?: number;
  results?: VariantResults;
}

interface VariantResults {
  testsPass: boolean;
  testsPassed: number;
  testsFailed: number;
  filesModified: number;
  linesChanged: number;
  complexity: number;  // Lower is better
  executionTime: number;
  agentTokens: number;
}

interface ABTestConfig {
  taskId: string;
  taskDescription: string;
  variants: number;
  approaches: string[];
  evaluationCriteria: EvaluationCriteria;
  autoMerge: boolean;
  autoMergeThreshold: number;  // Min score to auto-merge
}

interface EvaluationCriteria {
  weights: {
    testsPass: number;      // Must pass tests (binary)
    codeQuality: number;    // Fewer changes, cleaner code
    performance: number;    // Faster execution
    tokenEfficiency: number; // Fewer tokens used
  };
  mustPassTests: boolean;
  maxFilesModified: number;
}

interface ABTestResult {
  testId: string;
  taskDescription: string;
  variants: Variant[];
  winner?: Variant;
  scores: Map<string, number>;
  decision: 'auto-merged' | 'human-review' | 'no-winner';
  reasoning: string;
}

export class ABTestRunner {
  private worktreeManager: WorktreeManager;
  private executor: ADWExecutor;
  private resultsDir: string;

  constructor(options: {
    repoPath: string;
    orchestratorPath: string;
  }) {
    this.worktreeManager = new WorktreeManager({
      repoPath: options.repoPath,
    });

    this.executor = new ADWExecutor({
      workflowsDir: join(options.orchestratorPath, 'adw'),
      runsDir: join(options.orchestratorPath, 'runs'),
      expertsDir: join(options.orchestratorPath, '..', 'experts'),
    });

    this.resultsDir = join(options.orchestratorPath, 'ab-results');
  }

  /**
   * Run an A/B test with multiple approaches
   */
  async runTest(config: ABTestConfig): Promise<ABTestResult> {
    const testId = `ab-${Date.now().toString(36)}`;
    console.log(`\n🧪 Starting A/B Test: ${testId}`);
    console.log(`   Task: ${config.taskDescription}`);
    console.log(`   Variants: ${config.variants}`);

    const variants: Variant[] = [];
    const scores = new Map<string, number>();

    // Create worktrees for each variant
    const worktrees = await this.worktreeManager.createParallelWorktrees({
      prefix: testId,
      count: config.variants,
    });

    // Initialize variants
    for (let i = 0; i < worktrees.length; i++) {
      const approach = config.approaches[i % config.approaches.length];
      variants.push({
        id: `variant-${i + 1}`,
        worktreePath: worktrees[i].path,
        branch: worktrees[i].branch,
        approach,
        status: 'pending',
      });
    }

    // Run agents in parallel
    console.log('\n📊 Running variants in parallel...');
    const variantPromises = variants.map(v => this.runVariant(v, config));
    await Promise.all(variantPromises);

    // Evaluate results
    console.log('\n📈 Evaluating results...');
    for (const variant of variants) {
      if (variant.results) {
        const score = this.scoreVariant(variant, config.evaluationCriteria);
        scores.set(variant.id, score);
        console.log(`   ${variant.id}: Score ${score.toFixed(2)} (${variant.approach})`);
      }
    }

    // Determine winner
    const { winner, decision, reasoning } = this.determineWinner(
      variants,
      scores,
      config
    );

    const result: ABTestResult = {
      testId,
      taskDescription: config.taskDescription,
      variants,
      winner,
      scores,
      decision,
      reasoning,
    };

    // Handle the decision
    if (decision === 'auto-merged' && winner) {
      console.log(`\n✅ Auto-merging winner: ${winner.id}`);
      await this.worktreeManager.mergeWorktree(winner.worktreePath);
    } else if (decision === 'human-review') {
      console.log(`\n👀 Flagged for human review: ${reasoning}`);
    } else {
      console.log(`\n❌ No winner: ${reasoning}`);
    }

    // Cleanup non-winning worktrees
    for (const variant of variants) {
      if (variant !== winner) {
        await this.worktreeManager.removeWorktree(variant.worktreePath);
      }
    }

    // Save results
    this.saveResult(result);

    return result;
  }

  /**
   * Run a single variant
   */
  private async runVariant(variant: Variant, config: ABTestConfig): Promise<void> {
    variant.status = 'running';
    variant.startTime = Date.now();

    console.log(`   Starting ${variant.id} (${variant.approach})...`);

    try {
      // Create a customized prompt based on the approach
      const prompt = this.buildVariantPrompt(config.taskDescription, variant.approach);

      // In production, this would spawn an agent in the worktree
      // For now, we simulate the process
      const agentResult = await this.simulateAgentWork(variant.worktreePath, prompt);

      // Run tests in the worktree
      const testResults = this.runTestsInWorktree(variant.worktreePath);

      // Gather metrics
      variant.results = {
        testsPass: testResults.passed,
        testsPassed: testResults.passCount,
        testsFailed: testResults.failCount,
        filesModified: this.countModifiedFiles(variant.worktreePath),
        linesChanged: this.countLinesChanged(variant.worktreePath),
        complexity: this.estimateComplexity(variant.worktreePath),
        executionTime: Date.now() - variant.startTime!,
        agentTokens: agentResult.tokens,
      };

      variant.status = testResults.passed ? 'success' : 'failed';
    } catch (error: any) {
      variant.status = 'failed';
      console.error(`   ${variant.id} failed:`, error.message);
    }

    variant.endTime = Date.now();
  }

  /**
   * Build a variant-specific prompt
   */
  private buildVariantPrompt(task: string, approach: string): string {
    const approachInstructions: Record<string, string> = {
      'minimal': `
        Approach: MINIMAL CHANGES
        - Make the smallest possible change to fix the issue
        - Avoid refactoring unrelated code
        - Prefer surgical fixes over rewrites
      `,
      'comprehensive': `
        Approach: COMPREHENSIVE FIX
        - Fix the root cause, not just symptoms
        - Include related improvements if obvious
        - Add defensive coding where appropriate
      `,
      'test-first': `
        Approach: TEST-FIRST
        - Write a failing test that captures the bug first
        - Then implement the minimal fix to pass the test
        - Ensure test coverage is improved
      `,
      'refactor': `
        Approach: REFACTOR & FIX
        - If the code is messy, clean it up as part of the fix
        - Improve readability and maintainability
        - The fix should leave the code better than you found it
      `,
    };

    return `
Task: ${task}

${approachInstructions[approach] || approachInstructions['minimal']}

Remember:
- All tests must pass
- Changes should be well-documented
- Follow existing code patterns
    `.trim();
  }

  /**
   * Simulate agent work (in production, this calls sessions_spawn)
   */
  private async simulateAgentWork(
    worktreePath: string,
    prompt: string
  ): Promise<{ tokens: number; output: string }> {
    // In production:
    // return sessionsSpawn({ task: prompt, cwd: worktreePath });
    
    return {
      tokens: Math.floor(Math.random() * 5000) + 1000,
      output: '[Simulated agent work]',
    };
  }

  /**
   * Run tests in a worktree
   */
  private runTestsInWorktree(worktreePath: string): {
    passed: boolean;
    passCount: number;
    failCount: number;
  } {
    try {
      const output = execSync('pnpm test 2>&1 || true', {
        cwd: worktreePath,
        encoding: 'utf-8',
        timeout: 300000,
      });

      // Parse test output
      const passMatch = output.match(/(\d+) pass/i);
      const failMatch = output.match(/(\d+) fail/i);

      const passCount = passMatch ? parseInt(passMatch[1]) : 0;
      const failCount = failMatch ? parseInt(failMatch[1]) : 0;

      return {
        passed: failCount === 0,
        passCount,
        failCount,
      };
    } catch {
      return { passed: false, passCount: 0, failCount: -1 };
    }
  }

  /**
   * Count modified files in worktree
   */
  private countModifiedFiles(worktreePath: string): number {
    try {
      const output = execSync('git diff --name-only HEAD~1 2>/dev/null || echo ""', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }

  /**
   * Count lines changed in worktree
   */
  private countLinesChanged(worktreePath: string): number {
    try {
      const output = execSync('git diff --stat HEAD~1 2>/dev/null | tail -1 || echo "0"', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      const match = output.match(/(\d+) insertions?.*?(\d+) deletions?/);
      if (match) {
        return parseInt(match[1]) + parseInt(match[2]);
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Estimate code complexity (simple heuristic)
   */
  private estimateComplexity(worktreePath: string): number {
    // Simple heuristic: more files/lines = more complex
    const files = this.countModifiedFiles(worktreePath);
    const lines = this.countLinesChanged(worktreePath);
    return files * 10 + lines;
  }

  /**
   * Score a variant based on evaluation criteria
   */
  private scoreVariant(variant: Variant, criteria: EvaluationCriteria): number {
    if (!variant.results) return 0;
    const r = variant.results;

    // Must pass tests
    if (criteria.mustPassTests && !r.testsPass) {
      return 0;
    }

    // Too many files modified
    if (r.filesModified > criteria.maxFilesModified) {
      return 0;
    }

    const weights = criteria.weights;
    let score = 0;

    // Tests passing (binary)
    if (r.testsPass) {
      score += weights.testsPass * 100;
    }

    // Code quality (inverse of complexity, normalized)
    const complexityScore = Math.max(0, 100 - r.complexity);
    score += weights.codeQuality * complexityScore;

    // Performance (faster is better, normalized to 0-100)
    const perfScore = Math.max(0, 100 - (r.executionTime / 1000));
    score += weights.performance * perfScore;

    // Token efficiency (fewer tokens is better)
    const tokenScore = Math.max(0, 100 - (r.agentTokens / 100));
    score += weights.tokenEfficiency * tokenScore;

    return score;
  }

  /**
   * Determine the winner from scored variants
   */
  private determineWinner(
    variants: Variant[],
    scores: Map<string, number>,
    config: ABTestConfig
  ): { winner?: Variant; decision: ABTestResult['decision']; reasoning: string } {
    // Filter to passing variants
    const passing = variants.filter(v => v.results?.testsPass);

    if (passing.length === 0) {
      return {
        decision: 'no-winner',
        reasoning: 'No variant passed all tests',
      };
    }

    // Sort by score
    const sorted = [...passing].sort((a, b) => {
      return (scores.get(b.id) || 0) - (scores.get(a.id) || 0);
    });

    const winner = sorted[0];
    const winnerScore = scores.get(winner.id) || 0;
    const runnerUpScore = sorted[1] ? scores.get(sorted[1].id) || 0 : 0;

    // Check if auto-merge is appropriate
    if (config.autoMerge && winnerScore >= config.autoMergeThreshold) {
      // Check margin of victory
      const margin = winnerScore - runnerUpScore;
      if (margin > 20 || sorted.length === 1) {
        return {
          winner,
          decision: 'auto-merged',
          reasoning: `Winner ${winner.id} (${winner.approach}) with score ${winnerScore.toFixed(2)}, margin ${margin.toFixed(2)}`,
        };
      }
    }

    // Close race or below threshold - human review
    return {
      winner,
      decision: 'human-review',
      reasoning: `Close scores or below auto-merge threshold. Winner: ${winner.id} (${winnerScore.toFixed(2)}), Runner-up: ${sorted[1]?.id || 'none'} (${runnerUpScore.toFixed(2)})`,
    };
  }

  /**
   * Save test results to disk
   */
  private saveResult(result: ABTestResult): void {
    if (!existsSync(this.resultsDir)) {
      require('fs').mkdirSync(this.resultsDir, { recursive: true });
    }

    const path = join(this.resultsDir, `${result.testId}.json`);
    writeFileSync(path, JSON.stringify({
      ...result,
      scores: Object.fromEntries(result.scores),
    }, null, 2));
  }

  /**
   * Load historical results for analysis
   */
  loadResults(): ABTestResult[] {
    if (!existsSync(this.resultsDir)) {
      return [];
    }

    const files = require('fs').readdirSync(this.resultsDir);
    return files
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => {
        const content = readFileSync(join(this.resultsDir, f), 'utf-8');
        const data = JSON.parse(content);
        return {
          ...data,
          scores: new Map(Object.entries(data.scores)),
        };
      });
  }
}

export default ABTestRunner;
