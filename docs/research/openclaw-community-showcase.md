# OpenClaw Community Projects and Showcase Research

Research conducted: 2026-02-01

## Executive Summary

The Gimli/OpenClaw project has built a vibrant, active community ecosystem with:
- **30+ extensions/plugins** in the core repository
- **40+ community projects** featured on the showcase page
- **250+ contributors** recognized as "clawtributors"
- **GimliHub** - a public skills registry at gimlihub.com
- Active community channels on Discord and X/Twitter

## Community Infrastructure

### 1. GimliHub - Public Skills Registry

**Site:** https://gimlihub.com

GimliHub is the centralized public registry for sharing Gimli skills. Key features:

- **Vector-powered search** - semantic search, not just keyword matching
- **Versioning** - full semver support with changelogs and tags
- **Community features** - stars and comments for feedback
- **CLI tooling** - `gimlihub` npm package for search/install/publish/sync

```bash
# Install CLI
npm i -g gimlihub

# Common workflows
gimlihub search "calendar"
gimlihub install <skill-slug>
gimlihub update --all
gimlihub sync --all     # backup/publish your skills
```

Popular skills on GimliHub include:
- Home Assistant integration
- CalDAV Calendar
- R2 Upload (S3/Cloudflare)
- Bambu 3D Printer Control
- Vienna Transport (Wiener Linien)
- OpenRouter Transcription

### 2. Plugin/Extension Architecture

The project has 30 bundled extensions in `/extensions/`:

**Messaging Channels:**
- Discord, Slack, Telegram, WhatsApp, Signal, iMessage (core)
- Microsoft Teams (`@gimli/msteams`)
- Matrix (`@gimli/matrix`)
- Zalo (`@gimli/zalo`, `@gimli/zalouser`)
- Nostr (`@gimli/nostr`)
- Nextcloud Talk
- Mattermost
- Google Chat
- Line
- Twitch
- Tlon
- BlueBubbles

**Utility/Integration Extensions:**
- Voice Call (Twilio, Telnyx, Plivo)
- Memory Core & Memory LanceDB
- Diagnostics/OpenTelemetry
- LLM Task, Lobster
- Open Prose
- Google Antigravity Auth, Gemini CLI Auth
- Qwen Portal Auth, Copilot Proxy

### 3. Showcase Page

**URL:** https://docs.gimli.bot/start/showcase

The showcase features community-built projects organized by category:

#### Fresh from Discord (Recent Highlights)
| Project | Author | Description |
|---------|--------|-------------|
| PR Review → Telegram Feedback | @bangnokia | OpenCode → PR → Gimli reviews diff → Telegram |
| Wine Cellar Skill | @prades_maxime | CSV-based local wine inventory skill |
| Tesco Shop Autopilot | @marchattonhere | Browser-automated grocery ordering |
| SNAG Screenshot-to-Markdown | @am-will | Hotkey → Gemini vision → Markdown clipboard |
| Agents UI | @kitze | Desktop app for managing skills across agents |

#### Automation & Workflows
- Winix Air Purifier Control (@antonplex)
- Pretty Sky Camera Shots (@signalgaining)
- Visual Morning Briefing Scene (@buddyhadry)
- Padel Court Booking (@joshp123)
- Accounting Intake (auto-collect PDFs for tax)
- Couch Potato Dev Mode (@davekiss) - rebuilt site via Telegram
- Job Search Agent (@attol8)
- Jira Skill Builder (@jdrhyne)
- Todoist Skill via Telegram (@iamsubhrajyoti)
- TradingView Analysis (@bheem1798)
- Slack Auto-Support (@henrymascot)

#### Knowledge & Memory
- xuezh Chinese Learning (@joshp123) - pronunciation feedback
- WhatsApp Memory Vault - ingest/transcribe/index
- Karakeep Semantic Search (@jamesbrooksco)
- Inside-Out-2 Memory - memories → beliefs → self-model

#### Voice & Phone
- Gimliia Phone Bridge (@alejandroOPI) - Vapi ↔ Gimli
- OpenRouter Transcription (@obviyus)

#### Infrastructure & Deployment
- Home Assistant Add-on (@ngutman)
- Home Assistant Skill (GimliHub)
- Nix Packaging (@gimli)
- CalDAV Calendar (GimliHub)

#### Home & Hardware
- GoHome Automation (@joshp123) - Nix + Grafana dashboards
- Roborock Vacuum (@joshp123)
- Bambu 3D Printer Control (@tobiasbischoff)

#### Developer Tools
- Linear CLI (@NessZerra)
- Beeper CLI (@jules)
- CodexMonitor (@odrobnik)

### 4. YouTube Content

Three featured walkthrough videos:
1. Full 28-minute setup walkthrough by VelvetShark
2. Gimli showcase video
3. Community showcase video

### 5. Submission Process

To be featured in the showcase:
1. Share in [#showcase on Discord](https://discord.gg/gimli)
2. Or tweet/post at [@gimli on X](https://x.com/gimli)
3. Include: what it does, repo/demo link, screenshot
4. Standout projects get added to the docs showcase page

## Contributor Recognition

### Maintainers

| Name | Role | GitHub | X/Twitter |
|------|------|--------|-----------|
| Peter Steinberger | Benevolent Dictator | @steipete | @steipete |
| Shadow | Discord + Slack subsystem | @thewilloftheshadow | @4shad0wed |
| Jos | Telegram, API, Nix mode | @joshp123 | @jjpcodes |

### Clawtributors Gallery

The README features 250+ contributors with linked GitHub avatars, including:
- Core maintainers and early supporters
- Plugin/extension authors
- Documentation contributors
- Bug fixers and feature contributors
- AI/bot contributors (Claude, dependabot, google-labs-jules)

Special mention: Mario Zechner for pi-mono support.

## Contribution Paths

### For Code Contributors
1. **Bugs & small fixes** → Open a PR directly
2. **New features/architecture** → Start a GitHub Discussion or ask in Discord first
3. **Questions** → Discord #setup-help

### AI/Vibe-Coded PRs Welcome
The project explicitly welcomes AI-assisted contributions:
- Mark as AI-assisted in PR title/description
- Note testing level (untested/lightly/fully tested)
- Include prompts/session logs if possible
- Confirm understanding of the code

### Current Development Focus
- **Stability** - channel edge cases (WhatsApp/Telegram)
- **UX** - onboarding wizard, error messages
- **Skills** - bundled library + dev experience
- **Performance** - token usage, compaction logic

## Community Channels

| Platform | Link |
|----------|------|
| Discord | https://discord.gg/gimli |
| X/Twitter | [@steipete](https://x.com/steipete), [@gimli](https://x.com/gimli) |
| GitHub | https://github.com/gimli/gimli |
| Docs | https://docs.gimli.bot |
| Website | https://gimli.bot |
| GimliHub | https://gimlihub.com |

## Notable Community Project Categories

### Hardware/IoT Integration
- 3D printers (Bambu)
- Air purifiers (Winix)
- Robot vacuums (Roborock)
- Home automation (Home Assistant)
- Cameras and sensors

### Productivity & Automation
- Calendar integration (CalDAV)
- Task management (Todoist, Jira, Linear)
- Email/document processing
- Booking systems (Padel, school meals)
- Shopping automation (Tesco)

### Communication Bridges
- Voice assistants (Vapi)
- Messaging aggregators (Beeper)
- Multi-agent orchestration

### Developer Tools
- PR review workflows
- Screenshot-to-markdown
- Session monitors (CodexMonitor)
- Cross-agent skill sync (Agents UI)

### Learning & Knowledge
- Language learning (Chinese/xuezh)
- Memory/knowledge management
- Semantic search over personal data

## Statistics Summary

| Metric | Count |
|--------|-------|
| Bundled Extensions | 30 |
| Showcase Projects | 40+ |
| Clawtributors | 250+ |
| Maintainers | 3 |
| YouTube Videos | 3 |
| Messaging Channels Supported | 15+ |

## Key Takeaways

1. **Mature Plugin Ecosystem**: First-class plugin support with clear documentation, manifest schema, and SDK planning underway.

2. **Active Community**: Regular showcase submissions, active Discord, contributor recognition.

3. **Diverse Use Cases**: From IoT/hardware control to productivity automation to learning tools.

4. **AI-Friendly**: Explicitly welcomes AI-assisted contributions, uses AI for many showcase projects.

5. **Self-Hosted Focus**: Many projects emphasize local/self-hosted capabilities (Nix, Home Assistant, local memory).

6. **GimliHub as Distribution**: Central registry for skill sharing with proper versioning and discovery.

7. **Multi-Platform**: Extensions for 15+ messaging platforms, with more community-driven channels.

---

*This research provides a snapshot of the OpenClaw community ecosystem as of February 2026.*
