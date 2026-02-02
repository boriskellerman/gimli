---
name: channel-tester
description: Test and probe individual messaging channel connections and credentials.
metadata: {"gimli":{"emoji":"🔌"}}
---

# Channel Tester

Use this skill to test, probe, and diagnose individual messaging channel connections. This helps verify credentials are valid, check authentication status, and troubleshoot connection issues.

## Trigger

Use this skill when the user asks about:
- Testing a specific channel (Discord, Telegram, WhatsApp, etc.)
- Verifying bot tokens or credentials
- Checking if a channel is properly connected
- Diagnosing why a channel isn't working

## Commands

### Check All Channels (with probe)

```bash
gimli channels status --probe
```

Tests all configured channels and verifies their credentials are valid.

### Check Channel Status (without probe)

```bash
gimli channels status
```

Shows configuration status without actively testing credentials.

### JSON Output

```bash
gimli channels status --probe --json
```

Returns detailed JSON for programmatic analysis.

### Custom Timeout

```bash
gimli channels status --probe --timeout 15000
```

Set probe timeout in milliseconds for slow connections.

## Channel-Specific Testing

### Discord

Probe verifies:
- Bot token is valid
- Bot username is retrievable
- Application ID matches (if configured)

Common issues:
- `TOKEN_INVALID`: Token is incorrect or expired
- `Missing Access`: Bot lacks required permissions

### Telegram

Probe verifies:
- Bot token is valid via `getMe` API call
- Bot username is retrievable

Common issues:
- `Unauthorized`: Token is incorrect
- `Bot was blocked`: Bot was blocked by admin

### WhatsApp

Probe verifies:
- Active web session exists
- Session is not expired

Common issues:
- `not linked`: Need to scan QR code via `gimli channels login --channel whatsapp`
- `session expired`: Re-link via channels login

### Slack

Probe verifies:
- Bot token is valid
- App token (socket mode) is valid if configured

Common issues:
- `invalid_auth`: Token is incorrect
- Missing scopes in Slack app configuration

### Signal

Probe verifies:
- Signal CLI is reachable (if using CLI mode)
- Account is registered

Common issues:
- `not linked`: Need to link via `gimli channels login --channel signal`
- CLI not installed or not running

### BlueBubbles

Probe verifies:
- Server is reachable at configured URL
- Password is correct

Common issues:
- Connection refused: Server not running
- `401 Unauthorized`: Password incorrect

## Interpreting Status Output

### Status Line Format

```
- channel/account: enabled, configured, linked, running, connected, in:5m, out:2m, works
```

| Field | Meaning |
|-------|---------|
| `enabled` | Channel is enabled in config |
| `configured` | Required credentials are set |
| `linked` | Session-based auth is established |
| `running` | Channel listener is active |
| `connected` | Real-time connection is open |
| `in:Xm` | Time since last inbound message |
| `out:Xm` | Time since last outbound message |
| `works` | Probe succeeded |
| `probe failed` | Probe failed (check error) |

### Account Identifiers

Multi-account channels show account IDs:
- `discord/work`: Discord account named "work"
- `telegram/default`: Default Telegram account

## Fixing Common Issues

### Token Invalid

```bash
# Update the token
gimli config set channels.discord.token "new-token-here"

# Or re-add the channel
gimli channels add discord
```

### Not Linked (WhatsApp/Signal)

```bash
# Link WhatsApp
gimli channels login --channel whatsapp

# Link Signal
gimli channels login --channel signal
```

### Gateway Required

Many probes require the gateway to be running:
```bash
gimli gateway start
```

### After Fixing Issues

Re-run the probe to verify:
```bash
gimli channels status --probe
```

## Example Output

```
Gateway reachable.
- discord/default: enabled, configured, running, connected, in:5m, out:2m, bot:@MyBot, works
- telegram/default: enabled, configured, running, connected, in:12m, out:8m, bot:@my_bot, works
- whatsapp/default: enabled, linked, running, connected, in:3m, out:1m, works
- slack/default: disabled
- signal/default: enabled, configured, not linked

Warnings:
- signal default: Signal account not linked (Run: gimli channels login --channel signal)
- Run: gimli doctor
```
