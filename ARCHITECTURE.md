# Gimli Architecture

> A guide for junior developers joining the project. This document explains how Gimli
> is built, why it's built that way, and how the pieces fit together.

## High-Level Overview

Gimli is a **personal AI assistant** that connects to messaging platforms (WhatsApp,
Discord, Telegram, Slack, etc.) and uses AI models to execute real-world tasks on your
behalf — shell commands, file management, browser automation, and more.

```
                        +-----------------------+
                        |    Messaging Platforms |
                        | (WhatsApp, Discord,   |
                        |  Telegram, Slack, ...) |
                        +-----------+-----------+
                                    |
                            WebSocket / HTTP
                                    |
                        +-----------v-----------+
                        |       GATEWAY          |
                        |  (WebSocket Server)    |
                        |  Port 18789            |
                        +-----------+-----------+
                                    |
                   +----------------+----------------+
                   |                |                 |
           +-------v------+ +------v------+ +--------v-------+
           | Channel       | | Agent       | | Plugin         |
           | Registry      | | Runtime     | | System         |
           | (30+ adapters)| | (Pi Agent)  | | (Extensions)   |
           +--------------+ +------+------+ +----------------+
                                   |
                          +--------v--------+
                          |   Tool System    |
                          | (Bash, Browser,  |
                          |  Canvas, Files)  |
                          +--------+--------+
                                   |
                          +--------v--------+
                          |   Sandbox        |
                          | (Docker / Host)  |
                          +-----------------+
```

## Tech Stack

| Layer        | Technology                          |
|-------------|--------------------------------------|
| Runtime     | Node.js 22+ (ESM modules)            |
| Language    | TypeScript 5.9 (strict mode)         |
| Package Mgr | pnpm (workspace monorepo)           |
| Web Server  | Hono + Express (HTTP), ws (WebSocket)|
| CLI         | Commander.js + @clack/prompts        |
| AI Runtime  | Pi Agent (embedded)                  |
| Testing     | Vitest + Playwright                  |
| Validation  | Zod schemas                          |
| Logging     | tslog (structured JSON)              |
| Build       | TypeScript compiler + Rolldown       |
| Formatting  | oxfmt                                |
| Linting     | oxlint                               |
| UI          | Vite + Lit (web components)          |

## Monorepo Structure

```
gimli/
├── src/               # Core TypeScript source
├── dist/              # Compiled JavaScript
├── packages/
│   └── gimli/     # Legacy npm compatibility shim
├── extensions/        # 30+ messaging platform plugins
├── ui/                # Control dashboard (Vite + Lit)
├── apps/
│   ├── macos/        # macOS menu bar app (Swift)
│   ├── ios/          # iOS companion (Swift)
│   └── android/      # Android companion (Kotlin)
├── docs/             # Mintlify documentation site
├── scripts/          # Build, test, deployment scripts
├── patches/          # pnpm patches for dependencies
├── vendor/           # Vendored A2UI spec
└── test/             # Shared test utilities
```

## Component Breakdown

### 1. Entry Point & CLI (`src/entry.ts`, `src/cli/`)

The application starts at `gimli.mjs`, which:
1. Enables Node.js compile cache for performance
2. Imports `dist/entry.js` (compiled from `src/entry.ts`)
3. Entry sets process title, suppresses warnings, loads env
4. Hands off to `src/cli/run-main.ts`

The CLI uses Commander.js to expose subcommands:
- `gimli` (default) — interactive agent mode
- `gimli gateway` — start the WebSocket gateway
- `gimli agent` — run agent in RPC mode
- `gimli tui` — terminal UI mode
- `gimli login` — OAuth setup
- `gimli doctor` — health check & migration
- `gimli security audit` — security review

### 2. Gateway (`src/gateway/`)

The **central nervous system** of Gimli. A WebSocket server on port 18789 that:
- Manages all channel connections
- Routes messages between platforms and the AI agent
- Exposes an RPC API for control operations
- Serves the web control UI
- Handles authentication (token + password)

**Trust model:** The gateway trusts connections from localhost (127.0.0.1). Remote
access requires explicit token authentication. This is a known attack surface when
users expose the gateway via reverse proxies.

### 3. Channels (`src/channels/`, `extensions/`)

Each messaging platform is a **channel plugin** implementing a standard interface:
- `id` — unique identifier
- `meta` — display name, icon, capabilities
- `outbound` — send messages to the platform
- `auth` — platform-specific authentication
- `status` — connection health monitoring

Core channels (in `src/`): WhatsApp, Telegram, Discord, Slack, Signal, iMessage, LINE
Extension channels (in `extensions/`): Matrix, Mattermost, MS Teams, Nostr, Google Chat,
Nextcloud Talk, BlueBubbles, Tlon, Twitch, Zalo, and more.

### 4. Agent Runtime (`src/agents/`)

The AI "brain" of Gimli, powered by the Pi Agent framework:
- **Pi Embedded Runner**: Manages AI model interactions
- **Tool System**: Provides capabilities (bash, browser, canvas, file ops)
- **Auth Profiles**: Rotates OAuth tokens and API keys across providers
- **Sandbox**: Docker-based isolated execution environments

The agent processes messages through an approval system:
- **Deny list**: Blocked operations (never execute)
- **Allow list**: Pre-approved operations (execute without asking)
- **Full access**: User-approved elevated permissions

### 5. Plugin System (`src/plugins/`)

Extensions are discovered and loaded dynamically:
1. **Discovery** (`discovery.ts`): Scans `extensions/` dir, workspace, and npm packages
2. **Loading** (`loader.ts`): Uses `jiti` to transpile TypeScript on-the-fly
3. **Runtime**: Each plugin gets isolated runtime with access to the Plugin SDK
4. **Registration**: Plugins register CLI commands, gateway methods, and hooks

Plugin manifest: `package.json` with `"gimli": { "extensions": ["./index.ts"] }`
Legacy manifest: `gimli.plugin.json` (still found in many extensions)

### 6. Configuration (`src/config/`)

**Config file**: `~/.gimli/gimli.json` (JSON5 format, supports comments)
Legacy path: `~/.gimli/gimli.json`

```
Config Loading Order:
1. Process CWD .env file
2. ~/.gimli/.env or ~/.gimli/.env (global)
3. Environment variables (GIMLI_* / GIMLI_*)
4. Config file (JSON5)
5. CLI arguments (highest priority)
```

Validated with Zod schemas. Plugin configs are merged into the main schema.

### 7. Security (`src/security/`, `src/agents/sandbox/`)

Layers of security:
- **Authentication**: Gateway token, OAuth, API keys
- **DM Policy**: pairing (default), open, closed
- **Execution Approvals**: Three-level tool access control
- **Sandboxing**: Docker containers for untrusted code
- **Security Audit**: `gimli security audit` command

### 8. Media Pipeline (`src/media/`, `src/media-understanding/`)

Handles image, audio, video, and document processing:
- Image processing via `sharp`
- PDF parsing via `pdfjs-dist`
- Article extraction via `@mozilla/readability`
- Text-to-speech via ElevenLabs

### 9. Hooks (`src/hooks/`)

Lifecycle events that plugins and core can subscribe to:
- Command logging
- Session memory persistence
- Custom automation triggers

## Data Flow: Message Lifecycle

```
1. User sends message on WhatsApp
       |
2. Baileys SDK receives message
       |
3. Channel adapter normalizes to internal format
       |
4. Gateway routes to agent runtime
       |
5. Agent processes with AI model (Claude, GPT, etc.)
       |
6. Agent decides on actions (reply, execute command, etc.)
       |
7. If tool execution needed:
   a. Check approval level (deny/allow/full)
   b. If sandbox mode: spin up Docker container
   c. Execute tool (bash, browser, file op)
   d. Capture output
       |
8. Agent formats response
       |
9. Gateway routes back to originating channel
       |
10. Channel adapter sends reply to WhatsApp
```

## Security Model & Trust Boundaries

```
+------------------------------------------------------------+
|                    UNTRUSTED ZONE                           |
|  External messages, web content, emails, URLs              |
+-----------------------------+------------------------------+
                              |
                    Input validation
                    Content sanitization
                              |
+-----------------------------v------------------------------+
|                    GATEWAY ZONE                            |
|  Token-authenticated WebSocket server                      |
|  DM policy enforcement (pairing/closed/open)               |
+-----------------------------+------------------------------+
                              |
                    Execution approval check
                              |
+-----------------------------v------------------------------+
|                    AGENT ZONE                              |
|  AI model interaction, tool selection                      |
|  Deny/Allow/Full access levels                             |
+-----------------------------+------------------------------+
                              |
              Sandbox boundary (optional)
                              |
+-----------------------------v------------------------------+
|                    EXECUTION ZONE                          |
|  Docker sandbox OR host execution                          |
|  Bash, browser, file operations                            |
+------------------------------------------------------------+
```

**Known weaknesses (from security research):**
- Gateway localhost trust bypassed by reverse proxies
- No rate limiting on any endpoints
- No CSRF/CORS middleware
- Code evaluation enabled by default
- Extensions load without cryptographic verification
- Plaintext credential storage in Memory Vault

## Key Design Decisions

1. **ESM-first**: The project uses ES modules (`"type": "module"`) throughout.
   This means `import`/`export` syntax, no `require()`.

2. **Monorepo with pnpm**: Workspace protocol (`workspace:*`) links packages.
   Extensions are workspace members, enabling shared dependencies.

3. **TypeScript with jiti**: Extensions are written in TypeScript but loaded
   without a build step using `jiti` (just-in-time transpilation).

4. **Gateway-centric**: All communication flows through the gateway. This is
   both a strength (centralized control) and a weakness (single point of failure).

5. **Plugin SDK**: Channel adapters implement a standard interface, making it
   straightforward to add new messaging platform support.

6. **Dual naming**: The codebase supports both `GIMLI_*` and `GIMLI_*`
   environment variables, with the newer name taking precedence. This is a
   transitional state from the Gimli-to-Gimli rebrand.

---

## Agent Navigation Guide

This section provides quick-reference patterns for AI agents working with the codebase.

### File Location Cheat Sheet

| You want to... | Look in... |
|----------------|------------|
| Add a CLI command | `src/commands/<name>.ts`, register in `src/cli/program/register.subclis.ts` |
| Add an agent tool | `src/agents/gimli-tools.<category>.ts` |
| Add a channel plugin | `extensions/<name>/` (new workspace package) |
| Add a configuration option | `src/config/types.*.ts` + `src/config/zod-schema.*.ts` |
| Modify gateway behavior | `src/gateway/server.ts`, `src/gateway/server-*.ts` |
| Change message routing | `src/routing/` |
| Handle media (images/PDF) | `src/media/`, `src/media-understanding/` |
| Add a hook | `src/hooks/types.ts`, register via plugin API |
| Modify terminal output | `src/terminal/` (tables, progress, palette) |
| Add tests | Colocate as `<source>.test.ts` in same directory |

### Core Abstractions Reference

#### 1. Channel Plugin Interface

All messaging platforms implement adapters from `src/channels/plugins/types.ts`:

```typescript
// Minimal channel plugin structure
interface ChannelPlugin {
  id: ChannelId;                    // Unique identifier (e.g., "telegram")
  meta: ChannelMeta;                // Display name, icon, features
  capabilities: ChannelCapabilities; // What the channel can do

  // Required adapters
  outbound?: ChannelOutboundAdapter;     // Send messages out
  auth?: ChannelAuthAdapter;             // Authentication flow
  status?: ChannelStatusAdapter;         // Health checks

  // Optional adapters (10+ available)
  messaging?: ChannelMessagingAdapter;   // Full messaging interface
  security?: ChannelSecurityAdapter;     // Security policies
  pairing?: ChannelPairingAdapter;       // Device pairing
  // ... etc
}
```

Key files:
- `src/channels/plugins/types.ts` — Interface definitions
- `src/channels/registry.ts` — Channel metadata and aliases
- `extensions/*/index.ts` — Example implementations

#### 2. Plugin Registration Pattern

Plugins export a default object with a `register` function:

```typescript
// extensions/<name>/index.ts
import type { GimliPluginApi } from "gimli/plugin-sdk";

const plugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  register(api: GimliPluginApi) {
    // Register channel
    api.registerChannel({ plugin: myChannelPlugin });

    // Register CLI command
    api.registerCommand({
      name: "my-command",
      action: async () => { /* ... */ }
    });

    // Register tool
    api.registerTool({
      name: "my_tool",
      handler: async (ctx) => { /* ... */ }
    });
  }
};

export default plugin;
```

Key files:
- `src/plugin-sdk/index.ts` — Public SDK exports
- `src/plugins/loader.ts` — Plugin loading (jiti transpilation)
- `src/plugins/discovery.ts` — Extension scanning

#### 3. Configuration Schema

Configuration uses Zod schemas for validation:

```typescript
// src/config/zod-schema.<category>.ts
import { z } from "zod";

export const myFeatureSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
  options: z.object({
    timeout: z.number().default(30000),
  }).optional(),
});

// Merge into main config at src/config/zod-schema.ts
```

Key files:
- `src/config/zod-schema.core.ts` — Base types
- `src/config/zod-schema.channels.ts` — Channel configs
- `src/config/zod-schema.agent-runtime.ts` — Agent execution
- `src/config/types.*.ts` — TypeScript type definitions
- `src/config/io.ts` — File I/O for config

#### 4. Tool System

Agent tools accept a context object and return results:

```typescript
// src/agents/gimli-tools.<category>.ts
import { defineTool } from "@anthropic/pi-agent";

export const myTool = defineTool({
  name: "my_tool",
  description: "Does something useful",
  input: z.object({
    param: z.string(),
  }),
  handler: async ({ input, context }) => {
    // context includes: config, workspaceDir, agentDir, sessionKey, etc.
    return { success: true, result: "done" };
  },
});
```

Tool approval levels (defined in `src/infra/exec-approvals.ts`):
- **Deny**: Never execute (blocked tools)
- **Allow**: Pre-approved (execute without asking)
- **Full**: Elevated permissions (user must approve)

Key files:
- `src/agents/gimli-tools.bash.ts` — Shell execution
- `src/agents/gimli-tools.browser.ts` — Playwright automation
- `src/agents/gimli-tools.files.ts` — File operations
- `src/agents/gimli-tools.canvas.ts` — A2UI canvas
- `src/agents/gimli-tools.channels.ts` — Cross-channel messaging

#### 5. Dependency Injection

The codebase uses factory functions for DI:

```typescript
// src/cli/deps.ts
export function createDefaultDeps() {
  return {
    sendMessageWhatsApp,
    sendMessageTelegram,
    sendMessageDiscord,
    sendMessageSlack,
    sendMessageSignal,
    sendMessageIMessage,
  };
}

// Usage in commands
async function myCommand(deps = createDefaultDeps()) {
  await deps.sendMessageTelegram({ ... });
}
```

### Common Modification Scenarios

#### Adding a New CLI Command

1. Create `src/commands/<name>.ts`:
```typescript
import type { Command } from "commander";

export function registerMyCommand(program: Command) {
  program
    .command("my-command")
    .description("Does something")
    .option("-v, --verbose", "Verbose output")
    .action(async (options) => {
      // Implementation
    });
}
```

2. Register in `src/cli/program/register.subclis.ts`:
```typescript
import { registerMyCommand } from "../commands/my-command.js";
// Add to the registration list
```

3. Add test `src/commands/my-command.test.ts`

#### Adding a New Channel Plugin

1. Create extension directory:
```
extensions/mychannel/
├── package.json        # Workspace package
├── index.ts           # Plugin entry
├── send.ts            # Outbound adapter
├── auth.ts            # Authentication
├── status.ts          # Health checks
└── index.test.ts      # Tests
```

2. `package.json` structure:
```json
{
  "name": "@gimli/mychannel",
  "type": "module",
  "gimli": {
    "extensions": ["./index.ts"],
    "channel": {
      "id": "mychannel",
      "label": "My Channel",
      "docsPath": "/channels/mychannel"
    }
  },
  "dependencies": {
    "mychannel-sdk": "^1.0.0"
  },
  "devDependencies": {
    "gimli": "workspace:*"
  }
}
```

3. Implement the plugin interface in `index.ts`

4. Add docs at `docs/channels/mychannel.md`

#### Adding a Configuration Option

1. Define type in `src/config/types.<category>.ts`:
```typescript
export interface MyFeatureConfig {
  enabled: boolean;
  apiKey?: string;
}
```

2. Add Zod schema in `src/config/zod-schema.<category>.ts`:
```typescript
export const myFeatureSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().optional(),
});
```

3. Merge into main schema at `src/config/zod-schema.ts`

4. Load via `loadConfig()` from `src/config/config.ts`

#### Adding an Agent Tool

1. Create or edit `src/agents/gimli-tools.<category>.ts`

2. Define the tool using Pi Agent's `defineTool`:
```typescript
export const myTool = defineTool({
  name: "my_tool",
  description: "...",
  input: z.object({ ... }),
  handler: async ({ input, context }) => { ... },
});
```

3. Export from `src/agents/gimli-tools.ts` (barrel file)

4. Add test in `src/agents/gimli-tools.<category>.test.ts`

### Testing Patterns

#### Unit Test Template
```typescript
// src/feature/thing.test.ts
import { describe, it, expect, vi } from "vitest";
import { myFunction } from "./thing.js";

describe("myFunction", () => {
  it("handles normal case", async () => {
    const result = await myFunction({ input: "test" });
    expect(result).toBe("expected");
  });

  it("handles error case", async () => {
    await expect(myFunction({ input: "bad" }))
      .rejects.toThrow("error message");
  });
});
```

#### Channel Plugin Test
```typescript
// extensions/mychannel/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import plugin from "./index.js";

describe("MyChannel plugin", () => {
  const mockApi = {
    registerChannel: vi.fn(),
    registerCommand: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers channel on startup", () => {
    plugin.register(mockApi as any);
    expect(mockApi.registerChannel).toHaveBeenCalled();
  });
});
```

### Important Patterns to Follow

1. **ESM imports**: Always use `.js` extension in imports, even for TypeScript files
   ```typescript
   import { foo } from "./bar.js";  // Correct
   import { foo } from "./bar";     // Wrong
   ```

2. **Error handling**: Use structured errors from `src/infra/errors.ts`

3. **Terminal output**: Use palette from `src/terminal/palette.ts` (no hardcoded colors)

4. **Progress indicators**: Use `src/cli/progress.ts` (never hand-roll spinners)

5. **Tables**: Use `src/terminal/table.ts` for ANSI-safe tables

6. **Config access**: Always load through `loadConfig()`, never read files directly

7. **Channel operations**: Consider all channels (built-in + extensions) when modifying shared logic

### Multi-Agent Development Notes

When multiple AI agents work on this codebase simultaneously:

- **Do not** create/apply/drop git stash entries
- **Do not** switch branches unless explicitly requested
- **Do not** create/remove git worktrees without permission
- **Do** focus on your specific changes; commit only those
- **Do** preserve unrelated WIP from other agents
- **Do** use absolute file paths (agent sessions may reset cwd)

### Quick Commands Reference

```bash
# Development
pnpm install          # Install dependencies
pnpm build            # Compile TypeScript
pnpm dev              # Run CLI in dev mode
pnpm gimli <cmd>      # Run specific command

# Quality
pnpm lint             # Run oxlint
pnpm format           # Run oxfmt
pnpm test             # Run vitest
pnpm test:coverage    # Coverage report
pnpm test:watch       # Watch mode

# Live testing (requires API keys)
GIMLI_LIVE_TEST=1 pnpm test:live

# Gateway
pnpm gateway:watch    # Watch mode with auto-reload
```

### Directory Quick Reference

```
src/
├── agents/           # AI runtime, tools, sandbox
├── channels/         # Channel registry, plugin types
├── cli/              # CLI entry, program builder
├── commands/         # CLI subcommands
├── config/           # Configuration loading, Zod schemas
├── gateway/          # WebSocket server, RPC handlers
├── hooks/            # Lifecycle events
├── infra/            # Utilities (env, errors, paths)
├── media/            # Image/PDF/video processing
├── plugins/          # Plugin discovery, loading, runtime
├── plugin-sdk/       # Public plugin API
├── routing/          # Message routing
├── terminal/         # Output formatting (tables, progress)
├── web/              # WhatsApp (Baileys) integration
├── telegram/         # Telegram channel
├── discord/          # Discord channel
├── slack/            # Slack channel
├── signal/           # Signal channel
└── imessage/         # iMessage channel

extensions/           # 30+ messaging platform plugins
├── matrix/
├── msteams/
├── mattermost/
├── google-chat/
├── zalo/
└── ... (more)

apps/
├── macos/            # Swift menu bar app
├── ios/              # Swift companion
└── android/          # Kotlin companion

ui/                   # Vite + Lit control dashboard
docs/                 # Mintlify documentation site
scripts/              # Build, test, deployment scripts
test/                 # Shared test utilities
```
