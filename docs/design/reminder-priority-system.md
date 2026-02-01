# Reminder Priority System Design

> **PRD Phase 5 Task**: Design reminder priority system (urgent vs gentle nudge vs background)

## Overview

This document defines the behavioral specifications for Gimli's reminder priority system. The system uses three priority levels (`urgent`, `normal`, `low`) that determine how and when reminders are delivered to the user.

## Design Principles

1. **Respect User Attention**: Higher priority = more interruption tolerance
2. **Context Awareness**: Delivery adapts to user's current activity
3. **Graceful Degradation**: Lower priorities batch/defer when user is busy
4. **Clear Distinction**: Each level has noticeably different behavior
5. **User Control**: Priorities can be adjusted per-reminder or globally

## Priority Levels

### Urgent (`priority: "urgent"`)

**Use Cases**:
- Time-critical deadlines (meeting in 5 minutes)
- Security alerts (credential expiration)
- High-stakes commitments (flight departure)
- User-designated critical items

**Delivery Behavior**:

| Aspect | Behavior |
|--------|----------|
| Quiet Hours | **Bypasses** - Always delivered |
| Batching | **Never batched** - Immediate delivery |
| Injection Limit | Exempt from `maxReminders` limit |
| Visual Indicator | `[!]` prefix, bold formatting |
| Repeat on Dismiss | Re-surfaces after 5 minutes if not completed |
| Channel Priority | Escalates to all active channels |
| Snooze Duration | Minimum: 5 minutes, Maximum: 1 hour |

**Injection Priority**: Always injected first, before normal/low reminders.

```typescript
interface UrgentDeliveryConfig {
  bypassQuietHours: true;
  repeatOnDismissInterval: 5 * 60 * 1000; // 5 minutes
  maxSnoozeMinutes: 60;
  minSnoozeMinutes: 5;
  escalateToAllChannels: true;
}
```

### Normal (`priority: "normal"`)

**Use Cases**:
- Standard reminders (scheduled tasks)
- Moderate importance items (weekly reports)
- Context-triggered reminders (mention related topic)
- Default priority when not specified

**Delivery Behavior**:

| Aspect | Behavior |
|--------|----------|
| Quiet Hours | **Respects** - Queued until quiet hours end |
| Batching | Up to 3 reminders grouped per injection |
| Injection Limit | Subject to `maxReminders` limit (default: 3) |
| Visual Indicator | `[-]` prefix, standard formatting |
| Repeat on Dismiss | Does not auto-repeat |
| Channel Priority | Delivered to primary channel only |
| Snooze Duration | Minimum: 15 minutes, Maximum: 24 hours |

**Injection Priority**: Injected after urgent, before low priority.

```typescript
interface NormalDeliveryConfig {
  bypassQuietHours: false;
  maxBatchSize: 3;
  repeatOnDismissInterval: null; // No auto-repeat
  maxSnoozeMinutes: 24 * 60; // 24 hours
  minSnoozeMinutes: 15;
  escalateToAllChannels: false;
}
```

### Low (`priority: "low"`)

**Use Cases**:
- Nice-to-have reminders (organization tips)
- Learning/habit suggestions
- Non-time-sensitive follow-ups
- Background informational items

**Delivery Behavior**:

| Aspect | Behavior |
|--------|----------|
| Quiet Hours | **Respects** - Queued until quiet hours end |
| Batching | **Aggressive** - All low items combined |
| Injection Limit | Subject to `maxReminders` limit, lowest priority |
| Visual Indicator | `[.]` prefix, muted formatting |
| Repeat on Dismiss | Never auto-repeats |
| Channel Priority | Delivered to lowest-interruption channel |
| Snooze Duration | Minimum: 1 hour, Maximum: 7 days |
| Coalescing | Duplicate context reminders deduplicated |

**Injection Priority**: Injected last, only if space remains after urgent/normal.

```typescript
interface LowDeliveryConfig {
  bypassQuietHours: false;
  coalesceByContext: true;
  repeatOnDismissInterval: null;
  maxSnoozeMinutes: 7 * 24 * 60; // 7 days
  minSnoozeMinutes: 60;
  escalateToAllChannels: false;
  preferLowInterruptionChannel: true;
}
```

## Delivery Algorithm

### Injection Order

When injecting reminders at `agent:turn:start`, the system follows this order:

```
1. Filter by status (pending + snoozed where snoozeUntil <= now)
2. Check quiet hours
   - If quiet hours: Only include urgent reminders
   - If not quiet hours: Include all eligible reminders
3. Sort by priority (urgent > normal > low)
4. Within same priority: Sort by due date (earliest first)
5. Apply limits:
   - Urgent: No limit (always include all)
   - Normal + Low: Subject to maxReminders (default: 3)
6. Format and inject
```

### Pseudo-code

```typescript
function selectRemindersForInjection(
  reminders: Reminder[],
  config: ReminderInjectionConfig,
  now: Date
): Reminder[] {
  // Step 1: Filter eligible reminders
  const eligible = reminders.filter(r =>
    r.status === "pending" ||
    (r.status === "snoozed" && r.snoozeUntil && r.snoozeUntil <= now)
  );

  // Step 2: Handle quiet hours
  const inQuietHours = isQuietHours(config, now);
  const filtered = inQuietHours
    ? eligible.filter(r => r.priority === "urgent" || r.quietHoursExempt)
    : eligible;

  // Step 3: Sort by priority and due date
  const sorted = filtered.sort((a, b) => {
    const priorityOrder = { urgent: 0, normal: 1, low: 2 };
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;

    // Within same priority, sort by due date
    return getDueTime(a) - getDueTime(b);
  });

  // Step 4: Apply limits
  const urgent = sorted.filter(r => r.priority === "urgent");
  const normalAndLow = sorted.filter(r => r.priority !== "urgent");

  // Urgent always included, normal/low limited
  const limited = normalAndLow.slice(0, config.maxReminders);

  return [...urgent, ...limited];
}
```

## Quiet Hours Handling

### Configuration

```typescript
interface QuietHoursConfig {
  enabled: boolean;
  start: string;  // "HH:MM" format, e.g., "22:00"
  end: string;    // "HH:MM" format, e.g., "07:00"
  timezone: string; // IANA timezone, e.g., "America/New_York"
}
```

### Behavior by Priority

| Priority | During Quiet Hours |
|----------|-------------------|
| Urgent | Delivered immediately (bypasses) |
| Normal | Queued, delivered at quiet hours end |
| Low | Queued, delivered at quiet hours end |

### Queued Reminder Delivery

When quiet hours end, queued reminders are delivered:

1. **Batch normal reminders**: Group up to 3 per injection
2. **Coalesce low reminders**: Combine into summary
3. **Delivery order**: Normal first, then low
4. **Staleness check**: Skip if due date passed by >24 hours

## Batching and Coalescing

### Normal Priority Batching

When multiple normal reminders are due simultaneously:

```typescript
interface BatchedDelivery {
  maxPerBatch: 3;
  separatorFormat: "\n---\n";
  headerFormat: "## {count} Reminders Due\n";
}

// Example output:
// ## 3 Reminders Due
//
// [-] Weekly report due
// Due: Monday 9:00 AM
//
// ---
//
// [-] Team standup notes
// Due: Monday 9:00 AM
//
// ---
//
// [-] Review PR #1234
// Due: Monday 9:00 AM
```

### Low Priority Coalescing

Low priority reminders with similar context are combined:

```typescript
interface CoalescingConfig {
  contextSimilarityThreshold: 0.7; // Semantic similarity threshold
  maxItemsPerCoalesced: 5;
  summaryFormat: "light"; // "light" | "detailed"
}

// Example output:
// [.] Background Reminders (3 items)
// - Organize email folders
// - Review saved articles
// - Update project notes
```

## Escalation Rules

### Urgent Escalation

When an urgent reminder is not acknowledged within the repeat interval:

```
1. First delivery: Primary channel
2. After 5 min: All active channels
3. After 15 min: Add to persistent notification queue
4. After 30 min: Log for user review, stop escalation
```

### Priority Escalation (Optional)

User can configure automatic priority escalation:

```typescript
interface PriorityEscalationConfig {
  enabled: boolean;
  normalToUrgentAfterHours: 2; // Escalate normal→urgent if overdue 2+ hours
  lowToNormalAfterDays: 3;    // Escalate low→normal if overdue 3+ days
}
```

## User Preference Integration

### Global Preferences

```typescript
interface UserReminderPreferences {
  // Quiet hours
  quietHours: QuietHoursConfig;

  // Default priority for new reminders
  defaultPriority: ReminderPriority;

  // Limits
  maxRemindersPerTurn: number; // Default: 3
  maxActiveReminders: number;  // Default: 100

  // Escalation
  enableAutoEscalation: boolean;

  // Low priority handling
  lowPriorityDigestTime?: string; // If set, batch all low at this time
}
```

### Per-Reminder Overrides

Users can override defaults when creating reminders:

```
"remind me urgently to call mom at 5pm"  → priority: urgent
"low priority: organize photos sometime" → priority: low
"remind me (gentle nudge) to exercise"   → priority: low
```

## Display Formatting

### Visual Indicators

| Priority | Prefix | Style |
|----------|--------|-------|
| Urgent | `[!]` | Bold, red accent (if color supported) |
| Normal | `[-]` | Standard formatting |
| Low | `[.]` | Muted/dimmed (if supported) |

### Context Formatting

```typescript
function formatReminderForContext(reminder: Reminder): string {
  const priorityPrefix = {
    urgent: "[!]",
    normal: "[-]",
    low: "[.]",
  }[reminder.priority];

  const urgentMarker = reminder.priority === "urgent" ? " (URGENT)" : "";

  return [
    `${priorityPrefix} ${reminder.title}${urgentMarker}`,
    formatTriggerInfo(reminder.trigger),
    reminder.body,
  ].filter(Boolean).join("\n");
}
```

## Integration Points

### Memory System

Priority affects memory chunk ranking:
- Urgent reminders get 1.5x relevance boost in semantic search
- Low reminders get 0.7x relevance factor
- Ensures urgent items surface first in context queries

### Cron System

Priority affects scheduling:
- Urgent: Scheduled with high-priority cron flag
- Normal: Standard cron scheduling
- Low: May be coalesced to digest times

### Learning System

Track priority effectiveness:
- Log when reminders are completed vs dismissed vs expired
- Track snooze patterns per priority level
- Feed into reminder effectiveness metrics

## Configuration Schema

```typescript
interface PrioritySystemConfig {
  urgent: {
    bypassQuietHours: boolean;
    repeatOnDismissMinutes: number | null;
    minSnoozeMinutes: number;
    maxSnoozeMinutes: number;
    escalateToAllChannels: boolean;
    relevanceBoost: number;
  };
  normal: {
    maxBatchSize: number;
    minSnoozeMinutes: number;
    maxSnoozeMinutes: number;
  };
  low: {
    coalesceByContext: boolean;
    digestTime: string | null; // "HH:MM" for batch delivery
    minSnoozeMinutes: number;
    maxSnoozeMinutes: number;
    relevanceFactor: number;
  };
}

const defaultPriorityConfig: PrioritySystemConfig = {
  urgent: {
    bypassQuietHours: true,
    repeatOnDismissMinutes: 5,
    minSnoozeMinutes: 5,
    maxSnoozeMinutes: 60,
    escalateToAllChannels: true,
    relevanceBoost: 1.5,
  },
  normal: {
    maxBatchSize: 3,
    minSnoozeMinutes: 15,
    maxSnoozeMinutes: 24 * 60,
  },
  low: {
    coalesceByContext: true,
    digestTime: null,
    minSnoozeMinutes: 60,
    maxSnoozeMinutes: 7 * 24 * 60,
    relevanceFactor: 0.7,
  },
};
```

## Security Considerations

1. **Rate Limiting**: Max urgent reminders per hour (default: 10)
2. **Escalation Limits**: Auto-escalation capped at 3 levels per day
3. **Channel Security**: Escalation respects channel auth policies
4. **Audit Trail**: Priority changes logged for review

## Testing Strategy

1. **Unit Tests**: Each priority level's behavior in isolation
2. **Quiet Hours Tests**: Verify bypass/queue behavior
3. **Batching Tests**: Verify coalescing and limits
4. **Escalation Tests**: Verify timing and channel selection
5. **Integration Tests**: Full flow from creation to delivery

## Implementation Order

1. Add priority-specific config types to `types.ts`
2. Implement `selectRemindersForInjection()` with priority sorting
3. Add quiet hours bypass logic for urgent
4. Implement batching for normal reminders
5. Implement coalescing for low reminders
6. Add escalation logic for urgent reminders
7. Add tests for each component

## References

- Reminder-Memory Integration: `docs/design/reminder-memory-integration.md`
- Existing Types: `src/reminders/types.ts`
- Memory Injection Hook: `src/hooks/memory-injection-hook.ts`
- Learning System Pattern: `src/learning/`
