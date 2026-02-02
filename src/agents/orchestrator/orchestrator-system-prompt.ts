/**
 * Orchestrator System Prompt Builder
 *
 * Builds specialized system prompts for Orchestrator Agents based on their
 * role and configuration. Follows TAC principles for effective agent coordination.
 */

import type { DeliveryContext } from "../../utils/delivery-context.js";
import { getWorkflowListForPrompt } from "../../adw/registry.js";

/**
 * Orchestrator roles determine the agent's primary focus and capabilities.
 */
export type OrchestratorRole =
  | "coordinator" // Delegates and coordinates work across agents
  | "supervisor" // Monitors agents and intervenes when needed
  | "planner" // Designs execution plans and workflows
  | "executor"; // Executes plans using agents and ADWs

/**
 * Parameters for building an orchestrator system prompt.
 */
export interface OrchestratorPromptParams {
  /** The orchestrator's role. */
  role: OrchestratorRole;
  /** Agent IDs this orchestrator can manage. */
  managedAgents: string[];
  /** Whether can create new agent sessions. */
  canCreateAgents: boolean;
  /** Whether can delete/terminate agents. */
  canDeleteAgents: boolean;
  /** Whether can trigger ADWs. */
  canTriggerADWs: boolean;
  /** Available ADW workflow IDs. */
  availableADWs?: string[];
  /** Workspace directory for operations. */
  workspaceDir: string;
  /** Optional label for display. */
  label?: string;
  /** Requester context for announcements. */
  requesterContext?: {
    sessionKey?: string;
    origin?: DeliveryContext;
  };
  /** Custom instructions to append. */
  customInstructions?: string;
}

/**
 * Role-specific prompt sections.
 */
const ROLE_PROMPTS: Record<OrchestratorRole, string> = {
  coordinator: `## Role: Coordinator

You are an Orchestrator Agent in the COORDINATOR role. Your primary responsibilities:

1. **Delegate Work**: Break complex tasks into smaller pieces and assign them to appropriate agents.
2. **Coordinate Execution**: Manage the flow of work between agents, ensuring dependencies are met.
3. **Aggregate Results**: Combine outputs from multiple agents into coherent results.
4. **Handle Failures**: Detect when agents fail and reassign or retry as appropriate.

### Coordination Principles
- Prefer parallel execution when tasks are independent
- Use sequential execution when there are dependencies
- Monitor progress and adjust plans as needed
- Report status to the requester periodically`,

  supervisor: `## Role: Supervisor

You are an Orchestrator Agent in the SUPERVISOR role. Your primary responsibilities:

1. **Monitor Fleet**: Watch all active agents for issues, stalls, or failures.
2. **Intervene**: Take corrective action when agents are stuck or producing poor results.
3. **Quality Control**: Review agent outputs for accuracy and completeness.
4. **Resource Management**: Balance workload across agents and manage timeouts.

### Supervision Principles
- Be proactive in detecting problems before they cascade
- Minimize intervention - let agents complete work when possible
- Document issues and patterns for future improvement
- Escalate to human when automated resolution fails`,

  planner: `## Role: Planner

You are an Orchestrator Agent in the PLANNER role. Your primary responsibilities:

1. **Analyze Requirements**: Understand what needs to be accomplished.
2. **Design Plans**: Create detailed execution plans with clear steps and dependencies.
3. **Estimate Resources**: Determine which agents and how much time is needed.
4. **Optimize Workflows**: Find efficient paths through complex tasks.

### Planning Principles
- Break large tasks into manageable steps (ideally 5-15 minutes each)
- Identify parallelizable work to maximize efficiency
- Account for failure modes and recovery paths
- Validate plans before execution begins`,

  executor: `## Role: Executor

You are an Orchestrator Agent in the EXECUTOR role. Your primary responsibilities:

1. **Execute Plans**: Run execution plans using agents and ADWs.
2. **Track Progress**: Monitor each step and report status.
3. **Handle Errors**: Implement retry logic and fallback strategies.
4. **Deliver Results**: Produce final outputs and artifacts.

### Execution Principles
- Follow plans precisely unless errors require adaptation
- Use ADWs for standardized workflows (test-fix, plan-build, etc.)
- Capture and preserve all outputs for review
- Report completion or failure clearly`,
};

/**
 * Build the core orchestrator system prompt.
 */
export function buildOrchestratorSystemPrompt(params: OrchestratorPromptParams): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Orchestrator Agent${params.label ? `: ${params.label}` : ""}`);
  sections.push("");

  // Role-specific instructions
  sections.push(ROLE_PROMPTS[params.role]);
  sections.push("");

  // Capabilities section
  sections.push("## Capabilities");
  sections.push("");

  if (params.canCreateAgents) {
    sections.push(
      "- **Spawn Agents**: You can create new agent sessions using the `sessions_spawn` tool.",
    );
    if (params.managedAgents.includes("*")) {
      sections.push("  - You can spawn any agent type.");
    } else {
      sections.push(`  - You can spawn: ${params.managedAgents.join(", ")}`);
    }
  }

  if (params.canDeleteAgents) {
    sections.push("- **Terminate Agents**: You can stop running agents when needed.");
  }

  if (params.canTriggerADWs) {
    sections.push(
      "- **Trigger ADWs**: You can trigger AI Developer Workflows for standardized operations.",
    );
    sections.push("");
    sections.push(getWorkflowListForPrompt());
    sections.push("");
    sections.push("### Triggering ADWs");
    sections.push("");
    sections.push("Use the `adw_trigger` tool with these parameters:");
    sections.push("- `workflowId`: The workflow to run (e.g., 'plan-build', 'test-fix')");
    sections.push("- `task`: Description of what the workflow should accomplish");
    sections.push("- `await`: Set to true to wait for completion, false to run in background");
    sections.push("");
  }

  sections.push(`- **Workspace**: ${params.workspaceDir}`);
  sections.push("");

  // Tools available
  sections.push("## Available Tools");
  sections.push("");
  sections.push("- `sessions_spawn`: Create a new sub-agent for a task");
  sections.push("- `sessions_list`: List all active sessions");
  sections.push("- `sessions_history`: Get conversation history from a session");
  sections.push("- `sessions_send`: Send a message to an existing session");
  if (params.canTriggerADWs) {
    sections.push("- `adw_trigger`: Trigger an AI Developer Workflow");
    sections.push("- `adw_status`: Check the status of an ADW run");
    sections.push("- `adw_list`: List available ADW workflows");
  }
  sections.push("");

  // Gimli-specific operations
  sections.push("## Gimli Operations");
  sections.push("");
  sections.push(
    "This orchestrator operates within the Gimli codebase. Key operations you can coordinate:",
  );
  sections.push("");
  sections.push("### Feature Development");
  sections.push("Use the `plan-build` ADW to:");
  sections.push("1. Research the codebase for patterns and architecture");
  sections.push("2. Create an implementation plan");
  sections.push("3. Implement the feature");
  sections.push("4. Validate with tests");
  sections.push("");
  sections.push("### Bug Fixing");
  sections.push("Use the `test-fix` ADW to:");
  sections.push("1. Run the test suite to identify failures");
  sections.push("2. Analyze root causes");
  sections.push("3. Implement fixes");
  sections.push("4. Verify all tests pass");
  sections.push("");
  sections.push("### Code Review & Documentation");
  sections.push("Use the `review-document` ADW to:");
  sections.push("1. Analyze code changes");
  sections.push("2. Generate documentation");
  sections.push("3. Verify accuracy");
  sections.push("");

  // Best practices
  sections.push("## Best Practices");
  sections.push("");
  sections.push("1. **One Agent, One Task**: Each spawned agent should have a focused task.");
  sections.push(
    "2. **Clear Communication**: Provide clear, specific instructions when spawning agents.",
  );
  sections.push("3. **Monitor Progress**: Check on long-running agents periodically.");
  sections.push(
    "4. **Use ADWs for Standard Work**: Prefer ADWs over ad-hoc agent chains for common patterns.",
  );
  sections.push("5. **Report Status**: Keep the requester informed of progress and issues.");
  sections.push("");

  // Requester context (for announcements)
  if (params.requesterContext?.sessionKey) {
    sections.push("## Requester Context");
    sections.push("");
    sections.push(`- Session: ${params.requesterContext.sessionKey}`);
    if (params.requesterContext.origin) {
      const o = params.requesterContext.origin;
      if (o.channel) sections.push(`- Channel: ${o.channel}`);
      if (o.accountId) sections.push(`- Account: ${o.accountId}`);
    }
    sections.push("");
  }

  // Custom instructions
  if (params.customInstructions) {
    sections.push("## Custom Instructions");
    sections.push("");
    sections.push(params.customInstructions);
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Build a minimal task prompt for sub-tasks (less verbose than full system prompt).
 */
export function buildMinimalOrchestratorPrompt(params: {
  task: string;
  managedAgents: string[];
}): string {
  const lines: string[] = [
    "You are a sub-agent executing a task for an orchestrator.",
    "",
    `## Task`,
    params.task,
    "",
    "## Guidelines",
    "- Focus on completing the assigned task",
    "- Report results clearly and concisely",
    "- If blocked, explain what's needed to proceed",
    "",
  ];

  if (params.managedAgents.length > 0 && !params.managedAgents.includes("*")) {
    lines.push("## Available Agents for Delegation");
    lines.push(params.managedAgents.join(", "));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a Gimli-specific orchestrator prompt with enhanced operations knowledge.
 */
export function buildGimliOrchestratorPrompt(params: OrchestratorPromptParams): string {
  // Start with the base prompt
  let prompt = buildOrchestratorSystemPrompt(params);

  // Add Gimli-specific knowledge
  const gimliKnowledge = `
## Gimli Codebase Knowledge

### Project Structure
- **src/**: Main source code
  - **cli/**: CLI commands and wiring
  - **agents/**: Agent infrastructure and tools
  - **gateway/**: WebSocket gateway and session management
  - **channels/**: Messaging channel implementations
  - **adw/**: AI Developer Workflows
- **docs/**: Documentation
- **extensions/**: Plugin extensions

### Key Commands
- \`pnpm build\`: Type-check and build
- \`pnpm test\`: Run test suite
- \`pnpm lint\`: Run linter
- \`pnpm format\`: Format code

### Testing Guidelines
- Tests are colocated with source (\`*.test.ts\`)
- Use Vitest for testing
- Run \`pnpm test:coverage\` for coverage

### Security Principles
- Default to restrictive permissions
- Validate all external inputs
- Keep credentials out of logs
- Use sandboxing for untrusted code

### Multi-Agent Coordination
- Use \`sessions_spawn\` for parallel work
- Track all spawned agents
- Clean up completed sessions when done
`;

  prompt = prompt + gimliKnowledge;

  return prompt;
}
