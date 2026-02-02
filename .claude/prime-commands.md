# Prime Commands Reference

Essential CLI commands for autonomous agent operation. These ~20 commands cover the core operations needed to run Gimli effectively.

## Quick Reference

| Category | Command | Purpose |
|----------|---------|---------|
| Agent | `gimli agent` | Run an agent turn |
| Agent | `gimli agents list` | List configured agents |
| Status | `gimli status` | Show system health |
| Status | `gimli health` | Gateway health check |
| Config | `gimli config get` | Read config values |
| Config | `gimli config set` | Write config values |
| Gateway | `gimli gateway run` | Start the gateway |
| Channels | `gimli channels status` | Channel health |
| Message | `gimli message send` | Send a message |
| Memory | `gimli memory search` | Search agent memory |
| Sessions | `gimli sessions` | List sessions |
| Logs | `gimli logs` | View gateway logs |
| Doctor | `gimli doctor` | Diagnose issues |
| Models | `gimli models list` | List available models |
| Cron | `gimli cron list` | List scheduled jobs |
| Browser | `gimli browser snapshot` | Capture browser state |
| Skills | `gimli skills list` | List installed skills |
| Upstream | `gimli upstream check` | Check for updates |

---

## Agent Operations

### `gimli agent`

Run a single agent turn via the Gateway. Essential for scripted agent interactions.

```bash
# Basic usage - send a message to an agent
gimli agent --message "What's the status?" --agent main

# Target a specific session
gimli agent --session-id 1234 --message "Continue from before"

# Set thinking level for complex tasks
gimli agent --message "Analyze the codebase" --thinking high

# Deliver reply to a channel
gimli agent --agent ops --message "Generate report" --deliver

# Cross-channel delivery
gimli agent --agent ops --message "Alert" --deliver --reply-channel slack --reply-to "#alerts"
```

**Key Options:**
- `--message <text>` - Message body (required)
- `--agent <id>` - Target agent (default: main)
- `--session-id <id>` - Explicit session
- `--thinking <level>` - off | minimal | low | medium | high
- `--deliver` - Send reply to channel
- `--local` - Run embedded (requires API keys in shell)
- `--json` - JSON output

### `gimli agents list`

List all configured agents with their bindings and workspaces.

```bash
gimli agents list
gimli agents list --json
gimli agents list --bindings  # Include routing bindings
```

### `gimli agents add`

Create a new isolated agent with its own workspace.

```bash
gimli agents add myagent --workspace ~/myproject
gimli agents add ops --workspace ~/ops --bind telegram:bot1
```

---

## System Status

### `gimli status`

Quick diagnosis of system health, channels, and sessions.

```bash
gimli status              # Quick overview
gimli status --all        # Full diagnosis (pasteable)
gimli status --deep       # Live channel probes
gimli status --usage      # Model provider quotas
gimli status --json       # Machine-readable
```

**When to use:**
- First check when troubleshooting
- Verify channels are connected
- Check session token usage

### `gimli health`

Gateway-specific health check.

```bash
gimli health
gimli health --json
gimli health --timeout 5000
```

### `gimli doctor`

Diagnose and fix common issues.

```bash
gimli doctor              # Run all checks
gimli doctor --fix        # Auto-fix where possible
```

---

## Configuration

### `gimli config get`

Read configuration values.

```bash
gimli config get                    # Show all config
gimli config get gateway.mode       # Specific path
gimli config get agents.list        # Array values
gimli config get --json             # JSON output
```

**Common paths:**
- `gateway.mode` - local | remote
- `gateway.port` - Gateway port
- `agents.defaults.workspace` - Default workspace
- `agents.defaults.model` - Default model

### `gimli config set`

Write configuration values.

```bash
gimli config set gateway.mode local
gimli config set gateway.port 18789
gimli config set agents.defaults.model claude-sonnet-4-20250514
gimli config set --json agents.list '[{"id":"main"}]'
```

---

## Gateway

### `gimli gateway run`

Start the gateway server.

```bash
gimli gateway run                          # Default settings
gimli gateway run --port 18789             # Custom port
gimli gateway run --bind loopback          # Loopback only (secure)
gimli gateway run --verbose                # Debug output
gimli gateway run --force                  # Override existing
```

**Background startup (Linux):**
```bash
nohup gimli gateway run --bind loopback --port 18789 --force > /tmp/gimli-gateway.log 2>&1 &
```

### `gimli gateway stop`

Stop the running gateway.

```bash
gimli gateway stop
```

---

## Channels

### `gimli channels status`

Check channel connectivity.

```bash
gimli channels status              # Quick status
gimli channels status --probe      # Live credential check
gimli channels status --json       # Machine-readable
```

### `gimli channels list`

List configured channel accounts.

```bash
gimli channels list
gimli channels list --json
```

---

## Messaging

### `gimli message send`

Send a message to a channel target.

```bash
# WhatsApp (default)
gimli message send --target +15555550123 --message "Hello"

# With media
gimli message send --target +15555550123 --message "Photo" --media ./image.jpg

# Discord
gimli message send --channel discord --target channel:123456 --message "Hello"

# Slack
gimli message send --channel slack --target "#general" --message "Update"

# Telegram
gimli message send --channel telegram --target @username --message "Hi"
```

**Key Options:**
- `--target <dest>` - Recipient (phone, channel ID, username)
- `--message <text>` - Message body
- `--channel <name>` - Channel type (whatsapp, discord, slack, telegram)
- `--media <path>` - Attach file
- `--account <id>` - Specific account

---

## Memory

### `gimli memory search`

Search agent memory and session history.

```bash
gimli memory search "project deadline"
gimli memory search "API key" --agent ops
gimli memory search "meeting notes" --max-results 5
gimli memory search "deployment" --json
```

### `gimli memory status`

Check memory index health.

```bash
gimli memory status
gimli memory status --deep    # Probe embeddings
gimli memory status --index   # Reindex if dirty
```

---

## Sessions

### `gimli sessions`

List conversation sessions.

```bash
gimli sessions                    # All sessions
gimli sessions --active 60        # Last hour only
gimli sessions --json             # Machine-readable
```

---

## Logs

### `gimli logs`

View gateway logs.

```bash
gimli logs                        # Recent logs
gimli logs --follow               # Stream live
gimli logs --lines 500            # More history
gimli logs --level error          # Errors only
gimli logs --json                 # Structured output
```

---

## Models

### `gimli models list`

List available AI models.

```bash
gimli models list
gimli models list --json
```

### `gimli models set`

Set the default model.

```bash
gimli models set claude-sonnet-4-20250514
gimli models set --agent ops claude-opus-4-20250514
```

---

## Automation

### `gimli cron list`

List scheduled jobs.

```bash
gimli cron list
gimli cron list --json
```

### `gimli cron add`

Schedule a recurring job.

```bash
gimli cron add --schedule "0 9 * * *" --message "Daily standup reminder"
```

---

## Browser

### `gimli browser snapshot`

Capture browser accessibility snapshot (for agent-driven browsing).

```bash
gimli browser snapshot
gimli browser snapshot --json
gimli browser snapshot --url https://example.com
```

### `gimli browser tabs`

List open browser tabs.

```bash
gimli browser tabs
gimli browser tabs --json
```

---

## Skills

### `gimli skills list`

List installed skills.

```bash
gimli skills list
gimli skills list --json
gimli skills list --available     # Include uninstalled
```

---

## Upstream Sync

### `gimli upstream check`

Check for OpenClaw upstream updates.

```bash
gimli upstream check
gimli upstream check --json
```

### `gimli upstream preview`

Preview changes before applying.

```bash
gimli upstream preview
gimli upstream preview --commits 10
```

---

## Command Patterns

### JSON Output

Most commands support `--json` for machine-readable output:

```bash
gimli status --json | jq '.channels'
gimli sessions --json | jq '.[0]'
gimli config get --json | jq '.gateway'
```

### Verbose/Debug Mode

Use `--verbose` or `--debug` for troubleshooting:

```bash
gimli status --verbose
gimli agent --message "test" --verbose on
```

### Timeout Control

Many commands accept `--timeout <ms>`:

```bash
gimli health --timeout 5000
gimli channels status --probe --timeout 10000
```

---

## Common Workflows

### Initial Setup Verification

```bash
gimli doctor                      # Check installation
gimli status --all                # Full diagnosis
gimli channels status --probe     # Verify credentials
```

### Debugging Channel Issues

```bash
gimli channels status --probe     # Check credentials
gimli logs --level error          # Recent errors
gimli doctor                      # System checks
```

### Agent Development

```bash
gimli agents list                 # Current agents
gimli agent --message "test" --thinking high --local
gimli memory search "context"     # Check memory
gimli sessions --active 30        # Recent sessions
```

### Monitoring

```bash
gimli status --usage              # Provider quotas
gimli logs --follow               # Live logs
gimli cron list                   # Scheduled jobs
```

---

## Environment Variables

Key environment variables that affect CLI behavior:

| Variable | Purpose |
|----------|---------|
| `GIMLI_STATE_DIR` | Override state directory (~/.gimli) |
| `ANTHROPIC_API_KEY` | Claude API key for --local |
| `GIMLI_GATEWAY_PORT` | Default gateway port |
| `GIMLI_VERBOSE` | Enable verbose output |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Network/connection error |

---

## See Also

- Full CLI reference: https://docs.gimli.bot/cli
- Configuration guide: https://docs.gimli.bot/configuration
- Troubleshooting: https://docs.gimli.bot/debugging
