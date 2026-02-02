---
name: channel-expert
description: Expert knowledge of Gimli's messaging channel system - WhatsApp, Telegram, Discord, Slack, Signal, iMessage, and 20+ extension channels. Load this expertise for channel setup, troubleshooting, and integration tasks.
metadata: {"gimli":{"emoji":"📡","expertise_files":["skills/channel-expert/expertise/architecture.yaml","skills/channel-expert/expertise/channels.yaml","skills/channel-expert/expertise/security.yaml","skills/channel-expert/expertise/troubleshooting.yaml"]}}
---

# Channel Expert

This skill provides deep expertise on Gimli's messaging channel architecture. Load this when working on:
- Channel setup and configuration
- Multi-channel routing and session management
- DM pairing and security policies
- Channel troubleshooting and diagnostics
- Adding new channel support
- Channel plugin development

## Supported Channels Overview

Gimli supports **30+ messaging platforms** through a unified plugin architecture:

### Core Channels (Built-in)

| Channel | Driver | Auth Method | Key Features |
|---------|--------|-------------|--------------|
| **Telegram** | grammY (Bot API) | Bot token | Groups, native commands, channels |
| **WhatsApp** | Baileys | QR pairing | Most popular, media-rich |
| **Discord** | discord.js | Bot token | Guilds, threads, slash commands |
| **Slack** | Bolt SDK | Socket Mode | Workspace apps, threads |
| **Google Chat** | HTTP Webhook | Service account | Google Workspace |
| **Signal** | signal-cli | Phone number | Privacy-focused |
| **iMessage** | BlueBubbles/imsg | QR/native | Apple ecosystem |

### Extension Channels (Plugins)

| Channel | Type | Key Use Case |
|---------|------|--------------|
| Microsoft Teams | Enterprise | Microsoft ecosystem |
| Matrix | Decentralized | Self-hosted, open protocol |
| LINE | Regional | Asia (Japan, Taiwan, Thailand) |
| Mattermost | Self-hosted | Slack alternative |
| Nostr | Decentralized | Censorship-resistant |
| Zalo | Regional | Vietnam |
| Twitch | Streaming | Stream chat |
| Voice Call | Voice | Phone/voice integration |

## Architecture

### Plugin Contract

Every channel implements the `ChannelPlugin` interface:

```typescript
type ChannelPlugin = {
  id: ChannelId;              // Unique identifier
  meta: ChannelMeta;          // Display info, docs path
  capabilities: ChannelCapabilities;  // Feature flags
  config: ChannelConfigAdapter;       // Account resolution

  // Optional adapters
  onboarding?: ChannelOnboardingAdapter;
  pairing?: ChannelPairingAdapter;
  security?: ChannelSecurityAdapter;
  gateway?: ChannelGatewayAdapter;
  // ... and more
};
```

### Capabilities Matrix

```yaml
capabilities:
  chatTypes: ["direct", "group", "channel", "thread"]
  reactions: true|false|"limited"
  threads: true|false|"limited"
  media: true
  nativeCommands: true
  blockStreaming: false  # Telegram blocks streaming
```

### Key Source Files

| File | Purpose |
|------|---------|
| `src/channels/registry.ts` | Channel metadata, aliases, ordering |
| `src/channels/plugins/types.plugin.ts` | ChannelPlugin contract |
| `src/channels/plugins/types.core.ts` | Capabilities, adapters |
| `src/routing/resolve-route.ts` | Message routing to agents |
| `extensions/<channel>/` | Channel implementations |

## Routing System

Messages are routed to agents based on bindings:

```
Resolution Priority:
1. binding.peer (specific user/group)
2. binding.guild (Discord server)
3. binding.team (Microsoft Teams)
4. binding.account (account-level)
5. binding.channel (channel-level)
6. default (fallback agent)
```

Session key format: `agent:<agentId>:<channel>:<scope>:<peerId>`

### DM Scope Options

| Scope | Description |
|-------|-------------|
| `main` | All DMs share one session |
| `per-peer` | Each user isolated |
| `per-channel-peer` | Per channel + user |
| `per-account-channel-peer` | Most isolated |

## Security

### DM Policies

| Policy | Description | When to Use |
|--------|-------------|-------------|
| `pairing` | Unknown senders get pairing code | Default, recommended |
| `allowlist` | Only pre-approved senders | When users known upfront |
| `open` | Accept all messages | **NOT RECOMMENDED** |

### Pairing Commands

```bash
gimli pairing list              # Show pending requests
gimli pairing approve <channel> <code>   # Approve request
gimli pairing reject <channel> <code>    # Reject request
```

### Group Security

- Mention gating: Bot only responds to @mentions in groups
- `allowUnmentionedGroups`: Skip mention requirement
- `groupChannels`: Allowlist of groups for unprompted listening

## Quick Setup by Channel

### Telegram (Fastest)

```bash
# 1. Message @BotFather, create bot, get token
# 2. Run setup
gimli channels setup telegram --bot-token <TOKEN>

# 3. Verify
gimli channels status telegram --probe
```

### Discord

```bash
# 1. Create app in Developer Portal
# 2. Enable intents (MESSAGE_CONTENT required)
# 3. Get bot token
gimli channels setup discord --bot-token <TOKEN>

# 4. Invite to server with OAuth2 URL
```

### WhatsApp

```bash
# 1. Run setup (will show QR)
gimli channels setup whatsapp

# 2. Scan QR with WhatsApp mobile

# 3. Wait for 'linked' status
gimli channels status whatsapp
```

### Slack

```bash
# 1. Create app at api.slack.com/apps
# 2. Enable Socket Mode
# 3. Get bot token (xoxb-) and app token (xapp-)
gimli channels setup slack --bot-token <BOT> --app-token <APP>
```

## Troubleshooting

### Quick Diagnostics

```bash
gimli doctor                      # Overall health
gimli channels status --probe     # All channels with live checks
gimli channels status <channel> --probe  # Single channel
```

### Common Issues

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Not linked" | Missing/invalid token | Re-run setup |
| Messages not received | DM policy blocking | Check allowlist |
| Bot silent in groups | Privacy mode/mentions | Disable privacy or @mention |
| Token rejected | Revoked or expired | Generate new token |
| QR keeps regenerating | Session not persisting | Check ~/.gimli/credentials/ permissions |

### Platform-Specific Fixes

**Telegram IPv6 issue:**
```
HttpError: Network request for 'sendMessage' failed
```
Solution: Force IPv4 DNS or enable IPv6 egress

**Discord intents:**
```
Error code 4014 (Disallowed intents)
```
Solution: Enable MESSAGE_CONTENT in Developer Portal

**WhatsApp session:**
```
Disconnected: Connection Closed
```
Solution: Delete session files, re-pair

## Configuration Example

```json
{
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "botToken": "123456:ABC-DEF...",
          "enabled": true,
          "dmPolicy": "pairing",
          "allowUnmentionedGroups": false
        }
      }
    },
    "discord": {
      "accounts": {
        "default": {
          "botToken": "...",
          "enabled": true,
          "dmPolicy": "pairing"
        }
      },
      "routes": [
        {
          "match": { "guildId": "123456789" },
          "agentId": "work-bot"
        }
      ]
    }
  }
}
```

## Multi-Account Support

Each channel supports multiple named accounts:

```json
{
  "channels": {
    "telegram": {
      "accounts": {
        "work": { "botToken": "...", "enabled": true },
        "personal": { "botToken": "...", "enabled": true }
      }
    }
  }
}
```

Benefits:
- Work/personal separation
- Multiple bots per platform
- Per-client routing
- Failover between accounts

## Adding New Channels

### Plugin Location

```
extensions/<channel>/
├── package.json
├── index.ts          # Extension entrypoint
└── src/
    ├── channel.ts    # ChannelPlugin implementation
    └── runtime.ts    # Lazy-loaded runtime
```

### package.json

```json
{
  "name": "@gimli/<channel>",
  "gimli": {
    "extensions": ["./index.ts"]
  }
}
```

### Required Adapters

At minimum, implement:
- `id`, `meta`, `capabilities` (required)
- `config` adapter (required)
- `gateway` adapter (for message handling)
- `security` adapter (for DM policy)

## Expert Mental Model Location

Comprehensive YAML expertise files:

- `skills/channel-expert/expertise/architecture.yaml` - System architecture
- `skills/channel-expert/expertise/channels.yaml` - Individual channel details
- `skills/channel-expert/expertise/security.yaml` - Security patterns
- `skills/channel-expert/expertise/troubleshooting.yaml` - Diagnostics

## Self-Improvement

### When to Resync

Update expertise when changes occur in:
- `src/channels/registry.ts`
- `src/channels/plugins/types.*.ts`
- `src/routing/resolve-route.ts`
- `extensions/*/src/channel.ts`
- `docs/channels/*.md`

### Source Files to Monitor

```
src/channels/registry.ts
src/channels/plugins/types.plugin.ts
src/channels/plugins/types.core.ts
src/channels/plugins/types.adapters.ts
src/routing/resolve-route.ts
src/routing/session-key.ts
extensions/*/src/channel.ts
```

### Resync Workflow

1. Review recent commits to monitored files
2. Compare YAML with actual implementations
3. Update expertise sections that have drifted
4. Update `updated_at` timestamp
