/**
 * ADW Registry - Defines available AI Developer Workflows
 *
 * The registry provides a catalog of deterministic workflows that the
 * orchestrator can trigger. Each workflow defines its steps, inputs,
 * and configuration.
 */

import type { ADWDefinition, ADWWorkflowType } from "./types.js";

// ============================================================================
// Built-in Workflow Definitions
// ============================================================================

/**
 * Plan-Build workflow: Plan a feature, then build it.
 * Steps: Research → Plan → Implement → Validate
 */
const planBuildWorkflow: ADWDefinition = {
  id: "plan-build",
  name: "Plan & Build",
  description:
    "Plan a feature by researching the codebase, create an implementation plan, build it step by step, then validate the result.",
  type: "plan-build",
  steps: [
    {
      name: "Research",
      description: "Explore the codebase to understand existing patterns and architecture",
      stepType: "agent",
      config: {
        prompt:
          "Research the codebase to understand how to implement the requested feature. Identify relevant files, patterns, and dependencies.",
        thinking: "high",
      },
    },
    {
      name: "Plan",
      description: "Create a detailed implementation plan",
      stepType: "agent",
      config: {
        prompt:
          "Based on the research, create a step-by-step implementation plan. List files to create/modify, describe the approach, and identify potential challenges.",
        thinking: "high",
      },
    },
    {
      name: "Implement",
      description: "Execute the implementation plan",
      stepType: "agent",
      config: {
        prompt:
          "Implement the feature according to the plan. Write code, create tests, and update documentation as needed.",
        thinking: "medium",
      },
    },
    {
      name: "Validate",
      description: "Run tests and verify the implementation",
      stepType: "test",
      config: {
        command: "pnpm test --run",
        timeoutSeconds: 300,
      },
    },
  ],
  inputSchema: {
    required: ["task"],
    optional: ["targetFiles", "context"],
  },
  defaults: {
    timeoutSeconds: 1800,
    thinking: "high",
  },
  enabled: true,
};

/**
 * Test-Fix workflow: Run tests, analyze failures, fix issues.
 * Steps: Run Tests → Analyze → Fix → Verify
 */
const testFixWorkflow: ADWDefinition = {
  id: "test-fix",
  name: "Test & Fix",
  description:
    "Run the test suite, analyze any failures, implement fixes, and verify the solution passes all tests.",
  type: "test-fix",
  steps: [
    {
      name: "Run Tests",
      description: "Execute the test suite to identify failures",
      stepType: "test",
      config: {
        command: "pnpm test --run",
        timeoutSeconds: 300,
      },
    },
    {
      name: "Analyze Failures",
      description: "Analyze test failures to understand root cause",
      stepType: "agent",
      config: {
        prompt:
          "Analyze the test failures. Identify the root cause of each failure and propose a fix. Consider whether the test or the implementation is incorrect.",
        thinking: "high",
      },
    },
    {
      name: "Implement Fixes",
      description: "Apply fixes to resolve test failures",
      stepType: "agent",
      config: {
        prompt:
          "Implement the fixes identified in the analysis. Make minimal changes to resolve the failures.",
        thinking: "medium",
      },
    },
    {
      name: "Verify Fixes",
      description: "Re-run tests to confirm all issues are resolved",
      stepType: "test",
      config: {
        command: "pnpm test --run",
        timeoutSeconds: 300,
      },
    },
  ],
  inputSchema: {
    required: [],
    optional: ["testPattern", "targetFiles"],
  },
  defaults: {
    timeoutSeconds: 1200,
    thinking: "high",
  },
  enabled: true,
};

/**
 * Review-Document workflow: Review code changes and generate documentation.
 * Steps: Analyze Changes → Generate Docs → Review Quality
 */
const reviewDocumentWorkflow: ADWDefinition = {
  id: "review-document",
  name: "Review & Document",
  description:
    "Review code changes, identify areas needing documentation, generate comprehensive docs, and verify quality.",
  type: "review-document",
  steps: [
    {
      name: "Analyze Changes",
      description: "Review recent changes to identify documentation needs",
      stepType: "agent",
      config: {
        prompt:
          "Analyze the recent code changes. Identify public APIs, configuration options, and behaviors that need documentation. Note any undocumented edge cases.",
        thinking: "medium",
      },
    },
    {
      name: "Generate Documentation",
      description: "Create or update documentation",
      stepType: "agent",
      config: {
        prompt:
          "Generate documentation for the identified areas. Include examples, parameter descriptions, and usage guidelines. Follow existing documentation patterns.",
        thinking: "medium",
      },
    },
    {
      name: "Review Quality",
      description: "Verify documentation accuracy and completeness",
      stepType: "validation",
      config: {
        checks: ["accuracy", "completeness", "examples"],
      },
    },
  ],
  inputSchema: {
    required: [],
    optional: ["targetFiles", "docFormat"],
  },
  defaults: {
    timeoutSeconds: 900,
    thinking: "medium",
  },
  enabled: true,
};

/**
 * Scout-Research workflow: Research before implementation.
 * Steps: Gather Context → Explore Options → Summarize Findings
 */
const scoutResearchWorkflow: ADWDefinition = {
  id: "scout-research",
  name: "Scout & Research",
  description:
    "Research a topic or codebase area before implementation. Gather context, explore options, and summarize findings.",
  type: "scout-research",
  steps: [
    {
      name: "Gather Context",
      description: "Collect relevant information and context",
      stepType: "agent",
      config: {
        prompt:
          "Gather context about the research topic. Search the codebase, read documentation, and identify relevant prior work.",
        thinking: "high",
      },
    },
    {
      name: "Explore Options",
      description: "Investigate possible approaches and solutions",
      stepType: "agent",
      config: {
        prompt:
          "Explore different approaches to the problem. Consider trade-offs, dependencies, and compatibility. Identify pros and cons of each option.",
        thinking: "high",
      },
    },
    {
      name: "Summarize Findings",
      description: "Create a summary report of research findings",
      stepType: "agent",
      config: {
        prompt:
          "Summarize the research findings. Provide recommendations, highlight key insights, and suggest next steps.",
        thinking: "medium",
      },
    },
  ],
  inputSchema: {
    required: ["topic"],
    optional: ["scope", "depth"],
  },
  defaults: {
    timeoutSeconds: 600,
    thinking: "high",
  },
  enabled: true,
};

// ============================================================================
// Registry Management
// ============================================================================

/**
 * The workflow registry - maps workflow IDs to definitions.
 */
const workflowRegistry = new Map<string, ADWDefinition>([
  [planBuildWorkflow.id, planBuildWorkflow],
  [testFixWorkflow.id, testFixWorkflow],
  [reviewDocumentWorkflow.id, reviewDocumentWorkflow],
  [scoutResearchWorkflow.id, scoutResearchWorkflow],
]);

/**
 * Get all registered workflow definitions.
 */
export function getAllWorkflows(): ADWDefinition[] {
  return Array.from(workflowRegistry.values());
}

/**
 * Get enabled workflow definitions.
 */
export function getEnabledWorkflows(): ADWDefinition[] {
  return getAllWorkflows().filter((w) => w.enabled);
}

/**
 * Get a workflow definition by ID.
 */
export function getWorkflow(workflowId: string): ADWDefinition | undefined {
  return workflowRegistry.get(workflowId);
}

/**
 * Check if a workflow exists and is enabled.
 */
export function isWorkflowAvailable(workflowId: string): boolean {
  const workflow = workflowRegistry.get(workflowId);
  return workflow !== undefined && workflow.enabled;
}

/**
 * Get workflows by type.
 */
export function getWorkflowsByType(type: ADWWorkflowType): ADWDefinition[] {
  return getAllWorkflows().filter((w) => w.type === type);
}

/**
 * Register a custom workflow.
 */
export function registerWorkflow(workflow: ADWDefinition): void {
  if (workflowRegistry.has(workflow.id)) {
    throw new Error(`Workflow ${workflow.id} already registered`);
  }
  workflowRegistry.set(workflow.id, workflow);
}

/**
 * Unregister a workflow.
 */
export function unregisterWorkflow(workflowId: string): boolean {
  return workflowRegistry.delete(workflowId);
}

/**
 * Enable or disable a workflow.
 */
export function setWorkflowEnabled(workflowId: string, enabled: boolean): boolean {
  const workflow = workflowRegistry.get(workflowId);
  if (!workflow) return false;
  workflow.enabled = enabled;
  return true;
}

/**
 * Get a summary of the registry for display.
 */
export function getRegistrySummary(): {
  total: number;
  enabled: number;
  byType: Record<ADWWorkflowType, number>;
} {
  const workflows = getAllWorkflows();
  const byType: Record<ADWWorkflowType, number> = {
    "plan-build": 0,
    "test-fix": 0,
    "review-document": 0,
    "scout-research": 0,
    custom: 0,
  };

  for (const w of workflows) {
    byType[w.type]++;
  }

  return {
    total: workflows.length,
    enabled: workflows.filter((w) => w.enabled).length,
    byType,
  };
}

/**
 * Format a workflow for display (used in orchestrator prompts).
 */
export function formatWorkflowForDisplay(workflow: ADWDefinition): string {
  const lines = [
    `**${workflow.name}** (\`${workflow.id}\`)`,
    `  ${workflow.description}`,
    `  Type: ${workflow.type}`,
    `  Steps: ${workflow.steps.map((s) => s.name).join(" → ")}`,
    `  Status: ${workflow.enabled ? "✓ enabled" : "✗ disabled"}`,
  ];
  return lines.join("\n");
}

/**
 * Get a formatted list of available workflows for orchestrator prompts.
 */
export function getWorkflowListForPrompt(): string {
  const workflows = getEnabledWorkflows();
  if (workflows.length === 0) {
    return "No ADW workflows are currently available.";
  }

  const lines = ["## Available AI Developer Workflows (ADWs)", ""];
  for (const w of workflows) {
    lines.push(formatWorkflowForDisplay(w));
    lines.push("");
  }

  return lines.join("\n");
}
