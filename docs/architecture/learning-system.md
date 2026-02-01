# Learning System Architecture

This document provides a technical overview of Gimli's learning system, including its capabilities, implementation details, storage mechanisms, and known limitations.

## Overview

The learning system enables Gimli agents to automatically learn from user interactions, capturing corrections, preferences, and successful patterns. Learnings are stored in a per-agent `LEARNINGS.md` file and can be loaded into agent context to influence future behavior.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Turn Complete                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              learning-capture-hook.ts                           │
│  - Registers on agent:turn:complete event                       │
│  - Extracts learnings from user messages                        │
│  - Detects success patterns from positive feedback              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              extract-learnings.ts                               │
│  - Pattern matching via regex                                   │
│  - Categorizes into: preference, correction, pattern, tool-usage│
│  - Assigns confidence levels: high, medium, low                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│              learnings-store.ts                                 │
│  - Deduplication via Jaccard similarity (80% threshold)         │
│  - Markdown file format with category sections                  │
│  - Per-agent storage: ~/.gimli/agents/<id>/agent/LEARNINGS.md   │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Learning Capture Hook (`learning-capture-hook.ts`)

The entry point that listens to agent events and triggers learning extraction.

**Event**: `agent:turn:complete`

**Configuration**:
```typescript
interface LearningCaptureConfig {
  enabled: boolean;           // Default: true
  minMessageLength: number;   // Default: 10
  maxLearningsPerTurn: number; // Default: 3
}
```

**Process**:
1. Receives turn complete event with user message and agent payloads
2. Extracts learnings from user message via pattern matching
3. If positive feedback detected, extracts success pattern
4. Stores learnings via `addLearning()`, respecting per-turn limits

### 2. Learning Extraction (`extract-learnings.ts`)

Heuristic-based pattern matching to identify learnings in user messages.

**Learning Categories**:

| Category | Description | Example Patterns |
|----------|-------------|------------------|
| `preference` | User likes, dislikes, style preferences | "I prefer...", "Always use...", "Never..." |
| `correction` | User corrections to agent behavior | "Actually I meant...", "No, I want...", "Please don't..." |
| `pattern` | Successful interaction patterns | Captured when user gives positive feedback |
| `tool-usage` | Feedback about specific tools | "Use the X tool...", "Don't use X..." |

**Confidence Levels**:
- `high`: Explicit keywords (always, never, must, important) or corrections
- `medium`: Standard preference/tool expressions
- `low`: Implicit or ambiguous signals

**Pattern Detection Regex**:

Corrections:
- `/(?:actually|no,?\s*)?i\s*(?:meant|want(?:ed)?|need(?:ed)?)\s+(.+)/i`
- `/(?:that's\s*)?not\s*(?:what\s*i\s*(?:meant|wanted|asked))/i`
- `/(?:please\s*)?(?:don't|do\s*not)\s+(.+)/i`

Preferences:
- `/i\s*(?:prefer|like|want)\s+(.+)/i`
- `/(?:always|usually)\s+(?:use|do|want)\s+(.+)/i`
- `/(?:never|don't\s*ever)\s+(.+)/i`

Success Indicators:
- `/perfect!?/i`, `/exactly\s*(?:what\s*i\s*(?:wanted|needed))?/i`
- `/great!?\s*(?:job|work)?/i`, `/that'?s?\s*(?:it|right|correct)/i`

### 3. Learnings Store (`learnings-store.ts`)

Handles persistence and deduplication of learnings.

**Storage Location**: `~/.gimli/agents/<agentId>/agent/LEARNINGS.md`

**Data Structure**:
```typescript
interface StoredLearning {
  category: "preference" | "correction" | "pattern" | "tool-usage";
  content: string;      // Max 150 characters
  confidence: "high" | "medium" | "low";
  source: string;       // "user_message", "success_pattern", "file"
  timestamp: string;    // ISO 8601
  id: string;           // Unique ID: l_<timestamp36>_<random>
}
```

**Deduplication**:
- Uses Jaccard similarity on word tokens
- Threshold: 80% similarity within same category
- If duplicate found, updates timestamp instead of adding new entry

**File Format**:
```markdown
# Agent Learnings

## User Preferences

- [2025-01-29] Prefers concise responses without emojis

## Corrections

- [2025-01-29] Use pnpm instead of npm for this project

## Successful Patterns

- [2025-01-29] For "fix the test": ran vitest, read error, edited file

## Tool Usage

- [2025-01-29] Prefer exec tool over browser for CLI tasks
```

## Integration with Other Systems

### Reminder System Integration

The learning system integrates with the reminder feedback system (`src/reminders/learning-integration.ts`) to learn from reminder effectiveness:

- Tracks reminder completion, dismissal, snooze, and ignore rates
- Generates learnings about effective reminder timing and triggers
- Feeds system-level patterns (e.g., "Reminders are most effective in the morning")

**Outcome Weights**:
| Reaction | Weight |
|----------|--------|
| completed | 1.0 |
| acted | 0.8 |
| snoozed | 0.3 |
| dismissed | 0.1 |
| ignored | 0.0 |

### Memory Injection Hook

Separate from learning capture, the memory injection hook (`src/hooks/memory-injection-hook.ts`) can inject relevant memories (including learnings) before agent turns. This is the mechanism by which learnings influence agent behavior.

## Current Capabilities

1. **Automatic extraction**: Learnings are captured without explicit user action
2. **Four learning categories**: Preferences, corrections, patterns, and tool usage
3. **Confidence scoring**: High/medium/low based on message explicitness
4. **Deduplication**: Prevents redundant learnings via similarity matching
5. **Per-agent storage**: Each agent maintains its own learnings file
6. **Human-readable format**: Markdown format allows manual review/editing
7. **Bootstrap integration**: Can be loaded into agent context via bootstrap files
8. **Reminder integration**: Learns from reminder feedback effectiveness

## Known Limitations

### Extraction Limitations

1. **Regex-based only**: Pattern matching is rigid; misses nuanced or implicit feedback
2. **English-centric**: Patterns are designed for English; limited multilingual support
3. **Single extraction per category**: Only one learning per category per message
4. **No semantic understanding**: Cannot interpret context or intent beyond patterns
5. **Success pattern heuristics**: Limited action extraction from agent replies

### Storage Limitations

1. **File-based only**: No database integration; limited query capabilities
2. **No versioning**: Learnings cannot be rolled back or tracked over time
3. **Simple similarity**: Jaccard similarity may miss semantic duplicates
4. **No decay mechanism**: Old learnings persist indefinitely
5. **No relevance ranking**: All learnings treated equally in bootstrap loading

### Integration Limitations

1. **Passive injection**: Learnings are only used if explicitly loaded via bootstrap
2. **No active retrieval**: Agent cannot query specific learnings during a turn
3. **No cross-agent learning**: Each agent's learnings are isolated
4. **Limited feedback loop**: No mechanism to verify if learnings improve behavior

### Scale Limitations

1. **Unbounded growth**: LEARNINGS.md can grow indefinitely
2. **No pruning**: No automatic removal of outdated or contradictory learnings
3. **No summarization**: Cannot consolidate related learnings
4. **Linear loading**: All learnings loaded at once; no selective retrieval

## Future Enhancement Opportunities

Based on the current implementation, potential enhancements include:

1. **LLM-based extraction**: Use language models for semantic understanding
2. **Active memory queries**: Allow agents to query learnings during turns
3. **Learning decay**: Reduce confidence over time for unused learnings
4. **Contradiction detection**: Identify and resolve conflicting learnings
5. **Cross-agent patterns**: Share common learnings across agents
6. **Effectiveness tracking**: Measure if learnings improve agent responses
7. **Selective retrieval**: Query relevant learnings based on current context
8. **Learning summarization**: Consolidate related learnings periodically

## Configuration

### Disabling Learning Capture

```json5
{
  hooks: {
    "agent:turn:complete": {
      learnings: { enabled: false }
    }
  }
}
```

### Loading Learnings into Context

```json5
{
  agents: {
    defaults: {
      bootstrap: {
        files: ["SOUL.md", "USER.md", "TOOLS.md", "MEMORY.md", "LEARNINGS.md"]
      }
    }
  }
}
```

## File Locations

| Component | Path |
|-----------|------|
| Learning capture hook | `src/learning/learning-capture-hook.ts` |
| Learning extraction | `src/learning/extract-learnings.ts` |
| Learnings store | `src/learning/learnings-store.ts` |
| Index/exports | `src/learning/index.ts` |
| Tests | `src/learning/extract-learnings.test.ts` |
| Reminder integration | `src/reminders/learning-integration.ts` |
| User documentation | `docs/concepts/learnings.md` |

## Related Documentation

- [Self-Improving Agent (User Guide)](/concepts/learnings)
- [Memory System](/concepts/memory)
- [Hooks System](/hooks)
- [Agent Workspace](/concepts/agent-workspace)
