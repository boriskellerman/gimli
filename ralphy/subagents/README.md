# Gimli Sub-Agent Prompts

> TAC Grade 2: Sub-Agents for parallelizable, domain-specific tasks.

## Overview

These sub-agent prompts enable task delegation to specialized agents, each with focused domain knowledge. This follows the TAC (Tactical Agentic Coding) principle of "One Agent, One Prompt, One Purpose."

## Available Sub-Agents

| Sub-Agent | Domain | Key Directories |
|-----------|--------|-----------------|
| [Frontend](./frontend.md) | Web UI, Lit components | `ui/src/ui/` |
| [Backend](./backend.md) | Agent runtime, providers, tools | `src/agents/`, `src/providers/` |
| [Gateway](./gateway.md) | WebSocket server, sessions, routing | `src/gateway/` |
| [Channels](./channels.md) | Messaging platform adapters | `src/*/`, `extensions/` |

## Usage Pattern

### Spawning Sub-Agents

Use `sessions_spawn` to delegate tasks:

```typescript
// Example: Spawn frontend sub-agent
await sessions_spawn({
  task: `
    ${frontendPrompt}

    ## Your Task
    Add a dark mode toggle to the settings panel.
  `,
  label: 'frontend: dark mode toggle',
  thinking: 'medium',
});
```

### Parallel Execution

For independent tasks across domains:

```typescript
// Spawn multiple sub-agents in parallel
await Promise.all([
  sessions_spawn({
    task: `${frontendPrompt}\n\n## Task: Update settings UI`,
    label: 'frontend: settings UI',
  }),
  sessions_spawn({
    task: `${backendPrompt}\n\n## Task: Add config schema`,
    label: 'backend: config schema',
  }),
]);
```

## When to Use Sub-Agents

### Good Candidates
- UI-only changes (frontend)
- New tool implementation (backend)
- RPC method additions (gateway)
- New channel adapter (channels)
- Bug fixes isolated to one domain

### When to Keep Orchestrator
- Cross-domain features
- Architecture decisions
- Security-critical changes
- Integration testing

## TAC Principles Applied

1. **Context Delegation**: Each sub-agent gets domain-focused context
2. **One Purpose**: Each prompt defines a single responsibility area
3. **Feedback Loops**: Sub-agents report back with structured output
4. **Reduced Presence**: Orchestrator can work on other tasks while sub-agents run

## Directory Structure

```
ralphy/subagents/
├── README.md       # This file
├── frontend.md     # Web UI expert
├── backend.md      # Agent runtime expert
├── gateway.md      # Gateway server expert
└── channels.md     # Channel adapters expert
```

## Extending

To add a new sub-agent:

1. Create `ralphy/subagents/<domain>.md`
2. Define: Identity, Domain Knowledge, Responsibilities, Constraints
3. Include code style examples
4. Document escalation criteria
5. Add to this README

## Related TAC Concepts

- **Grade 2**: Sub-agents (this)
- **Grade 4**: Closed-loop prompts (add validation)
- **Grade 6**: Agentic workflows (chain sub-agents)
- **Grade 7**: Agent experts (self-improving domain knowledge)
