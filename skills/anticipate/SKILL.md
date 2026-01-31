---
name: anticipate
description: Proactive reminders and pattern-based anticipation. Create reminders, detect activity patterns, and get context-aware suggestions.
metadata: {"gimli":{"emoji":"🔮"}}
---

# Anticipate Skill

Gimli's anticipation system learns your patterns and provides proactive reminders. It integrates with the memory system to deliver context-aware suggestions.

## Creating Reminders

### Natural Language

Create reminders using natural language:

```
remind me to review PRs before standup tomorrow
remind me to submit expenses every Friday at 4pm
remind me about the deployment checklist when I mention staging
```

### Using /remind Command

The `/remind` command provides explicit control:

```
/remind add "Review PRs" --at "9:00 AM" --days "Mon,Tue,Wed,Thu,Fri"
/remind add "Weekly status" --cron "0 16 * * 5"
/remind add "Check staging" --context "deploy,release,production"
/remind list
/remind complete <id>
/remind snooze <id> --minutes 30
/remind delete <id>
```

## Reminder Types

### Scheduled Reminders

One-time reminders at a specific date/time:

```
remind me to call the dentist on January 20th at 2pm
/remind add "Dentist appointment" --at "2026-01-20 14:00"
```

### Recurring Reminders

Repeating reminders using patterns or cron expressions:

```
remind me to check email every morning at 8:30
/remind add "Check email" --cron "30 8 * * *"
```

Common cron patterns:
- `0 9 * * 1-5` - Weekdays at 9 AM
- `0 17 * * 5` - Fridays at 5 PM
- `0 0 1 * *` - First of every month

### Context Reminders

Triggered when conversation context matches keywords:

```
remind me about the security checklist when reviewing PRs
/remind add "Security checklist" --context "PR,review,security"
```

## Priority Levels

Reminders have three priority levels:

### Urgent
- Bypass quiet hours
- Auto-repeat if dismissed (5 min default)
- Delivered immediately to all channels
- Short snooze limits (5-60 min)

```
/remind add "Server maintenance" --priority urgent --at "3:00 AM"
```

### Normal (default)
- Respects quiet hours
- Batched up to 3 reminders
- Standard snooze (15 min - 24 hr)

```
/remind add "Team standup" --at "9:00 AM"
```

### Low
- Context coalescing (similar reminders grouped)
- Optional daily digest
- Long snooze allowed (1 hr - 7 days)

```
/remind add "Review old PRs" --priority low --context "cleanup"
```

## Quiet Hours

Configure times when non-urgent reminders are held:

```
/remind config quiet-start 22:00
/remind config quiet-end 07:00
```

Urgent reminders and those marked `--exempt` bypass quiet hours.

## Pattern Detection

The system automatically detects patterns in your activity:

### Time-Based Patterns
- "You usually review PRs around 9 AM on weekdays"
- "You often write status updates Friday afternoons"

### Event-Based Patterns
- "After committing, you typically create a PR"
- "After test failures, you usually run debug mode"

### Context-Based Patterns
- "When discussing deployments, you need staging URLs"
- "When reviewing security, you reference OWASP docs"

View detected patterns:

```
/remind patterns
/remind patterns --active
```

## Managing Reminders

### List Reminders

```
/remind list                    # All pending reminders
/remind list --status triggered # Triggered but not acknowledged
/remind list --priority urgent  # Only urgent reminders
```

### Complete or Dismiss

```
/remind complete <id>           # Mark as done
/remind dismiss <id>            # Dismiss without completing
/remind snooze <id> --minutes 60  # Snooze for 1 hour
```

### View Stats

```
/remind stats                   # Summary by status
```

## Integration with Memory

Reminders are stored in the memory system and can be discovered via semantic search. When you ask about something related to a reminder, it may surface automatically.

Example: If you have a reminder about "deployment checklist" and you ask "what do I need for the release?", the reminder context may be injected automatically.

## Examples

### Daily Workflow

```
remind me to check Slack at 9am and 2pm on weekdays
remind me to review PRs before standup
remind me to update the team on Fridays at 4pm
```

### Project Tracking

```
remind me about the API deadline on March 15th
remind me to follow up with the client next week
remind me about code review when I mention PR or pull request
```

### Personal

```
remind me to take a break every 2 hours
remind me about expenses on the last Friday of each month
remind me to backup important files on Sundays
```
