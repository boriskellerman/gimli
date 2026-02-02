# OpenClaw Automation and Cron Features

> Research conducted: 2026-02-01

## Executive Summary

OpenClaw (formerly Clawdbot/Moltbot) is an open-source autonomous AI personal assistant created by Peter Steinberger. Its key differentiator from traditional automation tools (n8n, Zapier) is its **proactive agent architecture** with heartbeat mechanism and natural language task interpretation.

**Key automation capabilities:**
- **Cron Jobs**: Gateway-based scheduler with persistence and multiple schedule types
- **Heartbeat Engine**: Proactive monitoring without user prompts (30min default interval)
- **Webhooks**: Event-driven integrations with authentication and custom mappings
- **Gmail Pub/Sub**: Email monitoring via Google's messaging infrastructure
- **MCP Integration**: Model Context Protocol for 100+ third-party services
- **AgentSkills**: 700+ community-built extensions for specialized tasks

---

## Cron Jobs

### Overview

Cron is Gateway's built-in scheduler that persists jobs, manages wakeups, and optionally delivers output. Importantly, cron runs **inside the Gateway**, not inside the model.

### Execution Models

#### Main Session Jobs
- Enqueue system events during the next heartbeat
- `payload.kind = "systemEvent"`
- `wakeMode`: `"next-heartbeat"` (default) or `"now"` for immediate triggering
- **Use case**: Events that should run in the user's primary conversation context

#### Isolated Session Jobs
- Run dedicated agent turns in session `cron:<jobId>`
- `payload.kind = "agentTurn"`
- Starts fresh sessions without prior conversation context
- Summaries post to main session automatically
- Supports model and thinking level overrides
- **Use case**: Independent tasks that shouldn't pollute main conversation

### Schedule Types

| Type | Description | Format | Example |
|------|-------------|--------|---------|
| `at` | One-shot timestamp | ISO 8601 or epoch ms | `2026-02-01T16:00:00Z` |
| `every` | Fixed interval | milliseconds | `3600000` (1 hour) |
| `cron` | 5-field cron expression | Standard cron with optional timezone | `0 7 * * *` (7 AM daily) |

If a timezone is omitted, the Gateway host's local timezone is used.

### Persistence

- **Jobs store**: `~/.openclaw/cron/jobs.json`
- **Run history**: `~/.openclaw/cron/runs/<jobId>.jsonl`
- Auto-pruning of old runs
- Survives Gateway restarts

### Configuration

```json
{
  "cron": {
    "enabled": true,
    "store": "~/.openclaw/cron/jobs.json",
    "maxConcurrentRuns": 1
  }
}
```

**Disable methods:**
- `cron.enabled: false`
- `OPENCLAW_SKIP_CRON=1` environment variable

### CLI Examples

**One-shot reminder with immediate wake:**
```bash
openclaw cron add --name "Reminder" --at "2026-02-01T16:00:00Z" \
  --session main --system-event "Check docs" --wake now --delete-after-run
```

**Recurring isolated job with delivery:**
```bash
openclaw cron add --name "Morning brief" --cron "0 7 * * *" \
  --tz "America/Los_Angeles" --session isolated \
  --message "Summarize updates" --deliver --channel slack
```

### Delivery Channels

- Slack
- Discord
- Telegram (including forum topics)
- WhatsApp
- Signal
- iMessage
- Mattermost

### API Tools

| Tool | Description |
|------|-------------|
| `cron.list` | List all cron jobs |
| `cron.status` | Get status of a job |
| `cron.add` | Create new cron job |
| `cron.update` | Modify existing job |
| `cron.remove` | Delete a job |
| `cron.run` | Manually trigger a job |
| `cron.runs` | View run history |

---

## Heartbeat Engine

### Overview

The Heartbeat is OpenClaw's **proactive monitoring system**. Unlike traditional agents that wait for user prompts, OpenClaw wakes itself up to check conditions and alert users.

**Philosophy:**
> Traditional agents: User asks "Is the server down?"
> OpenClaw with Heartbeat: Agent wakes up, checks server, messages you if there's a problem.

### Default Configuration

| Setting | Default Value |
|---------|---------------|
| Interval | 30 minutes (1 hour for Anthropic OAuth/setup-token) |
| Target | Last used external channel |
| Prompt | Read HEARTBEAT.md and reply `HEARTBEAT_OK` if nothing needs attention |

### Configuration Precedence

1. Per-account channel settings (highest)
2. Per-channel settings
3. Channel defaults
4. Per-agent overrides
5. Global defaults (lowest)

### Scheduling & Active Hours

- **Active hours**: Restrict execution to specified time windows (e.g., 08:00 to 24:00)
- **Timezone**: Respects local timezone configurations
- **Behavior**: Outside configured hours, heartbeats defer until next eligible window

### Target Destinations

| Target | Behavior |
|--------|----------|
| `"last"` | Previous external channel used |
| `"none"` | Run internally without external delivery |
| Named | WhatsApp, Telegram, Discord, Slack, Signal, iMessage, etc. |
| Custom | Optional recipient override via `to` parameter |

### Response Handling

| Signal | Behavior |
|--------|----------|
| `HEARTBEAT_OK` | At message start/end signals "no action needed" |
| OK response | Acknowledgments suppressed by default (configurable) |
| Non-OK response | Triggers alert delivery |
| Long response | Replies exceeding `ackMaxChars` (300) delivered regardless |

### Advanced Features

**Reasoning Delivery:**
```yaml
includeReasoning: true
```
Delivers a separate "Reasoning:" message explaining the agent's decision-making process.

**HEARTBEAT.md:**
- Optional workspace checklist guiding agent behavior
- Located in agent workspace
- **Security note**: Don't put secrets - becomes part of prompt context

**Manual Trigger:**
```bash
openclaw system event --text "Check for urgent follow-ups" --mode now
```

**Visibility Controls:**
- `showOk` - Show acknowledgment messages
- `showAlerts` - Show alert messages
- `useIndicator` - Use status indicator

### Cost Optimization

Shorter intervals increase token consumption. Strategies:
- Maintain minimal checklists
- Use cheaper models
- Set `target: "none"` for internal-only updates

### Use Cases

- Inbox monitoring for urgent messages
- Server uptime checks
- Log file monitoring
- Stock price threshold alerts
- API status monitoring
- Social network activity (Moltbook integration)

---

## Webhooks

### Configuration

**Required settings:**
```yaml
hooks.enabled: true
hooks.token: "<shared-secret>"
```

**Optional:**
```yaml
hooks.path: "/hooks"  # defaults to /hooks
```

### Authentication Methods

| Method | Example | Status |
|--------|---------|--------|
| Authorization header | `Authorization: Bearer <token>` | Recommended |
| Custom header | `x-openclaw-token: <token>` | Supported |
| Query parameter | `?token=<token>` | Deprecated |

### Endpoints

#### POST /hooks/wake
Triggers system events for the main session.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `text` | Yes | Event description |
| `mode` | No | `"now"` or `"next-heartbeat"` |

**Response:** `200` on success

#### POST /hooks/agent
Runs isolated agent turns.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `message` | Yes | Prompt to process |
| `name` | No | Human-readable identifier |
| `sessionKey` | No | Maintains multi-turn conversations |
| `wakeMode` | No | Timing control |
| `deliver` | No | Routes to messaging channel |
| `channel` | No | Target platform |
| `model` | No | Override default model |
| `thinking` | No | Adjust reasoning level |
| `timeoutSeconds` | No | Execution limit |

**Response:** `202` for async initiation

#### POST /hooks/<name>
Custom mapped hooks with payload transformations via `hooks.mappings` and optional code modules.

### Response Codes

| Code | Meaning |
|------|---------|
| 200 | Success for /wake |
| 202 | Async initiation for /agent |
| 401 | Authentication failure |
| 400 | Invalid payload |
| 413 | Oversized requests |

### Security Recommendations

- Keep endpoints behind loopback or trusted proxies
- Use dedicated tokens separate from auth credentials
- Avoid logging sensitive payloads
- External content sandboxed by default

---

## Gmail Pub/Sub Integration

### Architecture

```
Gmail watch → Pub/Sub push → gog gmail watch serve → OpenClaw webhook delivery
```

### Prerequisites

- `gcloud` CLI installed and authenticated
- `gog` (gogcli) authorized for Gmail account
- OpenClaw webhooks enabled
- Tailscale logged in (for HTTPS tunneling via Funnel)

### Configuration

**Basic setup:**
```yaml
hooks.enabled: true
hooks.token: "OPENCLAW_HOOK_TOKEN"
hooks.path: "/hooks"
hooks.presets: ["gmail"]
```

**Advanced features:**
- Custom message templates
- Channel delivery routing
- Per-hook model/thinking overrides

### Setup Methods

**Wizard (Recommended):**
```bash
openclaw webhooks gmail setup --account openclaw@gmail.com
```

Auto-configures:
- Tailscale Funnel
- Hook config generation
- Gmail preset enablement

**Manual Setup:**
1. GCP project configuration and API enablement
2. Pub/Sub topic creation (`gog-gmail-watch`)
3. IAM permissions for Gmail API push service account
4. Watch initialization with label targeting
5. Handler deployment via `gog gmail watch serve`

### Features

| Feature | Description |
|---------|-------------|
| Auto-renewal | Gateway automatically restarts watcher on boot |
| Disable | `OPENCLAW_SKIP_GMAIL_WATCHER=1` |
| Safety | External content wrapped by default |
| Unsafe mode | `hooks.gmail.allowUnsafeExternalContent: true` |

### Troubleshooting

Common issues:
- Project mismatches
- Missing IAM roles
- Incomplete message payloads (Gmail provides only historyId, requiring separate fetching)

---

## MCP and AgentSkills

### MCP Integration

OpenClaw relies on **Model Context Protocol (MCP)** to interface with 100+ third-party services.

**Capabilities:**
- Connect to MCP servers (Notion, Linear, Stripe, custom)
- Expose MCP tools to agents alongside native tools
- Sub-agent orchestration
- State persistence and context recovery across sessions

**Security concerns:**
- Extensible architecture introduces supply chain risks
- Skills can be functionally malware if not vetted
- API key and credential leakage has been reported

### AgentSkills

700+ community-built OpenClaw skills for extending capabilities.

**Categories:**
- Shell command execution
- File system management
- Web automation
- External service integration
- Workflow automation

**Notable skills:**

| Skill | Description |
|-------|-------------|
| `llm-council` | Orchestrate multi-LLM councils for implementation plans |
| `codex-orchestration` | General-purpose orchestration for Codex |
| `Council Chamber` | Orchestration with Memory Bridge |
| `claude-code-skill` | MCP integration for sub-agent orchestration |

---

## Comparison: OpenClaw vs Traditional Automation

### Key Difference

> Traditional tools (n8n, Zapier) execute pre-defined workflows.
> OpenClaw understands natural language and makes context-aware decisions.

### Feature Comparison

| Feature | OpenClaw | n8n | Zapier |
|---------|----------|-----|--------|
| **Type** | AI Agent | Declarative workflows | No-code automation |
| **Scheduling** | Cron + heartbeat + natural language | Advanced cron with timezone/exceptions | Basic (hourly/daily/weekly) |
| **Intelligence** | Context-aware, priority-based | Deterministic | Simple triggers |
| **Pricing** | Self-hosted (compute only) | Per execution | Per task |
| **Security** | Significant concerns | Enterprise-ready | Enterprise-ready |

### Advantages

**OpenClaw:**
- Proactive monitoring without prompts
- Natural language instructions
- Cross-platform context awareness
- Self-hosted privacy

**Traditional tools:**
- Deterministic, predictable behavior
- No security/prompt injection risks
- Mature ecosystem
- Enterprise compliance

---

## Security Considerations

### Warnings from Security Researchers

> "From a security perspective, it's an absolute nightmare."
> — [Cisco Security Blog](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)

> "OpenClaw proves agentic AI works. It also proves your security model doesn't."
> — [VentureBeat](https://venturebeat.com/security/openclaw-agentic-ai-security-risk-ciso-guide)

### Specific Risks

- Shell command execution with high privileges
- Plaintext API key and credential leakage
- Malicious skill injection
- Heartbeat auto-publishing without human review
- MCP supply chain vulnerabilities

### Mitigations

- Webhook endpoints behind loopback/trusted proxies
- Dedicated tokens separate from auth credentials
- Content sandboxing enabled by default
- Careful HEARTBEAT.md content (no secrets)
- Skill vetting before installation

---

## Pi: Minimal Agent Architecture

### Overview

Pi is a deliberately stripped-down coding agent within OpenClaw, emphasizing extensibility over built-in features.

### Design Philosophy

- Shortest system prompt of any agent
- Only 4 fundamental tools: Read, Write, Edit, Bash
- Self-extension over downloading external tools

### Session Management

- **Tree-based**: Sessions branch like version control
- **Persistence**: Extensions store state to disk
- **Hot reload**: Agents write, reload, test iteratively

### Orchestration

- Agent-generated extensions based on specs
- `/control` extension for lightweight multi-agent coordination

### Principles

- **Malleability**: Software designed for agents to modify themselves
- **Minimal context requirements**
- **UI flexibility** (custom terminal components)
- **Hand-crafted, agent-maintained skills**

---

## Relevance to Gimli Project

### Applicable Patterns

**Cron scheduling:**
- Persistent job storage pattern (`~/.openclaw/cron/jobs.json`)
- Multiple schedule types (at, every, cron expression)
- Session isolation for independent tasks
- Timezone-aware scheduling

**Heartbeat proactive monitoring:**
- Proactive monitoring without user prompts
- Configurable intervals and active hours
- HEARTBEAT.md checklist pattern
- Target destination flexibility

**Webhook integration:**
- Token-based authentication
- Multiple endpoint patterns (wake, agent, custom)
- Async response handling (202 for long operations)
- Content sandboxing by default

**Delivery channels:**
- Multi-channel output routing
- Per-channel configuration precedence
- Acknowledgment suppression patterns

### Potential Features for Gimli

- Scheduled agent tasks with persistence
- Proactive monitoring heartbeat for channels
- Webhook triggers for external integrations
- Multi-channel delivery routing
- Session isolation for cron jobs

---

## Sources

### Documentation
- [OpenClaw Cron Jobs](https://docs.openclaw.ai/automation/cron-jobs)
- [OpenClaw Heartbeat](https://docs.openclaw.ai/gateway/heartbeat)
- [OpenClaw Webhooks](https://docs.openclaw.ai/automation/webhook)
- [OpenClaw Gmail Pub/Sub](https://docs.openclaw.ai/automation/gmail-pubsub)
- [OpenClaw Main Docs](https://docs.openclaw.ai/)

### Articles
- [What is OpenClaw (DigitalOcean)](https://www.digitalocean.com/resources/articles/what-is-openclaw)
- [Pi: The Minimal Agent (Armin Ronacher)](https://lucumr.pocoo.org/2026/1/31/pi/)
- [OpenClaw vs n8n Comparison](https://sourceforge.net/software/compare/OpenClaw-vs-n8n/)
- [OpenClaw Workflow Automation (VPSBG)](https://www.vpsbg.eu/blog/meet-openclaw-a-revolution-in-ai-workflow-automation)

### Security Analysis
- [OpenClaw Security Nightmare (Cisco)](https://blogs.cisco.com/ai/personal-ai-agents-like-openclaw-are-a-security-nightmare)
- [OpenClaw Security Risk (VentureBeat)](https://venturebeat.com/security/openclaw-agentic-ai-security-risk-ciso-guide)
- [OpenClaw Wild in Business (Dark Reading)](https://www.darkreading.com/application-security/openclaw-ai-runs-wild-business-environments)

### Repositories
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Awesome OpenClaw Skills](https://github.com/VoltAgent/awesome-openclaw-skills)
- [Claude Code Skill for OpenClaw](https://github.com/Enderfga/openclaw-claude-code-skill)
