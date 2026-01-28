# Gimli Code Walkthrough

> Step-by-step guide through the codebase. Follow this to understand how Gimli
> boots, processes messages, loads plugins, and executes tools.

## 1. Entry Point & Initialization

### `gimli.mjs` — The Starting Line

```
gimli.mjs
  → enables Node.js compile cache
  → imports dist/entry.js
```

The compile cache (`module.enableCompileCache()`) speeds up repeated startups by
caching compiled JavaScript. Wrapped in try/catch because it's a newer Node API.

### `src/entry.ts` — Bootstrap

```
src/entry.ts
  → sets process.title = "gimli"
  → filters noisy Node warnings
  → respawns with --disable-warning=ExperimentalWarning if needed
  → normalizes Windows argv
  → loads CLI profile (parseCliProfileArgs + applyCliProfileEnv)
  → imports and runs src/cli/run-main.ts
```

Key detail: The process may respawn itself to suppress experimental warnings.
This is why you might see two `gimli` processes briefly.

### `src/cli/run-main.ts` — CLI Setup

```
src/cli/run-main.ts
  → loadDotEnv() from ~/.gimli/.env or ~/.gimli/.env
  → normalize environment variables
  → add gimli to PATH
  → assert Node >= 22
  → try early CLI routing (for fast commands)
  → enable console capture (structured logging)
  → buildProgram() → creates Commander.js instance
  → install unhandled rejection handlers
  → register primary subcommand (lazy loaded)
  → register plugin CLI commands
  → program.parseAsync(process.argv)
```

The "early routing" step allows some commands (like `--version`) to respond
instantly without loading the full application.

## 2. Request/Response Lifecycle

### Incoming Message (e.g., WhatsApp)

```
1. Baileys SDK (WhatsApp Web) receives raw message
   → src/web/inbound/ processes raw message

2. Channel adapter normalizes to MessageEvent
   {
     channelId: "whatsapp",
     senderId: "+1234567890",
     messageId: "unique-id",
     text: "Search for nearby restaurants",
     media: null,
     timestamp: Date.now()
   }

3. DM Policy Check
   → Is sender in allowlist? → Proceed
   → Is sender unknown + policy is "pairing"? → Send pairing code
   → Is policy "closed"? → Reject

4. Gateway routes MessageEvent to Agent Runtime
   → src/gateway/server-methods/ handles the dispatch

5. Agent Runtime processes
   → Pi Agent evaluates message with configured AI model
   → Model decides: reply directly or use a tool?

6. If tool use requested:
   → Check execution approval (deny/allow/full)
   → If sandbox enabled: create Docker container
   → Execute tool (bash command, browser action, file operation)
   → Capture stdout/stderr/result
   → Feed result back to model for response formatting

7. Agent produces response text
   → May include formatted markdown, media, or structured data

8. Gateway routes response back to WhatsApp channel
   → Channel adapter converts to platform-specific format
   → Baileys SDK sends the reply
```

### Tool Execution Detail

```
Agent decides to run: "curl https://api.yelp.com/nearby?lat=40.7&lng=-74"

→ src/agents/bash-tools.ts receives the command
→ Approval check:
  - Is "curl" on deny list? No → continue
  - Is "curl" on allow list? Yes → execute without asking
  - If neither: prompt user for approval

→ If sandbox mode (non-main session):
  - Spawn Docker container (gimli:local image)
  - Mount workspace at /workspace (read-only or read-write)
  - Execute command inside container
  - Capture output
  - Destroy container

→ If host mode (main session):
  - Execute directly via child_process
  - Capture stdout + stderr
  - Return to agent
```

## 3. How Commands Are Parsed & Executed

### Commander.js Program (`src/cli/program.ts`)

```typescript
// Simplified structure
const program = new Command("gimli")
  .description("Your personal AI assistant")
  .version(VERSION);

// Subcommands registered:
program.command("gateway")     // Start WebSocket server
program.command("agent")       // Run agent directly
program.command("tui")         // Terminal UI
program.command("login")       // OAuth setup
program.command("doctor")      // Health check
program.command("security")    // Security tools
program.command("config")      // Configuration management
// ... more subcommands
```

Each command is a **lazy-loaded module** — the code for `gimli gateway` isn't
loaded until you actually run that command. This keeps startup fast.

### Plugin Commands

Plugins can register their own CLI commands:
```typescript
registerPluginCliCommands(program, plugins);
// After this, you can run: gimli discord login, gimli telegram setup, etc.
```

## 4. Plugin Loading & Invocation

### Discovery Phase

```
src/plugins/discovery.ts

1. Scan extensions/ directory
   → Each subdirectory with package.json + gimli.extensions
   → Also checks for legacy gimli.plugin.json

2. Scan workspace plugins (from agent workspaceDir config)
   → Looks for package.json with gimli extensions field

3. Scan npm packages
   → Checks node_modules for packages declaring gimli extensions

→ Returns: PluginManifest[] (id, path, extensions list)
```

### Loading Phase

```
src/plugins/loader.ts

For each discovered plugin:
1. Create jiti instance (TypeScript transpiler)
   → Resolves "gimli/plugin-sdk" alias to src/plugin-sdk/
   → Handles ESM/CJS interop

2. Import the extension module
   → e.g., extensions/discord/index.ts

3. Create plugin runtime (createPluginRuntime)
   → Sandboxed environment with controlled API access

4. Validate plugin config against JSON schema
   → Plugin declares its config schema
   → Merged into main config validation

5. Register in global plugin registry
   → setActivePluginRegistry(registry)
   → Now available for gateway, CLI, hooks
```

### Invocation

Plugins are invoked through several mechanisms:
- **Channel events**: Incoming messages routed to matching channel plugin
- **CLI commands**: Plugin-registered Commander subcommands
- **Gateway RPC**: Plugin-exposed methods callable via WebSocket
- **Hooks**: Lifecycle events (message received, command executed, etc.)
- **Cron**: Scheduled tasks defined by plugins

## 5. Error Handling Patterns

### Structured Errors

```typescript
// Most errors are wrapped in a standard format:
class GimliError extends Error {
  code: string;        // e.g., "GATEWAY_AUTH_FAILED"
  details?: unknown;   // Additional context
  recoverable: boolean; // Can the operation be retried?
}
```

### Recovery Strategies

1. **Retry with backoff**: Network failures, rate limits
   - Used in channel connections, API calls
   - Exponential backoff with jitter

2. **Fallback model**: If primary AI model fails, try fallback
   - Configured in `agents.*.models.fallback`

3. **Graceful degradation**: If a plugin fails to load
   - Log warning, continue without that plugin
   - Other channels still function

4. **Circuit breaker**: Repeated failures to a service
   - Stop trying temporarily
   - Resume after cooldown period

### Unhandled Errors

```
src/cli/run-main.ts installs:
- process.on("unhandledRejection", handler)
  → Logs the error, attempts graceful shutdown
  → Does NOT crash — keeps running

This is important for a long-running service.
```

## 6. Logging & Observability

### Structured Logging (`src/logging/`)

Uses `tslog` for structured JSON logging:

```json
{
  "timestamp": "2026-01-28T12:00:00Z",
  "level": "info",
  "module": "gateway",
  "message": "Client connected",
  "data": {
    "clientId": "abc123",
    "channel": "discord"
  }
}
```

### Console Capture

`src/logging.ts` hooks into `console.log/warn/error` to route all output
through the structured logger. This ensures even third-party libraries
produce structured log output.

### Diagnostics Extension

The `diagnostics-otel` extension provides OpenTelemetry integration:
- Distributed tracing (spans for each message lifecycle)
- Metrics (message count, latency, error rate)
- Exportable to Grafana, Datadog, etc.

### Hook-Based Logging

The `command-logger` bundled hook logs all executed commands:
- What was run
- Who requested it
- What the result was
- Stored in session memory for audit

## 7. Configuration System Deep Dive

### Config File Format (JSON5)

```json5
// ~/.gimli/gimli.json
{
  // Gateway settings
  gateway: {
    port: 18789,
    mode: "local",  // "local" or "remote"
  },

  // Agent configuration
  agents: {
    default: {
      models: {
        primary: "claude-sonnet-4-20250514",
        fallback: "gpt-4o"
      },
      sandbox: {
        enabled: false,
        docker: { image: "gimli:local" }
      }
    }
  },

  // Channel-specific settings
  channels: {
    discord: {
      dm: { policy: "pairing" }
    }
  }
}
```

### Validation Pipeline

```
1. Read JSON5 file → parse to object
2. Apply environment variable overrides
3. Apply CLI argument overrides
4. Merge plugin config schemas
5. Validate entire config with Zod
6. Type-safe config object returned
```

### Session Storage

Agent sessions are stored in `~/.gimli/sessions/`:
- One file per conversation
- Contains message history, tool approvals, memory context
- Used for persistent memory across restarts

## 8. Key Source Files Reference

| Purpose | File |
|---------|------|
| Main entry | `gimli.mjs` → `src/entry.ts` |
| CLI runner | `src/cli/run-main.ts` |
| Command registry | `src/cli/program.ts` |
| Gateway server | `src/gateway/server.impl.ts` |
| Config loading | `src/config/io.ts` |
| Config paths | `src/config/paths.ts` |
| Config schema | `src/config/zod-schema.ts` |
| Plugin discovery | `src/plugins/discovery.ts` |
| Plugin loader | `src/plugins/loader.ts` |
| Plugin SDK | `src/plugin-sdk/index.ts` |
| Agent runner | `src/agents/pi-embedded-runner/run.ts` |
| Bash tools | `src/agents/bash-tools.ts` |
| Sandbox config | `src/agents/sandbox/config.ts` |
| Security audit | `src/security/audit.ts` |
| Exec approvals | `src/infra/exec-approvals.ts` |
| Env loading | `src/infra/dotenv.ts` |
| Version | `src/version.ts` |
| Test setup | `test/setup.ts` |
