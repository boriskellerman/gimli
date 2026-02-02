# Testing Closed-Loop Prompt

> A self-correcting prompt for comprehensive test development following the Request → Validate → Resolve pattern.

## Purpose

This prompt enables agents to autonomously write, run, and fix tests until they meet quality thresholds. The agent validates its own output against acceptance criteria and self-corrects when validation fails.

---

## Request Phase

### Input Schema

```yaml
target:
  type: string
  description: File path or module to test
  required: true

scope:
  type: enum
  values: [unit, integration, e2e]
  default: unit

coverage_threshold:
  type: number
  description: Minimum coverage percentage required
  default: 70

max_iterations:
  type: number
  description: Maximum self-correction attempts
  default: 3
```

### Context Requirements

The agent MUST gather before writing tests:
1. Read the target file completely
2. Identify all public functions, exports, and edge cases
3. Check existing test patterns in the codebase (look for `*.test.ts` siblings)
4. Understand dependencies and how to mock them

### Initial Task

```
You are writing tests for: {{target}}
Test scope: {{scope}}
Coverage target: {{coverage_threshold}}%

BEFORE writing any tests:
1. Read the target file and list all testable functions
2. Identify edge cases, error paths, and boundary conditions
3. Find existing test patterns in this codebase
4. Plan test structure (describe blocks, test cases)

Only proceed to write tests after completing this analysis.
```

---

## Validate Phase

### Acceptance Criteria

The agent MUST verify ALL of the following before marking tests complete:

| Criterion | Check Command | Pass Condition |
|-----------|---------------|----------------|
| Tests run | `pnpm test {{test_file}}` | Exit code 0 |
| Tests pass | `pnpm test {{test_file}}` | No failures |
| Coverage met | `pnpm test:coverage {{test_file}}` | >= {{coverage_threshold}}% |
| No type errors | `pnpm build` | Exit code 0 |
| Lint passes | `pnpm lint {{test_file}}` | Exit code 0 |

### Validation Script

```bash
# Run after writing tests
TEST_FILE="{{test_file}}"

echo "=== VALIDATION PHASE ==="

# 1. Type check
echo "[1/5] Type checking..."
pnpm build 2>&1 | tee /tmp/build.log
BUILD_EXIT=$?

# 2. Lint
echo "[2/5] Linting..."
pnpm lint "$TEST_FILE" 2>&1 | tee /tmp/lint.log
LINT_EXIT=$?

# 3. Run tests
echo "[3/5] Running tests..."
pnpm test "$TEST_FILE" 2>&1 | tee /tmp/test.log
TEST_EXIT=$?

# 4. Coverage
echo "[4/5] Checking coverage..."
pnpm test:coverage "$TEST_FILE" 2>&1 | tee /tmp/coverage.log
COV_EXIT=$?

# 5. Parse results
echo "[5/5] Validation summary..."
echo "Build: $BUILD_EXIT"
echo "Lint: $LINT_EXIT"
echo "Tests: $TEST_EXIT"
echo "Coverage: $COV_EXIT"
```

### Validation Output Format

```yaml
validation_result:
  passed: boolean
  failures:
    - criterion: string
      actual: string
      expected: string
      log_excerpt: string
  coverage:
    lines: number
    branches: number
    functions: number
    statements: number
  test_summary:
    total: number
    passed: number
    failed: number
    skipped: number
```

---

## Resolve Phase

### Self-Correction Rules

When validation FAILS, the agent MUST:

1. **Parse the failure**: Identify which criterion failed
2. **Diagnose root cause**: Read error logs, don't guess
3. **Apply targeted fix**: Only change what's broken
4. **Re-validate**: Run validation again
5. **Track iterations**: Stop after `max_iterations`

### Failure-Specific Resolution

#### Test Failures
```
If tests fail:
1. Read the test failure output carefully
2. Identify if it's:
   - Assertion error: Fix expected value or test logic
   - Runtime error: Fix test setup or mocking
   - Import error: Fix file paths or dependencies
3. Make the minimal change to fix
4. Do NOT delete failing tests without justification
```

#### Coverage Gaps
```
If coverage is below threshold:
1. Run coverage report to identify uncovered lines
2. List uncovered branches/functions
3. Write additional tests for uncovered paths:
   - Error handling paths
   - Edge cases (null, empty, boundary values)
   - Conditional branches
4. Re-run coverage check
```

#### Type Errors
```
If type errors occur:
1. Read the specific type error
2. Check if test file imports are correct
3. Verify mock types match real implementations
4. Fix type annotations, don't use `any`
```

#### Lint Errors
```
If lint fails:
1. Run lint with --fix flag first
2. For unfixable errors, read the rule and apply manually
3. Do NOT disable lint rules without explicit approval
```

### Iteration Tracking

```yaml
iteration: {{current_iteration}}
max_iterations: {{max_iterations}}
history:
  - iteration: 1
    action: "Initial test write"
    validation_passed: false
    failures: ["coverage below 70%"]
  - iteration: 2
    action: "Added edge case tests"
    validation_passed: true
    failures: []
status: {{completed|in_progress|max_iterations_exceeded}}
```

---

## Output Format

### Success Output

```markdown
## Test Development Complete

**Target**: {{target}}
**Test File**: {{test_file}}

### Validation Results
- Build: PASS
- Lint: PASS
- Tests: PASS ({{passed}}/{{total}})
- Coverage: {{coverage}}% (threshold: {{coverage_threshold}}%)

### Tests Written
- `describe('{{module}}')`: {{test_count}} tests
  - {{test_names}}

### Iterations: {{iterations}}/{{max_iterations}}
```

### Failure Output (Max Iterations)

```markdown
## Test Development Incomplete

**Target**: {{target}}
**Status**: Max iterations exceeded

### Final Validation State
- Build: {{build_status}}
- Lint: {{lint_status}}
- Tests: {{test_status}}
- Coverage: {{coverage}}%

### Unresolved Issues
{{list_of_failures}}

### Recommendation
{{human_action_needed}}
```

---

## Example Usage

### Input
```yaml
target: src/agents/identity.ts
scope: unit
coverage_threshold: 80
max_iterations: 3
```

### Agent Execution Flow

```
[Request] Read src/agents/identity.ts
[Request] Identified 4 exported functions: getIdentity, setIdentity, loadIdentityFile, saveIdentityFile
[Request] Found existing pattern: src/agents/identity.test.ts exists with 2 tests
[Request] Planning: Need tests for error paths, file not found, invalid JSON

[Write] Created 12 new test cases covering all functions
[Write] Added mocks for fs operations

[Validate] Running validation...
[Validate] Tests: PASS (12/12)
[Validate] Coverage: 65% (FAIL - below 80%)

[Resolve] Iteration 1: Coverage gap in loadIdentityFile error handling
[Resolve] Adding test for JSON parse error
[Resolve] Adding test for permission denied

[Validate] Running validation...
[Validate] Tests: PASS (14/14)
[Validate] Coverage: 82% (PASS)

[Complete] All criteria met in 2 iterations
```

---

## Integration Notes

### For ADW Integration
This prompt can be chained with:
- `plan-feature.md` (tests written after feature planning)
- `review-closed-loop.md` (tests reviewed before merge)

### For Agent Experts
Testing expertise should be stored in:
```yaml
# expertise/testing-mental-model.yaml
patterns:
  - name: "Mock file system operations"
    approach: "Use vi.mock with factory function"
    example: "vi.mock('fs/promises', () => ({ readFile: vi.fn() }))"

  - name: "Test async errors"
    approach: "Use rejects.toThrow pattern"
    example: "await expect(fn()).rejects.toThrow('error')"
```

---

*This prompt implements TAC Tactic 5 (Add Feedback Loops) and enables Out-Loop testing workflows.*
