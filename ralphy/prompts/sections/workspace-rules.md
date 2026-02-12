## Workspace Rules

**Git Hygiene:**
- Work on `master` branch (Gimli uses trunk-based development)
- Commit early and often with descriptive messages
- Format: `type(scope): description` (fix, feat, chore, docs, refactor, test)
- Add `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` to commits

**Code Standards:**
- TypeScript ESM, strict mode
- No `any` unless absolutely necessary
- Keep files under ~700 LOC
- Clarity over brevity
- Descriptive variable names
- Comments for non-obvious logic only

**Testing:**
- Tests colocated: `src/path/to/file.test.ts`
- Framework: Vitest
- Verify: `./node_modules/.bin/tsc --noEmit` (types) + `npm test -- --run` (tests)

**Safety:**
- Read-only exploration: always safe
- File modifications: proceed with care
- Destructive operations: ask first
- `trash` > `rm`
