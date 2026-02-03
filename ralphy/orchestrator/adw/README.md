# AI Developer Workflows (ADWs)

> Deterministic code + Non-deterministic agents = Reliable automation

ADWs are the highest level of composition in the TAC framework. They wrap agent calls in deterministic orchestration code, providing:

- **Structured inputs** - Well-defined parameters for each step
- **Validation** - Check outputs before proceeding
- **Retries** - Automatic recovery from transient failures
- **Logging** - Full audit trail of all operations
- **Composition** - Chain multiple workflows together

## Available Workflows

| ADW | Description | Trigger |
|-----|-------------|---------|
| `plan-build` | Plan a feature → Build it → Test it | New feature request |
| `test-fix` | Run tests → Identify failures → Fix bugs | Test failure detected |
| `review-document` | Review code → Generate docs | PR ready for review |
| `security-audit` | Scan vulnerabilities → Report findings | Scheduled or on-demand |
| `bug-investigate` | Reproduce → Root cause → Fix → Verify | Bug report received |
| `refactor` | Analyze → Plan → Execute → Validate | Tech debt cleanup |

## Workflow Structure

Each ADW follows the PETER framework:
- **P**rompt - Input specification
- **E**nvironment - Execution context
- **T**rigger - What starts the workflow
- **E**xecute - The workflow steps
- **R**esult - Output format and validation

## Usage

```typescript
// Example: Trigger plan-build ADW
await orchestrator.runWorkflow('plan-build', {
  feature: 'Add rate limiting to gateway',
  priority: 'high',
  context: ['src/gateway/', 'docs/ARCHITECTURE.md']
});
```

## Composition

ADWs can be composed:

```
bug-investigate
    └── test-fix (if tests fail during verification)
        └── review-document (after fix is complete)
```

## Metrics

Each ADW run captures:
- Duration (ms)
- Token usage
- Success/failure status
- Files modified
- Tests run/passed
- Errors encountered

---

*ADWs are the building blocks of Zero Touch Engineering*
