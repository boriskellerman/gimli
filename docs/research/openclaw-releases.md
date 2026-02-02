# OpenClaw Latest Release Notes and Changelog Research

## Summary

OpenClaw (formerly Clawdbot, briefly Moltbot) is a personal AI assistant platform. This document summarizes the latest releases from January 2026.

---

## Latest Release: v2026.1.31

### Changes
- **Documentation**: Updates for onboarding, installation, i18n, exec approvals, Control UI, and exe.dev
- **Telegram**: Shared pairing store implementation
- **Agents**: OpenRouter app attribution headers and system prompt safety guardrails
- **SDK**: Pi-ai SDK updated to 0.50.9; `cacheControlTtl` renamed to `cacheRetention`
- **Discord**: Thread parent bindings inheritance for routing
- **Gateway**: TLS 1.3 minimum requirement for TLS listeners

### Fixes
- Auto-reply: Removed workspace file references in /new greeting
- Process: Windows spawn() failures resolved for npm CLIs via `.cmd` appending
- Discord: PluralKit proxied sender resolution for allowlists and labels
- Agents: OpenRouter attribution in embedded runner; context window compaction safeguards
- System prompt: session_status hints for current date/time
- **Security hardening**: Arbitrary exec prevention, LD*/DYLD* env overrides blocked, Twitch allowFrom enforcement

---

## v2026.1.30 (Jan 31, 2026)

### Key Features
- **CLI Completion**: Native autocompletion for Zsh, Bash, PowerShell, and Fish with auto-setup during onboarding/postinstall
- **Per-agent Models Status**: `--agent` filtering for `models status` command
- **New Models**: Kimi K2.5 added to synthetic model catalog; Kimi Coding switched to built-in provider
- **MiniMax OAuth**: New plugin with onboarding option for simplified authentication
- **Gateway**: Timestamp injection into agent and chat.send messages
- **Build System**: Migrated to `tsdown` + `tsgo` for faster TypeScript compilation (CI typechecks)
- **Web UI**: Session refresh after chat commands; improved session display names

### Fixes
- **Security (LFI prevention)**: Restricted local path extraction in media parser
- Control UI: Asset resolution for npm global installs
- macOS: stderr pipe backpressure fix in gateway discovery
- Telegram: Token lookup normalization; HTML nesting for overlapping styles
- OAuth: Expired-token warnings skipped when refresh tokens valid

---

## v2026.1.29 (Jan 30, 2026) - Major Rebranding Release

### Breaking Changes
- **Gateway auth mode 'none' removed**: Gateway now requires token/password authentication (Tailscale Serve identity permitted)

### Major Changes
- **Package Rebranding**: npm package/CLI renamed to `openclaw`; compatibility shim added for migration
- **Extensions**: Moved to `@openclaw/*` scope
- **Browser Control**: Routed via gateway/node; standalone browser control command removed
- **Config**: Auto-migration of legacy state/config paths; consistent config resolution across legacy filenames

### Telegram Enhancements
- Sticker support
- Quote replies
- Silent send flag
- Message editing
- DM topics as separate sessions
- Link preview toggle

### Discord Improvements
- Configurable privileged gateway intents

### Other Changes
- Matrix switched to @vector-im/matrix-bot-sdk
- Tools: Per-sender group tool policies
- Memory Search: Extra paths for indexing (symlinks ignored)
- CLI: Node module compile cache for faster startup
- Onboarding security warnings strengthened
- Gateway: Dangerous Control UI device auth bypass flag with audit warnings

### Fixes
- Skills: Session-logs paths updated to ~/.openclaw
- Mentions: mentionPatterns honored with explicit mentions present
- Agents: Oversized image error handling; provider baseUrl/api inheritance
- TTS: OPENAI_TTS_BASE_URL read at runtime
- macOS: Auto-scroll to message bottom; OpenClaw app rename completion
- Web UI: Auto-expanding compose textarea

---

## v2026.1.24 (Jan 25, 2026)

### Highlights
- **LINE Plugin**: Messaging API support with rich replies and quick replies
- **TTS**: Edge fallback + `/tts` auto modes
- **Exec Approvals**: `/approve` command available across all channels
- **Telegram**: DM topics as separate sessions
- **Ollama**: Discovery and documentation improvements
- **Control UI**: Design refresh

---

## v2026.1.23 (Jan 24, 2026)

### Major Additions
- **Core TTS**: Model-driven tags for expressive audio
- **HTTP Endpoint**: `/tools/invoke` for direct tool calls
- **Heartbeat**: Per-channel visibility controls
- **Deployment**: Fly.io support
- **New Channel**: Tlon/Urbit channel plugin

---

## v2026.1.22 & v2026.1.21 (Jan 22-23, 2026)

- Compaction safeguard improvements with adaptive chunking
- Custom assistant identity + avatars in Control UI
- Lobster plugin tool for typed workflows + approval gates
- Exec approvals with elevated ask/full modes

---

## macOS-Specific Notes

- Uses Sparkle auto-updates as primary distribution mechanism
- Releases are Developer ID-signed, zipped, and published with signed appcast entry
- Supports both ARM64 and x86_64 architectures (universal binaries available)
- Apple notarization for Gatekeeper compatibility via `xcrun notarytool`

---

## Project History

OpenClaw was developed by software engineer Peter Steinberger and released in late 2025 under the name "Clawdbot". Within two months of release, the project's GitHub repository surpassed 100,000 stars. Shortly after its rise in popularity, the project was renamed "Moltbot" following a trademark request from Anthropic, and later settled on "OpenClaw" as the final name.

---

## Sources

- [GitHub Releases](https://github.com/openclaw/openclaw/releases)
- [CHANGELOG.md](https://github.com/openclaw/openclaw/blob/main/CHANGELOG.md)
- [Hacker News Discussion](https://news.ycombinator.com/item?id=46839928)
- [OpenClaw Official Site](https://openclaw.ai/)
- [npm Package](https://www.npmjs.com/package/openclaw)
- [macOS Release Documentation](https://docs.openclaw.ai/platforms/mac/release)

---

*Research completed: February 1, 2026*
