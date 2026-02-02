# TAC (Tactical Agentic Coding) Principles

> Comprehensive documentation extracted from 14 TAC lessons by Theo Brown

## Table of Contents

1. [The Core Philosophy](#the-core-philosophy)
2. [The 8 TAC Tactics](#the-8-tac-tactics)
3. [The Core Four](#the-core-four)
4. [The 12 Leverage Points](#the-12-leverage-points)
5. [The Progression: In-Loop → Out-Loop → ZTE](#the-progression)
6. [The Agentic Layer](#the-agentic-layer)
7. [Context Engineering (R&D Framework)](#context-engineering-rd-framework)
8. [Agentic Prompt Engineering](#agentic-prompt-engineering)
9. [Building Domain-Specific Agents](#building-domain-specific-agents)
10. [Multi-Agent Orchestration](#multi-agent-orchestration)
11. [Agent Experts Pattern](#agent-experts-pattern)
12. [The Codebase Singularity](#the-codebase-singularity)
13. [Key Frameworks](#key-frameworks)
14. [Agentic Coding KPIs](#agentic-coding-kpis)

---

## The Core Philosophy

TAC is fundamentally about **composable agentic primitives**, not the SDLC. The goal is to build an "agentic layer" around your codebase that operates your application autonomously.

> "The secret that I don't think most of you realize is that this is all composable."
> — Lesson 7

### The North Star: Zero Touch Engineering (ZTE)

ZTE is when agents ship end-to-end with no human review. This is the ultimate goal of agentic coding.

**The Question That Matters**: "Am I moving toward ZTE or away from it?"

---

## The 8 TAC Tactics

### Tactic 1: Stop Coding
Stop writing code yourself. Let agents do it. Your job is to guide, review, and improve the agentic system.

### Tactic 2: Adopt the Agent's Perspective
Think like the agent. Understand its context window, what it can see, what it can't see, and what decisions it's making.

### Tactic 3: Template Engineering
Create reusable prompt templates and specs that encode your patterns, standards, and approaches. Templates are composable building blocks.

### Tactic 4: Stay Out Loop
Minimize your involvement in agent workflows. Design systems that don't require constant human intervention.

**The Hierarchy**:
- **In-Loop**: You're actively involved in every step
- **Out-Loop**: Agent runs autonomously, you review at the end
- **AFK**: Agent runs while you're away, results waiting when you return
- **ZTE**: Agents ship without any human review

### Tactic 5: Add Feedback Loops
Agents need feedback to improve. Add testing, linting, type checking, and other automated feedback mechanisms.

### Tactic 6: One Agent, One Prompt, One Purpose
Keep agents focused. A single agent should have one clear purpose driven by one well-crafted prompt.

### Tactic 7: Scale Your Agents
Use Git worktrees for parallel agent execution. Multiple agents working simultaneously on different branches.

### Tactic 8: Prioritize Agentics
When deciding what to work on, prioritize improvements to your agentic layer over application features.

---

## The Core Four

The fundamental building blocks of agentic coding:

| Element | Description |
|---------|-------------|
| **Context** | What the agent knows - files, history, memory |
| **Model** | The LLM powering the agent |
| **Prompt** | Instructions that guide agent behavior |
| **Tools** | Capabilities the agent can use (read, write, execute) |

---

## The 12 Leverage Points

Extended from the Core Four:

1. **Context** - What the agent knows
2. **Model** - The LLM
3. **Prompt** - Instructions
4. **Tools** - Capabilities
5. **Standard Out** - What the agent outputs
6. **Testing** - Automated verification
7. **File Organization** - How code is structured
8. **Documentation** - Knowledge capture
9. **Memory** - Persistent agent knowledge
10. **Hooks** - Event-driven automation
11. **MCP (Model Context Protocol)** - External integrations
12. **Sub-agents** - Delegated specialized agents

---

## The Progression

```
In-Loop → Out-Loop → AFK → ZTE
```

### In-Loop
- You're present for every agent interaction
- High presence, low leverage
- Where most developers start

### Out-Loop
- Agent runs a complete workflow
- You review at the end
- Higher leverage, still requires attention

### AFK (Away From Keyboard)
- Agent runs while you're away
- Uses the PETER Framework
- Results ready when you return

### ZTE (Zero Touch Engineering)
- Agents ship end-to-end
- No human review required
- The North Star of agentic coding

---

## The Agentic Layer

> "The agentic layer is the new ring around your codebase where agents operate your application."
> — Lesson 8

### Meta-Tactic
Focus on the agentic layer over the application layer. Improvements to your agentic system compound over time.

### Composition Hierarchy

```
Prompts → Specs/Templates → ADWs (AI Developer Workflows)
```

**ADWs** are the highest level of composition:
- Deterministic code + non-deterministic agents
- Orchestrated workflows that accomplish complex tasks
- The building blocks of your agentic layer

### Agentic Layer Classes

| Class | Description |
|-------|-------------|
| **Class 1** | Manual agent usage, ad-hoc prompts |
| **Class 2** | Structured prompts, templates, specs |
| **Class 3** | Full ADWs, orchestration, ZTE capability |

### Agentic Layer Grades (1-8)

Progressive levels of agentic maturity from basic agent usage to full codebase singularity.

---

## Context Engineering (R&D Framework)

> "R&D: Reduce and Delegate. Those are the only two ways to manage context windows."
> — Lesson 9

### The Four Levels

#### Level 1: Measure
- Understand your context usage
- Track what's consuming tokens
- Identify waste

#### Level 2: Reduce
- Remove unnecessary context
- Be selective about what agents see
- Context priming > auto-loading

#### Level 3: Delegate
- Sub-agents for specialized tasks
- Each agent gets focused context
- Parallel execution for efficiency

#### Level 4: Self-Improving Experts
- Agents that learn and retain expertise
- Context that improves over time
- The path to true agent intelligence

### Key Insight
**Context priming is superior to auto-loading memory files**. Give agents exactly what they need, when they need it.

---

## Agentic Prompt Engineering

> "The stakeholder trifecta: You, Your Team, Your Agents"
> — Lesson 10

### Seven Levels of Prompt Formats

From basic to advanced:

1. **Raw text** - Unstructured prompts
2. **Markdown** - Basic formatting
3. **Structured sections** - Clear organization
4. **Templates with variables** - Reusable patterns
5. **Specs with validation** - Formal specifications
6. **Meta prompts** - Prompts that generate prompts
7. **Template Meta Prompts** - S-tier: prompts that build prompt templates

### Template Meta Prompts (S-Tier)

Prompts that generate other prompts. The highest leverage prompt engineering technique.

### The Stakeholder Trifecta

When writing prompts, consider all three audiences:
1. **You** - Must be able to understand and modify
2. **Your Team** - Must be able to collaborate
3. **Your Agents** - Must be able to execute effectively

---

## Building Domain-Specific Agents

> "The system prompt is the most important element with zero exceptions."
> — Lesson 11

### The Progression
```
Better Agents → More Agents → Custom Agents
```

### Key Principles

1. **System prompt is everything** - It defines agent behavior completely
2. **Tool selection matters** - Give agents the right capabilities
3. **Specialization wins** - Focused agents outperform generalists
4. **Use the SDK** - Claude Code SDK for building custom agents

### Building Custom Agents

Use the Claude Code SDK to create agents with:
- Custom system prompts
- Selected tool sets
- Specific context configurations
- Defined output formats

---

## Multi-Agent Orchestration

> "One Agent To Rule Them All"
> — Lesson 12

### The Orchestrator Agent (O-Agent)

A centralized agent that manages all other agents.

### Three Pillars

1. **Orchestrator** - Central control and coordination
2. **CRUD for Agents** - Create, Read, Update, Delete agent configurations
3. **Observability** - Visibility into agent operations

### Benefits

- Centralized control over agent fleets
- Consistent agent management
- Scalable orchestration
- Better monitoring and debugging

---

## Agent Experts Pattern

> "The massive problem: agents forget, so they don't learn."
> — Lesson 13

### The Problem
Agents forget everything after each session. They can't build expertise over time.

### The Solution: Act, Learn, Reuse

```
Act → Learn → Reuse
```

#### Act
Agent performs a task, capturing decisions and approaches.

#### Learn
Extract expertise into structured formats (YAML "mental models").

#### Reuse
Load relevant expertise into future agent sessions.

### Expertise Storage

Store agent expertise in YAML files:
- Mental models
- Decision patterns
- Domain knowledge
- Best practices

This solves the "agents forget" problem by externalizing learning.

---

## The Codebase Singularity

> "The moment when your agents can run your codebase better than you can."
> — Lesson 14

### Definition
The Codebase Singularity is achieved when:
- Agents understand your codebase deeply
- Agents can make better decisions than humans
- Agents can ship features end-to-end
- Human review becomes optional

### Getting There

Combine all TAC concepts:
1. Build a robust agentic layer
2. Implement Agent Experts for learning
3. Use Multi-Agent Orchestration
4. Achieve consistent ZTE
5. Let agents compound their knowledge

### The Goal
Your agents become the primary operators of your codebase. You become the architect of the agentic system, not the coder of the application.

---

## Key Frameworks

### PETER Framework (AFK Agents)

For running agents while Away From Keyboard:

| Element | Description |
|---------|-------------|
| **P**rompt Input | What the agent receives |
| **T**rigger | What starts the agent |
| **E**nvironment | Where the agent runs |
| **R**eview | How results are validated |

### ADW (AI Developer Workflow)

The highest composition level:
- Deterministic code orchestration
- Non-deterministic agent execution
- Structured workflows
- Reusable patterns

---

## Agentic Coding KPIs

Track these metrics to measure agentic maturity:

| KPI | Direction | Description |
|-----|-----------|-------------|
| **Presence** | ↓ Down | Time spent actively watching agents |
| **Size** | ↑ Up | Scope of tasks agents can handle |
| **Streak** | ↑ Up | Consecutive successful agent runs |
| **Attempts** | ↓ Down | Retries needed per task |

### The Goal
- Minimize presence (out-loop/AFK/ZTE)
- Maximize task size
- Maximize success streaks
- Minimize retry attempts

---

## Summary

TAC is a comprehensive framework for building agentic systems that operate your codebase. The journey progresses from:

1. **Basic agent usage** → Following the 8 tactics
2. **Building your agentic layer** → Using the 12 leverage points
3. **Engineering context** → R&D Framework
4. **Crafting prompts** → Template Meta Prompts
5. **Building custom agents** → Domain-specific specialists
6. **Orchestrating agents** → O-Agent pattern
7. **Creating learning agents** → Agent Experts
8. **Achieving singularity** → Agents run your codebase

The North Star is always **ZTE (Zero Touch Engineering)**: agents shipping end-to-end without human review.

---

*Documentation extracted from TAC Lessons 1-14 by Theo Brown*
*Generated for the Gimli project's TAC Orchestrator implementation*
