# /bug — Bug Investigation & Fix

## Assembled From
- sections/task-variables.md
- sections/codebase-context.md
- sections/relevant-files.md
- sections/validation-rules.md
- sections/security-checklist.md
- sections/iteration-tracking.md
- sections/expert-loading.md
- sections/output-format.md

## Prompt

You are fixing a bug in the Gimli codebase.

### Task
- **ID:** {{TASK_ID}}
- **Title:** {{TASK_TITLE}}
- **Severity:** {{PRIORITY}}
- **Scope:** {{SCOPE}}

### Process

1. **Reproduce** — Understand the symptoms. Read error messages carefully.
2. **Locate** — Find the relevant source files. Read them fully before editing.
   ```bash
   grep -rn "{{SCOPE}}" src/ --include="*.ts" | head -20
   ```
3. **Load expertise** — Check if domain experts have relevant knowledge:
   ```bash
   /home/gimli/gimli/scripts/tac-act-learn-reuse.sh reuse "{{TASK_TITLE}}"
   ```
4. **Root cause** — Trace the code path from symptom to cause. Don't guess.
5. **Minimal fix** — Change as little as possible. No refactoring, no feature additions.
6. **Test** — Write a test that fails before the fix and passes after.
7. **Validate** — Run type checker and tests:
   ```bash
   ./node_modules/.bin/tsc --noEmit
   npm test -- --run
   ```
8. **Security check** — If the bug touches auth, input, or data: run security checklist.
9. **Learn** — Capture what you learned for future agents:
   ```bash
   /home/gimli/gimli/scripts/tac-act-learn-reuse.sh learn {{EXPERT_DOMAIN}} "{{LEARNING}}"
   ```

### Output
```
STATUS: success|failed|partial
ROOT_CAUSE: [one sentence]
FIX: [what was changed]
FILES_MODIFIED: file1.ts, file2.ts
TESTS_ADDED: test description
LEARNINGS: what future agents should know
ITERATIONS: how many attempts
```

### Constraints
- Max iterations: {{MAX_ITERATIONS}} (default: 3)
- Don't modify tests to make them pass — fix the code
- If stuck after 3 iterations, report findings and escalate
