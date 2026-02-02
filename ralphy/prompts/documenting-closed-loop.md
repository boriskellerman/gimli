# Documenting Closed-Loop Prompt

> A self-correcting prompt for comprehensive documentation following the Request → Validate → Resolve pattern.

## Purpose

This prompt enables agents to autonomously write, validate, and improve documentation until it meets quality standards. The agent verifies documentation accuracy against the actual code and self-corrects discrepancies.

---

## Request Phase

### Input Schema

```yaml
target:
  type: string
  description: File, module, or feature to document
  required: true

doc_type:
  type: enum
  values: [api, guide, reference, changelog, readme]
  default: reference

output_path:
  type: string
  description: Where to write documentation
  required: false
  default: "docs/{{target_name}}.md"

audience:
  type: enum
  values: [developers, users, operators]
  default: developers

max_iterations:
  type: number
  description: Maximum self-correction attempts
  default: 3
```

### Context Requirements

The agent MUST gather before writing:
1. Read the target code completely
2. Understand all public APIs, functions, and interfaces
3. Check existing documentation for style and format
4. Identify examples in tests or usage patterns

### Initial Task

```
You are documenting: {{target}}
Documentation type: {{doc_type}}
Audience: {{audience}}
Output: {{output_path}}

BEFORE writing any documentation:
1. Read the target code thoroughly
2. List all public APIs/exports to document
3. Check existing doc style in docs/ directory
4. Find usage examples in tests or codebase

Only write documentation after completing this analysis.
```

---

## Validate Phase

### Documentation Quality Criteria

The agent MUST verify ALL of the following:

| Criterion | Definition | Validation Method |
|-----------|------------|-------------------|
| Accurate | Matches actual code behavior | Cross-check against source |
| Complete | All public APIs documented | Compare exports vs docs |
| Correct examples | Code examples work | Mental execution or actual run |
| Consistent format | Follows doc style guide | Compare with existing docs |
| Links valid | Internal links work | Check file paths exist |
| No stale info | Reflects current code | Compare with recent changes |

### Accuracy Validation

For EACH documented item, verify:

```yaml
accuracy_check:
  - item: "getUser(id: string)"
    documented_signature: "getUser(id: string): Promise<User>"
    actual_signature: "getUser(id: string): Promise<User | null>"
    accurate: false
    issue: "Missing null return type"
```

### Completeness Check

```yaml
completeness:
  total_exports: 12
  documented_exports: 10
  missing:
    - "validateInput()"
    - "DEFAULT_CONFIG"
  coverage: 83.3%
  threshold: 100%
  passed: false
```

### Example Validation

For EACH code example, verify:

```yaml
example_validation:
  - example_id: 1
    code: |
      const user = await getUser("123");
      console.log(user.name);
    checks:
      imports_valid: true
      types_correct: true
      would_run: false  # user could be null
    passed: false
    issue: "Example doesn't handle null case"
```

### Link Validation

```yaml
link_check:
  - link: "[Configuration](/configuration)"
    target: "docs/configuration.md"
    exists: true
    passed: true
  - link: "[API Reference](/api/users)"
    target: "docs/api/users.md"
    exists: false
    passed: false
```

---

## Resolve Phase

### Self-Correction Rules

When validation FAILS, the agent MUST:

1. **Inaccurate signature**: Update docs to match actual code
2. **Missing export**: Add documentation for missing item
3. **Broken example**: Fix example code to actually work
4. **Invalid link**: Fix path or remove link
5. **Stale info**: Update to reflect current behavior

### Correction Templates

#### Fix Inaccurate Signature
```markdown
BEFORE:
### getUser(id)
Returns a user by ID.

AFTER:
### getUser(id)
Returns a user by ID, or `null` if not found.

**Parameters:**
- `id` (string): The user ID

**Returns:** `Promise<User | null>`
```

#### Add Missing Documentation
```markdown
### validateInput(input)

Validates user input against the schema.

**Parameters:**
- `input` (unknown): Raw input to validate

**Returns:** `ValidationResult`

**Throws:** `ValidationError` if input is malformed

**Example:**
\`\`\`typescript
const result = validateInput({ name: "Alice" });
if (!result.valid) {
  console.error(result.errors);
}
\`\`\`
```

#### Fix Broken Example
```markdown
BEFORE:
\`\`\`typescript
const user = await getUser("123");
console.log(user.name);
\`\`\`

AFTER:
\`\`\`typescript
const user = await getUser("123");
if (user) {
  console.log(user.name);
} else {
  console.log("User not found");
}
\`\`\`
```

### Iteration Tracking

```yaml
iteration: {{current_iteration}}
max_iterations: {{max_iterations}}
history:
  - iteration: 1
    accuracy_score: 75%
    completeness: 83%
    examples_valid: 2/4
    links_valid: 5/5
    issues: ["2 inaccurate signatures", "2 missing exports", "2 broken examples"]
  - iteration: 2
    accuracy_score: 100%
    completeness: 100%
    examples_valid: 4/4
    links_valid: 5/5
    issues: []
status: {{completed|in_progress|max_iterations_exceeded}}
```

---

## Output Format

### Documentation Output Structure

The actual documentation format depends on `doc_type`:

#### API Reference Format
```markdown
# {{Module Name}} API

{{brief_description}}

## Installation

\`\`\`bash
npm install {{package}}
\`\`\`

## Quick Start

\`\`\`typescript
{{quick_example}}
\`\`\`

## API Reference

### Functions

#### functionName(params)

{{description}}

**Parameters:**
- `param1` (type): Description

**Returns:** `ReturnType`

**Example:**
\`\`\`typescript
{{example}}
\`\`\`

### Types

#### TypeName

\`\`\`typescript
interface TypeName {
  property: type;
}
\`\`\`

### Constants

#### CONSTANT_NAME

{{description}}

**Value:** `{{value}}`
```

#### Guide Format
```markdown
# {{Guide Title}}

## Overview

{{what_this_guide_covers}}

## Prerequisites

- {{prerequisite_1}}
- {{prerequisite_2}}

## Step 1: {{step_title}}

{{explanation}}

\`\`\`typescript
{{code}}
\`\`\`

## Step 2: {{step_title}}

{{explanation}}

## Troubleshooting

### {{common_issue}}

{{solution}}

## Next Steps

- [Related Guide 1](/path)
- [Related Guide 2](/path)
```

### Validation Report

```markdown
## Documentation Validation Report

**Target**: {{target}}
**Output**: {{output_path}}

### Quality Metrics
| Metric | Score | Threshold | Status |
|--------|-------|-----------|--------|
| Accuracy | {{accuracy}}% | 100% | {{status}} |
| Completeness | {{completeness}}% | 100% | {{status}} |
| Examples Valid | {{examples_valid}}/{{examples_total}} | 100% | {{status}} |
| Links Valid | {{links_valid}}/{{links_total}} | 100% | {{status}} |

### Items Documented
{{list_of_documented_items}}

### Iterations: {{iterations}}/{{max_iterations}}
```

---

## Example Usage

### Input
```yaml
target: src/agents/identity.ts
doc_type: api
output_path: docs/api/identity.md
audience: developers
max_iterations: 3
```

### Agent Execution Flow

```
[Request] Reading src/agents/identity.ts...
[Request] Found 6 exports: getIdentity, setIdentity, loadIdentityFile, saveIdentityFile, IdentityConfig, DEFAULT_IDENTITY
[Request] Checking existing doc style in docs/api/...
[Request] Found usage examples in identity.test.ts

[Write] Creating docs/api/identity.md
[Write] Documenting 6 exports with examples

[Validate] Checking accuracy...
[Validate] getIdentity: PASS - signature matches
[Validate] setIdentity: FAIL - missing optional parameter 'persist'
[Validate] loadIdentityFile: PASS
[Validate] saveIdentityFile: PASS
[Validate] Accuracy: 83%

[Validate] Checking completeness...
[Validate] Completeness: 100%

[Validate] Checking examples...
[Validate] Example 1: FAIL - doesn't show error handling
[Validate] Example 2: PASS

[Resolve] Iteration 1:
  - Fixing setIdentity signature to include 'persist?: boolean'
  - Adding try/catch to Example 1

[Validate] All checks pass
[Validate] Accuracy: 100%, Completeness: 100%, Examples: 2/2

[Complete] Documentation finalized in 2 iterations
```

---

## Integration Notes

### For Mintlify Docs (Gimli-specific)
- Use root-relative links without `.md` extension
- Avoid em dashes and apostrophes in headings (breaks anchors)
- End replies with full `https://docs.gimli.bot/...` URLs when requested

### For ADW Integration
Chain with:
- `testing-closed-loop.md` (ensure tests exist for documented behavior)
- `reviewing-closed-loop.md` (review docs before publishing)

### For Changelog Documentation
When `doc_type: changelog`:
```markdown
## {{version}} - {{date}}

### Added
- {{new_feature}} (#{{pr_number}})

### Changed
- {{modification}} (#{{pr_number}})

### Fixed
- {{bug_fix}} (#{{pr_number}})

### Thanks
- @{{contributor}} for {{contribution}}
```

### For Agent Experts
Documentation expertise should be stored in:
```yaml
# expertise/documentation-mental-model.yaml
patterns:
  - name: "API reference structure"
    elements: ["brief description", "parameters table", "return type", "example", "throws"]

  - name: "Guide structure"
    elements: ["overview", "prerequisites", "numbered steps", "troubleshooting", "next steps"]

common_issues:
  - issue: "Documenting internal implementation details"
    fix: "Focus only on public API surface"

  - issue: "Examples that assume global state"
    fix: "Make examples self-contained with explicit setup"
```

### Staleness Prevention

Run this prompt periodically with:
```yaml
target: docs/**/*.md
doc_type: reference
# Special mode: validates existing docs against current code
mode: audit
```

---

*This prompt implements TAC Lesson 10's stakeholder trifecta: documentation serves You, Your Team, and Your Agents.*
