---
description: Scout a bug before fixing - investigate root cause, affected code, and testing gaps
---

# Bug Scout Workflow

Use this workflow before fixing a bug. It spawns parallel scouts to research:
- Root cause analysis in the affected code
- Error handling patterns around the bug
- Existing tests and coverage gaps
- Similar bugs and their fixes

## Quick Reference

```bash
# Run bug scout
/scout bug "Users can't reset passwords in Safari"

# Or manually trigger scouts
sessions_spawn task:"Root cause scout: investigate password reset flow in Safari" label:"root-scout"
sessions_spawn task:"Error pattern scout: analyze error handling in password reset" label:"error-scout"
sessions_spawn task:"Test scout: find test gaps for password reset flow" label:"test-scout"
```

---

## Phase 1: Bug Triage

Before scouting, gather initial context:

1. **Reproduction steps**: How to trigger the bug
2. **Error messages**: Any logs, stack traces, console errors
3. **Environment details**: Browser, OS, configuration
4. **Affected scope**: Which users, how often, how severe

---

## Phase 2: Spawn Bug Scouts

### Root Cause Scout
```
Task: Investigate potential root causes for [bug description].

Context:
- Reproduction steps: [steps]
- Error message: [if any]
- Environment: [browser/os/config]

Focus on:
- Code paths that could produce this behavior
- Recent changes to affected files (git log)
- Edge cases not handled
- Environment-specific behaviors
- Race conditions or timing issues

Report findings with specific file:line references.
```

### Error Pattern Scout
```
Task: Analyze error handling patterns around [affected area].

Focus on:
- How errors are caught and handled
- Error propagation paths
- Silent failures (catch blocks that swallow errors)
- Logging gaps (errors not logged)
- User-facing error messages

Report findings with code examples.
```

### Test Scout
```
Task: Analyze test coverage for [affected functionality].

Focus on:
- Existing tests for this feature
- Edge cases not tested
- Browser-specific test gaps
- Integration test coverage
- Error path testing

Report findings with specific gaps to address.
```

### History Scout (optional)
```
Task: Find similar bugs and their fixes in this codebase.

Search for:
- Similar error messages in commit history
- Related issues in git/GitHub history
- Patterns of fixes for similar bugs

Report findings with commit SHAs and fix approaches.
```

---

## Phase 3: Synthesize Findings

```
## Bug Scout Summary: [Bug Title]

### Bug Profile
- **Symptom**: [What users see]
- **Reproduction**: [Steps to reproduce]
- **Frequency**: [How often, which users]
- **Severity**: [Impact level]

### Root Cause Analysis
[Summarize root cause scout findings]

**Most Likely Cause:**
[Description with file:line references]

**Alternative Hypotheses:**
1. [Alternative cause 1]
2. [Alternative cause 2]

### Error Handling Gaps
[Summarize error pattern scout findings]
- Missing error handling: [locations]
- Silent failures: [locations]
- Inadequate logging: [locations]

### Test Coverage Gaps
[Summarize test scout findings]
- Untested paths: [list]
- Missing edge cases: [list]
- Browser-specific gaps: [list]

### Historical Context
[If history scout was run]
- Similar past bugs: [list with fix approaches]
- Relevant commits: [list with SHAs]

### Recommended Fix Approach
1. [First step]
2. [Second step]
3. [Third step]

### Required Tests
- [ ] [Test case 1]
- [ ] [Test case 2]
- [ ] [Regression test]
```

---

## Phase 4: Proceed to Fix

With scout findings, implement the fix:

1. **Address root cause** - Fix the actual issue, not just symptoms
2. **Improve error handling** - Based on error pattern scout findings
3. **Add tests** - Cover gaps identified by test scout
4. **Verify in environment** - Test in the specific browser/environment

---

## Example: Safari Password Reset Bug

### 1. Bug Triage
- **Symptom**: "Reset password" button does nothing in Safari
- **Steps**: 1. Click forgot password, 2. Enter email, 3. Click submit
- **Environment**: Safari 17.x on macOS
- **Frequency**: All Safari users

### 2. Scout Tasks

**Root Cause Scout:**
```
Investigate why password reset submit fails in Safari.
Context: Button click has no effect, no network request seen.
Check for:
- Safari-specific form submission behavior
- Event handler attachment issues
- CSP or cookie policies affecting Safari
```

**Error Pattern Scout:**
```
Analyze error handling in src/auth/password-reset.ts.
Check for:
- Uncaught promise rejections
- Silent failures in form submission
- Missing error boundaries
```

**Test Scout:**
```
Analyze test coverage for password reset in src/auth/__tests__/.
Check for:
- Browser-specific tests
- Form submission tests
- Error state tests
```

### 3. Synthesized Findings

```
## Bug Scout Summary: Safari Password Reset

### Root Cause Analysis
**Most Likely Cause:** Safari's Intelligent Tracking Prevention (ITP)
blocks the third-party cookie used for CSRF protection.

File: src/auth/password-reset.ts:45
- CSRF token stored in cookie
- Safari with ITP enabled blocks cookie access
- Form submission fails silently

**Evidence:**
- Works in Safari with ITP disabled
- Works in Chrome/Firefox
- No error logged (silent failure)

### Error Handling Gaps
- Line 52: Promise rejection not caught
- Line 67: No logging when CSRF check fails
- No user feedback on submission failure

### Test Coverage Gaps
- No Safari-specific tests
- No test for CSRF cookie unavailable scenario
- No test for ITP-like cookie restrictions

### Recommended Fix
1. Use localStorage fallback for CSRF token
2. Add explicit error handling for token retrieval
3. Show user feedback on submission failure
4. Add test for cookie-blocked scenario

### Required Tests
- [ ] Test password reset with cookies blocked
- [ ] Test CSRF fallback to localStorage
- [ ] Test error message display
```

### 4. Fix Implementation

```typescript
// Before (problematic)
const csrfToken = document.cookie.match(/csrf=([^;]+)/)?.[1];
await submitReset(email, csrfToken); // silently fails if no token

// After (robust)
function getCsrfToken(): string {
  // Try cookie first
  const cookieToken = document.cookie.match(/csrf=([^;]+)/)?.[1];
  if (cookieToken) return cookieToken;

  // Fallback to localStorage (for Safari ITP)
  const storageToken = localStorage.getItem('csrf-token');
  if (storageToken) return storageToken;

  throw new AuthError('CSRF_TOKEN_MISSING', 'Unable to retrieve CSRF token');
}

try {
  const csrfToken = getCsrfToken();
  await submitReset(email, csrfToken);
} catch (error) {
  if (error instanceof AuthError) {
    showError('Password reset failed. Please try again or contact support.');
    logger.auth.error('Password reset CSRF failure', { error: error.code });
  }
  throw error;
}
```

---

## Troubleshooting

### Can't reproduce the bug

Run additional investigation:
```bash
sessions_spawn task:"Environment scout: what browser/OS combinations trigger this bug?" label:"env-scout"
```

### Multiple potential root causes

Prioritize by:
1. Evidence strength (logs, reproducibility)
2. Simplicity (simpler explanations first)
3. Recent changes (check git blame)

### Fix introduces new issues

Run regression scout before merging:
```bash
sessions_spawn task:"Regression scout: what could break with this change to [file]?" label:"regression-scout"
```
