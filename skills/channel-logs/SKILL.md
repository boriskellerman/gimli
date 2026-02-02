---
name: channel-logs
description: View and search channel activity logs for message history and debugging.
metadata: {"gimli":{"emoji":"📋"}}
---

# Channel Logs

Use this skill to view and search channel activity logs. This helps with debugging message delivery, tracking conversation history, and diagnosing channel issues.

## Trigger

Use this skill when the user asks about:
- Channel message logs or history
- What messages were sent/received
- Debugging message delivery issues
- Viewing recent channel activity
- Finding specific conversations

## Commands

### View Recent Logs

```bash
gimli channels logs
```

Shows recent channel activity across all channels.

### Filter by Channel

```bash
gimli channels logs --channel discord
gimli channels logs --channel telegram
gimli channels logs --channel whatsapp
```

### Filter by Account

```bash
gimli channels logs --channel discord --account work
```

### Tail Mode (Follow)

```bash
gimli channels logs --follow
```

Continuously displays new log entries as they arrive.

### Limit Output

```bash
gimli channels logs --limit 50
```

Shows only the most recent N log entries.

### JSON Output

```bash
gimli channels logs --json
```

Returns structured JSON for programmatic analysis.

## Gateway Logs

For lower-level gateway debugging:

```bash
# macOS - query unified logs
./scripts/clawlog.sh --tail 100

# Linux - journalctl for systemd service
journalctl --user -u gimli-gateway -f

# Direct log file (if configured)
tail -f /tmp/gimli-gateway.log
```

## Log Entry Format

Each log entry typically includes:
- Timestamp
- Channel and account
- Direction (inbound/outbound)
- Message type (text, media, etc.)
- Sender/recipient info
- Message content preview

Example:
```
2025-01-15T10:30:45Z discord/default IN  @user#1234: Hello!
2025-01-15T10:30:47Z discord/default OUT @MyBot: Hi there!
```

## Searching Logs

### Using Grep

```bash
gimli channels logs | grep "keyword"
```

### Using ripgrep for Session Files

Session logs contain full conversation history:

```bash
# Find sessions mentioning a keyword
rg "keyword" ~/.gimli/agents/default/sessions/*.jsonl

# Search specific channel sessions
rg "keyword" ~/.gimli/agents/default/sessions/*.jsonl | grep discord
```

### Using jq for Structured Queries

```bash
# Extract all inbound messages
jq -r 'select(.direction == "in") | "\(.timestamp) \(.channel): \(.content)"' logfile.jsonl

# Filter by channel
jq -r 'select(.channel == "discord")' logfile.jsonl
```

## Debugging Message Issues

### Message Not Delivered

1. Check channel is connected:
   ```bash
   gimli channels status --probe
   ```

2. Look for errors in logs:
   ```bash
   gimli channels logs --channel <channel> | grep -i error
   ```

3. Check gateway is running:
   ```bash
   gimli gateway status
   ```

### Message Not Received

1. Verify inbound messages are logged:
   ```bash
   gimli channels logs --channel <channel> | grep "IN"
   ```

2. Check allowlist configuration:
   ```bash
   gimli config get channels.<channel>.allowFrom
   ```

3. Verify bot has correct permissions (Discord/Slack)

### Rate Limiting

Look for rate limit errors:
```bash
gimli channels logs | grep -i "rate\|limit\|429"
```

## Session Logs vs Channel Logs

| Log Type | Location | Contains |
|----------|----------|----------|
| Channel logs | `gimli channels logs` | Raw channel events |
| Session logs | `~/.gimli/agents/*/sessions/*.jsonl` | Full conversations with AI |
| Gateway logs | System logs / `/tmp/gimli-gateway.log` | Internal gateway events |

## Related Skills

- **session-logs**: Search full conversation history with jq
- **gateway-health**: Check overall system health
- **channel-tester**: Test channel connections

## Example Output

```bash
$ gimli channels logs --channel discord --limit 5

2025-01-15T10:30:45.123Z discord/default IN  #general @user: What's the weather?
2025-01-15T10:30:47.456Z discord/default OUT #general @MyBot: Let me check...
2025-01-15T10:30:48.789Z discord/default OUT #general @MyBot: It's 72F and sunny!
2025-01-15T10:35:12.345Z discord/default IN  DM @user: Thanks!
2025-01-15T10:35:13.678Z discord/default OUT DM @MyBot: You're welcome!
```
