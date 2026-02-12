# Composable Prompt Library

> TAC Leverage Point #3 (Prompt) — Reusable building blocks for agent task execution.

## Architecture

```
prompts/
├── sections/           # Reusable building blocks (Lego pieces)
│   ├── task-variables.md       # Standard variable definitions
│   ├── codebase-context.md     # Gimli codebase overview
│   ├── relevant-files.md       # File discovery commands
│   ├── examples.md             # Pattern discovery & common patterns
│   ├── workspace-rules.md      # Git, code, testing standards
│   ├── validation-rules.md     # Self-validation checklist
│   ├── security-checklist.md   # Security review checklist
│   ├── iteration-tracking.md   # Attempt tracking & escalation
│   ├── expert-loading.md       # Act→Learn→Reuse integration
│   └── output-format.md        # Standard output format
│
├── meta/               # Assembled meta-prompts (composed from sections)
│   ├── bug.md          # /bug — investigation & fix
│   ├── feature.md      # /feature — implementation
│   ├── chore.md        # /chore — maintenance & cleanup
│   └── research.md     # /research — investigation & analysis
│
├── closed-loops/       # Self-validating prompt chains
│   ├── testing-closed-loop.md
│   ├── reviewing-closed-loop.md
│   └── documenting-closed-loop.md
│
└── assemble.sh         # CLI to assemble prompts with variables
```

## Quick Start

### Assemble a prompt
```bash
# Generate a bug-fix prompt
./assemble.sh bug --task-id TASK-123 --title "Fix gateway crash" --scope gateway --priority high

# Generate a feature prompt
./assemble.sh feature --task-id TASK-124 --title "Add reply button" --criteria "Button appears on hover"

# Generate a research prompt
./assemble.sh research --task-id TASK-125 --title "Evaluate MCP servers"
```

### Use in ADW workflows
```yaml
# In an ADW definition:
steps:
  - name: implement
    prompt: meta/feature.md
    variables:
      TASK_ID: "{{task.id}}"
      TASK_TITLE: "{{task.title}}"
      SCOPE: "{{task.scope}}"
```

### Use in sub-agent delegation
```
You are a coding agent. Follow this prompt exactly:

[paste assembled prompt here]
```

## Design Principles

1. **Composable** — Sections are independent building blocks. Meta-prompts assemble them.
2. **Self-validating** — Every prompt includes validation steps. Agents verify their own work.
3. **Learning-enabled** — Expert loading + learning capture creates institutional knowledge.
4. **Iteration-tracked** — Failed attempts are recorded, not discarded.
5. **Template-compatible** — Variables use `{{VARIABLE}}` syntax for easy substitution.

## Section Inventory

| Section | Purpose | Used By |
|---------|---------|---------|
| task-variables | Define standard variable schema | All meta-prompts |
| codebase-context | Orient agent in the Gimli codebase | bug, feature, chore |
| relevant-files | File discovery patterns | bug, feature |
| examples | Pattern matching in existing code | feature |
| workspace-rules | Git, coding, testing standards | feature, chore |
| validation-rules | Self-check after completion | bug, feature, chore |
| security-checklist | Security review gate | bug, feature |
| iteration-tracking | Track attempts, know when to escalate | bug |
| expert-loading | Load/save domain expertise | bug, feature |
| output-format | Standard completion report | All |

## Adding New Sections

Create a new file in `sections/` following this pattern:
```markdown
## Section Name

[Content that any meta-prompt can include]

**Commands:**
\`\`\`bash
# Useful commands for this section
\`\`\`

**Checklist:**
- [ ] Item 1
- [ ] Item 2
```

## Adding New Meta-Prompts

1. Create `meta/<type>.md`
2. List which sections it assembles from
3. Define the task-specific process
4. Include standard output format
5. Add constraints and escalation rules
6. Update this README

---

*Part of the TAC Orchestrator — Composable Prompt Library (MT-4)*
*Created: 2026-02-11*
