## Task Variables

**Required:**
- `{{TASK_ID}}` — Task identifier (e.g., TASK-069)
- `{{TASK_TITLE}}` — Short description
- `{{TASK_TYPE}}` — bug | feature | chore | research | refactor

**Optional:**
- `{{PRIORITY}}` — critical | high | medium | low (default: medium)
- `{{SCOPE}}` — Affected component(s)
- `{{FILES}}` — Known files to modify
- `{{ACCEPTANCE_CRITERIA}}` — What "done" looks like
- `{{CONTEXT}}` — Additional background from TASKS.md, PRD, or conversation
- `{{EXPERT_DOMAIN}}` — gateway | channels | security | database (for expert loading)
- `{{MAX_ITERATIONS}}` — Self-correction attempts (default: 3)
