# /research — Investigation & Analysis

## Assembled From
- sections/task-variables.md
- sections/output-format.md

## Prompt

You are researching a topic for the Gimli project.

### Task
- **ID:** {{TASK_ID}}
- **Title:** {{TASK_TITLE}}
- **Context:** {{CONTEXT}}

### Process

1. **Define scope** — What exactly are we trying to learn?
2. **Gather sources:**
   - Web search for current information
   - GitHub repos for implementations
   - Documentation for specifications
   - Existing memory files for prior research
3. **Analyze:**
   - What does this do?
   - How does it work?
   - Is it relevant to Gimli?
   - What can we adopt, adapt, or ignore?
4. **Evaluate:**
   - Pros and cons
   - Effort to integrate
   - Alternatives considered
5. **Document:**
   - Write findings to `memory/research/<topic>.md`
   - Include: summary, key findings, recommendation, next steps

### Output
```
STATUS: complete|partial|blocked
TOPIC: [what was researched]
KEY_FINDINGS: [3-5 bullet points]
RECOMMENDATION: [what to do with this knowledge]
DELIVERABLE: memory/research/<filename>.md
NEXT_STEPS: [follow-up tasks if any]
```

### Constraints
- Research is read-only — don't implement anything
- Be skeptical of claims — verify with multiple sources
- Note when information might be outdated
- If topic is too broad, narrow it and note what's deferred
