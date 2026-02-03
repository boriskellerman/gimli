#!/usr/bin/env node

/**
 * TAC Orchestrator CLI
 * 
 * Usage:
 *   orchestrator run <workflow>     # Run a specific workflow
 *   orchestrator health             # Check Gimli health
 *   orchestrator upstream           # Check upstream status
 *   orchestrator loop               # Run full autonomous loop
 *   orchestrator list               # List available workflows
 *   orchestrator metrics            # Show metrics
 *   orchestrator status             # Show active runs
 */

import { GimliWrapper } from './gimli-wrapper';
import { join } from 'path';

const GIMLI_PATH = process.env.GIMLI_PATH || '/home/gimli/github/gimli';
const ORCHESTRATOR_PATH = process.env.ORCHESTRATOR_PATH || join(GIMLI_PATH, 'ralphy', 'orchestrator');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  const wrapper = new GimliWrapper({
    gimliPath: GIMLI_PATH,
    orchestratorPath: ORCHESTRATOR_PATH,
  });

  switch (command) {
    case 'run': {
      const workflowName = args[1];
      if (!workflowName) {
        console.error('Usage: orchestrator run <workflow-name>');
        console.error('Available workflows:', wrapper.getWorkflows().join(', '));
        process.exit(1);
      }
      
      // Parse additional inputs as key=value pairs
      const inputs: Record<string, any> = {};
      for (const arg of args.slice(2)) {
        const [key, value] = arg.split('=');
        if (key && value) {
          // Try to parse as JSON, fall back to string
          try {
            inputs[key] = JSON.parse(value);
          } catch {
            inputs[key] = value;
          }
        }
      }

      const result = await wrapper.triggerWorkflow(workflowName, inputs);
      console.log('\n📋 Workflow Result:');
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.status === 'success' ? 0 : 1);
    }

    case 'health': {
      const health = await wrapper.checkHealth();
      console.log('\n📋 Health Report:');
      console.log(JSON.stringify(health, null, 2));
      process.exit(health.testsPass ? 0 : 1);
    }

    case 'upstream': {
      const upstream = await wrapper.checkUpstream();
      console.log('\n📋 Upstream Status:');
      console.log(JSON.stringify(upstream, null, 2));
      process.exit(0);
    }

    case 'loop': {
      await wrapper.runAutonomousLoop();
      process.exit(0);
    }

    case 'list': {
      console.log('📋 Available Workflows:');
      for (const wf of wrapper.getWorkflows()) {
        console.log(`  - ${wf}`);
      }
      process.exit(0);
    }

    case 'metrics': {
      const metrics = wrapper.getMetrics();
      console.log('📊 Wrapper Metrics:');
      console.log(JSON.stringify(metrics, null, 2));
      process.exit(0);
    }

    case 'status': {
      // Would show active runs
      console.log('📊 Status: No active runs');
      process.exit(0);
    }

    case 'help':
    default: {
      console.log(`
TAC Orchestrator CLI - Autonomous Gimli Management

Usage:
  orchestrator run <workflow> [inputs]   Run a specific workflow
  orchestrator health                    Check Gimli health (tests, logs)
  orchestrator upstream                  Check for upstream updates
  orchestrator loop                      Run full autonomous loop
  orchestrator list                      List available workflows
  orchestrator metrics                   Show cumulative metrics
  orchestrator status                    Show active workflow runs
  orchestrator help                      Show this help

Workflows:
  plan-build        End-to-end feature development
  test-fix          Automatically fix failing tests
  bug-investigate   Systematic bug investigation and fix
  security-audit    Comprehensive security scanning
  self-improve      Continuous autonomous improvement

Examples:
  orchestrator run self-improve focus=bugs max_issues=3
  orchestrator run security-audit scope=quick
  orchestrator loop
      `);
      process.exit(command === 'help' ? 0 : 1);
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
