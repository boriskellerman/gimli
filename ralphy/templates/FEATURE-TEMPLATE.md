---
title: "[FEATURE-NAME]"
type: feature
status: draft | planning | in-progress | review | complete
owner: "[agent-name or human]"
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
security_reviewed: false
---

# Feature: [FEATURE-NAME]

> **One-sentence summary**: What does this feature do and why does it matter?

## 1. Context & Motivation

### Why Now?
Explain the trigger for this feature:
- User request / pain point
- Technical debt / limitation
- Upstream opportunity (Gimli sync)
- Security hardening need

### Current State
Describe what exists today:
- Related functionality already in Gimli
- Gaps or limitations in current approach
- Relevant code paths: `src/...`, `extensions/...`

### Success Criteria
How will we know this feature is complete and working?
- [ ] Criterion 1: Measurable outcome
- [ ] Criterion 2: Measurable outcome
- [ ] Criterion 3: Measurable outcome

---

## 2. Scope

### Goals
What this feature WILL accomplish:
1. Primary goal
2. Secondary goal
3. Tertiary goal (if applicable)

### Non-Goals
What this feature will NOT address (explicitly out of scope):
- Non-goal 1 (rationale)
- Non-goal 2 (rationale)
- Non-goal 3 (rationale)

### Dependencies
- [ ] Requires: [dependency] to be complete first
- [ ] Blocked by: [blocker] if applicable
- [ ] Integrates with: [existing system]

---

## 3. Security Analysis

> **Gimli is security-hardened.** Every feature must pass security review.

### Trust Boundaries Affected
Check all that apply:
- [ ] Gateway (WebSocket, RPC, HTTP endpoints)
- [ ] Channel adapters (external messaging platforms)
- [ ] Agent runtime (AI model interaction)
- [ ] Tool system (bash, browser, file ops)
- [ ] Sandbox (Docker / host execution)
- [ ] Credentials (auth-profiles, tokens, API keys)
- [ ] Configuration (gimli.json, environment)
- [ ] Plugins/Extensions (third-party code)

### Security Checklist
- [ ] No credentials exposed in logs, errors, or responses
- [ ] All external inputs validated and sanitized
- [ ] Default to restrictive permissions (opt-in, not opt-out)
- [ ] Sandboxed execution where appropriate
- [ ] Rate limiting considered (if applicable)
- [ ] CSRF/CORS implications reviewed (if HTTP endpoint)
- [ ] No command injection vectors introduced
- [ ] Schema validation via Zod for all inputs

### Risk Assessment
| Risk | Severity | Mitigation |
|------|----------|------------|
| Example: Untrusted user input | High | Zod schema validation + sanitization |

---

## 4. Design

### Architecture Overview
```
[ASCII diagram or description of data flow]
```

### Key Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Decision 1 | Why this approach | What was rejected |

### API / Interface Changes

#### New CLI Commands (if any)
```bash
gimli [command] [args]
```

#### New Gateway Methods (if any)
```typescript
// RPC method signature
```

#### New Chat Commands (if any)
- `/command` — description

#### Configuration Changes (if any)
```json
{
  "new.config.key": "default_value"
}
```

### Data Model Changes (if any)
- New types in `src/types/...`
- Schema changes in `src/.../schema.ts`

---

## 5. Implementation Plan

### Phase 1: Scout (Research)
- [ ] Review related code: `src/...`
- [ ] Identify integration points
- [ ] Document current behavior
- [ ] Validate assumptions with tests

### Phase 2: Plan (Design)
- [ ] Write detailed design doc (this section)
- [ ] Create TypeScript interfaces/types
- [ ] Define Zod schemas for validation
- [ ] Sketch test cases

### Phase 3: Build (Implementation)
- [ ] Create new files: `src/...`
- [ ] Modify existing files: `src/...`
- [ ] Add/update types
- [ ] Implement core logic
- [ ] Add CLI/gateway/chat integration

### Phase 4: Test (Verification)
- [ ] Unit tests: `src/.../*.test.ts`
- [ ] Integration tests: `src/.../*.e2e.test.ts`
- [ ] Manual verification steps
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes

### Phase 5: Review (Quality)
- [ ] Self-review: code style, complexity
- [ ] Security review: checklist above complete
- [ ] Documentation updated
- [ ] Changelog entry added

### Phase 6: Deploy (Rollout)
- [ ] Feature flag (if applicable)
- [ ] Staged rollout plan
- [ ] Monitoring / alerting
- [ ] Rollback plan

---

## 6. Testing Strategy

### Unit Tests
| Test Case | File | Description |
|-----------|------|-------------|
| test-1 | `src/.../file.test.ts` | What it validates |

### Integration Tests
| Test Case | File | Description |
|-----------|------|-------------|
| e2e-test-1 | `src/.../file.e2e.test.ts` | End-to-end scenario |

### Manual Verification
1. Step-by-step manual test procedure
2. Expected outcomes
3. Edge cases to verify

### Edge Cases
- [ ] Empty input
- [ ] Maximum input size
- [ ] Invalid/malformed input
- [ ] Concurrent access
- [ ] Network failures
- [ ] Timeout scenarios

---

## 7. Documentation

### User-Facing Docs
- [ ] New page: `docs/.../*.md`
- [ ] Update: `docs/.../existing.md`
- [ ] Changelog: `CHANGELOG.md`

### Developer Docs
- [ ] Architecture: `ARCHITECTURE.md` (if structural changes)
- [ ] AGENTS.md / CLAUDE.md (if new conventions)
- [ ] Inline code comments for complex logic

### Docs Links
After implementation, list the docs URLs:
- https://docs.gimli.bot/...

---

## 8. Rollback Plan

### How to Revert
```bash
# Git revert command or rollback steps
git revert <commit-sha>
```

### Feature Flag (if applicable)
```json
{
  "feature.name.enabled": false
}
```

### Data Migration Rollback (if applicable)
Steps to undo any data changes.

---

## 9. Post-Launch

### Monitoring
- Log messages to watch for
- Error patterns to alert on
- Metrics to track

### Success Metrics
- [ ] Metric 1: Target value
- [ ] Metric 2: Target value

### Known Limitations
- Limitation 1: Why it exists, future fix plan
- Limitation 2: Why it exists, future fix plan

### Follow-up Tasks
- [ ] Future enhancement 1
- [ ] Future enhancement 2
- [ ] Tech debt to address

---

## 10. Changelog Entry

```markdown
### Added
- Feature description ([#PR](link)) - Thanks @contributor!
```

---

## Appendix

### Research Notes
Any raw research, links, or reference material.

### Open Questions
- [ ] Question 1: Who to ask / how to resolve
- [ ] Question 2: Who to ask / how to resolve

### Related Issues/PRs
- Issue #X: Description
- PR #Y: Description
