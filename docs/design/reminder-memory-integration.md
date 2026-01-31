# Reminder-Memory Integration Design

> **PRD Phase 5 Task**: Design how reminders integrate with existing memory architecture

## Overview

This document describes how Gimli's anticipation and reminder system integrates with the existing memory architecture. The design follows security-first principles and leverages existing infrastructure rather than creating parallel data stores.

## Goals

1. **Leverage Existing Memory System**: Store reminders in the same SQLite-based memory infrastructure
2. **Use Existing Hooks**: Inject reminders via the established `agent:turn:start` hook pattern
3. **Cron Integration**: Use the existing cron service for scheduled reminder triggers
4. **Semantic Discovery**: Enable reminders to be found via the same hybrid search (vector + BM25)

## Architecture

### Storage Layer

Reminders extend the existing memory schema by adding a new `reminders` table:

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,

  -- Reminder content (also indexed in memory chunks for semantic search)
  title TEXT NOT NULL,
  body TEXT,

  -- Trigger configuration
  trigger_type TEXT NOT NULL, -- 'scheduled' | 'recurring' | 'context'
  trigger_spec TEXT NOT NULL, -- ISO datetime, cron expression, or context pattern

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'triggered' | 'completed' | 'dismissed' | 'snoozed'
  priority TEXT NOT NULL DEFAULT 'normal', -- 'urgent' | 'normal' | 'low'

  -- Timing
  created_at INTEGER NOT NULL,
  triggered_at INTEGER,
  completed_at INTEGER,
  snooze_until INTEGER,

  -- Context for smart delivery
  context_tags TEXT, -- JSON array of tags for context-based triggering
  quiet_hours_exempt INTEGER NOT NULL DEFAULT 0,

  -- Link to memory chunk for semantic search
  chunk_id TEXT, -- References chunks.id for semantic retrieval

  FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_agent ON reminders(agent_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_trigger ON reminders(trigger_type, trigger_spec);
```

### Memory Integration Points

#### 1. Reminder Creation → Memory Chunk

When a reminder is created, a corresponding memory chunk is also created:

```typescript
interface ReminderMemoryEntry {
  id: string;
  agentId: string;
  title: string;
  body?: string;
  triggerType: "scheduled" | "recurring" | "context";
  triggerSpec: string;
  priority: "urgent" | "normal" | "low";
  contextTags?: string[];
}

async function createReminder(
  manager: MemoryIndexManager,
  reminder: ReminderMemoryEntry
): Promise<void> {
  // 1. Create the reminder record
  await insertReminder(reminder);

  // 2. Create a memory chunk for semantic search
  const chunkText = formatReminderAsMemory(reminder);
  const chunkId = await manager.addChunk({
    source: "reminders",
    path: `reminders/${reminder.id}.md`,
    text: chunkText,
  });

  // 3. Link reminder to chunk
  await updateReminderChunkId(reminder.id, chunkId);
}

function formatReminderAsMemory(reminder: ReminderMemoryEntry): string {
  const lines = [
    `# Reminder: ${reminder.title}`,
    `Priority: ${reminder.priority}`,
    `Trigger: ${reminder.triggerType} - ${reminder.triggerSpec}`,
  ];
  if (reminder.body) lines.push(`\n${reminder.body}`);
  if (reminder.contextTags?.length) {
    lines.push(`\nContext: ${reminder.contextTags.join(", ")}`);
  }
  return lines.join("\n");
}
```

#### 2. Proactive Query Extension

Extend `queryProactiveMemories` to include due reminders:

```typescript
interface ProactiveReminderResult extends ProactiveMemoryResult {
  reminderId: string;
  reminderPriority: "urgent" | "normal" | "low";
  reminderTriggerType: string;
  isDue: boolean;
}

async function queryProactiveReminders(
  manager: MemoryIndexManager,
  options: ProactiveQueryOptions & { currentTime?: Date }
): Promise<ProactiveReminderResult[]> {
  const now = options.currentTime || new Date();

  // 1. Get scheduled reminders that are due
  const dueReminders = await getDueReminders(options.agentId, now);

  // 2. Get context-relevant reminders via semantic search
  const contextReminders = await manager.search(options.userMessage, {
    source: "reminders",
    maxResults: 3,
    minScore: 0.4,
  });

  // 3. Merge and deduplicate
  return mergeReminderResults(dueReminders, contextReminders);
}
```

#### 3. Injection Hook Extension

Extend `memory-injection-hook.ts` to include reminders:

```typescript
export interface MemoryInjectionConfig {
  enabled: boolean;
  maxMemories: number;
  maxTokens: number;
  minScore: number;
  // New reminder-specific options
  reminders?: {
    enabled: boolean;
    maxReminders: number;
    includeContextual: boolean; // Include context-based reminders
    quietHoursStart?: string;  // "22:00"
    quietHoursEnd?: string;    // "07:00"
  };
}

async function injectReminders(
  event: InternalHookEvent,
  config: MemoryInjectionConfig
): Promise<void> {
  const context = event.context as TurnStartContext;

  // Check quiet hours (unless reminder is exempt)
  if (isQuietHours(config.reminders)) {
    // Only inject urgent reminders
    const urgentReminders = await getUrgentDueReminders(context.agentId);
    if (urgentReminders.length > 0) {
      event.messages.push(formatRemindersForInjection(urgentReminders));
    }
    return;
  }

  // Normal reminder injection
  const reminders = await queryProactiveReminders(/* ... */);
  if (reminders.length > 0) {
    event.messages.push(formatRemindersForInjection(reminders));
  }
}
```

### Cron Integration

Scheduled reminders register with the existing cron service:

```typescript
interface ReminderCronJob {
  id: string;           // `reminder:${reminderId}`
  schedule: string;     // Cron expression or ISO datetime
  agentId: string;
  message: string;      // "Reminder: {title}"
  metadata: {
    reminderId: string;
    priority: string;
  };
}

function scheduleReminder(reminder: ReminderMemoryEntry): void {
  const cronService = getCronService();

  if (reminder.triggerType === "scheduled") {
    // One-time reminder: use at() scheduling
    cronService.scheduleAt({
      id: `reminder:${reminder.id}`,
      runAt: new Date(reminder.triggerSpec),
      agentId: reminder.agentId,
      message: `[Reminder - ${reminder.priority}] ${reminder.title}`,
    });
  } else if (reminder.triggerType === "recurring") {
    // Recurring reminder: use cron expression
    cronService.add({
      id: `reminder:${reminder.id}`,
      schedule: reminder.triggerSpec,
      agentId: reminder.agentId,
      message: `[Reminder - ${reminder.priority}] ${reminder.title}`,
    });
  }
  // Context-based reminders don't use cron - they're injected via semantic match
}
```

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Reminder Creation                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User: "remind me to X before Y"                                        │
│           │                                                             │
│           ▼                                                             │
│  ┌────────────────────┐    ┌─────────────────────┐                      │
│  │  Parse Reminder    │───▶│  Insert Reminder    │                      │
│  │  (NLP extraction)  │    │  (reminders table)  │                      │
│  └────────────────────┘    └─────────────────────┘                      │
│                                      │                                   │
│                   ┌──────────────────┼──────────────────┐               │
│                   ▼                  ▼                  ▼               │
│          ┌──────────────┐   ┌──────────────┐   ┌──────────────┐         │
│          │ Create Chunk │   │ Schedule via │   │  Index for   │         │
│          │ (for search) │   │    Cron      │   │ Context Tags │         │
│          └──────────────┘   └──────────────┘   └──────────────┘         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          Reminder Delivery                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Two delivery paths:                                                    │
│                                                                         │
│  ┌─────────────┐           ┌─────────────────────────────────────┐      │
│  │  Cron Timer │──────────▶│  Scheduled/Recurring Triggers       │      │
│  │  (tick)     │           │  → Direct injection to session      │      │
│  └─────────────┘           └─────────────────────────────────────┘      │
│                                                                         │
│  ┌─────────────┐           ┌─────────────────────────────────────┐      │
│  │  User Turn  │──────────▶│  agent:turn:start Hook              │      │
│  │  (message)  │           │  → Query due reminders              │      │
│  └─────────────┘           │  → Semantic search for context      │      │
│                            │  → Inject relevant reminders        │      │
│                            └─────────────────────────────────────┘      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## API Design

### Reminder Types

```typescript
export interface Reminder {
  id: string;
  agentId: string;
  title: string;
  body?: string;

  trigger: ReminderTrigger;
  status: ReminderStatus;
  priority: ReminderPriority;

  createdAt: Date;
  triggeredAt?: Date;
  completedAt?: Date;
  snoozeUntil?: Date;

  contextTags?: string[];
  quietHoursExempt: boolean;

  // Memory system link
  chunkId?: string;
}

export type ReminderTrigger =
  | { type: "scheduled"; datetime: Date }
  | { type: "recurring"; cron: string }
  | { type: "context"; pattern: string };

export type ReminderStatus =
  | "pending"
  | "triggered"
  | "completed"
  | "dismissed"
  | "snoozed";

export type ReminderPriority = "urgent" | "normal" | "low";
```

### Reminder Store Interface

```typescript
export interface ReminderStore {
  // CRUD
  create(reminder: CreateReminderInput): Promise<Reminder>;
  get(id: string): Promise<Reminder | null>;
  update(id: string, updates: Partial<Reminder>): Promise<Reminder>;
  delete(id: string): Promise<void>;

  // Queries
  listByAgent(agentId: string, filter?: ReminderFilter): Promise<Reminder[]>;
  getDue(agentId: string, asOf?: Date): Promise<Reminder[]>;
  getByContext(agentId: string, query: string): Promise<Reminder[]>;

  // Status updates
  markTriggered(id: string): Promise<void>;
  markCompleted(id: string): Promise<void>;
  dismiss(id: string): Promise<void>;
  snooze(id: string, until: Date): Promise<void>;
}
```

## Security Considerations

1. **Agent Isolation**: Reminders are scoped to `agentId` - no cross-agent access
2. **Input Validation**: All reminder content is sanitized before storage
3. **Rate Limiting**: Max reminders per agent (configurable, default: 100)
4. **Quiet Hours**: Respects configured quiet periods (except urgent reminders)
5. **Memory Permissions**: Reminders inherit memory system permissions

## File Locations

```
src/
├── reminders/
│   ├── types.ts           # Reminder type definitions
│   ├── store.ts           # ReminderStore implementation
│   ├── schema.ts          # SQLite schema extensions
│   ├── memory-bridge.ts   # Memory system integration
│   ├── cron-bridge.ts     # Cron service integration
│   ├── proactive.ts       # Proactive reminder queries
│   └── index.ts           # Public exports
├── hooks/
│   └── reminder-injection-hook.ts  # Hook for turn-start injection
└── agents/
    └── tools/
        └── reminder-tool.ts  # Agent-callable reminder tools
```

## Testing Strategy

1. **Unit Tests**: Each module (store, bridges, proactive) tested in isolation
2. **Integration Tests**: Full flow from creation → storage → cron → delivery
3. **Memory Integration**: Verify reminders appear in semantic search
4. **Hook Tests**: Verify injection at turn-start events

## Implementation Order

1. `src/reminders/types.ts` - Type definitions
2. `src/reminders/schema.ts` - SQLite schema
3. `src/reminders/store.ts` - CRUD operations
4. `src/reminders/memory-bridge.ts` - Memory chunk integration
5. `src/reminders/cron-bridge.ts` - Cron scheduling
6. `src/reminders/proactive.ts` - Proactive queries
7. `src/hooks/reminder-injection-hook.ts` - Turn injection
8. Tests for each component

## References

- Memory system: `src/memory/manager.ts`, `src/memory/memory-schema.ts`
- Proactive queries: `src/memory/proactive-query.ts`
- Memory injection: `src/hooks/memory-injection-hook.ts`
- Cron service: `src/gateway/server-cron.ts`, `src/cron/service.ts`
- Learning system: `src/learning/` (similar pattern for extraction/storage)
