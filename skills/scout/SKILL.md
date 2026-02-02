---
name: scout
description: Research codebase before building. Spawn parallel scout agents to investigate architecture, dependencies, patterns, and tests before implementation.
metadata: {"gimli":{"emoji":"🔍"}}
---

# Scout Agents Skill

Scout agents research the codebase **before** you build. They investigate architecture patterns, dependencies, existing code, and testing strategies to produce structured research findings that inform implementation decisions.

## Quick Start

```bash
# Scout a feature before implementing
/scout feature "Add OAuth2 authentication"

# Scout a bug before fixing
/scout bug "Users can't reset passwords in Safari"

# Run specific scout types
/scout architecture src/auth/
/scout dependencies @auth0/auth0-spa-js
/scout tests "password reset"
/scout patterns "error handling in API routes"
```

## The Scout Philosophy

**Research before building.** Scout agents follow TAC (Tactical Agentic Coding) principles:

1. **Reduce context** - Scouts gather only relevant information
2. **Delegate research** - Parallel scouts explore different aspects
3. **Inform decisions** - Findings shape the implementation plan
4. **Stay focused** - Each scout has one purpose

## Scout Types

### Architecture Scout

Investigates code structure, file organization, and architectural patterns.

```bash
/scout architecture src/auth/
/scout architecture --depth deep src/api/
```

**Finds:**
- Directory structure and module organization
- Design patterns in use (MVC, CQRS, etc.)
- Separation of concerns analysis
- Entry points and flow paths
- Configuration and dependency injection patterns

### Dependency Scout

Analyzes dependencies, versions, and compatibility.

```bash
/scout dependencies express
/scout dependencies --security --outdated
/scout dependencies src/payment/  # Find deps used in path
```

**Finds:**
- Direct and transitive dependencies
- Version constraints and compatibility
- Security vulnerabilities (CVEs)
- Outdated packages with upgrade paths
- Bundle size impact
- Alternative packages with trade-offs

### Pattern Scout

Discovers coding patterns and conventions in the codebase.

```bash
/scout patterns "error handling"
/scout patterns "database queries"
/scout patterns --file-type tsx "component composition"
```

**Finds:**
- Naming conventions (files, functions, variables)
- Error handling patterns
- Logging practices
- Testing approaches
- State management patterns
- API design conventions

### Test Scout

Analyzes existing tests to inform testing strategy.

```bash
/scout tests src/auth/
/scout tests --coverage --gaps "payment processing"
```

**Finds:**
- Test file locations and naming conventions
- Testing frameworks in use
- Coverage gaps and untested paths
- Mocking patterns
- Fixture and factory patterns
- Integration vs unit test balance

### API Scout

Investigates API design and integration points.

```bash
/scout api src/routes/
/scout api --external "third-party integrations"
```

**Finds:**
- Endpoint structure and naming
- Request/response schemas
- Authentication patterns
- Rate limiting and caching
- Error response formats
- Versioning strategies

### Security Scout

Analyzes security practices and potential vulnerabilities.

```bash
/scout security src/auth/
/scout security --focus "input validation"
```

**Finds:**
- Authentication and authorization patterns
- Input validation practices
- Secrets management
- XSS/CSRF protections
- SQL injection safeguards
- Dependency vulnerabilities

## Composite Scouts

### Feature Scout

Runs multiple scouts in parallel for feature planning.

```bash
/scout feature "Add user notifications"
/scout feature --thorough "Implement payment webhooks"
```

**Spawns:**
- Architecture scout (for related code)
- Pattern scout (for conventions)
- Test scout (for testing strategy)
- Dependency scout (for new deps needed)
- API scout (if API changes involved)

### Bug Scout

Investigates a bug before attempting a fix.

```bash
/scout bug "Login fails after password reset"
/scout bug --issue 123  # From GitHub issue
```

**Spawns:**
- Pattern scout (error handling around the bug)
- Test scout (existing tests and gaps)
- Architecture scout (affected modules)

## Commands

### /scout status

View active and recent scout runs:

```bash
/scout status
/scout status --active
/scout status --recent 5
```

### /scout report

Get detailed report from a scout run:

```bash
/scout report <scout-id>
/scout report --format markdown <scout-id>
/scout report --export ~/reports/auth-scout.md <scout-id>
```

### /scout cancel

Cancel a running scout:

```bash
/scout cancel <scout-id>
/scout cancel --all
```

## Output Format

### Summary View

Scout results show a structured summary:

```
Scout Report: Feature - Add OAuth2 Authentication
===============================================

## Architecture Findings
- Auth code lives in src/auth/ (12 files, 2.3k LOC)
- Uses middleware pattern for route protection
- Session stored in Redis (src/session/redis-store.ts)
- Existing providers: local, magic-link

## Pattern Findings
- Error handling: custom AuthError class, logged via pino
- Naming: camelCase for functions, kebab-case for files
- Middleware: express-style (req, res, next)

## Dependency Analysis
- Current auth deps: passport, bcrypt, jsonwebtoken
- Suggested new deps: @auth0/passport-auth0 (well-maintained)
- No security vulnerabilities in current deps

## Test Coverage
- Auth has 78% coverage (src/auth/*.test.ts)
- Gap: No tests for session expiry edge cases
- Pattern: Uses vitest + mock-redis

## Recommendations
1. Add OAuth2 as new provider in src/auth/providers/
2. Extend existing AuthError for OAuth-specific errors
3. Reuse session infrastructure, add provider field
4. Add integration tests for OAuth callback flow

Scout ID: scout-abc123 | Duration: 45s | Cost: $0.12
```

### JSON Export

Export structured data for automation:

```bash
/scout report --format json <scout-id>
```

```json
{
  "id": "scout-abc123",
  "type": "feature",
  "query": "Add OAuth2 authentication",
  "duration_ms": 45000,
  "cost_usd": 0.12,
  "findings": {
    "architecture": { ... },
    "patterns": { ... },
    "dependencies": { ... },
    "tests": { ... }
  },
  "recommendations": [ ... ]
}
```

## Integration with Build Workflow

Scouts integrate with the plan → build → test → review → document workflow:

```
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌──────────┐
│ SCOUT  │───▶│  PLAN  │───▶│ BUILD  │───▶│  TEST  │───▶│ DOCUMENT │
└────────┘    └────────┘    └────────┘    └────────┘    └──────────┘
     │             ▲
     │             │
     └─────────────┘
   Findings inform plan
```

### Using Scout Findings in Plan

```bash
# Scout first
/scout feature "Add rate limiting"

# Then plan with scout context
/plan "Add rate limiting" --scout-id scout-abc123
```

The plan agent receives scout findings as context, making better architectural decisions.

### Automatic Scout-Before-Build

Configure auto-scouting for all feature work:

```yaml
# gimli.config.yaml
scout:
  autoBefore:
    - feature
    - bug
  parallel: true
  timeout_seconds: 120
```

## Configuration

### Full Schema

```yaml
# gimli.config.yaml
scout:
  # When to auto-scout
  autoBefore:
    - feature          # Auto-scout before feature work
    - bug              # Auto-scout before bug fixes

  # Scout execution
  parallel: true       # Run scouts in parallel
  maxConcurrent: 4     # Max parallel scouts
  timeoutSeconds: 120  # Per-scout timeout

  # Scout depth
  defaultDepth: medium # quick, medium, deep
  depthOverrides:
    security: deep     # Always deep-scan security
    dependencies: quick

  # Models for scout work
  model: "anthropic/claude-sonnet-4-20250514"
  thinkingLevel: medium

  # File patterns to always include/exclude
  includePatterns:
    - "src/**/*.ts"
    - "**/*.test.ts"
  excludePatterns:
    - "node_modules/**"
    - "dist/**"
    - "*.min.js"

  # Output
  saveReports: true
  reportPath: ~/.gimli/scout-reports/
  retainDays: 30
```

## Examples

### Before Building a Feature

```bash
# 1. Scout the feature area
/scout feature "Add WebSocket support for real-time updates"

# 2. Review findings
/scout report --latest

# 3. Plan with context
/plan "Add WebSocket support" --with-scout

# 4. Build with informed decisions
/build
```

### Before Fixing a Bug

```bash
# 1. Scout the bug
/scout bug "Memory leak in long-running sessions"

# 2. See what scouts found
/scout status

# 3. Get detailed findings
/scout report scout-xyz789

# 4. Fix with full context
# Now you know: which sessions, what patterns, what tests exist
```

### Quick Architecture Check

```bash
# Understand a module before modifying
/scout architecture src/payment/ --depth deep

# Output shows:
# - File structure
# - Class/function relationships
# - External dependencies
# - Test coverage
# - Recent commit activity
```

### Dependency Audit

```bash
# Before adding a new dependency
/scout dependencies react-hook-form

# Output shows:
# - Size impact
# - Existing form handling in codebase
# - Similar deps already installed
# - Security status
# - Alternatives comparison
```

## Implementation Details

### How Scouts Work

1. **Query Analysis**: Parse the scout request to determine type and scope
2. **Spawn Sub-agents**: Launch specialized scouts in parallel (via `sessions_spawn`)
3. **Gather Context**: Each scout reads files, runs commands, searches patterns
4. **Synthesize**: Combine findings into structured report
5. **Recommend**: Generate actionable recommendations

### Scout Sub-agent System Prompt

Each scout runs as a focused sub-agent:

```
You are a [type] scout analyzing [scope].

Your mission:
- Find relevant information for: [query]
- Report findings in structured format
- Stay focused on your specialty
- Be thorough but concise

Output format:
## Summary
[1-2 sentence overview]

## Findings
[Detailed findings organized by category]

## Recommendations
[Actionable suggestions based on findings]
```

### Cost and Performance

| Scout Type | Avg Duration | Avg Cost |
|------------|--------------|----------|
| Architecture | 30-60s | $0.05-0.15 |
| Dependency | 15-30s | $0.02-0.08 |
| Pattern | 20-45s | $0.04-0.12 |
| Test | 25-40s | $0.04-0.10 |
| Feature (composite) | 45-90s | $0.10-0.25 |
| Bug (composite) | 30-60s | $0.06-0.15 |

### CLI Reference

```bash
# Scout commands
gimli scout <type> [query] [options]
gimli scout status [--active|--recent N]
gimli scout report <scout-id> [--format json|markdown]
gimli scout cancel <scout-id>|--all
gimli scout list [--type <type>] [--since <date>]
gimli scout export <scout-id> <path>

# Scout types
gimli scout architecture <path>
gimli scout dependencies [package|path]
gimli scout patterns <query>
gimli scout tests <path|query>
gimli scout api <path>
gimli scout security <path>
gimli scout feature <description>
gimli scout bug <description>

# Options
--depth quick|medium|deep   # Scout thoroughness
--parallel                  # Run in parallel (default)
--sequential               # Run sequentially
--timeout <seconds>        # Override default timeout
--model <model-id>         # Override default model
--thinking <level>         # Thinking level
--output <path>            # Save report to file
--format json|markdown     # Output format
```

## Troubleshooting

### Scouts timing out

Increase timeout or reduce depth:

```bash
/scout architecture src/ --depth quick --timeout 60
```

Or configure globally:

```yaml
scout:
  timeoutSeconds: 180
  defaultDepth: quick
```

### Too many irrelevant findings

Use more specific queries or scope:

```bash
# Instead of broad scout
/scout patterns "authentication"

# Be specific
/scout patterns "JWT token validation in API middleware"
```

### High costs

Reduce parallel scouts or use cheaper models:

```yaml
scout:
  maxConcurrent: 2
  model: "anthropic/claude-3-haiku"
```

## References

- TAC Principles: `ralphy/TAC_PRINCIPLES.md`
- Sub-agent system: `docs/tools/subagents.md`
- Workflow chaining: `.agent/workflows/`
