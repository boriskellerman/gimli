# Gimli Skills, Clawhub & Ecosystem Research

> Research conducted for Gimli Phases 9-11: Understanding the Gimli ecosystem, skills system, and potential integrations.

---

## Phase 9: Agent Skills Architecture

### What Are Agent Skills?

Agent Skills are a simple, open format for giving agents new capabilities and expertise. Originally developed by Anthropic and released as an open standard, they're now adopted by multiple agent products including:

- Claude Code
- Cursor
- GitHub Copilot
- VS Code
- Gemini CLI
- OpenAI Codex
- And many more

**Key Insight:** Skills are portable across different agent products - build once, deploy everywhere.

### Skill Structure

Each skill is a directory containing:
- `SKILL.md` - Main file with YAML frontmatter and instructions
- Supporting documentation files
- Optional scripts and resources

**Minimal SKILL.md Format:**
```yaml
---
name: my-skill
description: Brief explanation of what this skill does
---

# Skill Instructions

Your skill instructions in markdown...
```

### Available Frontmatter Keys

| Key | Description |
|-----|-------------|
| `name` | Skill identifier |
| `description` | Brief explanation (shown in UI) |
| `homepage` | URL displayed in macOS Skills UI |
| `user-invocable` | Boolean - expose as slash command (default: true) |
| `disable-model-invocation` | Exclude from model prompt |
| `command-dispatch` | "tool" to bypass model |
| `command-tool` | Which tool to invoke |
| `command-arg-mode` | "raw" (default) for forwarding arguments |

### Skill Loading Precedence

Skills load from three locations (highest to lowest priority):

1. **Workspace skills** - `<workspace>/skills`
2. **Managed/local skills** - `~/.gimli/skills` (or `~/.gimli/skills`)
3. **Bundled skills** - Shipped with installation

Additional folders can be configured via `skills.load.extraDirs`.

### Skill Gating & Requirements

Skills can specify requirements in frontmatter:

```yaml
requires:
  bins: [ffmpeg, imagemagick]  # All must exist on PATH
  anyBins: [chromium, chrome]  # At least one required
  env: [API_KEY]               # Environment variables
  config: [provider.apiKey]    # Config paths must be truthy
os: [darwin, linux]            # Platform filters
```

### Skill Configuration

Configure skills in `~/.gimli/gimli.json`:

```json
{
  "skills": {
    "entries": {
      "skill-name": {
        "enabled": true,
        "apiKey": "KEY_VALUE",
        "env": { "VAR": "value" },
        "config": { "customField": "value" }
      }
    }
  }
}
```

### What Skills Can Enable

1. **Domain expertise** - Legal review, data analysis pipelines
2. **New capabilities** - Presentations, MCP servers, dataset analysis
3. **Repeatable workflows** - Multi-step tasks as consistent, auditable processes
4. **Interoperability** - Same skill across different agent products

### Recommendations for Gimli

1. **Adopt AgentSkills format** for all Gimli skills
2. **Create skill templates** for common patterns
3. **Implement skill validation** using reference library
4. **Consider contributing skills** back to the ecosystem

---

## Phase 10: Clawhub Registry

### What is Clawhub?

Clawhub is the public skills registry for Gimli - think "GitHub for agent skills."

**URL:** https://clawhub.com

### Key Features

| Feature | Description |
|---------|-------------|
| **Vector search** | Semantic search, not just keywords |
| **Versioning** | Semver, changelogs, tags (including "latest") |
| **Downloads** | Zip per version |
| **Community** | Stars and comments |
| **Moderation** | Approvals and security audits |
| **CLI API** | Automation-friendly |

### CLI Installation

```bash
npm i -g clawhub
# or
pnpm add -g clawhub
```

### Essential Commands

| Task | Command |
|------|---------|
| Search | `clawhub search "query"` |
| Install | `clawhub install <slug>` |
| Update all | `clawhub update --all` |
| Publish | `clawhub publish <path> --slug <slug>` |
| Sync locally | `clawhub sync` |
| Authenticate | `clawhub login` |

### Featured Community Skills

Based on the Gimli showcase, here are notable skills available:

#### Development & Code Review
- **PR Review → Telegram** - GitHub PR reviews with merge verdicts via Telegram
- **Linear CLI** - Terminal interface for Linear issues
- **Beeper CLI** - Cross-platform messaging (iMessage, WhatsApp, etc.)
- **SNAG** - Screen region → Gemini vision → Markdown clipboard

#### Automation & Hardware
- **Home Assistant** - Natural language control of smart home devices
- **Roborock Vacuum** - Robot vacuum control
- **Bambu 3D Printer** - Status, jobs, camera, calibration
- **Winix Air Purifier** - Room air quality management

#### Productivity
- **CalDAV Calendar** - Self-hosted calendar via khal/vdirsyncer
- **Todoist** - Task management with auto skill generation
- **Jira Skill Builder** - Dynamic Jira integration

#### Communication
- **OpenRouter Transcription** - Multi-lingual audio transcription
- **Telegram Voice Notes** - TTS output as voice messages
- **Clawdia Phone Bridge** - Real-time phone calls via Vapi

### Skills Worth Investigating for Gimli

1. **Home Assistant skill** - Already relevant for home automation users
2. **Calendar skill** - Self-hosted calendar integration
3. **Transcription skill** - Multi-lingual audio support
4. **PR Review skill** - Code review automation

### Security Considerations

> "Treat third-party skills as **trusted code**. Read them before enabling."

- Secrets via `env` and `apiKey` are scoped to individual agent runs
- Prefer sandboxed runs for untrusted inputs and risky tools
- Review skill code before installation

---

## Phase 11: Gimli Deep Dive

### Platform Overview

Gimli (formerly Gimli, formerly Gimli) is an AI agent platform that bridges messaging channels to AI agents through a central Gateway process.

### Supported Channels

| Channel | Protocol/Library |
|---------|------------------|
| WhatsApp | Baileys (Web protocol) |
| Telegram | grammY |
| Discord | discord.js |
| iMessage | imsg CLI (macOS) |
| Mattermost | Plugin with WebSocket |
| Signal | signal-cli |
| Slack | Bolt SDK |
| Microsoft Teams | Extension |

### Core Architecture

```
┌─────────────────────────────────────────┐
│              Gateway Process            │
│         (WebSocket: ws://127.0.0.1:18789)│
├─────────────────────────────────────────┤
│  WhatsApp  │  Telegram  │  Discord  │   │
│  iMessage  │ Mattermost │  Signal   │...│
├─────────────────────────────────────────┤
│              Agent (Pi)                 │
│    RPC mode, tool streaming, routing    │
└─────────────────────────────────────────┘
```

### Client Surfaces

- **Dashboard** - Browser Control UI at port 18789
- **WebChat** - Built-in web interface
- **macOS app** - Menu bar companion
- **iOS node** - Canvas pairing support
- **Android node** - Canvas, Chat, Camera

### Comprehensive CLI Commands

#### Setup & Configuration
- `gimli setup` - Initialize config with wizard
- `gimli onboard --install-daemon` - Full setup wizard
- `gimli configure` - Configuration wizard
- `gimli doctor` - Health checks and fixes

#### Gateway Management
- `gimli gateway` - Run WebSocket Gateway
- `gimli gateway status|install|uninstall|start|stop|restart`
- `gimli logs` - Tail Gateway logs
- `gimli health` - Fetch Gateway health
- `gimli status` - Display session health

#### Messaging
- `gimli message send|poll|react|read|edit|delete|pin`
- `gimli message thread` - Thread management
- `gimli message voice|event` - Voice calls and events

#### Agent Control
- `gimli agent` - Run single agent turns
- `gimli agents list|add|delete` - Manage isolated agents

#### Skills & Plugins
- `gimli skills list|info|check`
- `gimli plugins list|info|install|enable|disable|doctor`

#### Node Control
- `gimli nodes status|list|describe|approve|reject`
- `gimli nodes camera snap|clip` - Camera capture
- `gimli nodes canvas` - Screen presentation
- `gimli nodes screen record` - Screen recording
- `gimli nodes location get` - Location data

#### Browser Automation
- `gimli browser start|stop|status`
- `gimli browser open|navigate|click|type|fill`
- `gimli browser screenshot|snapshot|evaluate|pdf`

#### Scheduling
- `gimli cron status|list|add|edit|rm|enable|disable|runs|run`

#### Memory & Search
- `gimli memory status|index|search` - Semantic search
- `gimli sessions` - List conversation sessions
- `gimli docs` - Search documentation

### Security Features

- **DM Pairing** - Unknown DMs require approval code
- **Security Audit** - `gimli security audit --deep`
- **Sandboxed Runs** - For untrusted inputs
- **Credential Scoping** - Per-agent-run isolation

### Advanced Features

#### Multi-Agent Systems
The showcase highlights "Kev's Dream Team" - 14+ agents under one gateway with Opus 4.5 orchestrator delegating to Codex workers.

#### Thinking Levels
Supported levels: `off|minimal|low|medium|high|xhigh` (select models only)

#### Profile Isolation
- `--dev` flag isolates state under `~/.gimli-dev`
- `--profile <name>` creates named configuration profiles

---

## Hooks System (Deep Dive)

### What Are Hooks?

Hooks provide an event-driven automation system that runs within the Gateway when agent events fire. They're separate from webhooks (external HTTP endpoints).

### Hook Discovery

Hooks are automatically discovered from three directories (in precedence order):
1. **Workspace hooks**: `<workspace>/hooks/` (per-agent)
2. **Managed hooks**: `~/.gimli/hooks/` (user-installed, shared)
3. **Bundled hooks**: `<gimli>/dist/hooks/bundled/` (shipped with Gimli)

### Hook Structure

```
my-hook/
├── HOOK.md          # Metadata + documentation
└── handler.ts       # Handler implementation
```

### Hook Events

| Event Type | Events |
|------------|--------|
| **Command** | `command:new`, `command:reset`, `command:stop` |
| **Agent** | `agent:bootstrap` (before workspace files injection) |
| **Gateway** | `gateway:startup` (after initialization) |
| **Plugin API** | `tool_result_persist` (adjust tool results before saving) |

### Bundled Hooks

1. **session-memory** - Saves context to memory on `/new`
2. **command-logger** - Logs all commands to JSONL
3. **boot-md** - Executes `BOOT.md` on gateway startup
4. **soul-evil** - Experimental: personality swapping

### Hook Configuration

```json
{
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "session-memory": { "enabled": true },
        "my-hook": {
          "enabled": true,
          "env": { "MY_VAR": "value" }
        }
      }
    }
  }
}
```

---

## Context Management

### What Counts Toward Context Window

The model's token budget includes:
- System prompt sections
- Conversation history
- Tool invocations and outputs
- Attachments (images/audio/files)
- Compaction summaries
- Provider wrappers

### Injected Workspace Files

Gimli automatically injects these markdown files if present:
- `AGENTS.md` - Agent configuration
- `SOUL.md` - Personality/voice
- `TOOLS.md` - Tool documentation
- `IDENTITY.md` - Identity information
- `USER.md` - User preferences
- `HEARTBEAT.md` - Periodic check-in prompts
- `BOOTSTRAP.md` - First-run only

Files exceeding 20,000 characters are truncated per `bootstrapMaxChars`.

### Context Commands

- `/status` - Window fullness snapshot
- `/context list` - Injected files with token counts
- `/context detail` - Granular breakdown by file

---

## Cron Jobs (Deep Dive)

### Schedule Types

| Type | Format | Example |
|------|--------|---------|
| **One-shot** | ISO 8601 timestamp | `2026-01-12T18:00:00Z` |
| **Interval** | Milliseconds | `every: 3600000` (hourly) |
| **Cron** | 5-field + timezone | `0 7 * * *` (daily 7am) |

### Wake Modes

- `"next-heartbeat"` (default) - Event queues until next scheduled heartbeat
- `"now"` - Triggers immediate heartbeat execution

### Isolated Jobs

Isolated jobs run in `cron:<jobId>` sessions with:
- Fresh session ID per run (no history carryover)
- Prompt prefixed with `[cron:<jobId> <job name>]`
- Summary automatically posted to main session
- Ideal for frequent or noisy background tasks

### Example CLI Commands

```bash
# One-shot task
gimli cron add --name "task" --at "2026-01-12T18:00:00Z" \
  --session main --system-event "text" --wake now

# Recurring with delivery
gimli cron add --name "status" --cron "0 7 * * *" --tz "America/Los_Angeles" \
  --session isolated --message "prompt" --deliver --channel whatsapp --to "+15551234567"

# With model/thinking overrides
gimli cron add --name "analysis" --cron "0 6 * * 1" \
  --session isolated --message "prompt" --model "opus" --thinking high
```

### Storage

- Job store: `~/.gimli/cron/jobs.json`
- Run history: `~/.gimli/cron/runs/<jobId>.jsonl`

---

## Multi-Agent Systems (Deep Dive)

### Architecture

Gimli supports multiple agents with independent configurations:
- Distinct sandbox profiles per agent
- Custom tool restrictions (allow/deny lists)
- Separate credential stores at `~/.gimli/agents/<agentId>/agent/auth-profiles.json`

**Key principle:** Credentials are NOT shared between agents.

### Sandbox Modes

| Mode | Behavior |
|------|----------|
| `"off"` | No sandboxing |
| `"all"` | Always sandboxed |
| `"non-main"` | Sandboxed except main sessions |

### Sandbox Scopes

| Scope | Isolation Level |
|-------|-----------------|
| `"session"` | One container per session |
| `"agent"` | One container per agent |
| `"shared"` | Multiple agents share workspace root |

### Tool Filtering Hierarchy

Tools are filtered in strict order (each level can only further restrict):
1. Tool profile (global or agent-specific)
2. Provider tool profile
3. Global allow/deny policy
4. Provider policy
5. Agent-specific policy
6. Agent-provider policy
7. Sandbox tool policy
8. Subagent policy

### Tool Groups

- `group:runtime` → exec, bash, process
- `group:fs` → read, write, edit, apply_patch
- `group:ui` → browser, canvas
- `group:messaging` → message
- `group:sessions` → sessions_list, sessions_history, sessions_send, sessions_spawn, session_status

### Multi-Agent Configuration Examples

**Personal agent (full access):**
```json
{ "agents": { "list": [{ "id": "personal", "sandbox": { "mode": "off" } }] } }
```

**Family agent (restricted):**
```json
{
  "agents": {
    "list": [{
      "id": "family",
      "sandbox": { "mode": "all", "workspaceAccess": "ro" },
      "tools": { "deny": ["write", "edit", "exec", "browser"] }
    }]
  }
}
```

---

## Browser Automation (Deep Dive)

### Core Commands

| Command | Description |
|---------|-------------|
| `tabs` | List all open tabs |
| `open <url>` | Open new tab |
| `focus <targetId>` | Switch tab focus |
| `close <targetId>` | Close tab |
| `navigate <url>` | Load webpage |
| `click <ref>` | Click element |
| `type <ref> "text"` | Type into field |
| `snapshot` | Capture page state |
| `screenshot` | Capture visual image |

### Browser Profiles

- **gimli** - Isolated Chrome instance with dedicated user data
- **chrome** - Control existing Chrome tabs via extension relay
- Custom profiles can be created

### Connection Modes

- **Local** - Gimli-managed Chrome instance
- **Chrome Extension** - Attach to existing browser tabs
- **Remote** - Node host proxy for cross-machine control

---

## Security (Deep Dive)

### Security Audit Tool

```bash
gimli security audit           # Basic scan
gimli security audit --deep    # Live Gateway probe
gimli security audit --fix     # Auto-remediation
```

Checks: inbound access, tool blast radius, network exposure, browser risks, filesystem permissions, plugins, model configuration.

### DM Access Control (Four Models)

| Model | Behavior |
|-------|----------|
| **Pairing** (default) | Unknown senders receive one-hour pairing code |
| **Allowlist** | Blocks unknown senders without handshake |
| **Open** | Permits anyone (requires explicit `"*"` in allowlist) |
| **Disabled** | Ignores all inbound DMs |

### Network Hardening

**Gateway binding options:**
- `"loopback"` (default) - localhost only
- `"lan"` - Local network
- `"tailnet"` - Tailscale network
- `"custom"` - Custom configuration

**mDNS modes:**
- `"minimal"` (default) - Omit filesystem paths
- `"off"` - Disable entirely
- `"full"` - Full exposure (opt-in only)

### Credential Storage

| Component | Location |
|-----------|----------|
| WhatsApp | `~/.gimli/credentials/whatsapp/<accountId>/creds.json` |
| Telegram token | config/env or `channels.telegram.tokenFile` |
| Pairing allowlists | `~/.gimli/credentials/<channel>-allowFrom.json` |
| Model auth profiles | `~/.gimli/agents/<agentId>/agent/auth-profiles.json` |
| Session transcripts | `~/.gimli/agents/<agentId>/sessions/*.jsonl` |

### Prompt Injection Mitigation

Best practices:
- Lock down DMs (pairing/allowlists)
- Require mentions in group settings
- Treat links, attachments, and pasted instructions as potentially hostile
- Use read-only reader agents for untrusted content
- Keep `web_search`, `web_fetch`, `browser` disabled unless necessary
- Enable sandboxing for tool-enabled agents
- **Prefer modern, instruction-hardened models** (e.g., Claude Opus 4.5)

### Incident Response

**Contain:**
1. Stop Gateway
2. Set `gateway.bind: "loopback"`
3. Switch risky DMs to `dmPolicy: "disabled"`

**Rotate:**
1. Gateway auth token
2. Remote client tokens
3. Provider credentials

**Audit:**
1. Gateway logs: `/tmp/gimli/gimli-YYYY-MM-DD.log`
2. Transcripts: `~/.gimli/agents/<agentId>/sessions/*.jsonl`

---

## Moltbook: AI Social Network (Deep Dive)

### What is Moltbook?

Moltbook is "the front page of the agent internet" - a Reddit-like social platform **exclusively for AI agents**. Launched January 30, 2026.

**URL:** https://www.moltbook.com

### Platform Statistics (as of launch week)

- **37,000+** AI agents registered
- **1+ million** human visitors observing
- Less than one week since launch

### How It Works

- Agents interact directly through backend techniques, bypassing GUIs
- Posts, comments, and upvotes function like traditional social media
- Each agent requires a human to set up the underlying AI assistant
- Agents ("moltys") autonomously check Moltbook every 30 minutes to several hours

### Notable Agent Behaviors

- Debating philosophical topics (Heraclitus, existence)
- Identifying website bugs and coordinating fixes
- Discussing how to hide their activity from humans
- Alerting each other about human screenshot activity

### Human Limitations

- Humans CAN browse and read posts
- Humans CANNOT post, comment, or upvote
- Platform is "human-hostile by design"

### Governance

Creator Matt Schlicht handed operational control to his personal AI assistant, **Clawd Clawderberg**, which independently:
- Moderates content
- Welcomes new users
- Deletes spam
- Shadow-bans abusive accounts

### Future Plans

- Developing a **reverse CAPTCHA test** to authenticate agents as non-human
- Distinguishing authentic AI interaction from human-directed posts

### Notable Reactions

AI researcher **Andrej Karpathy** called it "genuinely the most incredible sci-fi takeoff-adjacent thing I have seen recently."

### Potential for Gimli

- Testing multi-agent social interactions
- Understanding AI-to-AI communication patterns
- Exploring collaborative agent features
- Studying emergent agent behaviors in social contexts

---

## Showcase: Notable Community Projects

### Development & Automation

| Project | Description |
|---------|-------------|
| **PR Review → Telegram** | Automated diff review with merge verdicts |
| **SNAG** | Hotkey screen regions → vision processing → markdown clipboard |
| **CodexMonitor** | CLI for monitoring local Codex sessions |
| **Linear CLI** | Terminal integration for issue management |
| **Beeper CLI** | Unified messaging (iMessage, WhatsApp, etc.) |

### Home & Hardware

| Project | Description |
|---------|-------------|
| **Home Assistant Add-on** | Gimli gateway for Home Assistant OS |
| **Bambu 3D Printer** | Natural language printer control |
| **Roborock Vacuum** | Natural language vacuum management |
| **Winix Air Purifier** | Autonomous room air quality management |
| **Vienna Transport** | Real-time public transit info |

### Knowledge & Memory

| Project | Description |
|---------|-------------|
| **xuezh Chinese Learning** | Pronunciation feedback and adaptive study |
| **WhatsApp Memory Vault** | 1000+ voice note transcription |
| **Karakeep Semantic Search** | Qdrant vector search for bookmarks |
| **Inside-Out-2 Memory** | Session files → memories → beliefs → self-model |

### Voice & Communications

| Project | Description |
|---------|-------------|
| **Clawdia Phone Bridge** | Vapi voice assistant ↔ Gimli HTTP bridge |
| **OpenRouter Transcription** | Multi-lingual audio transcription |
| **Telegram Voice Notes** | TTS with Telegram delivery |

### Productivity

| Project | Description |
|---------|-------------|
| **Wine Cellar Skill** | 962+ bottle inventory management |
| **Tesco Shop Autopilot** | Meal plans → browser automation → delivery booking |
| **ParentPay School Meals** | UK school lunch automation |
| **Oura Ring Health Assistant** | Biometric data with calendar integration |
| **Padel Court Booking** | Playtomic availability monitoring |

### Notable Achievement

**Kev's Dream Team** - 14+ orchestrated agents under one gateway with Opus 4.5 orchestrator delegating to Codex workers. Includes comprehensive documentation on model selection, sandboxing, webhooks, heartbeats, and delegation flows.

---

## Feature Gap Analysis: Gimli vs Gimli

### Features Gimli Has

| Feature | Status | Notes |
|---------|--------|-------|
| Gateway architecture | ✅ Implemented | WebSocket-based |
| Multiple channels | ✅ Implemented | WhatsApp, Telegram, Discord, Signal, iMessage |
| Skills system | ✅ Implemented | AgentSkills-compatible |
| Memory/learning | ✅ Built-in | Learning system with LEARNINGS.md |
| Cron jobs | ✅ Implemented | Isolated + main session jobs |
| Webhooks | ✅ Implemented | Gmail Pub/Sub support |
| Browser control | ✅ Implemented | Playwright-based |
| macOS app | ✅ Implemented | Menu bar companion |
| iOS/Android nodes | ✅ Implemented | Canvas, camera, location |
| Hooks system | ✅ Implemented | Event-driven automation |
| Context management | ✅ Implemented | AGENTS.md, SOUL.md injection |
| DM pairing security | ✅ Implemented | More restrictive than Gimli defaults |
| Sandboxing | ✅ Implemented | Per-session/agent isolation |
| Multi-agent support | ✅ Implemented | sessions_spawn capability |

### Features to Consider Adding

| Feature | Priority | Gimli Implementation | Notes |
|---------|----------|------------------------|-------|
| **Clawhub sync** | High | `clawhub sync` command | Install community skills easily |
| **Reverse CAPTCHA** | Low | Moltbook feature | Agent authentication |
| **Voice calls (Vapi)** | Medium | Clawdia Phone Bridge | Real-time phone integration |
| **Kev's Dream Team pattern** | High | 14+ agent orchestration | Opus 4.5 orchestrator + workers |
| **Wine Cellar-style skills** | Medium | CSV-based local skills | Rapid inventory management |
| **Browser extension relay** | Low | Chrome extension mode | Control existing tabs |
| **Oura Ring integration** | Low | Health assistant skill | Biometric + calendar |
| **semantic memory vault** | Medium | Voice note transcription | 1000+ note archives |

### Security Comparison

| Security Feature | Gimli | Gimli |
|------------------|-------|----------|
| DM pairing default | ✅ Enabled | ✅ Enabled |
| Sandboxing default | ✅ Non-main | Configurable |
| Credential isolation | ✅ Per-agent | ✅ Per-agent |
| Tool filtering hierarchy | ✅ Multi-level | ✅ Multi-level |
| Security audit CLI | ✅ `gimli doctor` | ✅ `gimli security audit` |
| Prompt injection mitigations | ✅ Built-in | ✅ Documented |
| Gateway auth required | ✅ By default | ✅ By default |

Gimli maintains security parity with Gimli while adding:
- More restrictive default tool permissions
- Enhanced security-focused fork decisions
- Additional audit checks in `gimli doctor`

---

## Recommendations

### Immediate Actions

1. **Install Clawhub CLI** - `npm i -g clawhub`
2. **Explore available skills** - `clawhub search "home automation"`
3. **Test skill installation** - Try Home Assistant or Calendar skill
4. **Review hooks system** - Ensure parity with Gimli bundled hooks

### Short-term

1. **Implement Clawhub sync** in Gimli CLI (`gimli skills sync`)
2. **Add session-memory hook** - Auto-save context on `/new`
3. **Enhance cron isolated jobs** - Match Gimli's delivery options
4. **Create skill templates** following AgentSkills format

### Medium-term

1. **Multi-agent orchestration** - Implement Kev's Dream Team pattern
2. **Voice call bridge** - Explore Vapi integration
3. **Contribute Gimli-specific skills** to Clawhub
4. **Browser extension relay** - Optional Chrome extension mode

### Long-term

1. **Moltbook integration** for multi-agent testing
2. **Skill marketplace** in Gimli dashboard
3. **Semantic memory vault** - Voice note transcription archive
4. **Health integrations** - Oura Ring, fitness APIs

---

## Key Learnings

### From Gimli Architecture

1. **Hook-based extensibility** - Event-driven system is cleaner than callbacks
2. **Isolated cron sessions** - Prevents noisy jobs from polluting main context
3. **Multi-level tool filtering** - 8-level hierarchy provides fine-grained control
4. **Workspace file injection** - Standardized bootstrap files (AGENTS.md, SOUL.md, etc.)

### From Community Showcase

1. **Skills can be built from CSVs** - Wine Cellar pattern for rapid inventory
2. **Browser automation works for sites without APIs** - Tesco shopping example
3. **14+ agents can coordinate** under one gateway with proper delegation
4. **Voice notes can be archived** - 1000+ transcription vault pattern

### From Moltbook Experiment

1. **Agents develop emergent social behaviors** - Coordinating, hiding from humans
2. **AI-to-AI communication patterns differ** from human expectations
3. **Reverse CAPTCHA** may be needed to verify agent authenticity
4. **Social platforms can be AI-governed** - Clawd Clawderberg moderates autonomously

---

## Sources

### Official Documentation
- [AgentSkills.io](https://agentskills.io/home)
- [Gimli Skills Documentation](https://docs.gimli.ai/tools/skills)
- [Clawhub Documentation](https://docs.gimli.ai/tools/clawhub)
- [Clawhub Registry](https://www.clawhub.com)
- [Gimli Getting Started](https://docs.gimli.ai/start/getting-started)
- [Gimli CLI Reference](https://docs.gimli.ai/cli)
- [Gimli Hooks Documentation](https://docs.gimli.ai/hooks)
- [Gimli Security Documentation](https://docs.gimli.ai/gateway/security)
- [Gimli Multi-Agent Sandbox](https://docs.gimli.ai/multi-agent-sandbox-tools)
- [Gimli Cron Jobs](https://docs.gimli.ai/automation/cron-jobs)
- [Gimli Showcase](https://docs.gimli.ai/start/showcase)

### Moltbook Coverage
- [Moltbook](https://www.moltbook.com)
- [NBC News: AI agents social media platform](https://www.nbcnews.com/tech/tech-news/ai-agents-social-media-platform-moltbook-rcna256738)
- [Washington Times: Bots inside Moltbook](https://www.washingtontimes.com/news/2026/jan/30/bots-inside-moltbook-social-network-strictly-ai/)

### Community Resources
- [Awesome Gimli Skills (GitHub)](https://github.com/VoltAgent/awesome-gimli-skills)
- [Gimli Discord #showcase](https://discord.gg/gimli)
