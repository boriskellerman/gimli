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
