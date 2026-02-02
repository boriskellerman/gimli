# Gimli Bug Investigation & Fix Template

> **TAC Grade 5 Template**: This template encodes Gimli's engineering standards for how bugs should be investigated, diagnosed, and fixed. Use this template when working on any bug, whether from GitHub Issues, user reports, or internal discovery.

---

## Template Variables

When using this template, substitute these variables:

| Variable | Description |
|----------|-------------|
| `{{BUG_ID}}` | GitHub Issue number or internal bug ID |
| `{{BUG_TITLE}}` | Short description of the bug |
| `{{REPORTER}}` | Who reported the bug |
| `{{CHANNEL}}` | Where it was reported (GitHub, Telegram, Discord, etc.) |
| `{{SEVERITY}}` | critical / high / medium / low |

---

## Phase 1: Intake & Triage

### 1.1 Gather Initial Information

**Checklist:**
- [ ] Bug ID: `{{BUG_ID}}`
- [ ] Title: `{{BUG_TITLE}}`
- [ ] Reporter: `{{REPORTER}}`
- [ ] Channel: `{{CHANNEL}}`
- [ ] Date reported: ___

**Symptom Description:**
> [Paste the exact error message, unexpected behavior, or user complaint]

**Expected Behavior:**
> [What should have happened instead]

**Reproduction Steps (if provided):**
1. ___
2. ___
3. ___

### 1.2 Initial Severity Assessment

| Severity | Criteria | Response Time |
|----------|----------|---------------|
| **Critical** | Data loss, security vulnerability, service down | Immediate |
| **High** | Core feature broken, no workaround | Same day |
| **Medium** | Feature degraded, workaround exists | Within week |
| **Low** | Cosmetic, edge case, minor annoyance | Backlog |

**Assessed Severity:** `{{SEVERITY}}`

**Justification:**
> [Why this severity level was assigned]

---

## Phase 2: Reproduction

### 2.1 Environment Setup

Before investigating, ensure a clean reproduction environment:

```bash
# Use dev profile for isolation
GIMLI_PROFILE=dev gimli doctor

# Check current state
gimli gateway status
gimli config get
```

**Environment Details:**
- Node version: `node --version`
- Gimli version: `gimli --version`
- Platform: ___
- Gateway mode: local / remote
- Active channels: ___

### 2.2 Reproduce the Bug

**Reproduction Attempts:**

| Attempt | Steps Taken | Result | Notes |
|---------|-------------|--------|-------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

**Reproduction Status:**
- [ ] Consistently reproducible
- [ ] Intermittently reproducible
- [ ] Cannot reproduce (escalate to reporter)

**Minimal Reproduction Case:**
```
[Document the smallest set of steps that trigger the bug]
```

---

## Phase 3: Root Cause Analysis

### 3.1 Systematic Investigation

**NEVER guess the root cause. Follow this checklist:**

1. **Read the Error Message Carefully**
   - What component threw the error?
   - What line number / stack trace?
   - What was the immediate trigger?

2. **Trace the Code Path**
   - Start from the symptom and work backwards
   - Use `grep` to find relevant code sections
   - Read source code of npm dependencies if needed

3. **Check Recent Changes**
   ```bash
   # What changed recently?
   git log --oneline -20

   # Any relevant commits?
   git log --grep="<relevant keyword>" --oneline

   # Did this ever work? Find when it broke
   git bisect start
   ```

4. **Enable Debug Logging**
   ```bash
   # Raw stream logging for message issues
   pnpm gateway:watch --force --raw-stream

   # Gateway verbose mode
   gimli gateway --verbose

   # Check logs
   tail -f ~/.gimli/logs/*.log
   ```

### 3.2 Root Cause Documentation

**Component(s) Affected:**
- [ ] Gateway (`src/gateway/`)
- [ ] Channels (`src/channels/`, `src/telegram/`, `src/discord/`, etc.)
- [ ] CLI (`src/cli/`, `src/commands/`)
- [ ] Tools (`src/tools/`)
- [ ] Media pipeline (`src/media/`)
- [ ] Sessions (`src/sessions/`)
- [ ] Config (`src/config/`)
- [ ] Other: ___

**Root Cause Statement:**
> [One clear sentence describing WHY the bug exists, not just WHAT happens]

**Evidence:**
- File: `src/path/to/file.ts`
- Line: ___
- Code snippet showing the bug:
```typescript
// The problematic code
```

**Confidence Level:**
- [ ] High (verified with logging/debugging)
- [ ] Medium (logical deduction from code reading)
- [ ] Low (hypothesis only, needs verification)

---

## Phase 4: Fix Design

### 4.1 Solution Approach

**Before writing any fix, answer these questions:**

1. **Is this the right place to fix?**
   - Could the bug be fixed upstream in a dependency?
   - Is there a more fundamental issue to address?
   - Will this fix mask a larger problem?

2. **What's the minimal fix?**
   - Don't refactor surrounding code
   - Don't add features
   - Don't "improve" unrelated code
   - Focus ONLY on fixing this specific bug

3. **What could break?**
   - List components that depend on the affected code
   - Consider edge cases
   - Think about backwards compatibility

**Proposed Fix:**
> [Brief description of the fix approach]

**Files to Modify:**
| File | Change Description |
|------|-------------------|
| | |

**Risk Assessment:**
- [ ] Low risk (isolated change, good test coverage)
- [ ] Medium risk (touches shared code, partial coverage)
- [ ] High risk (core system, security-related, poor coverage)

### 4.2 Security Considerations

**Gimli is security-hardened. Answer these:**

- [ ] Does this fix touch authentication?
- [ ] Does this fix touch authorization/permissions?
- [ ] Does this fix touch credential handling?
- [ ] Does this fix touch sandboxing?
- [ ] Could this fix expose sensitive data in logs?
- [ ] Does this fix handle external input?

**If any are checked, get a security review before merging.**

---

## Phase 5: Implementation

### 5.1 Write the Fix

**Coding Standards (from CLAUDE.md):**
- TypeScript (ESM), prefer strict typing
- No `any` unless absolutely necessary
- Keep files under ~700 LOC
- Add brief comments for tricky logic
- Follow existing patterns in the file

**Implementation Checklist:**
- [ ] Read the file before editing
- [ ] Made the minimal change needed
- [ ] Added comments explaining the fix if non-obvious
- [ ] No unrelated changes bundled
- [ ] No new security vulnerabilities introduced

### 5.2 Write Tests

**Every bug fix MUST include a test that:**
- [ ] Fails before the fix
- [ ] Passes after the fix
- [ ] Documents the edge case

**Test Location:**
- Colocated with source: `src/path/to/file.test.ts`
- E2E tests: `src/path/to/file.e2e.test.ts`

**Test Template:**
```typescript
describe('ComponentName', () => {
  describe('bugfix: {{BUG_ID}} - {{BUG_TITLE}}', () => {
    it('should handle [specific condition]', () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

---

## Phase 6: Verification

### 6.1 Local Testing

```bash
# Run type checker
pnpm build

# Run linter
pnpm lint

# Run all tests
pnpm test

# Run specific test for the fix
pnpm test -- path/to/file.test.ts

# Run with coverage
pnpm test:coverage
```

**All must pass before proceeding:**
- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] New test specifically validates the fix

### 6.2 Manual Verification

**Reproduce the original bug and confirm it's fixed:**

| Step | Expected | Actual | Pass? |
|------|----------|--------|-------|
| Original reproduction steps | No error | | |
| Edge case 1 | | | |
| Edge case 2 | | | |

### 6.3 Regression Check

**Verify no regressions in related functionality:**
- [ ] `gimli doctor` reports no new issues
- [ ] Affected channel still works
- [ ] No performance degradation
- [ ] No new warnings in logs

---

## Phase 7: Commit & PR

### 7.1 Commit Message

**Format:**
```
fix(<scope>): <short description>

<body explaining what was wrong and how it was fixed>

Fixes #{{BUG_ID}}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Scope Options:**
- `gateway`, `channels`, `cli`, `tools`, `media`, `sessions`, `config`
- Use the primary component affected

### 7.2 Changelog Entry

Add to `CHANGELOG.md` under the current version:

```markdown
### Fixed

- **<scope>**: <description> (#{{BUG_ID}}, thanks @{{REPORTER}})
```

### 7.3 PR Checklist

Before creating PR:
- [ ] Commit message follows format
- [ ] Changelog updated
- [ ] All tests pass locally
- [ ] PR title: `fix(<scope>): <description>`
- [ ] PR body includes:
  - [ ] What was the bug
  - [ ] Root cause
  - [ ] How it was fixed
  - [ ] How it was tested
  - [ ] Link to issue: Fixes #{{BUG_ID}}

---

## Phase 8: Post-Fix Actions

### 8.1 Documentation Updates

**If the bug revealed a gap in documentation:**
- [ ] Update relevant docs in `docs/`
- [ ] Add troubleshooting entry if common error
- [ ] Update CLAUDE.md if new pattern/guideline emerged

### 8.2 Learning Capture

**What can we learn from this bug?**

| Question | Answer |
|----------|--------|
| How could this have been prevented? | |
| What test was missing? | |
| Is there a pattern here? | |
| Should we add a lint rule? | |
| Should we add to CLAUDE.md? | |

### 8.3 Close the Loop

- [ ] Close GitHub issue with link to fix PR
- [ ] Notify reporter that fix is available
- [ ] If critical: note version containing the fix

---

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

# Mac unified logs
./scripts/clawlog.sh -f
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
| Channel auth | `src/<channel>/auth.ts` |

### Testing Commands

```bash
# Full test suite
pnpm test

# Single file
pnpm test -- path/to/file.test.ts

# Watch mode
pnpm test -- --watch

# Coverage report
pnpm test:coverage

# Live tests (requires API keys)
GIMLI_LIVE_TEST=1 pnpm test:live
```

---

## Template Usage Examples

### Example 1: Gateway Crash on Startup

```
Phase 1:
- BUG_ID: #456
- Title: Gateway crashes when Discord bot token is invalid
- Severity: High (core feature broken)

Phase 2:
- Reproduction: Set invalid Discord token, run `gimli gateway`
- Result: Gateway exits with unhandled rejection

Phase 3:
- Component: src/discord/client.ts
- Root cause: Discord client throws on invalid token, not caught

Phase 4:
- Fix: Add try/catch around Discord login, log error and continue

Phase 5:
- Minimal change: 5 lines added to handle the error
- Test: discord-client.test.ts added case for invalid token

Phase 6:
- All tests pass
- Manual verification: Gateway now logs error and continues

Phase 7:
- Commit: fix(discord): handle invalid bot token gracefully
- Changelog: Added
- PR: Created with full context
```

### Example 2: Messages Not Sent to Group

```
Phase 1:
- BUG_ID: #789
- Title: Bot doesn't respond in Telegram groups
- Severity: Medium (workaround: DM bot directly)

Phase 2:
- Reproduction: Create Telegram group, add bot, send message
- Result: No response (works in DM)

Phase 3:
- Component: src/telegram/handler.ts
- Root cause: Group messages filtered incorrectly by privacy mode check

Phase 4:
- Fix: Update filter logic to allow group messages when bot is mentioned

Phase 5-8: [Continue through template...]
```

---

*Template Version: 1.0*
*Last Updated: 2026-02-01*
*Based on TAC Principles and Gimli Engineering Standards*
