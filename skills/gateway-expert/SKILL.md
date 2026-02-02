---
name: gateway-expert
description: Expert agent for Gateway operations including WebSocket connections, session management, channel integration, and protocol debugging. Load this expertise when working on gateway code, debugging connections, or implementing channel features.
metadata: {"gimli":{"emoji":"🌐"}}
---

# Gateway Expert

The Gateway Expert provides deep knowledge of Gimli's gateway architecture, WebSocket protocol, session management, and multi-channel messaging. This expertise enables agents to understand, debug, and extend gateway functionality with confidence.

## When to Load This Expert

Load this expertise when:
- Debugging WebSocket connection issues
- Working on session management code
- Implementing or modifying channel adapters
- Understanding the gateway protocol
- Troubleshooting authentication flows
- Extending gateway RPC methods

## Core Mental Models

### Gateway Architecture

The gateway is Gimli's central nervous system, handling:

1. **WebSocket Server**: Accepts client connections from apps (macOS, iOS, Android), CLI tools, and external services
2. **Protocol Layer**: JSON-RPC-style request/response with event streaming
3. **Session Manager**: Persists conversation state across restarts
4. **Channel Router**: Dispatches messages to/from messaging platforms
5. **Agent Executor**: Runs AI agents with tool access

### Connection Lifecycle

```
Client                          Gateway
  |                                |
  |------ WebSocket Connect ------>|
  |                                |
  |<----- connect.challenge -------|  (nonce for signing)
  |                                |
  |------ connect (signed) ------->|  (device auth + capabilities)
  |                                |
  |<----- HelloOk ----------------|  (session info, policies)
  |                                |
  |<===== Event Stream ============|  (tick, chat.*, agent.*)
  |                                |
  |====== Request/Response =======>|  (RPC calls)
```

### Protocol Frames

**RequestFrame** (client -> gateway):
```typescript
{
  type: "req",
  id: string,      // UUID for correlation
  method: string,  // RPC method name
  params?: object  // Method parameters
}
```

**ResponseFrame** (gateway -> client):
```typescript
{
  type: "res",
  id: string,      // Matches request ID
  ok: boolean,
  payload?: object,
  error?: { code: number, message: string }
}
```

**EventFrame** (gateway -> client, broadcast):
```typescript
{
  type: "event",
  event: string,   // Event name (e.g., "chat.message", "tick")
  seq?: number,    // Sequence for gap detection
  payload?: object
}
```

### Session Key Anatomy

Session keys identify conversation contexts:

- **Main session**: `agent:<agentId>` or just `main`
- **Group session**: `agent:<agentId>:group:<groupId>`
- **Channel session**: `agent:<agentId>:<channel>:<chatType>:<targetId>`
- **Thread session**: `agent:<agentId>:<channel>:thread:<parentId>:<threadId>`

Examples:
```
agent:pi                           # Main session for agent "pi"
agent:pi:telegram:group:123456     # Telegram group chat
agent:pi:discord:channel:789       # Discord channel
agent:pi:whatsapp:direct:+1234     # WhatsApp DM
```

### Channel Capabilities

Each channel declares its capabilities:

```typescript
type ChannelCapabilities = {
  chatTypes: ("direct" | "group" | "channel" | "thread")[];
  nativeCommands?: boolean;    // Supports /commands
  blockStreaming?: boolean;    // Cannot stream responses
  polls?: boolean;             // Supports polls
  reactions?: boolean;         // Supports emoji reactions
  media?: boolean;             // Supports media attachments
  threads?: boolean;           // Supports threaded replies
};
```

### Authentication Flow

1. **Device Identity**: Ed25519 keypair stored locally
2. **Nonce Challenge**: Gateway sends nonce, client signs with private key
3. **Token Exchange**: Successful auth returns device token for future connections
4. **Token Rotation**: Tokens can be rotated for security

### Gateway Modes

- **local**: Gateway runs on same machine, binds to loopback
- **remote**: Gateway on different machine, requires auth token
- **tailnet**: Gateway accessible via Tailscale network

## Key Files

### Gateway Core
- `src/gateway/client.ts` - WebSocket client implementation
- `src/gateway/server.ts` - WebSocket server implementation
- `src/gateway/protocol/` - Protocol schemas and validators
- `src/gateway/call.ts` - RPC client utilities
- `src/gateway/device-auth.ts` - Device authentication

### Session Management
- `src/gateway/session-utils.ts` - Session listing, resolution, persistence
- `src/config/sessions.ts` - Session store configuration
- `src/routing/session-key.ts` - Session key parsing and normalization

### Channels
- `src/channels/dock.ts` - Channel metadata and capabilities
- `src/channels/registry.ts` - Channel registration
- `src/channels/plugins/` - Channel-specific implementations
- `extensions/` - Extension channels (MS Teams, Matrix, etc.)

## Common Patterns

### Handling WebSocket Reconnection

```typescript
// Backoff pattern for reconnection
private scheduleReconnect() {
  if (this.closed) return;
  const delay = this.backoffMs;
  this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
  setTimeout(() => this.start(), delay);
}
```

### Sequence Gap Detection

```typescript
// Detect missed events
if (this.lastSeq !== null && seq > this.lastSeq + 1) {
  this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
}
this.lastSeq = seq;
```

### Session Key Resolution

```typescript
// Resolve session key with agent prefix
export function resolveSessionStoreKey(params: {
  cfg: GimliConfig;
  sessionKey: string;
}): string {
  const raw = params.sessionKey.trim();
  if (raw === "global" || raw === "unknown") return raw;

  const parsed = parseAgentSessionKey(raw);
  if (parsed) {
    return canonicalizeMainSessionAlias({ cfg, agentId, sessionKey: raw });
  }

  const agentId = resolveDefaultStoreAgentId(params.cfg);
  return `agent:${agentId}:${raw}`;
}
```

### Channel Dock Pattern

```typescript
// Lightweight channel metadata
const dock: ChannelDock = {
  id: "telegram",
  capabilities: {
    chatTypes: ["direct", "group", "channel", "thread"],
    nativeCommands: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 4000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      resolveTelegramAccount({ cfg, accountId }).config.allowFrom,
  },
  groups: {
    resolveRequireMention: resolveTelegramGroupRequireMention,
  },
};
```

## Debugging Tips

### Connection Issues

1. Check gateway is running: `gimli gateway status`
2. Verify port binding: `ss -ltnp | grep 18789`
3. Check TLS fingerprint if using wss://
4. Review device auth: `~/.gimli/device-auth/`

### Session Issues

1. List sessions: `gimli sessions list`
2. Check session store: `~/.gimli/sessions/`
3. Verify session key format matches expected pattern
4. Check transcript file exists for session

### Channel Issues

1. Check channel status: `gimli channels status --probe`
2. Verify channel config: `gimli config get channels.<channel>`
3. Test allowlist: ensure sender is in `allowFrom`
4. Check mention gating for group messages

## RPC Methods Reference

### Connection
- `connect` - Establish authenticated connection

### Chat
- `chat.send` - Send message to agent
- `chat.abort` - Abort running agent
- `chat.history` - Get conversation history
- `chat.inject` - Inject system message

### Sessions
- `sessions.list` - List all sessions
- `sessions.preview` - Get session preview
- `sessions.resolve` - Resolve session key
- `sessions.patch` - Update session metadata
- `sessions.reset` - Clear session history
- `sessions.delete` - Delete session
- `sessions.compact` - Compact session transcript

### Channels
- `channels.status` - Get channel connection status
- `channels.logout` - Disconnect channel

### Config
- `config.get` - Get configuration value
- `config.set` - Set configuration value
- `config.patch` - Patch configuration
- `config.schema` - Get config schema

### Agents
- `agents.list` - List configured agents
- `agent.identity` - Get agent identity
- `agent.wait` - Wait for agent completion

## Expertise YAML Files

This expert's knowledge is stored in structured YAML files:

- `expertise/protocol.yaml` - Protocol frame types and validation
- `expertise/sessions.yaml` - Session management patterns
- `expertise/channels.yaml` - Channel integration patterns
- `expertise/authentication.yaml` - Device auth and token flows
- `expertise/troubleshooting.yaml` - Common issues and solutions

Load specific expertise files when working on related code.

## CLI Commands

```bash
# Gateway operations
gimli gateway run --port 18789 --verbose
gimli gateway status
gimli gateway wake --text "Hello"

# Session management
gimli sessions list
gimli sessions preview <key>
gimli sessions reset <key>

# Channel status
gimli channels status
gimli channels status --probe --channel telegram

# Configuration
gimli config get gateway
gimli config set gateway.mode local

# Debugging
gimli doctor
gimli logs --tail
```

## Integration Points

### With Memory System
Sessions can store learning data for personalization.

### With Cron System
Scheduled messages route through gateway to channels.

### With Tool System
Agent tools can access gateway for message sending, session management.

### With Plugins
Extension channels register through plugin system, get dock metadata.

## Security Considerations

- Gateway binds to loopback by default (127.0.0.1)
- Device pairing requires approval for new devices
- Session sandboxing isolates non-main sessions
- Credentials stored in `~/.gimli/credentials/` with proper permissions
- Token rotation recommended for long-lived connections
