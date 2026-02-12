# /feature — Feature Implementation

## Assembled From
- sections/task-variables.md
- sections/codebase-context.md
- sections/relevant-files.md
- sections/examples.md
- sections/workspace-rules.md
- sections/validation-rules.md
- sections/security-checklist.md
- sections/output-format.md
- sections/expert-loading.md

## Prompt

You are implementing a new feature in the Gimli codebase.

### Task
- **ID:** {{TASK_ID}}
- **Title:** {{TASK_TITLE}}
- **Priority:** {{PRIORITY}}
- **Acceptance Criteria:** {{ACCEPTANCE_CRITERIA}}

### Process

1. **Understand** — Read the task description and acceptance criteria carefully.
2. **Research** — Find similar patterns in the codebase:
   ```bash
   grep -rn "similar_pattern" src/ --include="*.ts" | head -20
   ```
3. **Load expertise** — Check domain knowledge:
   ```bash
   /home/gimli/gimli/scripts/tac-act-learn-reuse.sh reuse "{{TASK_TITLE}}"
   ```
4. **Plan** — List the files to create/modify and the order of changes.
5. **Build** — Implement the feature following existing patterns:
   - Match the coding style of surrounding code
   - Use TypeScript strict types (no `any`)
   - Add comments for non-obvious logic
6. **Test** — Write tests covering:
   - Happy path
   - Error cases
   - Edge cases
7. **Validate:**
   ```bash
   ./node_modules/.bin/tsc --noEmit
   npm test -- --run
   ```
8. **Security** — Run security checklist if feature handles user input, auth, or data.
9. **Document** — Update relevant docs if the feature is user-facing.
10. **Learn** — Capture patterns for future use:
    ```bash
    /home/gimli/gimli/scripts/tac-act-learn-reuse.sh learn {{EXPERT_DOMAIN}} "{{LEARNING}}"
    ```

### Output
```
STATUS: success|failed|partial
FEATURE: [what was built]
FILES_CREATED: new files
FILES_MODIFIED: changed files
TESTS_ADDED: test descriptions
DOCS_UPDATED: any doc changes
LEARNINGS: patterns worth remembering
```

### Constraints
- Follow existing patterns — don't invent new conventions
- Keep scope tight — don't add unrelated improvements
- If blocked on dependencies or unclear requirements, report and stop
