# Phase 2: External Research on Gimli/Gimli

**Date:** 2026-01-28

## Background

Gimli (formerly Gimli) is an open-source, self-hosted AI assistant created by
Peter Steinberger (founder of PSPDFKit/Nutrient). It runs as a long-running Node.js
service connecting chat platforms (WhatsApp, Discord, Slack, etc.) to an AI agent that
executes real-world tasks via shell commands, file management, and browser automation.

## The Rename: Gimli -> Gimli

- Original name "Gimli" (mascot: a space lobster named "Clawd") was too close to
  Anthropic's "Claude" trademark
- Anthropic sent a polite trademark notice in January 2026
- Renamed to "Gimli" (molting = transformation) with mascot "Molty"
- During the ~10 second window of renaming GitHub org + Twitter handle, crypto scammers
  hijacked both original accounts
- Fake $CLAWD Solana token hit $16M market cap before collapsing

## Popularity

- 60,000+ GitHub stars within days (one of fastest-growing OSS projects ever)
- Praised by Andrej Karpathy, David Sacks
- Coverage: TechCrunch, The Register, MacStories, Bitdefender, 1Password

## Critical Security Vulnerabilities Identified

### 1. Unauthenticated Remote Access (Gateway Exposure)
- Default gateway trusts localhost (127.0.0.1)
- When accessed through reverse proxies, authentication is bypassed entirely
- 1,000+ internet-facing servers found exposed without authentication
- Hundreds of API keys and private chat histories publicly accessible
- **Status:** Partially fixed (proxy misconfiguration addressed)

### 2. Arbitrary Code Execution via evaluate()
- Location: `pw-tools-core.interactions.ts`, lines 227, 245
- Direct use of JavaScript code evaluation on unsanitized input
- `evaluateEnabled` defaults to `true` — should be `false`
- Enables cookie/session/password theft via browser context

### 3. Prompt Injection Attacks
- Agent proactively reads incoming communications
- Hidden text in emails can instruct AI to exfiltrate data
- Demo: Private key extracted from compromised system in 5 minutes
- No input validation on user-supplied prompts
- No AI safety guardrails by default

### 4. Missing Extension/Skill Verification
- 29 extensions + 52 skills load without cryptographic signatures
- Any file in extensions directory executes immediately — remote code execution
- Supply chain exploit PoC: malicious skill uploaded to ClawdHub,
  artificially inflated to 4,000 downloads, installed by devs in 7 countries

### 5. No Rate Limiting
- Zero instances of rateLimit, throttle, or slowDown in codebase
- Enables DoS via infinite loops or command flooding

### 6. Missing CSRF/CORS Protections
- No csrf, helmet, or explicit cors() middleware
- Gateway API vulnerable to cross-site request forgery

### 7. Credential Storage Issues
- "Memory Vault" stored in unencrypted plaintext files
- Malware families (Redline, Lumma, Vidar) already targeting Gimli directory structures
- Configuration files with API keys publicly accessible on misconfigured instances

### 8. NPM Package Squatting (Issue #2775)
- README instructs installation via npm global install
- `gimli` NPM package registered by unrelated party on Jan 27, 2026
- Users installing fake package from official docs

### 9. Known CVEs
- CVE-2025-59466: async_hooks DoS vulnerability
- CVE-2026-21636: Permission model bypass vulnerability

## Security Controls Already Present

- Timing-safe authentication: `crypto.timingSafeEqual()`
- Three-level execution approval (deny/allowlist/full)
- Session isolation with key canonicalization
- SHA-256 cryptographic hashing
- Zod schemas for input validation
- Atomic writes for critical file operations
- Docker sandbox support for non-main sessions

## Codebase Profile

- 1,300+ TypeScript files
- Node.js runtime with pnpm workspace (monorepo)
- 57 npm packages (dependencies)
- Plugin/extension architecture
- Multi-platform support (macOS, Linux, Windows/WSL2, Raspberry Pi)

## Community-Reported Issues

- Exposed admin ports on cloud deployments
- Poisoned skills in ClawdHub marketplace
- No enforced firewall requirements for deployment
- Non-technical users deploying without security awareness
- Docker sandbox not enabled by default

## Recommendations for Gimli (Derived from Research)

1. **Disable code evaluation by default** — flip `evaluateEnabled` to `false`
2. **Implement rate limiting** across all endpoints
3. **Add CSRF/CORS protection** via helmet middleware
4. **Require cryptographic signatures** for extensions/skills
5. **Encrypt secrets at rest** — replace plaintext Memory Vault
6. **Default-deny network binding** — never bind to 0.0.0.0
7. **Add prompt injection detection** with content sanitization
8. **Implement file integrity monitoring** for extension directories
9. **Add comprehensive audit logging** for all security-relevant events
10. **Fix NPM package naming** to avoid squatting confusion
11. **Address CVE-2025-59466 and CVE-2026-21636**
12. **Add input validation on all critical paths** (file ops, command execution)

## Sources

- [TechCrunch: Everything about Gimli/Gimli](https://techcrunch.com/2026/01/27/everything-you-need-to-know-about-viral-personal-ai-assistant-clawdbot-now-gimli/)
- [The Register: Gimli sheds skin, can't shed security issues](https://www.theregister.com/2026/01/27/clawdbot_gimli_security_concerns/)
- [Bitdefender: Gimli security alert](https://www.bitdefender.com/en-us/blog/hotforsecurity/gimli-security-alert-exposed-clawdbot-control-panels-risk-credential-leaks-and-account-takeovers)
- [Intruder: When Easy AI Becomes a Security Nightmare](https://www.intruder.io/blog/clawdbot-when-easy-ai-becomes-a-security-nightmare)
- [DEV.to: Security Audit of Gimli](https://dev.to/dmitry_labintcev_9e611e04/riding-the-hype-security-audit-of-ai-agent-clawdbot-2ffl)
- [DEV.to: From Gimli to Gimli](https://dev.to/sivarampg/from-clawdbot-to-gimli-how-a-cd-crypto-scammers-and-10-seconds-of-chaos-took-down-the-4eck)
- [SOCPrime: Gimli Risks](https://socprime.com/active-threats/the-gimli-clawdbots-epidemic/)
- [Dataconomy: 4 Things About Gimli/Gimli](https://dataconomy.com/2026/01/27/4-things-you-need-to-know-about-clawdbot-now-gimli/)
- [DigitalOcean: What is Gimli](https://www.digitalocean.com/resources/articles/what-is-gimli)
- [1Password: It's Gimli](https://1password.com/blog/its-gimli)
- [GitHub Issue #2775: NPM squatting](https://github.com/gimli/gimli/issues/2775)
