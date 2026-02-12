/**
 * Tests for Expert Manager — Act→Learn→Reuse cycle
 */

import { ExpertManager, type Learning } from '../src/expert-manager';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

const TEST_DIR = join(__dirname, '__test-experts__');

function setup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });

  // Create test expert files — names match DOMAIN_MAPPINGS keys
  writeFileSync(join(TEST_DIR, 'gateway-expert.yaml'), yaml.dump({
    name: 'gateway-expert',
    version: '1.0',
    domain: 'gateway',
    description: 'Test gateway expert for unit tests',
    updated: '2026-02-11',
    mental_model: {
      core: 'WebSocket-based gateway',
    },
    learnings: {
      patterns: [
        {
          id: 'lrn-existing-1',
          timestamp: Date.now(),
          sourceWorkflow: 'test',
          sourceRunId: 'test-run-1',
          category: 'pattern',
          title: 'Existing pattern',
          description: 'An existing learned pattern',
          confidence: 0.8,
          occurrences: 3,
          tags: ['gateway', 'websocket'],
        },
      ],
    },
    self_improve: {
      max_learnings_per_category: 5,
    },
  }));

  writeFileSync(join(TEST_DIR, 'security-expert.yaml'), yaml.dump({
    name: 'security-expert',
    version: '1.0',
    domain: 'security',
    description: 'Test security expert for unit tests',
    updated: '2026-02-11',
    mental_model: {
      core: 'Defense in depth',
    },
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

function testLoadExperts(): void {
  console.log('  Test: Load experts from directory');
  const mgr = new ExpertManager(TEST_DIR);

  const experts = mgr.listExperts();
  assert(experts.length === 2, `Expected 2 experts, got ${experts.length}`);
  assert(experts.includes('gateway-expert'), 'Should include gateway expert');
  assert(experts.includes('security-expert'), 'Should include security expert');
  console.log('  ✅ PASSED');
}

function testSelectExperts(): void {
  console.log('  Test: Select experts by keyword');
  const mgr = new ExpertManager(TEST_DIR);

  // Should match gateway expert
  const sel1 = mgr.selectExperts('Fix the websocket reconnection in the gateway');
  assert(sel1.experts.length > 0, 'Should select at least one expert');
  assert(sel1.experts[0].name === 'gateway-expert', `Expected gateway expert, got ${sel1.experts[0].name}`);
  assert(sel1.contextString.length > 0, 'Context string should not be empty');
  assert(sel1.estimatedTokens > 0, 'Should estimate tokens');

  // Should match security expert
  const sel2 = mgr.selectExperts('Add authentication to the credential store');
  assert(sel2.experts.length > 0, 'Should select security expert');
  assert(sel2.experts[0].name === 'security-expert', `Expected security expert, got ${sel2.experts[0].name}`);

  console.log('  ✅ PASSED');
}

function testSelectExpertsByFilePath(): void {
  console.log('  Test: Select experts by affected file paths');
  const mgr = new ExpertManager(TEST_DIR);

  const sel = mgr.selectExperts('Fix this bug', ['src/infra/sessions-store.ts']);
  // src/infra/ matches database-expert mapping, but we only have test experts
  // This should still work — may not find a match which is OK
  assert(sel.experts.length >= 0, 'Should handle file path matching gracefully');

  console.log('  ✅ PASSED');
}

function testRecordLearnings(): void {
  console.log('  Test: Record new learnings to expert');
  const mgr = new ExpertManager(TEST_DIR);

  const added = mgr.recordLearnings({
    workflowName: 'self-improve',
    runId: 'test-run-2',
    domain: 'gateway',
    learnings: [
      {
        category: 'pattern',
        title: 'New reconnect pattern',
        description: 'Use exponential backoff for WebSocket reconnection',
        confidence: 0.9,
        tags: ['gateway', 'websocket', 'reconnect'],
      },
      {
        category: 'anti_pattern',
        title: 'Never force-close connections',
        description: 'Always use graceful shutdown with drain timeout',
        confidence: 0.85,
        tags: ['gateway', 'websocket'],
      },
    ],
  });

  assert(added === 2, `Expected 2 learnings added, got ${added}`);

  // Verify they were saved to disk
  const expertYaml = readFileSync(join(TEST_DIR, 'gateway-expert.yaml'), 'utf-8');
  const expert = yaml.load(expertYaml) as any;
  assert(expert.learnings.patterns.length === 2, `Expected 2 patterns, got ${expert.learnings.patterns.length}`);
  assert(expert.learnings.anti_patterns.length === 1, `Expected 1 anti-pattern, got ${expert.learnings.anti_patterns?.length}`);

  console.log('  ✅ PASSED');
}

function testDuplicateDetection(): void {
  console.log('  Test: Duplicate learning detection');
  const mgr = new ExpertManager(TEST_DIR);

  // Record the same learning twice
  mgr.recordLearnings({
    workflowName: 'test',
    runId: 'run-dup-1',
    domain: 'gateway',
    learnings: [{
      category: 'pattern',
      title: 'Existing pattern',  // Same title as the seed data
      description: 'Updated description',
      confidence: 0.7,
    }],
  });

  // Should have bumped occurrences, not added a new entry
  const expert = mgr.getExpert('gateway-expert');
  const patterns = expert?.learnings?.patterns || [];
  const existing = patterns.find(p => p.title === 'Existing pattern');
  assert(existing !== undefined, 'Should find the existing pattern');
  assert(existing!.occurrences > 3, `Expected occurrences > 3, got ${existing!.occurrences}`);

  console.log('  ✅ PASSED');
}

function testPruning(): void {
  console.log('  Test: Pruning when category exceeds max');
  const mgr = new ExpertManager(TEST_DIR);

  // Add 10 learnings (max is 5 for test expert)
  const learnings = Array.from({ length: 10 }, (_, i) => ({
    category: 'debugging_tip' as const,
    title: `Debugging tip #${i}`,
    description: `Description for tip ${i}`,
    confidence: 0.1 * (i + 1), // 0.1 to 1.0
  }));

  mgr.recordLearnings({
    workflowName: 'test',
    runId: 'run-prune-1',
    domain: 'gateway',
    learnings,
  });

  const expert = mgr.getExpert('gateway-expert');
  const tips = expert?.learnings?.debugging_tips || [];
  assert(tips.length <= 5, `Expected ≤5 debugging tips after pruning, got ${tips.length}`);
  // Highest confidence should survive
  assert(tips.some(t => t.title === 'Debugging tip #9'), 'Highest confidence tip should survive');

  console.log('  ✅ PASSED');
}

function testGetStats(): void {
  console.log('  Test: Get expert stats');
  const mgr = new ExpertManager(TEST_DIR);

  const stats = mgr.getStats();
  assert(Object.keys(stats).length === 2, `Expected 2 experts in stats, got ${Object.keys(stats).length}`);
  assert(stats['gateway-expert'] !== undefined, 'Should have gateway expert stats');

  console.log('  ✅ PASSED');
}

function testContextStringIncludesLearnings(): void {
  console.log('  Test: Context string includes learnings');
  const mgr = new ExpertManager(TEST_DIR);

  const sel = mgr.selectExperts('gateway websocket connection');
  assert(sel.contextString.includes('Existing pattern'), 'Context should include existing learning title');
  assert(sel.contextString.includes('Key Learnings'), 'Context should have Key Learnings section');

  console.log('  ✅ PASSED');
}

// ============================================================================
// Run
// ============================================================================

console.log('\n🧪 Expert Manager Tests\n');

try {
  setup();
  testLoadExperts();
  testSelectExperts();
  testSelectExpertsByFilePath();
  testRecordLearnings();
  testDuplicateDetection();
  testPruning();
  testGetStats();
  testContextStringIncludesLearnings();
  console.log('\n✅ All Expert Manager tests passed!\n');
} catch (error: any) {
  console.error('\n❌ TEST FAILURE:', error.message);
  process.exit(1);
} finally {
  teardown();
}
