---
name: gateway-health
description: Check Gimli gateway health, channel status, and agent heartbeats.
metadata: {"gimli":{"emoji":"💓"}}
---

# Gateway Health

Use this skill to check the health of the Gimli gateway, including channel connections, agent heartbeats, and session statistics.

## Trigger

Use this skill when the user asks about:
- Gateway health or status
- Whether channels are working
- Agent heartbeat status
- Session activity or counts
- Connection issues or troubleshooting

## Commands

### Quick Health Check

```bash
gimli health
```

Returns a summary with:
- Channel status for each configured channel
- Agent list and default agent
- Heartbeat intervals
- Session store paths and recent activity

### Verbose Health Check (with probes)

```bash
gimli health --verbose
```

Adds detailed probing of channel credentials and bot usernames.

### JSON Output

```bash
gimli health --json
```

Returns machine-readable JSON with full health snapshot including:
- `ok`: Always `true` if gateway is reachable
- `channels`: Per-channel health with probe results
- `agents`: List of configured agents with heartbeat summaries
- `sessions`: Store path, count, and recent entries

### Timeout Control

```bash
gimli health --timeout 15000
```

Set probe timeout in milliseconds (default: 10000).

## Interpreting Results

### Channel Status Values

| Status | Meaning |
|--------|---------|
| `ok` | Channel is working, credentials verified |
| `linked` | Session-based channel (WhatsApp, Signal) is linked |
| `configured` | Channel has config but wasn't probed |
| `not linked` | Session-based channel needs to be linked |
| `not configured` | No credentials configured |
| `failed` | Probe failed (check error message) |

### Probe Response Fields

When using `--json`, each channel probe contains:
- `probe.ok`: Whether the credential check succeeded
- `probe.elapsedMs`: Time taken to verify
- `probe.bot.username`: Bot username (Discord/Telegram)
- `probe.error`: Error message if probe failed

### Heartbeat

Shows how often the agent checks for pending tasks:
- `disabled`: No heartbeat configured
- Duration like `30s` or `1m`: Active heartbeat interval

## Troubleshooting

### Gateway Not Reachable

If the gateway isn't running:
```bash
# Check if gateway is running
gimli gateway status

# Start the gateway
gimli gateway start
```

### Channel Probe Failures

For specific channel issues, run:
```bash
gimli channels status --probe
```

This provides more detailed per-channel diagnostics.

### Full Diagnostic

For comprehensive troubleshooting:
```bash
gimli doctor
```

## Example Output

```
Discord: ok (@MyBot) (245ms)
Telegram: ok (@my_assistant_bot) (180ms)
WhatsApp: linked (auth age 2m)
Slack: not configured
Signal: not linked
Agents: default (default)
Heartbeat interval: 30s (default)
Session store (default): ~/.gimli/sessions (12 entries)
- discord:123456789 (5m ago)
- telegram:987654321 (12m ago)
```
