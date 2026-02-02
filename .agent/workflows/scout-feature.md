---
description: Scout a feature before building - parallel research on architecture, patterns, dependencies, and tests
---

# Feature Scout Workflow

Use this workflow before implementing a new feature. It spawns parallel scouts to research:
- Architecture patterns in the affected area
- Coding conventions and patterns
- Relevant dependencies
- Existing test coverage and gaps

## Quick Reference

```bash
# Run feature scout
/scout feature "Add user notifications via WebSocket"

# Or manually trigger scouts in parallel
sessions_spawn task:"Architecture scout: analyze src/notifications/ structure and patterns" label:"arch-scout"
sessions_spawn task:"Pattern scout: find notification and real-time patterns in codebase" label:"pattern-scout"
sessions_spawn task:"Dependency scout: analyze WebSocket libraries and current deps" label:"deps-scout"
sessions_spawn task:"Test scout: find test patterns for notifications and real-time features" label:"test-scout"
```

---

## Phase 1: Analyze Feature Request

Before spawning scouts, understand what needs to be researched:

1. **Identify affected areas**: Which directories/modules will this feature touch?
2. **List new capabilities needed**: What new dependencies or patterns might be required?
3. **Consider testing needs**: What test types will be needed?

---

## Phase 2: Spawn Parallel Scouts

Launch scouts simultaneously for faster research:

### Architecture Scout
```
Task: Analyze the architecture of [affected directories].
Focus on:
- Directory structure and module organization
- Design patterns in use
- Data flow and dependencies between modules
- Entry points and extension points
- Configuration patterns

Report findings in structured format with file paths and code examples.
```

### Pattern Scout
```
Task: Find coding patterns related to [feature area] in this codebase.
Focus on:
- Naming conventions for files, functions, types
- Error handling patterns
- Logging and monitoring patterns
- State management approaches
- API design conventions

Report findings with concrete examples from the codebase.
```

### Dependency Scout
```
Task: Analyze dependencies relevant to [new capability].
Focus on:
- Current similar dependencies already in package.json
- Recommended packages for [capability] with pros/cons
- Security status and maintenance activity
- Bundle size impact
- Integration complexity

Report findings with specific package recommendations.
```

### Test Scout
```
Task: Analyze testing patterns in [affected directories].
Focus on:
- Test file locations and naming conventions
- Testing frameworks and utilities in use
- Mocking patterns and test fixtures
- Coverage gaps in related areas
- Integration vs unit test balance

Report findings with example test structures.
```

---

## Phase 3: Synthesize Findings

After all scouts complete, synthesize their findings:

```
## Feature Scout Summary: [Feature Name]

### Architecture Findings
[Summarize architecture scout output]
- Key modules affected: [list]
- Extension points: [list]
- Patterns to follow: [list]

### Pattern Findings
[Summarize pattern scout output]
- Naming conventions: [summary]
- Error handling: [summary]
- Relevant patterns found: [list with file references]

### Dependency Analysis
[Summarize dependency scout output]
- Existing relevant deps: [list]
- Recommended new deps: [list with reasoning]
- No-go deps: [list with reasoning]

### Testing Strategy
[Summarize test scout output]
- Test structure to follow: [description]
- Required test types: [unit, integration, e2e]
- Coverage gaps to address: [list]

### Recommendations
1. [First recommendation with rationale]
2. [Second recommendation with rationale]
3. [Third recommendation with rationale]

### Files to Modify/Create
- [file path]: [purpose]
- [file path]: [purpose]
```

---

## Phase 4: Proceed to Planning

Use scout findings to inform the implementation plan:

```bash
# Create implementation plan with scout context
/plan "Implement [feature]" --context "Scout findings: [summary]"
```

The plan should reference specific findings:
- "Following the middleware pattern found in src/auth/middleware.ts..."
- "Using existing ErrorHandler class as documented by pattern scout..."
- "Adding tests following the pattern in src/notifications/*.test.ts..."

---

## Example: Adding OAuth2 Authentication

### 1. Feature Analysis
- Affected areas: `src/auth/`, `src/middleware/`, `src/routes/`
- New capabilities: OAuth2 provider integration, token refresh
- Testing needs: Unit tests, integration tests with mock OAuth server

### 2. Scout Tasks

**Architecture Scout:**
```
Analyze src/auth/ architecture.
Focus on provider pattern, session handling, middleware integration.
```

**Pattern Scout:**
```
Find authentication and authorization patterns.
Focus on error handling, token validation, route protection.
```

**Dependency Scout:**
```
Analyze OAuth2 library options.
Compare passport-oauth2, @auth0/passport-auth0, simple-oauth2.
```

**Test Scout:**
```
Analyze auth test patterns in src/auth/*.test.ts.
Focus on mocking strategies, test fixtures, integration test setup.
```

### 3. Synthesized Findings

```
## Feature Scout Summary: OAuth2 Authentication

### Architecture
- Auth uses provider pattern (src/auth/providers/*.ts)
- Each provider implements IAuthProvider interface
- Session stored via session-store.ts with Redis backend
- Middleware in src/middleware/auth.ts checks session

### Patterns
- Errors: throw new AuthError(code, message, context)
- Logging: logger.auth.info/error with structured data
- Validation: Zod schemas in src/auth/schemas/

### Dependencies
- Existing: passport (v0.7.0), passport-local
- Recommended: passport-oauth2 (flexible, well-maintained)
- Alternative: @auth0/passport-auth0 (if using Auth0 specifically)

### Testing
- Pattern: describe blocks per feature, it blocks per case
- Mocking: vi.mock for external services
- Fixtures: src/auth/__fixtures__/mock-users.ts
- Gap: No integration tests for token refresh

### Recommendations
1. Create src/auth/providers/oauth2.ts implementing IAuthProvider
2. Add OAuth2 config schema to src/auth/schemas/oauth2.ts
3. Extend session to store refresh tokens
4. Add integration tests for full OAuth flow
```

### 4. Proceed to Build

With these findings, the build phase knows exactly:
- Where to add new files
- What patterns to follow
- Which dependencies to use
- How to structure tests

---

## Troubleshooting

### Scouts returning too much information

Be more specific in scout tasks:
```
# Too broad
"Analyze the codebase architecture"

# Better
"Analyze src/auth/providers/ architecture, specifically the provider interface pattern"
```

### Scouts missing relevant information

Run additional targeted scouts:
```bash
sessions_spawn task:"Deep dive: How does session expiry work in src/session/?" label:"deep-scout"
```

### Conflicting recommendations from scouts

When scouts conflict, prefer:
1. Existing patterns in the codebase
2. More recent implementations
3. Better test coverage approaches
