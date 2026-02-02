---
name: bug-template
description: Systematic bug investigation and fix workflow for Gimli. Activates on bug reports, error investigations, or /bug commands.
metadata: {"gimli":{"emoji":"🐛"}}
---

# Bug Investigation Template Skill

This skill provides a structured, TAC-compliant workflow for investigating and fixing bugs in Gimli. It ensures consistent, high-quality bug fixes with proper root cause analysis, testing, and documentation.

## When to Activate

Activate this skill when:
- User reports a bug or error
- GitHub Issue is labeled as `bug`
- User asks to investigate an error or crash
- User mentions "fix", "bug", "broken", "doesn't work", "error"
- `/bug` command is invoked

## Commands

### /bug investigate <issue>

Start a new bug investigation:

```
/bug investigate #456
/bug investigate "Gateway crashes on startup"
```

This loads the full bug template and guides you through all phases.

### /bug quick <issue>

Quick investigation for simple bugs:

```
/bug quick "Typo in error message"
```

Skips extensive root cause analysis for obvious fixes.

### /bug status

Show current investigation status:

```
/bug status
```

Lists active investigations and their phase.

## Investigation Phases

The template follows 8 phases:

| Phase | Purpose | Exit Criteria |
|-------|---------|---------------|
| 1. Intake | Gather info, set severity | Severity assigned |
| 2. Reproduce | Verify the bug exists | Minimal reproduction case |
| 3. Root Cause | Find WHY, not just WHAT | Root cause documented with evidence |
| 4. Fix Design | Plan the minimal fix | Security review if needed |
| 5. Implement | Write fix and tests | Code complete |
| 6. Verify | Run tests, manual check | All tests pass |
| 7. Commit | Create PR with changelog | PR ready |
| 8. Post-Fix | Document learnings | Issue closed |

## Core Principles

### 1. Never Guess Root Causes

From CLAUDE.md: "When answering questions, respond with high-confidence answers only: verify in code; do not guess."

The template enforces this by requiring:
- Actual code reading before diagnosis
- Evidence (file path, line number, code snippet)
- Confidence level assessment

### 2. Security First

From CLAUDE.md: "Never weaken existing security configurations"

The template includes explicit security checks:
- Does fix touch auth/permissions?
- Does fix touch credential handling?
- Does fix touch sandboxing?
- Could fix expose data in logs?

### 3. Minimal Changes Only

From CLAUDE.md: "Don't add features, refactor code, or make 'improvements' beyond what was asked."

The template enforces:
- Smallest possible fix
- No bundled refactors
- No unrelated changes

### 4. Test-Driven Verification

Every bug fix must include a test that:
- Fails before the fix
- Passes after the fix
- Documents the edge case

## Template Location

The full template is located at:
```
ralphy/templates/BUG_TEMPLATE.md
```

Load this file when starting a bug investigation.

## Quick Reference

### Debugging Commands

```bash
# Gateway watch mode with raw stream logging
pnpm gateway:watch --force --raw-stream

# Dev profile (isolated state)
GIMLI_PROFILE=dev gimli gateway --dev

# Check system health
gimli doctor

# View recent logs
tail -f ~/.gimli/logs/*.log
```

### Common Bug Locations

| Symptom | Likely Location |
|---------|-----------------|
| Message not delivered | `src/channels/`, `src/routing/` |
| Tool execution failed | `src/tools/`, `src/sandbox/` |
| Config not applied | `src/config/`, `src/cli/` |
| Session issues | `src/sessions/` |
| Media processing | `src/media/` |
| Gateway crash | `src/gateway/`, `src/entry.ts` |

### Testing Commands

```bash
pnpm test                    # Full suite
pnpm test -- path/to/file    # Single file
pnpm test:coverage           # With coverage
```

## Integration with Other Skills

### With Kanban Agent

When bugs come from the Kanban board:

```
/kanban pick --type bug
```

The Kanban agent will invoke this skill automatically for bug-type tasks.

### With Anticipate

Set reminders for bug follow-up:

```
remind me to check if #456 fix landed in next release
```

## Example Usage

### Full Investigation

```
User: Gateway crashes when I have an invalid Discord token

Agent: I'll investigate this bug using the bug template.

[Phase 1: Intake]
- Severity: High (core feature broken)
- Symptom: Gateway exits on startup

[Phase 2: Reproduce]
- Set invalid Discord token
- Run `gimli gateway`
- Confirmed: Gateway crashes with unhandled rejection

[Phase 3: Root Cause]
- Reading src/discord/client.ts...
- Line 45: Discord.login() throws on invalid token
- Root cause: Exception not caught, propagates to top level

[Phase 4: Fix Design]
- Add try/catch around Discord.login()
- Log error and continue (other channels should still work)
- Security check: No auth/credentials touched

[Phase 5-8: Implementation through completion...]
```

### Quick Fix

```
User: There's a typo in the error message for missing config

Agent: Using quick bug fix workflow...

- Found: src/config/loader.ts:89
- Typo: "confguration" -> "configuration"
- Test: Existing tests cover this path
- Fix applied, tests pass

Commit: fix(config): correct typo in missing config error message
```

## TAC Alignment

This skill implements multiple TAC principles:

- **Tactic 3 (Template Engineering)**: Encodes Gimli's bug fix patterns
- **Tactic 5 (Feedback Loops)**: Requires tests before merge
- **Grade 4 (Closed-Loop)**: Request → Validate → Resolve at each phase
- **Grade 5 (Templates)**: Reusable workflow for all bug types

## References

- Full template: `ralphy/templates/BUG_TEMPLATE.md`
- Debugging docs: `docs/debugging.md`
- Testing guide: `docs/testing.md`
- CLAUDE.md guidelines
