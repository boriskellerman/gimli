# Reviewing Closed-Loop Prompt

> A self-correcting prompt for comprehensive code review following the Request → Validate → Resolve pattern.

## Purpose

This prompt enables agents to autonomously review code, identify issues, and verify that feedback is actionable and accurate. The agent validates its own review against quality criteria and self-corrects vague or incorrect feedback.

---

## Request Phase

### Input Schema

```yaml
target:
  type: string
  description: PR number, commit SHA, or file path(s) to review
  required: true

review_type:
  type: enum
  values: [pr, commit, files]
  default: pr

focus_areas:
  type: array
  items: [security, performance, correctness, style, architecture]
  default: [correctness, security]

severity_threshold:
  type: enum
  values: [critical, high, medium, low]
  default: medium
  description: Minimum severity to report

max_iterations:
  type: number
  description: Maximum self-correction attempts for review quality
  default: 2
```

### Context Requirements

The agent MUST gather before reviewing:
1. Read the diff or file changes completely
2. Understand the intent (PR description, commit message, or infer from changes)
3. Check related files for context (imports, callers, tests)
4. Load project standards (CLAUDE.md, .eslintrc, tsconfig.json)

### Initial Task

```
You are reviewing: {{target}}
Review type: {{review_type}}
Focus areas: {{focus_areas}}
Severity threshold: {{severity_threshold}}

BEFORE writing any review comments:
1. Read the complete diff/changes
2. Understand the purpose and intent of the changes
3. Check related code for context
4. Review against project standards

Only provide feedback after completing this analysis.
```

---

## Validate Phase

### Review Quality Criteria

The agent MUST verify ALL review comments meet these standards:

| Criterion | Definition | Validation Method |
|-----------|------------|-------------------|
| Specific | Points to exact line/code | Comment references file:line |
| Actionable | Includes fix suggestion | Contains "Consider..." or code example |
| Accurate | Issue actually exists | Re-read code confirms issue |
| Relevant | Within focus areas | Matches requested focus areas |
| Calibrated | Severity is appropriate | Not over/under-classified |

### Self-Validation Checklist

For EACH review comment, verify:

```yaml
comment_validation:
  - id: 1
    file: "src/example.ts"
    line: 42
    checks:
      specific: true  # Does it reference exact location?
      actionable: true  # Does it suggest a fix?
      accurate: true  # Re-reading code, is the issue real?
      relevant: true  # Is it in focus areas?
      calibrated: true  # Is severity correct?
    passed: true
```

### Review Quality Score

```
Quality Score = (valid_comments / total_comments) * 100

PASS: Score >= 80%
FAIL: Score < 80%
```

### False Positive Detection

Before finalizing, the agent MUST check for common false positives:

1. **Misread code flow**: Re-trace execution path
2. **Missing context**: Check if issue is handled elsewhere
3. **Style preference vs actual issue**: Distinguish opinion from problem
4. **Already tested**: Check if test coverage exists for concern

---

## Resolve Phase

### Self-Correction Rules

When a review comment fails validation:

1. **Vague comment**: Add specific file:line reference and code snippet
2. **No fix suggested**: Add "Consider doing X instead" with example
3. **Inaccurate**: Delete the comment, don't guess
4. **Wrong severity**: Recalibrate based on actual impact
5. **Out of scope**: Remove if not in focus areas (unless critical)

### Comment Improvement Templates

#### Make Specific
```markdown
BEFORE: "This could cause issues"
AFTER: "In `src/auth.ts:42`, the `validateToken()` function doesn't handle expired tokens, which could allow unauthorized access."
```

#### Make Actionable
```markdown
BEFORE: "This is inefficient"
AFTER: "This O(n²) loop in `processItems()` could be optimized. Consider using a Map for O(1) lookups:
\`\`\`typescript
const itemMap = new Map(items.map(i => [i.id, i]));
\`\`\`"
```

#### Recalibrate Severity
```markdown
Severity Guide:
- CRITICAL: Security vulnerability, data loss, production breakage
- HIGH: Bug that affects functionality, performance regression
- MEDIUM: Code smell, maintainability issue, minor bug
- LOW: Style, naming, documentation
```

### Iteration Tracking

```yaml
iteration: {{current_iteration}}
max_iterations: {{max_iterations}}
history:
  - iteration: 1
    total_comments: 8
    valid_comments: 5
    quality_score: 62.5
    issues: ["3 comments lacked specific line references"]
  - iteration: 2
    total_comments: 7
    valid_comments: 7
    quality_score: 100
    issues: []
status: {{completed|in_progress|max_iterations_exceeded}}
```

---

## Output Format

### Review Output Structure

```markdown
## Code Review: {{target}}

### Summary
{{one_line_summary}}

### Review Focus
- Focus areas: {{focus_areas}}
- Files reviewed: {{file_count}}
- Lines changed: +{{additions}} -{{deletions}}

### Findings

#### Critical ({{count}})
{{critical_findings}}

#### High ({{count}})
{{high_findings}}

#### Medium ({{count}})
{{medium_findings}}

#### Low ({{count}})
{{low_findings}}

### Recommendation
- [ ] **Approve**: Ready to merge
- [ ] **Request Changes**: Must address critical/high issues
- [ ] **Comment**: Suggestions only, merge at discretion

### Review Quality
- Comments validated: {{valid_count}}/{{total_count}}
- Quality score: {{score}}%
- Iterations: {{iterations}}/{{max_iterations}}
```

### Individual Finding Format

```markdown
#### [SEVERITY] Issue Title
**Location**: `file.ts:42`
**Category**: {{security|performance|correctness|style|architecture}}

**Issue**: {{description_of_problem}}

**Impact**: {{why_this_matters}}

**Suggestion**:
\`\`\`typescript
// Suggested fix
{{code_example}}
\`\`\`
```

---

## Example Usage

### Input
```yaml
target: PR #1234
review_type: pr
focus_areas: [security, correctness]
severity_threshold: medium
max_iterations: 2
```

### Agent Execution Flow

```
[Request] Fetching PR #1234 diff...
[Request] Reading PR description: "Add user authentication middleware"
[Request] Files changed: 3 (auth.ts, middleware.ts, auth.test.ts)
[Request] Loading project security guidelines from CLAUDE.md

[Review] Analyzing auth.ts...
[Review] Found 4 potential issues

[Validate] Checking review quality...
[Validate] Comment 1: PASS (specific, actionable, accurate)
[Validate] Comment 2: FAIL (no specific line reference)
[Validate] Comment 3: FAIL (inaccurate - issue already handled in line 58)
[Validate] Comment 4: PASS
[Validate] Quality score: 50% (FAIL)

[Resolve] Iteration 1:
  - Comment 2: Adding specific reference to line 34
  - Comment 3: Removing - false positive
[Resolve] Re-validating...

[Validate] All 3 comments pass validation
[Validate] Quality score: 100% (PASS)

[Complete] Review finalized in 2 iterations
```

---

## Integration Notes

### For PR Workflow
This prompt integrates with:
- `gh pr view` for fetching PR data
- `gh pr diff` for getting changes
- `gh pr review` for submitting review

### For ADW Integration
Chain with:
- `testing-closed-loop.md` (ensure tests cover review concerns)
- `documenting-closed-loop.md` (update docs based on review)

### For Agent Experts
Review expertise should be stored in:
```yaml
# expertise/review-mental-model.yaml
patterns:
  - name: "SQL injection detection"
    signals: ["string concatenation with user input", "no parameterized queries"]
    severity: critical

  - name: "Race condition detection"
    signals: ["shared state", "no mutex/lock", "async without await"]
    severity: high

common_false_positives:
  - pattern: "unused variable warning"
    check: "Is it used in a later commit in the PR?"

  - pattern: "missing null check"
    check: "Is there a type guard or optional chaining upstream?"
```

### Security Review Checklist

When `security` is in focus_areas, MUST check:
- [ ] Input validation on all external data
- [ ] No secrets/credentials in code
- [ ] Proper authentication/authorization
- [ ] No SQL/command injection vulnerabilities
- [ ] Secure defaults (deny by default)
- [ ] Error messages don't leak sensitive info

---

*This prompt implements TAC Tactic 2 (Adopt the Agent's Perspective) by making review criteria explicit and verifiable.*
