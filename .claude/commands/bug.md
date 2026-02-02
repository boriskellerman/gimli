# Bug Planning

## Purpose
Create a new plan in the `specs/` directory to investigate and fix the bug using the specified plan format. Follow the instructions to create the plan, use the relevant files to focus on the right files.

## Instructions
1. Understand the bug report/symptoms thoroughly
2. Think hard about root cause analysis
3. Identify steps to reproduce the bug
4. Locate all affected files and code paths
5. Plan the fix with minimal changes (avoid over-engineering)
6. Include regression tests to prevent recurrence
7. Consider security implications (OWASP top 10, credential handling)
8. Save the plan to `specs/bug-<descriptive-name>.md`

## Relevant Files
When investigating bugs, consider these key areas:
- `src/cli/` - CLI command handling
- `src/commands/` - Command implementations
- `src/gateway/` - Gateway WebSocket, sessions
- `src/channels/` - Channel adapters (routing, auth, message flow)
- `src/routing/` - Message routing logic
- `src/media/` - Media pipeline
- `src/infra/` - Infrastructure utilities
- `extensions/` - Plugin extensions
- `*.test.ts` - Colocated test files

## Security Checklist
Before finalizing the plan, verify:
- [ ] Fix doesn't introduce command injection
- [ ] Fix doesn't introduce XSS vulnerabilities
- [ ] Fix doesn't expose credentials in logs
- [ ] Fix maintains proper input validation
- [ ] Fix respects sandbox boundaries

## Plan Format
Create a plan with the following structure:

```markdown
# Bug: [Descriptive Title]

## Problem Statement
[Clear description of the bug and its impact]

## Solution Statement
[High-level description of the fix approach]

## Steps to Reproduce
1. [First step]
2. [Second step]
3. [Expected behavior]
4. [Actual behavior]

## Root Cause Analysis
[Explain why the bug occurs - be specific about the code path]

## Relevant Files
- `path/to/file1.ts` - [why this file is relevant]
- `path/to/file2.ts` - [why this file is relevant]

## New Files (if any)
- `path/to/new-file.ts` - [purpose of new file]
- `path/to/new-file.test.ts` - [test coverage for the fix]

## Step-by-Step Tasks
Execute every step in order, top to bottom.

1. [ ] **Investigate**: [Confirm the root cause]
   - Read the relevant code paths
   - Add temporary logging if needed

2. [ ] **Fix**: [Implement the fix]
   - Make minimal changes
   - Document the fix with a brief comment if non-obvious

3. [ ] **Test**: [Add regression tests]
   - Add test case that reproduces the bug
   - Verify the fix resolves the issue

4. [ ] **Validate**: [Run validation suite]
   - Run existing tests
   - Manual verification if applicable

## Validation
Run these commands to verify the fix:
- `pnpm lint` - Check for linting errors
- `pnpm build` - Verify TypeScript compiles
- `pnpm test` - Run full test suite
- `pnpm test <specific-file>` - Run targeted tests
- [Add bug-specific validation if needed]

## Notes
- [Impact on other components]
- [Security considerations]
- [Migration or upgrade notes if applicable]
```

## Bug
$ARGUMENTS
