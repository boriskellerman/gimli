## Iteration Tracking

Track each attempt to solve the problem. This builds institutional knowledge.

### Format
```
ITERATION 1:
  Approach: [what you tried]
  Result: [what happened]
  Learning: [what you learned]
  Next: [what to try next]

ITERATION 2:
  Approach: [adjusted based on iteration 1]
  Result: [what happened]
  Learning: [what you learned]
  Next: [continue or escalate]
```

### Escalation Rules
- **After 3 failed iterations:** Stop. Report what you tried, what failed, and your best hypothesis.
- **On unfamiliar territory:** Read documentation before guessing. Check `docs/`, TOOLS.md, MEMORY.md.
- **On dependency issues:** Check upstream. Don't fight the framework — understand it first.
- **On flaky tests:** Investigate root cause, don't just re-run. Timing? State? Race condition?

### Anti-Patterns
- ❌ Retrying the same approach hoping for different results
- ❌ Making the change bigger when it should be smaller
- ❌ Fixing symptoms instead of root causes
- ❌ Modifying tests to make them pass (instead of fixing the code)
