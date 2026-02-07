# Plan With Team - Meta-Prompt

## Purpose
Generate a detailed plan with team assignments for multi-agent execution.
This is a TEMPLATE META-PROMPT - it generates another prompt in a specific format.

## Hooks (Self-Validation)

### On Stop
Validate that the generated plan:
1. Exists in `specs/` directory
2. Is a valid markdown file
3. Contains required sections: Team Members, Step-by-Step Tasks, Validation Commands

```bash
# Validate file exists
test -f specs/{{PLAN_NAME}}.md || echo "VALIDATION_FAILED: Plan file not created"

# Validate required sections
grep -q "## Team Members" specs/{{PLAN_NAME}}.md || echo "VALIDATION_FAILED: Missing Team Members"
grep -q "## Step-by-Step Tasks" specs/{{PLAN_NAME}}.md || echo "VALIDATION_FAILED: Missing Tasks"
grep -q "## Validation Commands" specs/{{PLAN_NAME}}.md || echo "VALIDATION_FAILED: Missing Validation"
```

## Variables

- `{{USER_REQUEST}}` - What the user wants to build/do
- `{{ORCHESTRATION_PROMPT}}` - Optional guidance for team composition
- `{{CODEBASE_CONTEXT}}` - Key files and patterns from codebase

## Instructions

### Step 1: Analyze Request
Understand what needs to be built:
- What are the deliverables?
- What files will be created/modified?
- What are the dependencies between tasks?

### Step 2: Research Codebase
Read key files to understand patterns:
- Look at similar existing implementations
- Note coding style and conventions
- Identify reusable components

### Step 3: Design Team
Based on the work needed, assign team members:
- **Builders** - One per major component
- **Validators** - One per builder (validates their output)
- **Specialized agents** - If needed (tester, documenter, etc.)

### Step 4: Define Team Members
Use this format for each team member:
```yaml
- name: {{Component}}Builder
  role: builder
  agent_file: agents/builder.md
  focus: "{{Specific component or task}}"
  
- name: {{Component}}Validator  
  role: validator
  agent_file: agents/validator.md
  validates: {{Component}}Builder
```

### Step 5: Create Step-by-Step Tasks
Define tasks with dependencies:
```yaml
tasks:
  - id: 1
    name: "Build {{Component A}}"
    owner: {{Component A}}Builder
    depends_on: []
    
  - id: 2
    name: "Validate {{Component A}}"
    owner: {{Component A}}Validator
    depends_on: [1]
    
  - id: 3
    name: "Build {{Component B}}"
    owner: {{Component B}}Builder
    depends_on: [2]  # Waits for A to be validated
```

### Step 6: Add Validation Commands
Include commands to verify the work:
```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Lint
npx eslint . --ext .ts,.js

# Custom validation for this task
{{CUSTOM_VALIDATION}}
```

---

## Output Format (Generated Plan)

The generated plan MUST follow this exact format:

```markdown
# {{PLAN_NAME}}

## Objective
{{Brief description of what this plan accomplishes}}

## Problem Statement
{{What problem are we solving}}

## Solution Approach
{{High-level approach}}

---

## Team Members

### Builders
{{For each builder:}}
- **{{Name}}Builder**
  - Role: Builder
  - Focus: {{What they build}}
  - Agent: agents/builder.md

### Validators
{{For each validator:}}
- **{{Name}}Validator**
  - Role: Validator
  - Validates: {{Name}}Builder
  - Agent: agents/validator.md

---

## Team Orchestration

The orchestrator will:
1. Assign tasks to builders in dependency order
2. After each builder completes, assign validation to corresponding validator
3. If validation fails, reassign to builder with feedback
4. Track progress via task system
5. Report completion when all tasks validated

---

## Step-by-Step Tasks

| # | Task | Owner | Depends On | Status |
|---|------|-------|------------|--------|
| 1 | {{Task 1}} | {{Owner}} | - | pending |
| 2 | {{Task 2}} | {{Owner}} | 1 | blocked |
| ... | ... | ... | ... | ... |

### Task Details

#### Task 1: {{Task Name}}
- **Owner:** {{Owner}}
- **Description:** {{Detailed description}}
- **Acceptance Criteria:**
  - [ ] {{Criterion 1}}
  - [ ] {{Criterion 2}}
- **Files to modify:** {{list of files}}

{{Repeat for each task}}

---

## Validation Commands

```bash
# Overall validation
{{commands}}
```

---

## Notes

{{Any additional context or considerations}}
```

---

## Example Usage

**User Request:**
"Add a new webhook endpoint for GitHub events"

**Orchestration Prompt:**
"Create builder+validator pairs for: route handler, event processor, tests"

**Generated Plan:**
- GitHubRouteBuilder → GitHubRouteValidator
- EventProcessorBuilder → EventProcessorValidator  
- TestBuilder → TestValidator
- Tasks ordered: Route → Validate → Processor → Validate → Tests → Validate
