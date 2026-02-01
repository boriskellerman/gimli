# Pattern Types Design

> **PRD Phase 5 Task**: Define pattern types to track (time-based, event-based, context-based)

## Overview

This document defines the pattern types that Gimli's anticipation system tracks to predict user needs before they ask. Patterns are learned observations about user behavior that can trigger proactive reminders.

## Pattern Categories

### 1. Time-Based Patterns

Patterns triggered by temporal conditions (time of day, day of week, recurring intervals).

**Examples:**
- "User reviews PRs every Monday morning around 9 AM"
- "User writes status updates on Friday afternoons"
- "User checks email at 8:30 AM and 2:00 PM"

**Use Cases:**
- Proactive standup reminders before daily meetings
- Weekend planning prompts on Friday afternoons
- Morning briefing suggestions at start of workday

### 2. Event-Based Patterns

Patterns triggered by specific events or actions within a session or across sessions.

**Examples:**
- "After a test failure, user typically runs in debug mode"
- "After committing code, user usually creates a PR"
- "When an error is thrown, user asks for stack trace analysis"

**Use Cases:**
- Suggest PR creation after commits
- Offer debugging assistance after errors
- Prompt for test runs after code changes

### 3. Context-Based Patterns

Patterns triggered by semantic context in the conversation or environment.

**Examples:**
- "When discussing deployments, user needs staging URLs"
- "When reviewing security issues, user wants OWASP references"
- "When planning features, user references the PRD"

**Use Cases:**
- Surface relevant documentation during discussions
- Inject helpful context based on conversation topic
- Remind about related tasks when topics arise

## Type Definitions

### Base Pattern Interface

```typescript
interface BasePattern {
  /** Unique identifier */
  id: string;

  /** Agent this pattern belongs to */
  agentId: string;

  /** Human-readable description of what was observed */
  description: string;

  /** Pattern type discriminator */
  type: "time-based" | "event-based" | "context-based";

  /** Confidence score (0-1) based on observation frequency and recency */
  confidence: number;

  /** Number of times this pattern has been observed */
  observationCount: number;

  /** When the pattern was first observed */
  firstObserved: Date;

  /** When the pattern was most recently observed */
  lastObserved: Date;

  /** Whether this pattern is active (can trigger reminders) */
  active: boolean;

  /** Optional link to a reminder this pattern triggers */
  linkedReminderId?: string;
}
```

### Time-Based Pattern

```typescript
interface TimePattern extends BasePattern {
  type: "time-based";

  /** What time condition triggers this pattern */
  trigger: TimePatternTrigger;

  /** What the user typically does at this time */
  typicalAction: string;

  /** Optional time window tolerance in minutes (default: 30) */
  toleranceMinutes: number;

  /** Days of week this pattern applies to (1-7, Monday=1) */
  daysOfWeek?: number[];
}

type TimePatternTrigger =
  | { kind: "time-of-day"; hour: number; minute: number }
  | { kind: "day-of-week"; dayOfWeek: number; hour?: number; minute?: number }
  | { kind: "interval"; intervalMinutes: number; lastTriggered?: Date };
```

### Event-Based Pattern

```typescript
interface EventPattern extends BasePattern {
  type: "event-based";

  /** What event triggers this pattern */
  trigger: EventPatternTrigger;

  /** What the user typically does after the trigger event */
  typicalFollowUp: string;

  /** Typical delay between trigger and follow-up (in seconds) */
  typicalDelaySeconds?: number;

  /** Maximum delay before pattern no longer applies (in seconds) */
  expirationSeconds: number;
}

type EventPatternTrigger =
  | { kind: "tool-call"; toolName: string; resultPattern?: string }
  | { kind: "error"; errorType?: string; messagePattern?: string }
  | { kind: "command"; command: string }
  | { kind: "session-event"; event: "start" | "end" | "compact" | "reset" }
  | { kind: "user-mention"; keywords: string[] };
```

### Context-Based Pattern

```typescript
interface ContextPattern extends BasePattern {
  type: "context-based";

  /** Keywords that indicate this context */
  contextKeywords: string[];

  /** Minimum semantic similarity score to trigger (0-1) */
  relevanceThreshold: number;

  /** What the user typically needs in this context */
  typicalNeed: string;

  /** Related memory chunks that inform this pattern */
  relatedChunkIds?: string[];

  /** Whether to use semantic matching in addition to keywords */
  useSemanticMatching: boolean;
}
```

## Confidence Calculation

Pattern confidence is calculated based on:

1. **Observation Count**: More observations = higher base confidence
2. **Recency**: Recent observations weighted more heavily
3. **Consistency**: Lower variance in timing = higher confidence

```typescript
function calculateConfidence(params: {
  observationCount: number;
  daysSinceLastObserved: number;
  consistencyScore: number; // 0-1, based on timing variance
}): number {
  const { observationCount, daysSinceLastObserved, consistencyScore } = params;

  // Base confidence from observation count (asymptotic to 0.7)
  const countFactor = 1 - Math.exp(-observationCount / 5);

  // Recency decay (halves every 14 days)
  const recencyFactor = Math.exp(-daysSinceLastObserved / 14);

  // Combined confidence
  const rawConfidence = (countFactor * 0.5 + consistencyScore * 0.3 + recencyFactor * 0.2);

  // Clamp to 0-1
  return Math.max(0, Math.min(1, rawConfidence));
}
```

## Pattern Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│                      Pattern Lifecycle                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. OBSERVATION                                                  │
│     User behavior captured via:                                  │
│     - agent:turn:complete hook                                   │
│     - Session transcript analysis                                │
│     - Learning system extraction                                 │
│                 │                                                │
│                 ▼                                                │
│  2. DETECTION                                                    │
│     Pattern extractor identifies:                                │
│     - Recurring time-based behaviors                             │
│     - Event → action sequences                                   │
│     - Context → need associations                                │
│                 │                                                │
│                 ▼                                                │
│  3. RECORDING                                                    │
│     New pattern created OR existing pattern updated:             │
│     - Increment observation count                                │
│     - Update lastObserved timestamp                              │
│     - Recalculate confidence                                     │
│                 │                                                │
│                 ▼                                                │
│  4. ACTIVATION                                                   │
│     Pattern becomes active when:                                 │
│     - confidence >= 0.4 (configurable threshold)                 │
│     - observationCount >= 3 (minimum observations)               │
│                 │                                                │
│                 ▼                                                │
│  5. REMINDER LINKING                                             │
│     Active patterns can:                                         │
│     - Auto-generate reminder suggestions                         │
│     - Link to existing reminders for context triggers            │
│                 │                                                │
│                 ▼                                                │
│  6. DECAY / DEACTIVATION                                         │
│     Patterns decay when:                                         │
│     - Not observed for extended period (confidence → 0)          │
│     - User explicitly dismisses pattern-based reminders          │
│     - Conflicting patterns emerge                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Storage Format

Patterns are stored in `~/.gimli/agents/{agentId}/PATTERNS.md`:

```markdown
# Activity Patterns

## Time-Based

### Daily Standup Prep
- **ID**: pattern-time-001
- **Confidence**: 0.78
- **Observations**: 12
- **First Observed**: 2026-01-15
- **Last Observed**: 2026-01-30
- **Trigger**: Weekdays at 08:45 (±15 min)
- **Action**: User reviews open PRs and prepares standup notes

### Friday Planning
- **ID**: pattern-time-002
- **Confidence**: 0.65
- **Observations**: 6
- **Trigger**: Fridays at 16:00 (±30 min)
- **Action**: User writes weekly status update

## Event-Based

### Post-Commit PR Creation
- **ID**: pattern-event-001
- **Confidence**: 0.82
- **Observations**: 24
- **Trigger**: After git commit
- **Follow-up**: User creates pull request (typically within 5 minutes)

## Context-Based

### Deployment Discussion
- **ID**: pattern-context-001
- **Confidence**: 0.71
- **Observations**: 8
- **Keywords**: deploy, staging, production, release
- **Need**: User requests staging URLs and deployment checklist
```

## Integration with Reminder System

Patterns connect to reminders via:

1. **Auto-Generation**: High-confidence patterns can suggest reminders
2. **Context Triggers**: Context patterns feed into `trigger.type = "context"`
3. **Time Triggers**: Time patterns inform `trigger.type = "scheduled"` or `"recurring"`
4. **Event Triggers**: Event patterns could spawn real-time prompts (future)

### Pattern → Reminder Flow

```typescript
function patternToReminder(pattern: Pattern): CreateReminderInput | null {
  if (pattern.confidence < 0.5) return null; // Too low confidence

  switch (pattern.type) {
    case "time-based":
      return {
        agentId: pattern.agentId,
        title: `Reminder: ${pattern.typicalAction}`,
        trigger: timePatternToTrigger(pattern.trigger),
        priority: "low", // Pattern-generated = low priority
        contextTags: ["auto-generated", "pattern-based"],
      };

    case "context-based":
      return {
        agentId: pattern.agentId,
        title: `Context: ${pattern.typicalNeed}`,
        trigger: { type: "context", pattern: pattern.contextKeywords.join("|") },
        priority: "low",
        contextTags: ["auto-generated", "pattern-based"],
      };

    case "event-based":
      // Event patterns don't directly map to reminders
      // They're handled by real-time prompting (future feature)
      return null;
  }
}
```

## Data Sources

| Pattern Type | Primary Data Source | Secondary Sources |
|--------------|---------------------|-------------------|
| Time-Based | Session file timestamps | Hook event timestamps |
| Event-Based | Tool calls in turn events | Error logs, command history |
| Context-Based | Memory semantic search | Session transcript analysis |

## Configuration

```typescript
interface PatternConfig {
  /** Minimum confidence to activate a pattern */
  activationThreshold: number; // default: 0.4

  /** Minimum observations before activation */
  minObservations: number; // default: 3

  /** Days before inactive pattern is archived */
  archiveAfterDays: number; // default: 90

  /** Maximum patterns per agent */
  maxPatternsPerAgent: number; // default: 100

  /** Whether to auto-generate reminder suggestions */
  autoSuggestReminders: boolean; // default: true

  /** Confidence threshold for auto-suggesting reminders */
  reminderSuggestionThreshold: number; // default: 0.6
}

const defaultPatternConfig: PatternConfig = {
  activationThreshold: 0.4,
  minObservations: 3,
  archiveAfterDays: 90,
  maxPatternsPerAgent: 100,
  autoSuggestReminders: true,
  reminderSuggestionThreshold: 0.6,
};
```

## Security Considerations

1. **Agent Isolation**: Patterns are scoped to agentId, no cross-agent access
2. **Privacy**: Patterns stored locally, never transmitted externally
3. **User Control**: User can view, edit, and delete patterns
4. **Transparency**: Pattern-triggered reminders are clearly labeled

## Implementation Files

```
src/patterns/
├── types.ts              # Pattern type definitions
├── config.ts             # Configuration and defaults
├── store.ts              # Load/save patterns from PATTERNS.md
├── confidence.ts         # Confidence calculation logic
├── extractor.ts          # Extract patterns from observations
├── matcher.ts            # Match current context to patterns
├── capture-hook.ts       # Hook to capture pattern observations
└── index.ts              # Public exports
```

## References

- Reminder types: `src/reminders/types.ts`
- Memory integration: `docs/design/reminder-memory-integration.md`
- Learning system: `src/learning/extract-learnings.ts`
- Hook system: `src/hooks/internal-hooks.ts`
