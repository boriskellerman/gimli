# Bug Template Examples

Real-world examples of using the bug investigation template for Gimli bugs.

---

## Example 1: Gateway Crash on Invalid Token

### Phase 1: Intake & Triage

**Bug ID:** #456
**Title:** Gateway crashes when Discord bot token is invalid
**Reporter:** @user123
**Channel:** GitHub Issue
**Severity:** High (core feature broken, no workaround)

**Symptom Description:**
> "When I start the gateway with an invalid Discord token, the entire gateway crashes instead of just skipping Discord."

**Expected Behavior:**
> Gateway should log an error for Discord and continue running other channels.

### Phase 2: Reproduction

```bash
# Environment
GIMLI_PROFILE=dev gimli doctor
# Node: 22.1.0, Gimli: 2024.6.15

# Set invalid token
gimli config set discord.token "invalid-token-here"

# Start gateway
gimli gateway --verbose
# Result: UnhandledPromiseRejection, gateway exits
```

**Reproduction Status:** Consistently reproducible

### Phase 3: Root Cause Analysis

**Investigation Steps:**

1. Check error stack trace:
```
Error: An invalid token was provided.
    at Discord.login (node_modules/discord.js/src/client/Client.js:234)
    at DiscordChannel.connect (src/discord/client.ts:45)
    at Gateway.start (src/gateway/index.ts:89)
```

2. Read the code:
```typescript
// src/discord/client.ts:45
async connect() {
  await this.client.login(this.token);  // <-- No try/catch!
}
```

**Root Cause:** The Discord client's `connect()` method doesn't catch exceptions from `login()`. When Discord.js throws on an invalid token, the exception propagates up and crashes the gateway.

**Evidence:**
- File: `src/discord/client.ts`
- Line: 45
- Missing: try/catch around login call

**Confidence Level:** High (verified with stack trace and code reading)

### Phase 4: Fix Design

**Proposed Fix:**
Wrap the Discord login call in try/catch. Log the error and mark the channel as failed rather than crashing.

**Files to Modify:**
| File | Change |
|------|--------|
| `src/discord/client.ts` | Add try/catch around login |

**Risk Assessment:** Low (isolated change)

**Security Considerations:**
- Does NOT touch authentication logic
- Does NOT expose credentials in logs (error message only)
- Token validation happens inside Discord.js

### Phase 5: Implementation

```typescript
// src/discord/client.ts
async connect(): Promise<void> {
  try {
    await this.client.login(this.token);
    this.connected = true;
    this.log.info('Discord connected');
  } catch (error) {
    this.log.error('Discord connection failed', { error: error.message });
    this.connected = false;
    // Don't throw - let gateway continue with other channels
  }
}
```

**Test Added:**
```typescript
// src/discord/client.test.ts
describe('DiscordChannel', () => {
  describe('bugfix: #456 - handle invalid token gracefully', () => {
    it('should not throw on invalid token', async () => {
      const channel = new DiscordChannel({ token: 'invalid' });
      await expect(channel.connect()).resolves.not.toThrow();
      expect(channel.connected).toBe(false);
    });

    it('should log error on connection failure', async () => {
      const logSpy = vi.spyOn(console, 'error');
      const channel = new DiscordChannel({ token: 'invalid' });
      await channel.connect();
      expect(logSpy).toHaveBeenCalled();
    });
  });
});
```

### Phase 6: Verification

```bash
pnpm build   # PASS
pnpm lint    # PASS
pnpm test    # PASS (including new tests)

# Manual verification
gimli config set discord.token "invalid"
gimli gateway --verbose
# Result: Logs "Discord connection failed", gateway continues
# Other channels (Telegram, Slack) still work
```

### Phase 7: Commit & PR

**Commit Message:**
```
fix(discord): handle invalid bot token gracefully

Previously, an invalid Discord token would crash the entire gateway
due to an uncaught exception from Discord.js login(). This prevented
other channels from functioning.

Now the Discord channel catches login failures, logs the error, and
marks itself as disconnected. The gateway continues running with
other channels.

Fixes #456

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

**Changelog Entry:**
```markdown
### Fixed

- **discord**: Invalid bot token no longer crashes gateway (#456, thanks @user123)
```

---

## Example 2: Messages Not Sent to Telegram Groups

### Phase 1: Intake & Triage

**Bug ID:** #789
**Title:** Bot doesn't respond in Telegram groups
**Reporter:** @telegramuser
**Channel:** Telegram (meta!)
**Severity:** Medium (workaround: DM bot directly)

**Symptom Description:**
> "Bot works great in DMs but completely ignores messages in groups, even when I mention it."

### Phase 2: Reproduction

```bash
# Create Telegram group, add bot
# Send: @gimli_bot hello
# Result: No response

# Send DM to same bot
# Send: hello
# Result: Response received
```

**Reproduction Status:** Consistently reproducible

### Phase 3: Root Cause Analysis

**Investigation:**

1. Enable debug logging:
```bash
pnpm gateway:watch --force --raw-stream
```

2. Observe incoming messages:
```
[DEBUG] Telegram message received: { chat_type: "group", ... }
[DEBUG] Message filtered: group message without command
```

3. Find the filter:
```typescript
// src/telegram/handler.ts:78
if (message.chat.type !== 'private' && !message.text?.startsWith('/')) {
  return; // Filter non-command group messages
}
```

**Root Cause:** The handler filters out group messages that don't start with `/`. This was intended for "command-only" mode but is always active. Bot mentions like `@gimli_bot hello` don't start with `/` so they're filtered.

**Evidence:**
- File: `src/telegram/handler.ts`
- Line: 78
- Logic error: Missing mention check

### Phase 4: Fix Design

**Proposed Fix:**
Add mention detection to the group message filter. Allow messages that either:
1. Start with `/` (commands)
2. Mention the bot's username

```typescript
// Check for bot mention
const isMentioned = message.text?.includes(`@${botUsername}`);
if (message.chat.type !== 'private' && !message.text?.startsWith('/') && !isMentioned) {
  return;
}
```

**Security Considerations:**
- Uses bot's own username (no external input)
- Does not change auth logic

### Phase 5: Implementation

```typescript
// src/telegram/handler.ts:78
private shouldProcess(message: TelegramMessage): boolean {
  // Always process DMs
  if (message.chat.type === 'private') return true;

  // In groups: process commands or mentions
  const isCommand = message.text?.startsWith('/');
  const isMentioned = message.text?.toLowerCase().includes(`@${this.botUsername.toLowerCase()}`);

  return isCommand || isMentioned;
}
```

**Test Added:**
```typescript
describe('bugfix: #789 - respond to group mentions', () => {
  it('should process group messages that mention the bot', () => {
    const handler = new TelegramHandler({ botUsername: 'gimli_bot' });
    const message = { chat: { type: 'group' }, text: '@gimli_bot hello' };
    expect(handler.shouldProcess(message)).toBe(true);
  });

  it('should filter group messages without mention or command', () => {
    const handler = new TelegramHandler({ botUsername: 'gimli_bot' });
    const message = { chat: { type: 'group' }, text: 'hello everyone' };
    expect(handler.shouldProcess(message)).toBe(false);
  });
});
```

### Phase 6-8: [Continue through template...]

---

## Example 3: Quick Fix - Typo in Error Message

For simple bugs, use the quick workflow:

```
User: There's a typo in the error message "confguration file not found"

Agent: Using quick bug fix workflow...

Search: grep -r "confguration" src/
Found: src/config/loader.ts:89
  console.error('confguration file not found');

Fix: Change "confguration" to "configuration"

Test: Existing tests cover this code path (config.test.ts)

Verification:
  pnpm build  # PASS
  pnpm lint   # PASS
  pnpm test   # PASS

Commit: fix(config): correct typo in missing config error message
```

---

## Example 4: Security-Sensitive Bug

### Special Handling Required

**Bug ID:** #901
**Title:** API key visible in debug logs

This requires the full template WITH security escalation:

**Phase 4: Security Review**

All boxes checked:
- [x] Does fix touch credential handling?
- [x] Could fix expose data in logs?

**Action:** This fix requires security review before merge.

**Fix Approach:**
```typescript
// BAD - current code
this.log.debug('Making API call', { headers: this.headers });

// GOOD - redacted
this.log.debug('Making API call', {
  headers: {
    ...this.headers,
    Authorization: '[REDACTED]'
  }
});
```

**Security Review Checklist:**
- [ ] No credentials in any log level
- [ ] Error messages don't leak sensitive data
- [ ] Stack traces don't contain secrets
- [ ] Tested with `--verbose` flag

---

## Anti-Patterns (What NOT to Do)

### 1. Guessing Without Reading Code

**Wrong:**
```
The bug is probably in the authentication module because
that's where most bugs are.
```

**Right:**
```
Reading src/auth/validator.ts:
Line 45 shows the validation skips empty strings.
This matches the reported symptom.
```

### 2. Bundling Unrelated Changes

**Wrong:**
```
fix(telegram): handle mentions + refactor message types + add logging
```

**Right:**
```
fix(telegram): process group messages that mention the bot
```

### 3. Skipping Tests

**Wrong:**
```
Tests would take too long, the fix is obvious.
```

**Right:**
```
describe('bugfix: #789', () => {
  it('should process messages mentioning the bot', () => {
    // Regression test for this specific bug
  });
});
```

### 4. Over-Engineering the Fix

**Wrong:**
```
Created new MessageFilterChain class with configurable
predicates and extensibility hooks.
```

**Right:**
```
Added one condition to existing filter logic:
|| message.text?.includes(`@${botUsername}`)
```
