# Gimli - Agent Memory File

> This file provides context for AI agents working on the Gimli codebase. It follows TAC (Tactical Agentic Coding) principles for effective agent collaboration.

## Project Identity

**Gimli** is a security-hardened personal AI assistant with multi-channel messaging, voice, browser control, Canvas, skills, cron, webhooks, and companion apps. It's a fork of OpenClaw/MoltBot with enhanced security defaults.

- **Repository**: https://github.com/gimli/gimli
- **Documentation**: https://docs.gimli.bot
- **Runtime**: Node 22+ (Bun preferred for dev)
- **Language**: TypeScript (ESM)

---

## Architecture Overview

### Core Layers

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Layer (src/cli/)                   │
│  Entry point for all commands, uses Commander.js            │
├─────────────────────────────────────────────────────────────┤
│                   Commands (src/commands/)                  │
│  Implementation of CLI commands (agent, gateway, onboard)   │
├─────────────────────────────────────────────────────────────┤
│                    Gateway (src/gateway/)                   │
│  WebSocket server, session management, message routing      │
├─────────────────────────────────────────────────────────────┤
│                   Channels (src/channels/)                  │
│  Unified interface for messaging platforms                  │
├─────────────────────────────────────────────────────────────┤
│                    Agents (src/agents/)                     │
│  LLM interaction, tools, skills, sandboxing                 │
├─────────────────────────────────────────────────────────────┤
│                   Extensions (extensions/)                  │
│  Plugin system for additional channels and features         │
└─────────────────────────────────────────────────────────────┘
```

### Key Directories

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/cli/` | CLI wiring, argument parsing | `program/`, `*-cli/` |
| `src/commands/` | Command implementations | `agent/`, `onboard*/` |
| `src/gateway/` | WebSocket server, sessions | Core messaging infrastructure |
| `src/channels/` | Channel abstractions | Routing, allowlists |
| `src/agents/` | Agent logic, tools, skills | `tools/`, `skills/`, `sandbox/` |
| `src/routing/` | Message routing logic | Route handling |
| `src/media/` | Media processing pipeline | Image/audio handling |
| `src/infra/` | Infrastructure utilities | Shared helpers |
| `extensions/` | Plugin workspace packages | Channel plugins |
| `apps/` | Native apps | `macos/`, `ios/`, `android/` |
| `docs/` | Mintlify documentation | Hosted at docs.gimli.bot |

### Built-in Channels

Located in `src/`:
- `src/telegram/` - Telegram bot
- `src/discord/` - Discord bot
- `src/slack/` - Slack app
- `src/signal/` - Signal messenger
- `src/imessage/` - iMessage (macOS)
- `src/web/` - WhatsApp Web
- `src/whatsapp/` - WhatsApp

### Extension Channels

Located in `extensions/`:
- `msteams` - Microsoft Teams
- `matrix` - Matrix protocol
- `zalo`, `zalouser` - Zalo messenger
- `voice-call` - Voice calling
- `telegram`, `discord`, `slack`, `signal` - Extended versions
- `line`, `twitch`, `nostr`, `googlechat` - Additional platforms

---

## Security Model

> **Gimli prioritizes security over convenience. Never weaken existing protections.**

### Security Defaults

| Setting | Default | Purpose |
|---------|---------|---------|
| Gateway bind | `loopback` | Prevents external access |
| DM policy | `pairing` | Requires user verification |
| Sandbox | Active for non-main | Isolates untrusted sessions |
| Credentials | `~/.gimli/credentials/` | Restricted permissions |

### Security Principles

1. **Opt-in permissions** - Features require explicit enabling
2. **Input validation** - Validate all external inputs at boundaries
3. **No credential exposure** - Keep secrets out of logs/errors
4. **Sandbox by default** - Non-main sessions run sandboxed
5. **Channel-specific auth** - Each channel has its own auth requirements

### Security-Critical Paths

When modifying these areas, flag changes for review:
- `src/agents/sandbox/` - Execution sandboxing
- `src/pairing/` - User verification
- `src/agents/auth-profiles/` - Authentication
- Credential handling anywhere
- Permission checks

---

## Development Patterns

### Dependency Injection

Use `createDefaultDeps` pattern for testability:

```typescript
export function createDefaultDeps() {
  return {
    config: loadConfig(),
    logger: createLogger(),
    // ... other dependencies
  }
}

export async function myFunction(deps = createDefaultDeps()) {
  // Use deps.config, deps.logger, etc.
}
```

### CLI Progress & Output

- Progress: Use `src/cli/progress.ts` (osc-progress + @clack/prompts)
- Tables: Use `src/terminal/table.ts` for ANSI-safe wrapping
- Colors: Use `src/terminal/palette.ts` (no hardcoded colors)

### Error Handling

- Validate inputs at system boundaries
- Use typed errors where possible
- Never expose credentials in error messages
- Log sufficient context for debugging

### Testing

- Framework: Vitest with V8 coverage (70% threshold)
- Naming: `*.test.ts` colocated, `*.e2e.test.ts` for e2e
- Run: `pnpm test` or `pnpm test:coverage`
- Live tests: `GIMLI_LIVE_TEST=1 pnpm test:live`

---

## Build & Development

### Commands

```bash
# Install dependencies
pnpm install

# Run CLI in development
pnpm gimli <command>

# Type-check and build
pnpm build

# Lint and format
pnpm lint
pnpm format

# Run tests
pnpm test
pnpm test:coverage

# Pre-commit hooks
prek install
```

### Runtime Requirements

- Node 22+ (keep Node + Bun paths working)
- Prefer Bun for TypeScript execution: `bun <file.ts>`
- Node for built output (`dist/*`) and production

---

## Key Conventions

### Naming

- **Product/docs**: "Gimli" (capitalized)
- **CLI/code**: `gimli` (lowercase)
- Files: Keep under ~700 LOC, split when it improves clarity

### Code Style

- TypeScript ESM, strict typing, avoid `any`
- Oxlint + Oxfmt for formatting/linting
- Brief comments for tricky logic
- Extract helpers instead of "V2" copies

### Git Workflow

- Commits: Use `scripts/committer "<msg>" <files...>`
- Messages: Concise, action-oriented (e.g., "CLI: add verbose flag")
- PRs: Prefer rebase when clean, squash when messy
- Changelog: Latest version at top, no "Unreleased" section

### Documentation

- Hosted on Mintlify at docs.gimli.bot
- Internal links: root-relative, no `.md` extension
- Avoid em dashes and apostrophes in headings (breaks anchors)
- Generic content: no personal device names/paths

---

## Session & Agent Architecture

### Session Types

| Type | Sandbox | Permissions | Use Case |
|------|---------|-------------|----------|
| Main | No | Full host access | Primary user session |
| Group | Yes | Restricted | Shared/group chats |
| Spawned | Yes | Restricted | Sub-agent sessions |

### Agent Tools

Located in `src/agents/tools/`:
- File operations (read, write, edit)
- Process execution (bash)
- Browser automation
- Session management (spawn, list, history)

### Skills System

- Location: `~/gimli/skills/<skill>/SKILL.md`
- Skills provide specialized capabilities
- Can be bundled or workspace-installed

---

## Configuration

### File Locations

| File | Purpose |
|------|---------|
| `~/.gimli/gimli.json` | Main configuration |
| `~/.gimli/credentials/` | Secure credential storage |
| `~/.gimli/sessions/` | Session data |
| `~/.gimli/agents/` | Agent session logs |

### Key Settings

```json
{
  "gateway": {
    "mode": "local",
    "port": 18789
  },
  "dmPolicy": "pairing",
  "sandbox": {
    "enabled": true
  }
}
```

---

## Troubleshooting

### Common Commands

```bash
# Health check
gimli doctor

# Gateway status
gimli gateway status
gimli channels status --probe

# Logs (macOS)
./scripts/clawlog.sh

# Gateway restart (Linux/VM)
pkill -9 -f gimli-gateway || true
nohup gimli gateway run --bind loopback --port 18789 --force > /tmp/gimli-gateway.log 2>&1 &
```

### Common Issues

1. **Gateway won't start**: Check port 18789 availability
2. **Channel auth fails**: Verify credentials in `~/.gimli/credentials/`
3. **Sandbox errors**: Ensure Docker is available for non-main sessions
4. **Migration issues**: Run `gimli doctor` for legacy config warnings

---

## Multi-Agent Safety

When multiple agents work on this codebase:

- **No stash operations** unless explicitly requested
- **No branch switching** unless explicitly requested
- **No worktree modifications** unless explicitly requested
- **Scope commits** to your changes only
- **Focus on your task** - don't touch unrelated WIP
- **Format-only changes**: Auto-resolve without asking

---

## Extension Development

### Plugin Structure

```
extensions/<plugin>/
├── package.json      # Plugin deps (no workspace:* in dependencies)
├── src/
│   └── index.ts      # Entry point
└── README.md
```

### Key Rules

- Runtime deps in `dependencies` (not devDependencies)
- Put `gimli` in `devDependencies` or `peerDependencies`
- Install runs `npm install --omit=dev` in plugin dir
- Avoid `workspace:*` in dependencies (breaks npm install)

---

## Agent Expert Knowledge

### Gateway Mental Model

The Gateway is the central hub:
1. Receives messages from channels
2. Routes to appropriate session
3. Manages session lifecycle
4. Handles WebSocket connections
5. Coordinates with extensions

### Channel Mental Model

Channels are adapters:
1. Authenticate with platform
2. Listen for incoming messages
3. Transform to unified format
4. Send to Gateway
5. Receive responses from Gateway
6. Transform and send to platform

### Session Mental Model

Sessions are conversation contexts:
1. Main session = full host access
2. Other sessions = sandboxed
3. Each session has history, tools, state
4. Sessions can spawn sub-sessions
5. Sessions persist across restarts

---

## Quick Reference

### Files to Read First

When starting work on a new area:

| Area | Start With |
|------|------------|
| CLI commands | `src/cli/program/index.ts` |
| Gateway | `src/gateway/index.ts` |
| Channels | `src/channels/index.ts` |
| Agents | `src/agents/index.ts` |
| Tools | `src/agents/tools/index.ts` |
| Extensions | `extensions/*/src/index.ts` |

### Common Patterns

```typescript
// Config loading
import { loadConfig } from '@/config'
const config = loadConfig()

// Logger usage
import { createLogger } from '@/logging'
const log = createLogger('my-module')

// CLI progress
import { withSpinner } from '@/cli/progress'
await withSpinner('Processing...', async () => { /* work */ })
```

---

*This memory file follows TAC principles for effective agent collaboration. Keep it updated as the codebase evolves.*
