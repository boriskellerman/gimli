---
title: Feature Development Workflow
type: workflow
description: Quick-reference guide for agents building new features in Gimli
---

# Feature Development Workflow

> **TAC Principle**: Template Engineering (Grade 5) - Encode engineering standards into reusable workflows.

## Quick Reference

```
┌─────────────────────────────────────────────────────────────────┐
│                     FEATURE DEVELOPMENT PHASES                    │
├────────────┬────────────┬────────────┬────────────┬─────────────┤
│   SCOUT    │    PLAN    │   BUILD    │    TEST    │   REVIEW    │
│  Research  │   Design   │   Code     │   Verify   │   Approve   │
├────────────┼────────────┼────────────┼────────────┼─────────────┤
│ • Read code│ • Template │ • Write    │ • Unit     │ • Security  │
│ • Find deps│ • Schemas  │ • Integrate│ • E2E      │ • Docs      │
│ • Document │ • APIs     │ • Types    │ • Manual   │ • Changelog │
└────────────┴────────────┴────────────┴────────────┴─────────────┘
```

---

## Phase 1: Scout (Research)

**Goal**: Understand before you build.

### Checklist
```markdown
- [ ] Read related source files
- [ ] Identify integration points
- [ ] Document existing behavior
- [ ] Find similar patterns in codebase
- [ ] List affected trust boundaries
```

### Commands
```bash
# Find related code
pnpm gimli grep "keyword"
rg "pattern" src/

# Understand structure
cat ARCHITECTURE.md
cat src/path/to/related/file.ts
```

### Output
- List of affected files
- Integration points identified
- Similar patterns found
- Security boundaries mapped

---

## Phase 2: Plan (Design)

**Goal**: Design before you code.

### Checklist
```markdown
- [ ] Create feature doc from FEATURE-TEMPLATE.md
- [ ] Define Zod schemas for all inputs
- [ ] Design API/CLI interfaces
- [ ] Plan file structure
- [ ] Sketch test cases
- [ ] Complete security analysis
```

### TAC Tactic: One Agent, One Prompt, One Purpose
If the feature is complex, break it into sub-tasks for parallel agent work:
- Schema agent → defines types and validation
- Implementation agent → writes core logic
- Test agent → writes test cases
- Docs agent → writes documentation

### Output
- Completed feature template
- TypeScript interfaces designed
- Zod schemas defined
- Test cases outlined

---

## Phase 3: Build (Implementation)

**Goal**: Write clean, focused code.

### Principles
1. **Keep files small** - Aim for <700 LOC; split if larger
2. **Use existing patterns** - Check `src/` for conventions
3. **Validate everything** - Zod schemas for all external inputs
4. **Comment tricky logic** - Brief explanations for complex code
5. **No over-engineering** - Only build what's needed now

### Checklist
```markdown
- [ ] Create new files in correct locations
- [ ] Define types in src/types/ or inline
- [ ] Implement Zod schemas
- [ ] Write core logic
- [ ] Add CLI/gateway/chat integration
- [ ] Use existing utilities (don't reinvent)
```

### File Conventions
| Type | Location | Naming |
|------|----------|--------|
| Core logic | `src/feature/` | `feature.ts` |
| Types | `src/types/` or inline | `feature.types.ts` |
| Schemas | adjacent to logic | `feature.schema.ts` |
| Tests | colocated | `feature.test.ts` |
| E2E tests | colocated | `feature.e2e.test.ts` |
| CLI command | `src/commands/` | `feature.ts` |
| Gateway RPC | `src/gateway/` | `feature-rpc.ts` |

### Security Requirements
```markdown
- [ ] No credentials in logs/errors
- [ ] All inputs validated via Zod
- [ ] Restrictive defaults (opt-in)
- [ ] Sandboxed if executing untrusted code
- [ ] No command injection vectors
```

---

## Phase 4: Test (Verification)

**Goal**: Prove it works.

### Checklist
```markdown
- [ ] Unit tests pass: pnpm test path/to/file.test.ts
- [ ] All tests pass: pnpm test
- [ ] Lint passes: pnpm lint
- [ ] Build passes: pnpm build
- [ ] Type check passes: pnpm build (includes tsc)
- [ ] Manual verification complete
```

### Test Commands
```bash
# Run specific test
pnpm test src/feature/feature.test.ts

# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Lint
pnpm lint

# Build (includes type check)
pnpm build
```

### Test Coverage Requirements
- 70% line coverage minimum
- 70% branch coverage minimum
- 70% function coverage minimum

### Edge Cases to Test
- Empty input
- Maximum input size
- Invalid/malformed input
- Missing required fields
- Concurrent access (if applicable)
- Network failures (if applicable)
- Timeout scenarios (if applicable)

---

## Phase 5: Review (Quality)

**Goal**: Ship with confidence.

### Pre-Commit Checklist
```markdown
- [ ] Code follows style guide (oxlint/oxfmt)
- [ ] Security checklist complete
- [ ] Tests cover happy path + edge cases
- [ ] Documentation updated
- [ ] Changelog entry added
- [ ] No debug code left behind
- [ ] No commented-out code
- [ ] No TODOs without linked issues
```

### Documentation Checklist
```markdown
- [ ] User docs: docs/feature.md
- [ ] Inline comments for complex logic
- [ ] Type definitions documented
- [ ] CLI help text accurate
- [ ] Changelog entry ready
```

### Changelog Format
```markdown
### Added
- Feature description ([#PR](link)) - Thanks @contributor!
```

---

## Validation Gate

Before marking a feature complete, verify:

```bash
# Full validation sequence
pnpm lint && pnpm build && pnpm test

# Doctor check (post-deploy)
gimli doctor
```

### Exit Criteria
- [ ] All phases complete
- [ ] All tests pass
- [ ] Security checklist verified
- [ ] Documentation complete
- [ ] Changelog entry added
- [ ] Code reviewed (self or peer)

---

## Quick Commands Reference

| Action | Command |
|--------|---------|
| Install deps | `pnpm install` |
| Dev mode | `pnpm dev` or `pnpm gimli ...` |
| Build | `pnpm build` |
| Test all | `pnpm test` |
| Test file | `pnpm test path/to/file.test.ts` |
| Test coverage | `pnpm test:coverage` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Type check | `pnpm build` (tsc runs as part of build) |
| Doctor | `pnpm gimli doctor` |

---

## Gimli-Specific Conventions

### Progress Tracking
Use CLI progress utilities from `src/cli/progress.ts`:
```typescript
import { createSpinner, updateProgress } from '../cli/progress.js';
```

### Table Output
Use terminal table utilities from `src/terminal/table.ts`:
```typescript
import { createTable, wrapText } from '../terminal/table.js';
```

### Palette Colors
Use shared palette from `src/terminal/palette.ts`:
```typescript
import { palette } from '../terminal/palette.js';
```

### Dependency Injection
Use `createDefaultDeps` pattern for testable code:
```typescript
export function createFeature(deps = createDefaultDeps()) {
  // Use deps.logger, deps.config, etc.
}
```

---

## Anti-Patterns to Avoid

| Don't | Do |
|-------|-----|
| Add features "while you're there" | Focus on the task at hand |
| Create new files for small changes | Edit existing files |
| Hand-roll spinners/progress bars | Use `src/cli/progress.ts` |
| Hardcode colors | Use `src/terminal/palette.ts` |
| Skip security checklist | Complete every item |
| Commit untested code | Run full test suite |
| Leave debug logs | Remove before commit |
| Add dependencies lightly | Prefer existing utilities |

---

## TAC Integration

This workflow implements TAC principles:

- **Tactic 3**: Template Engineering - This workflow is a template
- **Tactic 5**: Add Feedback Loops - Test/lint/build gates
- **Tactic 6**: One Agent, One Purpose - Each phase has clear scope
- **R&D Framework**: Reduce context by phase, delegate to sub-agents when complex

For complex features, spawn sub-agents:
```
Scout Agent → research only
Plan Agent → design only
Build Agent → implementation only
Test Agent → verification only
Review Agent → approval only
```

---

*Template version: 1.0*
*Last updated: 2026-02-01*
