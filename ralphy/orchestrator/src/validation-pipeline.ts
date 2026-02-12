/**
 * Validation Pipeline — Closed-loop validation for agent-produced code
 *
 * Implements the builder→validator→auto-fix cycle from TAC Phase 2:
 *   1. Builder produces code
 *   2. Validation hooks run automatically (type check, lint, tests)
 *   3. If validation fails, error context is fed back to the builder
 *   4. Builder retries with error context (up to N attempts)
 *   5. Validation pass/fail rates tracked in metrics
 *
 * This turns "hope it works" into "verify it works, fix if not."
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, extname } from 'path';

// ============================================================================
// Types
// ============================================================================

/** A single validation check */
export interface ValidationCheck {
  /** Unique name for this check */
  name: string;
  /** Human-readable description */
  description: string;
  /** Shell command to run */
  command: string;
  /** Working directory (defaults to project root) */
  cwd?: string;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Whether a non-zero exit code means failure */
  failOnNonZero?: boolean;
  /** Pattern in output that indicates failure */
  failPattern?: RegExp;
  /** Pattern in output that indicates success */
  successPattern?: RegExp;
  /** Whether this check is required (vs advisory) */
  required?: boolean;
  /** File extensions this check applies to */
  appliesTo?: string[];
}

/** Result of running a single validation check */
export interface ValidationResult {
  /** Check name */
  check: string;
  /** Whether this check passed */
  passed: boolean;
  /** Output from the check */
  output: string;
  /** Error output if failed */
  error?: string;
  /** Duration in ms */
  durationMs: number;
  /** Whether this was a required check */
  required: boolean;
}

/** Result of running the full validation suite */
export interface ValidationSuiteResult {
  /** All individual check results */
  results: ValidationResult[];
  /** Whether all required checks passed */
  allPassed: boolean;
  /** Number of checks that passed */
  passedCount: number;
  /** Number of checks that failed */
  failedCount: number;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Human-readable error summary for retry context */
  errorSummary: string;
}

/** Validation metrics tracked over time */
export interface ValidationMetrics {
  /** Total runs */
  totalRuns: number;
  /** Runs that passed first time */
  firstPassRate: number;
  /** Average retries needed */
  avgRetries: number;
  /** Most common failures */
  commonFailures: Array<{ check: string; count: number }>;
  /** Last updated */
  lastUpdated: number;
}

/** Options for the retry loop */
export interface RetryOptions {
  /** Max retry attempts */
  maxRetries?: number;
  /** Function called on each retry with error context */
  onRetry?: (attempt: number, errors: string) => Promise<void>;
  /** Whether to stop on first required failure */
  failFast?: boolean;
}

// ============================================================================
// Built-in Validation Checks
// ============================================================================

const TYPESCRIPT_CHECKS: ValidationCheck[] = [
  {
    name: 'tsc-type-check',
    description: 'TypeScript type checking',
    command: 'npx tsc --noEmit 2>&1',
    timeoutMs: 60000,
    failOnNonZero: true,
    required: true,
    appliesTo: ['.ts', '.tsx'],
  },
  {
    name: 'eslint',
    description: 'ESLint linting',
    command: 'npx eslint --max-warnings 0 2>&1',
    timeoutMs: 30000,
    failOnNonZero: false, // Advisory — many repos have existing warnings
    required: false,
    appliesTo: ['.ts', '.tsx', '.js', '.jsx'],
  },
];

const PYTHON_CHECKS: ValidationCheck[] = [
  {
    name: 'python-syntax',
    description: 'Python syntax check',
    command: 'python3 -m py_compile',
    timeoutMs: 10000,
    failOnNonZero: true,
    required: true,
    appliesTo: ['.py'],
  },
];

const SHELL_CHECKS: ValidationCheck[] = [
  {
    name: 'bash-syntax',
    description: 'Bash syntax check',
    command: 'bash -n',
    timeoutMs: 5000,
    failOnNonZero: true,
    required: true,
    appliesTo: ['.sh', '.bash'],
  },
  {
    name: 'shellcheck',
    description: 'ShellCheck static analysis',
    command: 'shellcheck -x',
    timeoutMs: 10000,
    failOnNonZero: false, // Advisory
    required: false,
    appliesTo: ['.sh', '.bash'],
  },
];

const GENERAL_CHECKS: ValidationCheck[] = [
  {
    name: 'test-suite',
    description: 'Run project test suite',
    command: 'npm test 2>&1 | tail -50',
    timeoutMs: 120000,
    failOnNonZero: true,
    failPattern: /FAIL|failed|error/i,
    successPattern: /PASS|passed|Tests:.*\d+ passed/i,
    required: true,
  },
  {
    name: 'build-check',
    description: 'Verify project builds',
    command: 'npm run build 2>&1 | tail -30',
    timeoutMs: 60000,
    failOnNonZero: true,
    required: true,
  },
];

// ============================================================================
// Validation Pipeline
// ============================================================================

export class ValidationPipeline {
  private checks: ValidationCheck[] = [];
  private metricsPath: string;
  private metrics: ValidationMetrics;
  private defaultCwd: string;

  constructor(options: {
    /** Project root directory */
    projectRoot: string;
    /** Path to store validation metrics */
    metricsPath?: string;
    /** Custom checks to add */
    customChecks?: ValidationCheck[];
    /** Whether to auto-detect checks based on project type */
    autoDetect?: boolean;
  }) {
    this.defaultCwd = options.projectRoot;
    this.metricsPath = options.metricsPath ||
      join(options.projectRoot, 'ralphy', 'orchestrator', 'metrics', 'validation-metrics.json');

    this.metrics = this.loadMetrics();

    if (options.autoDetect !== false) {
      this.autoDetectChecks();
    }

    if (options.customChecks) {
      this.checks.push(...options.customChecks);
    }
  }

  /**
   * Auto-detect which validation checks to enable based on project files
   */
  private autoDetectChecks(): void {
    // TypeScript project?
    if (existsSync(join(this.defaultCwd, 'tsconfig.json'))) {
      this.checks.push(...TYPESCRIPT_CHECKS);
    }

    // Python project?
    if (existsSync(join(this.defaultCwd, 'setup.py')) ||
        existsSync(join(this.defaultCwd, 'pyproject.toml')) ||
        existsSync(join(this.defaultCwd, 'requirements.txt'))) {
      this.checks.push(...PYTHON_CHECKS);
    }

    // Has shell scripts?
    this.checks.push(...SHELL_CHECKS);

    // Has package.json with test/build scripts?
    const pkgPath = join(this.defaultCwd, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
          this.checks.push(GENERAL_CHECKS[0]); // test-suite
        }
        if (pkg.scripts?.build) {
          this.checks.push(GENERAL_CHECKS[1]); // build-check
        }
      } catch { /* ignore parse errors */ }
    }

    console.log(`[ValidationPipeline] Auto-detected ${this.checks.length} checks: ${this.checks.map(c => c.name).join(', ')}`);
  }

  /**
   * Run validation for specific files that were modified
   */
  async validateFiles(filePaths: string[]): Promise<ValidationSuiteResult> {
    const fileExts = new Set(filePaths.map(f => extname(f).toLowerCase()));
    const relevantChecks = this.checks.filter(check => {
      if (!check.appliesTo) return false; // Skip general checks for file-level validation
      return check.appliesTo.some(ext => fileExts.has(ext));
    });

    return this.runChecks(relevantChecks, filePaths);
  }

  /**
   * Run the full validation suite (all checks)
   */
  async validateAll(): Promise<ValidationSuiteResult> {
    return this.runChecks(this.checks);
  }

  /**
   * Run specific named checks
   */
  async runNamedChecks(names: string[]): Promise<ValidationSuiteResult> {
    const checks = this.checks.filter(c => names.includes(c.name));
    return this.runChecks(checks);
  }

  /**
   * Run a set of validation checks
   */
  private async runChecks(checks: ValidationCheck[], targetFiles?: string[]): Promise<ValidationSuiteResult> {
    const results: ValidationResult[] = [];
    const startTime = Date.now();

    for (const check of checks) {
      const result = await this.runSingleCheck(check, targetFiles);
      results.push(result);

      // Log result
      const status = result.passed ? '✅' : (result.required ? '❌' : '⚠️');
      console.log(`  ${status} ${check.name}: ${result.passed ? 'PASSED' : 'FAILED'} (${result.durationMs}ms)`);
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const allRequiredPassed = results.every(r => r.passed || !r.required);

    // Build error summary for retry context
    const errorSummary = this.buildErrorSummary(results);

    const suiteResult: ValidationSuiteResult = {
      results,
      allPassed: allRequiredPassed,
      passedCount: passed,
      failedCount: failed,
      totalDurationMs: Date.now() - startTime,
      errorSummary,
    };

    // Update metrics
    this.updateMetrics(suiteResult);

    return suiteResult;
  }

  /**
   * Run a single validation check
   */
  private async runSingleCheck(check: ValidationCheck, targetFiles?: string[]): Promise<ValidationResult> {
    const startTime = Date.now();

    // Build command — append file paths for file-specific checks
    let command = check.command;
    if (targetFiles && targetFiles.length > 0 && check.appliesTo) {
      const relevantFiles = targetFiles.filter(f =>
        check.appliesTo!.some(ext => f.endsWith(ext))
      );
      if (relevantFiles.length > 0 && !command.includes('--noEmit')) {
        // Only append files for per-file checks (not tsc which checks the whole project)
        command = `${command} ${relevantFiles.map(f => `"${f}"`).join(' ')}`;
      }
    }

    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: check.timeoutMs || 30000,
        cwd: check.cwd || this.defaultCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Check for failure patterns in output
      let passed = true;
      if (check.failPattern && check.failPattern.test(output)) {
        passed = false;
      }
      if (check.successPattern && !check.successPattern.test(output)) {
        passed = false;
      }

      return {
        check: check.name,
        passed,
        output: output.substring(0, 2000), // Truncate long outputs
        durationMs: Date.now() - startTime,
        required: check.required ?? true,
      };
    } catch (error: any) {
      const output = (error.stdout || '') + (error.stderr || '');
      return {
        check: check.name,
        passed: check.failOnNonZero === false, // Non-required checks pass even on error
        output: output.substring(0, 2000),
        error: error.message?.substring(0, 500),
        durationMs: Date.now() - startTime,
        required: check.required ?? true,
      };
    }
  }

  /**
   * Build a concise error summary for agent retry context
   */
  private buildErrorSummary(results: ValidationResult[]): string {
    const failures = results.filter(r => !r.passed && r.required);
    if (failures.length === 0) return '';

    const lines: string[] = ['## Validation Failures\n'];

    for (const failure of failures) {
      lines.push(`### ${failure.check}`);
      // Extract the most useful error lines (skip noise)
      const errorLines = (failure.output || failure.error || 'Unknown error')
        .split('\n')
        .filter(line =>
          line.includes('error') ||
          line.includes('Error') ||
          line.includes('FAIL') ||
          line.includes('✗') ||
          line.includes('×') ||
          line.trim().startsWith('at ') ||
          /TS\d{4}:/.test(line) // TypeScript error codes
        )
        .slice(0, 15); // Max 15 error lines

      lines.push('```');
      lines.push(errorLines.join('\n') || failure.output.substring(0, 500));
      lines.push('```');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Execute a validation-retry loop
   *
   * Runs validation, and if it fails, calls onRetry() with error context
   * so the agent can fix the issues, then re-validates.
   */
  async validateWithRetry(options: RetryOptions): Promise<{
    finalResult: ValidationSuiteResult;
    attempts: number;
    passedOnAttempt: number | null;
  }> {
    const maxRetries = options.maxRetries ?? 2;
    let attempts = 0;

    while (attempts <= maxRetries) {
      attempts++;
      console.log(`[ValidationPipeline] Validation attempt ${attempts}/${maxRetries + 1}`);

      const result = await this.validateAll();

      if (result.allPassed) {
        return {
          finalResult: result,
          attempts,
          passedOnAttempt: attempts,
        };
      }

      // If we have retries left, call the retry handler
      if (attempts <= maxRetries && options.onRetry) {
        console.log(`[ValidationPipeline] Validation failed, requesting fix (attempt ${attempts}/${maxRetries + 1})`);
        await options.onRetry(attempts, result.errorSummary);
      }
    }

    // All retries exhausted
    const finalResult = await this.validateAll();
    return {
      finalResult,
      attempts,
      passedOnAttempt: finalResult.allPassed ? attempts : null,
    };
  }

  // --------------------------------------------------------------------------
  // Metrics
  // --------------------------------------------------------------------------

  /**
   * Load metrics from disk
   */
  private loadMetrics(): ValidationMetrics {
    if (existsSync(this.metricsPath)) {
      try {
        return JSON.parse(readFileSync(this.metricsPath, 'utf-8'));
      } catch {
        // Fall through to default
      }
    }
    return {
      totalRuns: 0,
      firstPassRate: 0,
      avgRetries: 0,
      commonFailures: [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update metrics after a validation run
   */
  private updateMetrics(result: ValidationSuiteResult): void {
    this.metrics.totalRuns++;

    // Update first-pass rate
    if (result.allPassed) {
      const prevTotal = this.metrics.totalRuns - 1;
      const prevPasses = Math.round(this.metrics.firstPassRate * prevTotal);
      this.metrics.firstPassRate = (prevPasses + 1) / this.metrics.totalRuns;
    } else {
      const prevTotal = this.metrics.totalRuns - 1;
      const prevPasses = Math.round(this.metrics.firstPassRate * prevTotal);
      this.metrics.firstPassRate = prevPasses / this.metrics.totalRuns;
    }

    // Update common failures
    for (const r of result.results.filter(r => !r.passed)) {
      const existing = this.metrics.commonFailures.find(f => f.check === r.check);
      if (existing) {
        existing.count++;
      } else {
        this.metrics.commonFailures.push({ check: r.check, count: 1 });
      }
    }

    // Sort common failures by count
    this.metrics.commonFailures.sort((a, b) => b.count - a.count);
    this.metrics.commonFailures = this.metrics.commonFailures.slice(0, 10);

    this.metrics.lastUpdated = Date.now();
    this.saveMetrics();
  }

  /**
   * Save metrics to disk
   */
  private saveMetrics(): void {
    const dir = dirname(this.metricsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.metricsPath, JSON.stringify(this.metrics, null, 2));
  }

  /**
   * Get current validation metrics
   */
  getMetrics(): ValidationMetrics {
    return { ...this.metrics };
  }

  /**
   * Get list of registered checks
   */
  getChecks(): ValidationCheck[] {
    return [...this.checks];
  }

  /**
   * Add a custom check
   */
  addCheck(check: ValidationCheck): void {
    this.checks.push(check);
  }
}

export default ValidationPipeline;
