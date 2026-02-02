---
name: gimli-doctor
description: Run comprehensive diagnostics and auto-repair for Gimli configuration issues.
metadata: {"gimli":{"emoji":"🩺"}}
---

# Gimli Doctor

Use this skill to diagnose and fix common Gimli configuration issues. The doctor command performs comprehensive health checks and can automatically repair many problems.

## Trigger

Use this skill when the user:
- Reports configuration problems
- Has gateway startup issues
- Sees warnings about migrations or legacy config
- Needs to troubleshoot auth or credential issues
- Asks for a diagnostic check or health scan
- Encounters "run gimli doctor" messages

## Commands

### Interactive Doctor

```bash
gimli doctor
```

Runs an interactive diagnostic wizard that:
1. Checks for available updates
2. Validates configuration file
3. Verifies auth profiles
4. Checks gateway connection
5. Validates channel configurations
6. Detects legacy state that needs migration
7. Offers to fix detected issues

### Non-Interactive Mode

```bash
gimli doctor --non-interactive
```

Runs diagnostics without prompts, applying safe auto-fixes. Useful for automation.

### Fix Mode

```bash
gimli doctor --fix
```

Applies pending repairs that were detected in a previous run.

### Generate Gateway Token

```bash
gimli doctor --generate-gateway-token
```

Auto-generates a gateway auth token if one isn't configured.

## What Doctor Checks

### Configuration

- Config file syntax and validity
- Required fields (gateway.mode, etc.)
- Deprecated config keys
- Migration from legacy formats

### Authentication

- Anthropic API key validity
- OAuth profile health
- Gateway auth token configuration
- Keychain access (macOS)

### Gateway

- Service installation status
- Daemon health
- Connection to running gateway
- Port availability
- systemd linger (Linux)

### Channels

- Per-channel credential status
- Probe results
- Missing configurations
- Authentication age

### State & Sessions

- Legacy state migrations needed
- Session store integrity
- Workspace backups

### Security

- Sandbox configuration
- Permission warnings

## Interpreting Results

Doctor outputs notes and prompts:

```
╭─ Gateway ─────────────────────────╮
│ gateway.mode is unset             │
│ Fix: run `gimli configure`        │
╰───────────────────────────────────╯
```

Each note indicates:
- **Category** (header): What area has an issue
- **Message**: What the problem is
- **Fix**: How to resolve it

### Common Prompts

| Prompt | What It Does |
|--------|--------------|
| "Migrate legacy state now?" | Moves old sessions/config to new locations |
| "Generate gateway token now?" | Creates secure token for gateway auth |
| "Repair gateway daemon?" | Fixes systemd/launchd service issues |

## Common Issues Fixed by Doctor

### Missing Gateway Mode

```
Fix: gimli config set gateway.mode local
```

### Legacy State Migration

Doctor detects and migrates:
- Old session formats
- Legacy WhatsApp auth
- Deprecated config keys

### Gateway Auth Token

If token auth is missing:
```bash
gimli doctor --generate-gateway-token
```

### Invalid Config

Doctor shows validation errors and suggests fixes:
```
Invalid config:
- channels.discord.token: must be string
```

## After Running Doctor

1. Restart the gateway if config changed:
   ```bash
   gimli gateway restart
   ```

2. Verify channels work:
   ```bash
   gimli channels status --probe
   ```

3. Check overall health:
   ```bash
   gimli health
   ```

## Example Output

```
 Gimli doctor

╭─ Gateway auth ────────────────────╮
│ Gateway auth is off or missing    │
│ Token auth is now recommended     │
╰───────────────────────────────────╯

? Generate and configure a gateway token now? (Y/n)

╭─ Doctor changes ──────────────────╮
│ Gateway token configured.         │
╰───────────────────────────────────╯

Discord: ok (@MyBot)
Telegram: ok (@my_bot)
WhatsApp: linked

Run "gimli doctor --fix" to apply changes.

 Doctor complete.
```

## Related Commands

- `gimli configure`: Interactive setup wizard
- `gimli health`: Quick health check
- `gimli channels status --probe`: Channel-specific testing
- `gimli gateway status`: Check gateway service
