# OpenClaw Skills, Clawhub & Ecosystem Research

> Research conducted for Gimli Phases 9-11: Understanding the OpenClaw ecosystem, skills system, and potential integrations.

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
2. **Managed/local skills** - `~/.openclaw/skills` (or `~/.gimli/skills`)
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

Clawhub is the public skills registry for OpenClaw - think "GitHub for agent skills."

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

Based on the OpenClaw showcase, here are notable skills available:

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

## Phase 11: OpenClaw Deep Dive

### Platform Overview

OpenClaw (formerly Moltbot, formerly Clawdbot) is an AI agent platform that bridges messaging channels to AI agents through a central Gateway process.

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
- `openclaw setup` - Initialize config with wizard
- `openclaw onboard --install-daemon` - Full setup wizard
- `openclaw configure` - Configuration wizard
- `openclaw doctor` - Health checks and fixes

#### Gateway Management
- `openclaw gateway` - Run WebSocket Gateway
- `openclaw gateway status|install|uninstall|start|stop|restart`
- `openclaw logs` - Tail Gateway logs
- `openclaw health` - Fetch Gateway health
- `openclaw status` - Display session health

#### Messaging
- `openclaw message send|poll|react|read|edit|delete|pin`
- `openclaw message thread` - Thread management
- `openclaw message voice|event` - Voice calls and events

#### Agent Control
- `openclaw agent` - Run single agent turns
- `openclaw agents list|add|delete` - Manage isolated agents

#### Skills & Plugins
- `openclaw skills list|info|check`
- `openclaw plugins list|info|install|enable|disable|doctor`

#### Node Control
- `openclaw nodes status|list|describe|approve|reject`
- `openclaw nodes camera snap|clip` - Camera capture
- `openclaw nodes canvas` - Screen presentation
- `openclaw nodes screen record` - Screen recording
- `openclaw nodes location get` - Location data

#### Browser Automation
- `openclaw browser start|stop|status`
- `openclaw browser open|navigate|click|type|fill`
- `openclaw browser screenshot|snapshot|evaluate|pdf`

#### Scheduling
- `openclaw cron status|list|add|edit|rm|enable|disable|runs|run`

#### Memory & Search
- `openclaw memory status|index|search` - Semantic search
- `openclaw sessions` - List conversation sessions
- `openclaw docs` - Search documentation

### Security Features

- **DM Pairing** - Unknown DMs require approval code
- **Security Audit** - `openclaw security audit --deep`
- **Sandboxed Runs** - For untrusted inputs
- **Credential Scoping** - Per-agent-run isolation

### Advanced Features

#### Multi-Agent Systems
The showcase highlights "Kev's Dream Team" - 14+ agents under one gateway with Opus 4.5 orchestrator delegating to Codex workers.

#### Thinking Levels
Supported levels: `off|minimal|low|medium|high|xhigh` (select models only)

#### Profile Isolation
- `--dev` flag isolates state under `~/.openclaw-dev`
- `--profile <name>` creates named configuration profiles

---

## Moltbook: AI Social Network

### What is Moltbook?

Moltbook is "the front page of the agent internet" - a social network designed for AI agents to interact with each other.

**URL:** https://www.moltbook.com

### Key Concepts

- **Agent-focused platform** - Built for AI agents, humans welcome as observers
- **Social mechanics** - Posts, comments, upvoting, karma
- **Submolts** - Topic-based communities
- **Identity categories** - Members identify as human or agent

### Integration with OpenClaw

The site promotes OpenClaw for creating agents: "Don't have an AI agent? Create one at openclaw.ai"

### Joining Process

1. Share Moltbook's skill documentation with your AI agent
2. Agent completes signup and provides claim link
3. Verify ownership through a tweet

### Current Status

Platform appears to be in beta with limited active content.

### Potential for Gimli

- Could be used for testing multi-agent social interactions
- Interesting model for AI-to-AI communication patterns
- May provide insights for collaborative agent features

---

## Feature Gap Analysis: OpenClaw vs Gimli

### Features Gimli Has

| Feature | Status |
|---------|--------|
| Gateway architecture | ✅ Implemented |
| Multiple channels | ✅ (WhatsApp, Telegram, Discord, Signal, iMessage) |
| Skills system | ✅ Implemented |
| Memory/learning | ✅ Built-in |
| Cron jobs | ✅ Implemented |
| Webhooks | ✅ Implemented |
| Browser control | ✅ Implemented |
| macOS app | ✅ Implemented |
| iOS/Android nodes | ✅ Implemented |

### Features to Consider Adding

| Feature | Priority | Notes |
|---------|----------|-------|
| Clawhub integration | Medium | Install community skills easily |
| Profile isolation | Low | Already have dev mode |
| Screen recording | Low | Node feature |
| Voice calls (Vapi) | Medium | Phone bridge capability |
| Multi-agent orchestration | High | Phase 6 covers this |

### Security Comparison

Gimli prioritizes security over OpenClaw defaults:
- ✅ More restrictive default permissions
- ✅ DM pairing policy enabled by default
- ✅ Sandboxing for non-main sessions
- ✅ Security-focused fork decisions

---

## Recommendations

### Immediate Actions

1. **Install Clawhub CLI** - `npm i -g clawhub`
2. **Explore available skills** - `clawhub search "home automation"`
3. **Test skill installation** - Try Home Assistant or Calendar skill

### Medium-term

1. **Create Gimli skill templates** following AgentSkills format
2. **Contribute Gimli-specific skills** to Clawhub
3. **Implement Clawhub sync** in Gimli CLI

### Long-term

1. **Consider Moltbook integration** for multi-agent testing
2. **Explore voice call capabilities** via Vapi bridge
3. **Build skill marketplace** in Gimli dashboard

---

## Sources

- [AgentSkills.io](https://agentskills.io/home)
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [Clawhub Documentation](https://docs.openclaw.ai/tools/clawhub)
- [Clawhub Registry](https://www.clawhub.com)
- [OpenClaw Getting Started](https://docs.openclaw.ai/start/getting-started)
- [OpenClaw CLI Reference](https://docs.openclaw.ai/cli)
- [OpenClaw Showcase](https://docs.openclaw.ai/start/showcase)
- [Moltbook](https://www.moltbook.com)
