# Closed-Loop Prompts

> Specialized prompts implementing the Request → Validate → Resolve pattern for autonomous agent workflows.

## Overview

Closed-loop prompts enable agents to self-validate their work and self-correct when validation fails. This moves agents from "best effort" to "verified output," enabling higher-trust autonomous workflows.

## The Request → Validate → Resolve Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ┌─────────┐      ┌──────────┐      ┌─────────┐            │
│  │ REQUEST │ ──▶  │ VALIDATE │ ──▶  │ RESOLVE │ ─┐         │
│  └─────────┘      └──────────┘      └─────────┘  │         │
│       │                 │                 │      │         │
│       │                 │                 │      │         │
│  Gather context    Check against      Fix issues │         │
│  and constraints   acceptance          and retry │         │
│                    criteria                      │         │
│       │                 │                        │         │
│       ▼                 ▼                        ▼         │
│  ┌─────────┐      ┌──────────┐      ┌─────────────┐        │
│  │ Execute │      │  PASS?   │      │ Iteration < │        │
│  │  Task   │      │          │      │    max?     │        │
│  └─────────┘      └──────────┘      └─────────────┘        │
│                        │                   │               │
│                   YES  │  NO          YES  │  NO           │
│                        ▼                   ▼               │
│                   ┌────────┐         Loop back    ┌───────┐│
│                   │COMPLETE│         to VALIDATE  │ FAIL  ││
│                   └────────┘                      └───────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Available Prompts

| Prompt | Purpose | Key Validation Criteria |
|--------|---------|------------------------|
| [testing-closed-loop.md](./testing-closed-loop.md) | Write and validate tests | Tests pass, coverage met, lint clean |
| [reviewing-closed-loop.md](./reviewing-closed-loop.md) | Code review with quality checks | Comments specific, actionable, accurate |
| [documenting-closed-loop.md](./documenting-closed-loop.md) | Documentation with accuracy checks | Matches code, examples work, links valid |

## Usage

### Standalone Usage

Each prompt can be used directly by providing the required inputs:

```yaml
# Example: Run testing prompt
target: src/agents/identity.ts
scope: unit
coverage_threshold: 80
max_iterations: 3
```

### ADW (AI Developer Workflow) Integration

Chain prompts together for end-to-end workflows:

```
plan-feature → build → [testing-closed-loop] → [reviewing-closed-loop] → [documenting-closed-loop] → merge
```

### Sub-Agent Delegation

Use as specialized sub-agents with focused context:

```yaml
# O-Agent delegates to test agent
delegate:
  agent: testing-agent
  prompt: testing-closed-loop.md
  input:
    target: "{{files_changed}}"
    coverage_threshold: 80
```

## Design Principles

### 1. Explicit Acceptance Criteria
Every prompt defines clear, measurable criteria for success. Agents don't guess whether their work is done—they verify.

### 2. Bounded Iterations
Maximum iteration limits prevent infinite loops while allowing reasonable self-correction attempts.

### 3. Specific Failure Handling
Each failure type has a defined resolution strategy. Agents know exactly how to fix each type of issue.

### 4. Output Verification
Prompts include mechanisms to verify outputs match reality (e.g., cross-checking docs against code signatures).

### 5. Iteration History
Tracking what was tried and what failed enables better debugging and prevents repeated mistakes.

## Common Parameters

All closed-loop prompts share these parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | string | required | What to operate on |
| `max_iterations` | number | 3 | Self-correction attempts before failing |

## Creating New Closed-Loop Prompts

To add a new specialized prompt:

1. **Define the Request Phase**
   - What inputs are needed?
   - What context must be gathered first?
   - What's the core task?

2. **Define Acceptance Criteria**
   - What must be true for success?
   - How can each criterion be verified?
   - What tools/commands verify each criterion?

3. **Define Resolution Strategies**
   - For each failure type, what's the fix?
   - What should NOT be done (e.g., "don't delete failing tests")?
   - When should the agent escalate vs. retry?

4. **Define Output Format**
   - What does success look like?
   - What does failure look like?
   - How is iteration history reported?

### Template

```markdown
# {{Name}} Closed-Loop Prompt

## Purpose
{{one_line_description}}

## Request Phase
### Input Schema
{{yaml_schema}}

### Context Requirements
{{what_to_gather}}

### Initial Task
{{task_description}}

## Validate Phase
### Acceptance Criteria
{{table_of_criteria}}

### Validation Method
{{how_to_check}}

## Resolve Phase
### Self-Correction Rules
{{what_to_do_on_failure}}

### Iteration Tracking
{{tracking_format}}

## Output Format
{{success_and_failure_formats}}
```

## TAC Alignment

These prompts implement key TAC principles:

- **Tactic 5: Add Feedback Loops** - Validation phase provides automated feedback
- **Tactic 6: One Agent, One Purpose** - Each prompt has a single, focused purpose
- **Leverage Point 6: Testing** - Testing prompt enables test-driven agent workflows
- **Leverage Point 8: Documentation** - Documenting prompt keeps docs accurate

## Future Additions

Planned closed-loop prompts:
- `refactoring-closed-loop.md` - Refactor with behavior preservation
- `migration-closed-loop.md` - Database/API migrations with rollback
- `security-audit-closed-loop.md` - Security scanning with remediation

---

*Part of the TAC Orchestrator (Phase 9, Grade 4) implementation*
