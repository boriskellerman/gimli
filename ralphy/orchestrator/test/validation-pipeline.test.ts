/**
 * Tests for Validation Pipeline — Closed-loop validation
 */

import { ValidationPipeline, type ValidationCheck } from '../src/validation-pipeline';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(__dirname, '__test-validation__');
const METRICS_PATH = join(TEST_DIR, 'metrics', 'validation-metrics.json');

function setup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(join(TEST_DIR, 'metrics'), { recursive: true });

  // Create a minimal package.json so auto-detect doesn't find test/build scripts
  writeFileSync(join(TEST_DIR, 'package.json'), JSON.stringify({
    name: 'test-project',
    scripts: {},
  }));
}

function teardown(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ============================================================================
// Tests
// ============================================================================

async function testCustomCheck(): Promise<void> {
  console.log('  Test: Run custom validation check');
  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'echo-check',
        description: 'Simple echo test',
        command: 'echo "all good"',
        timeoutMs: 5000,
        failOnNonZero: true,
        required: true,
      },
    ],
  });

  const result = await pipeline.validateAll();
  assert(result.allPassed, 'Echo check should pass');
  assert(result.passedCount === 1, `Expected 1 passed, got ${result.passedCount}`);
  assert(result.results[0].check === 'echo-check', 'Should be echo-check');
  console.log('  ✅ PASSED');
}

async function testFailingCheck(): Promise<void> {
  console.log('  Test: Detect failing validation check');
  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'fail-check',
        description: 'Always fails',
        command: 'exit 1',
        timeoutMs: 5000,
        failOnNonZero: true,
        required: true,
      },
    ],
  });

  const result = await pipeline.validateAll();
  assert(!result.allPassed, 'Should not pass when check fails');
  assert(result.failedCount === 1, `Expected 1 failed, got ${result.failedCount}`);
  console.log('  ✅ PASSED');
}

async function testAdvisoryCheckDontBlockPass(): Promise<void> {
  console.log('  Test: Advisory (non-required) checks don\'t block pass');
  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'pass-check',
        description: 'Passes',
        command: 'echo ok',
        required: true,
      },
      {
        name: 'advisory-fail',
        description: 'Advisory failure',
        command: 'exit 1',
        failOnNonZero: false,
        required: false,
      },
    ],
  });

  const result = await pipeline.validateAll();
  assert(result.allPassed, 'Should still pass when only advisory checks fail');
  assert(result.passedCount === 2, `Expected 2 passed (advisory non-zero is ok), got ${result.passedCount}`);
  console.log('  ✅ PASSED');
}

async function testErrorSummary(): Promise<void> {
  console.log('  Test: Error summary generation');
  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'type-error-check',
        description: 'Simulated type error',
        command: 'echo "error TS2345: Argument of type string not assignable" && exit 1',
        failOnNonZero: true,
        required: true,
      },
    ],
  });

  const result = await pipeline.validateAll();
  assert(!result.allPassed, 'Should fail');
  assert(result.errorSummary.includes('Validation Failures'), 'Error summary should include header');
  assert(result.errorSummary.includes('type-error-check'), 'Error summary should name the check');
  console.log('  ✅ PASSED');
}

async function testRetryLoop(): Promise<void> {
  console.log('  Test: Validation retry loop');
  let retryCount = 0;

  // Create a check that reads a file — we'll "fix" it on retry
  writeFileSync(join(TEST_DIR, 'state.txt'), 'bad');

  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'state-check',
        description: 'Check state file',
        command: `cat ${join(TEST_DIR, 'state.txt')} | grep "good"`,
        failOnNonZero: true,
        required: true,
      },
    ],
  });

  const result = await pipeline.validateWithRetry({
    maxRetries: 2,
    onRetry: async (attempt, errors) => {
      retryCount++;
      // "Fix" the issue on first retry
      writeFileSync(join(TEST_DIR, 'state.txt'), 'good');
    },
  });

  assert(result.finalResult.allPassed, 'Should pass after retry');
  assert(retryCount >= 1, `Expected at least 1 retry, got ${retryCount}`);
  assert(result.passedOnAttempt !== null, 'Should have passed on some attempt');
  console.log('  ✅ PASSED');
}

async function testMetricsTracking(): Promise<void> {
  console.log('  Test: Metrics are tracked');
  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'metrics-check',
        description: 'For metrics',
        command: 'echo ok',
        required: true,
      },
    ],
  });

  await pipeline.validateAll();
  await pipeline.validateAll();

  const metrics = pipeline.getMetrics();
  assert(metrics.totalRuns >= 2, `Expected ≥2 runs, got ${metrics.totalRuns}`);
  assert(metrics.firstPassRate > 0, 'First pass rate should be > 0');
  console.log('  ✅ PASSED');
}

async function testFileValidation(): Promise<void> {
  console.log('  Test: File-specific validation');

  // Create a test shell script
  writeFileSync(join(TEST_DIR, 'test.sh'), '#!/bin/bash\necho "hello"');

  const pipeline = new ValidationPipeline({
    projectRoot: TEST_DIR,
    metricsPath: METRICS_PATH,
    autoDetect: false,
    customChecks: [
      {
        name: 'bash-syntax',
        description: 'Bash syntax',
        command: 'bash -n',
        failOnNonZero: true,
        required: true,
        appliesTo: ['.sh'],
      },
      {
        name: 'ts-check',
        description: 'TypeScript check',
        command: 'npx tsc --noEmit',
        failOnNonZero: true,
        required: true,
        appliesTo: ['.ts'],
      },
    ],
  });

  const result = await pipeline.validateFiles([join(TEST_DIR, 'test.sh')]);
  // Should only run bash-syntax, not ts-check
  assert(result.results.length === 1, `Expected 1 check for .sh file, got ${result.results.length}`);
  assert(result.results[0].check === 'bash-syntax', 'Should run bash syntax check');
  console.log('  ✅ PASSED');
}

// ============================================================================
// Run
// ============================================================================

console.log('\n🧪 Validation Pipeline Tests\n');

(async () => {
  try {
    setup();
    await testCustomCheck();
    await testFailingCheck();
    await testAdvisoryCheckDontBlockPass();
    await testErrorSummary();
    await testRetryLoop();
    await testMetricsTracking();
    await testFileValidation();
    console.log('\n✅ All Validation Pipeline tests passed!\n');
  } catch (error: any) {
    console.error('\n❌ TEST FAILURE:', error.message);
    process.exit(1);
  } finally {
    teardown();
  }
})();
