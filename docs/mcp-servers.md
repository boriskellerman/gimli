# MCP Server Configuration for TAC Orchestrator

This document describes the MCP (Model Context Protocol) server configuration for Gimli's TAC orchestrator system.

## Overview

MCP servers extend agent capabilities by providing standardized tool integrations. For the TAC (Tactical Agentic Coding) orchestrator, we've configured servers that align with TAC's 12 Leverage Points and support the Agent Experts pattern.

## Configured Servers

### Memory Server

**Purpose**: Implements TAC's "Agent Experts" pattern for persistent agent learning.

```json
"memory": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-memory"],
  "env": {
    "MEMORY_FILE_PATH": "${PROJECT_ROOT}/.gimli/agent-memory.jsonl"
  }
}
```

**TAC Alignment**:
- Supports TAC Leverage Point #9: Memory
- Enables the "Act → Learn → Reuse" cycle
- Stores agent expertise as knowledge graph entities
- Solves the "agents forget" problem from TAC Lesson 13

**Use Cases**:
- Store mental models for domain-specific agents
- Track decision patterns and approaches
- Maintain expertise across sessions
- Build up codebase knowledge incrementally

### Git Server

**Purpose**: Enhanced git operations beyond CLI for deep repository analysis.

```json
"git": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-git"]
}
```

**TAC Alignment**:
- Supports TAC Leverage Point #4: Tools
- Enables TAC Tactic 7: Scale agents via git worktrees
- Provides structured access to repository state

**Use Cases**:
- Analyze commit history for pattern extraction
- Inspect diffs for code review workflows
- Support parallel agent execution via worktrees
- Track changes for self-improvement loop

### Sequential Thinking Server

**Purpose**: Reflective problem-solving for complex multi-step tasks.

```json
"sequential-thinking": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
}
```

**TAC Alignment**:
- Supports TAC Leverage Point #3: Prompt (closed-loop patterns)
- Enables TAC Tactic 5: Add feedback loops
- Implements Request → Validate → Resolve pattern

**Use Cases**:
- Break down complex tasks into reasoning steps
- Validate solutions before application
- Support ADW (AI Developer Workflow) pipelines
- Enable self-correction in agent workflows

## Already Available via Plugins

The following MCP capabilities are already available through Claude Code plugins:

| Capability | Plugin | Notes |
|------------|--------|-------|
| Browser automation | Playwright | Full browser control |
| Code search | Greptile | PR review, code analysis |
| Vector storage | Pinecone | Semantic search |
| Library docs | Context7 | Up-to-date documentation |
| GitHub PRs | Greptile | PR management and review |

## Integration with Gimli

These MCP servers complement Gimli's existing systems:

### Memory Server + Gimli Memory
- MCP Memory: Agent expertise and knowledge graphs
- Gimli Memory: Conversation context and user preferences
- Separation allows focused agent learning without polluting user memory

### Git Server + gh CLI
- Git Server: Structured repository analysis
- gh CLI: GitHub-specific operations (issues, PRs, actions)
- Complementary tools for different purposes

### Sequential Thinking + Kanban Agent
- Sequential Thinking: Step-by-step reasoning
- Kanban Agent: Task orchestration and iteration
- Combined for validated autonomous workflows

## Configuration Location

The `.mcp.json` file lives at the project root and is automatically loaded by Claude Code when working in this directory.

Memory storage location: `.gimli/agent-memory.jsonl`

## Future Considerations

As the TAC orchestrator matures, consider adding:

1. **Fetch Server** - For web content analysis in research workflows
2. **Brave Search** - For real-time information gathering
3. **Custom Gimli MCP Server** - Exposing Gimli's internal APIs as MCP tools

## References

- [MCP Official Servers](https://github.com/modelcontextprotocol/servers)
- [TAC Principles](../ralphy/TAC_PRINCIPLES.md)
- [Gimli Skills](../skills/)
