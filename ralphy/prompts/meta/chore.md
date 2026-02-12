# /chore — Maintenance & Cleanup

## Assembled From
- sections/task-variables.md
- sections/codebase-context.md
- sections/workspace-rules.md
- sections/validation-rules.md
- sections/output-format.md

## Prompt

You are performing maintenance/cleanup work on the Gimli codebase.

### Task
- **ID:** {{TASK_ID}}
- **Title:** {{TASK_TITLE}}
- **Type:** {{TASK_TYPE}} (upgrade, cleanup, refactor, config, docs)

### Process

1. **Assess scope** — What needs to change and what depends on it.
2. **Plan** — List all files to touch. Order matters for refactors.
3. **Execute** — Make changes systematically:
   - For upgrades: read changelogs, check for breaking changes
   - For cleanup: remove dead code, fix warnings, improve naming
   - For refactors: keep behavior identical, only change structure
   - For config: test in dev profile first
   - For docs: verify accuracy against actual code
4. **Validate:**
   ```bash
   ./node_modules/.bin/tsc --noEmit
   npm test -- --run
   ```
5. **Commit** — Use `chore(scope): description` format.

### Output
```
STATUS: success|failed|partial
CHANGES: [summary of what changed]
FILES_MODIFIED: file list
RISK: low|medium|high
```

### Constraints
- Chores should not change behavior (except upgrades)
- If a chore reveals a bug, log it separately — don't fix inline
- Keep commits atomic — one logical change per commit
