---
name: kanban-agent
description: Autonomous task management from Kanban boards. Pick tasks, run parallel iterations, compare solutions, and apply the best results.
metadata: {"gimli":{"emoji":"📋"}}
---

# Kanban Agent Skill

Gimli's autonomous Kanban agent enables intelligent task management from external Kanban sources. The agent can pick tasks from GitHub Issues or local TASKS.md files, run multiple parallel solution attempts (iterations), evaluate and compare results, and present the best solutions for approval.

## Quick Start

```bash
# Check current task board status
/kanban status

# Let the agent pick and work on the next task
/kanban pick

# Review pending solutions
/kanban review

# Approve a solution
/kanban approve <iteration-id>
```

## Task Sources

### GitHub Issues

Connect to GitHub Issues as your task source using the `gh` CLI:

```bash
# Configure GitHub Issues adapter
gimli config set kanban.github.repo owner/repo
gimli config set kanban.github.enabled true

# Optional: customize label mappings
gimli config set kanban.github.labelMappings.inProgress '["in-progress", "wip"]'
gimli config set kanban.github.labelMappings.blocked '["blocked", "waiting"]'
gimli config set kanban.github.labelMappings.highPriority '["priority:high", "urgent"]'
gimli config set kanban.github.labelMappings.exclude '["duplicate", "invalid"]'
```

The adapter uses `gh` CLI for authentication. Ensure you're logged in:

```bash
gh auth login
gh auth status
```

### Local TASKS.md

Use a local markdown file for task management:

```bash
# Configure markdown adapter
gimli config set kanban.markdown.filePath ./TASKS.md
gimli config set kanban.markdown.enabled true
gimli config set kanban.markdown.createIfMissing true
```

#### TASKS.md Format

```markdown
# Project Tasks

## Backlog

### [TASK-001] Implement user authentication
- **Priority**: high
- **Labels**: auth, security
- **Created**: 2026-01-15
- **Due**: 2026-02-01

Implement OAuth2 authentication with GitHub and Google providers.
Support both web and CLI flows.

---

### [TASK-002] Add rate limiting to API
- **Priority**: medium
- **Labels**: api, performance
- **Created**: 2026-01-16

Implement token bucket rate limiting for all API endpoints.

---

## In Progress

### [TASK-003] Database migration script
- **Priority**: high
- **Labels**: database, ops
- **Assignee**: @alice
- **Created**: 2026-01-10
- **Started**: 2026-01-20

Create migration scripts for PostgreSQL to SQLite transition.

---

## Blocked

### [TASK-004] Third-party API integration
- **Priority**: medium
- **Labels**: integration
- **Blocked**: Waiting for API credentials from vendor

---

## Completed

### [TASK-005] Setup CI/CD pipeline
- **Priority**: high
- **Completed**: 2026-01-18

Configured GitHub Actions for automated testing and deployment.

---
```

Supported sections map to task statuses:
- `Backlog` / `Todo` -> `open`
- `In Progress` -> `in_progress`
- `Blocked` / `Waiting` -> `blocked`
- `Review` -> `review`
- `Completed` / `Done` -> `closed`
- `Abandoned` / `Won't Do` -> `wont_do`

## Commands

### /kanban status

Show current board status and pending tasks:

```
/kanban status
/kanban status --adapter github
/kanban status --priority high
```

Displays:
- Task counts by status (backlog, in progress, blocked, completed)
- Active iterations and their progress
- Pending solutions awaiting review
- Recent completions

### /kanban pick

Select and start working on the next task:

```
# Pick highest priority task automatically
/kanban pick

# Pick a specific task by ID
/kanban pick TASK-001
/kanban pick 42  # GitHub issue number

# Pick with specific iteration strategy
/kanban pick --strategy parallel --iterations 3
/kanban pick --strategy sequential --stop-on-success
```

Task selection considers:
- Priority level (critical > high > medium > low)
- Due date (closer deadlines first)
- Complexity estimate (simpler tasks by default, configurable)
- Current workload (avoids overloading)

### /kanban review

Review pending solutions from completed iterations:

```
# Review all pending solutions
/kanban review

# Review solutions for a specific task
/kanban review --task TASK-001

# Show detailed comparison
/kanban review --detailed
```

The review interface shows:
- Comparison table with scores across criteria
- Winner recommendation with confidence level
- Strengths and trade-offs for each solution
- Actions to accept, reject, or request changes

### /kanban approve

Accept a solution and apply it:

```
# Approve the recommended winner
/kanban approve

# Approve a specific iteration
/kanban approve iteration-2

# Approve with comment
/kanban approve --comment "LGTM, good approach"
```

After approval:
- Solution is applied (commits, file changes)
- Task status is updated in the source
- A summary comment is posted to the task
- Session is linked for audit trail

## Multi-Iteration Mode

The Kanban agent can spawn multiple parallel sub-agents to work on the same task with different approaches, then compare and select the best solution.

### Iteration Strategies

**Parallel** (default): Run all variations simultaneously for fastest results.

```
/kanban pick --strategy parallel --iterations 3
```

**Sequential**: Run one at a time, stop when a solution meets the acceptance threshold.

```
/kanban pick --strategy sequential --stop-on-success --min-score 0.85
```

**Tournament**: Run in rounds where the best solutions advance.

```
/kanban pick --strategy tournament --rounds 2
```

**Adaptive**: Start with quick attempts, escalate to deeper analysis if needed.

```
/kanban pick --strategy adaptive
```

### Variation Types

**Model Variations**: Try different models for diverse approaches.

```yaml
# In gimli.config.yaml
kanban:
  iterations:
    modelPool:
      - "anthropic/claude-sonnet-4-20250514"
      - "anthropic/claude-opus-4-5-20251101"
      - "openai/gpt-4o"
```

**Thinking Level Variations**: Vary reasoning depth.

```
/kanban pick --thinking-levels "low,medium,high"
```

**Prompt Variations**: Try different approaches to the same problem.

```
/kanban pick --approaches "minimal,robust,performant"
```

Built-in approach templates:
- `minimal`: Focus on simplest solution that works
- `robust`: Focus on error handling and edge cases
- `performant`: Focus on efficiency and performance

**Hybrid Variations**: Combine multiple dimensions.

```
/kanban pick --models "claude-sonnet,claude-opus" --thinking-levels "medium,high"
```

### Resource Limits

Configure limits to control cost and time:

```yaml
kanban:
  iterations:
    maxConcurrent: 3              # Max parallel iterations
    maxTotal: 6                   # Max iterations per task
    perIterationTimeoutSeconds: 300  # 5 min per iteration
    totalTimeoutSeconds: 900      # 15 min total
    perIterationMaxCostUsd: 0.50  # $0.50 per iteration
    totalMaxCostUsd: 2.00         # $2.00 total per task
```

## Solution Evaluation

Solutions are evaluated across five weighted criteria:

| Criterion | Weight | What It Measures |
|-----------|--------|------------------|
| Correctness | 40% | Tests pass, types check, lint clean, requirements met |
| Code Quality | 25% | Complexity, duplication, naming, pattern adherence |
| Efficiency | 15% | Algorithm complexity, resource cleanup, performance |
| Completeness | 10% | Requirements coverage, tests added, docs updated |
| Safety | 10% | No dangerous ops, security review, no secrets exposed |

### Automated Checks

- Test suite execution (`vitest run`)
- Type checking (`tsc --noEmit`)
- Linting (`pnpm lint`)
- Build verification (`pnpm build`)
- Code metrics (complexity, LOC delta, duplication)
- Security scanning (secret detection, dangerous patterns)

### LLM-Assisted Evaluation

- Requirement coverage analysis
- Edge case handling assessment
- Naming quality review
- Pattern adherence check
- Security vulnerability scan
- Algorithm complexity estimation

### Auto-Acceptance

Solutions can be automatically accepted when they meet high confidence thresholds:

```yaml
kanban:
  autoAcceptance:
    enabled: false  # Opt-in
    minScore: 0.85
    minConfidence: 0.80
    minScoreGap: 0.10
    categoryMinimums:
      correctness: 0.90
      quality: 0.70
      efficiency: 0.60
      completeness: 0.80
      safety: 0.95
```

## Presentation Format

### Summary View

When comparing solutions, you see a summary table:

```
Solution Comparison: Add user authentication endpoint

Winner: Iteration #2 (claude-opus)    Score: 0.87    Confidence: 92%

| Criterion     | #1 sonnet | #2 opus  | #3 gpt-4o | Weight |
|---------------|-----------|----------|-----------|--------|
| Correctness   |    0.85   |  *0.95*  |    0.80   |   40%  |
| Code Quality  |    0.75   |  *0.82*  |    0.78   |   25%  |
| Efficiency    |    0.70   |   0.75   |   *0.80*  |   15%  |
| Completeness  |    0.90   |  *0.95*  |    0.85   |   10%  |
| Safety        |    1.00   |   1.00   |    1.00   |   10%  |
| OVERALL       |    0.82   |  *0.87*  |    0.81   |  100%  |

#2 Strengths: All tests pass, 3 new tests, follows existing patterns
#2 Trade-offs: +15% LOC vs #1, marginally slower runtime than #3

Actions:
  [a] Accept winner    [v] View details    [d] View diff
  [c] Compare pair     [r] Request changes [x] Reject all
```

### Detail View

Drill into a specific solution for full breakdown:

```
/kanban review --task TASK-001 --iteration 2 --detailed
```

Shows:
- Score breakdown with individual check results
- Files changed with line counts
- LLM reasoning explanation
- Code snippets for key changes

### Diff View

Compare code changes between iterations:

```
/kanban diff iteration-1 iteration-2
```

Supports:
- Unified diff (default)
- Side-by-side comparison
- File-by-file navigation
- Syntax highlighting

## Configuration

### Full Configuration Schema

```yaml
# gimli.config.yaml
kanban:
  # Task sources
  adapters:
    - type: github
      source: owner/repo
      enabled: true
      config:
        project: "Project Board Name"  # Optional: filter by project
        milestone: "v1.0"              # Optional: filter by milestone
        labelMappings:
          inProgress: ["in-progress", "wip"]
          blocked: ["blocked", "waiting"]
          highPriority: ["priority:high", "urgent"]
          exclude: ["duplicate", "invalid"]

    - type: markdown
      source: ./TASKS.md
      enabled: true
      config:
        createIfMissing: true

  defaultAdapter: github

  # Sync settings
  sync:
    intervalMinutes: 30   # Auto-sync interval (0 = disabled)
    onStartup: true       # Sync when gateway starts

  # Task selection preferences
  selection:
    prioritizeDueDates: true
    priorityWeight: 2
    preferSimpler: true

  # Iteration settings
  iterations:
    maxConcurrent: 3
    maxTotal: 6
    perIterationTimeoutSeconds: 300
    totalTimeoutSeconds: 900
    perIterationMaxCostUsd: 0.50
    totalMaxCostUsd: 2.00
    defaultStrategy: parallel
    modelPool:
      - "anthropic/claude-sonnet-4-20250514"
      - "anthropic/claude-opus-4-5-20251101"

  # Evaluation settings
  evaluation:
    weights:
      correctness: 0.40
      quality: 0.25
      efficiency: 0.15
      completeness: 0.10
      safety: 0.10
    llmAssessment:
      enabled: true
      model: "claude-3-5-sonnet"
      temperature: 0.1

  # Auto-acceptance settings
  autoAcceptance:
    enabled: false
    minScore: 0.85
    minConfidence: 0.80
    minScoreGap: 0.10
    categoryMinimums:
      correctness: 0.90
      quality: 0.70
      efficiency: 0.60
      completeness: 0.80
      safety: 0.95
```

## Examples

### Daily Workflow

```bash
# Morning: check what's on the board
/kanban status

# Pick a high-priority task
/kanban pick --priority high

# Check progress on running iterations
/kanban status --iterations

# Review completed solutions
/kanban review

# Approve the best one
/kanban approve
```

### Complex Feature Implementation

```bash
# Start a complex task with multiple iterations
/kanban pick TASK-042 --strategy parallel --iterations 5 --models "claude-sonnet,claude-opus,gpt-4o"

# Wait for iterations to complete, then review
/kanban review --task TASK-042 --detailed

# Compare top two solutions side-by-side
/kanban diff iteration-3 iteration-5

# Request changes to preferred solution
/kanban review --iteration 3 --request-changes "Add error handling for network failures"

# After re-run, approve
/kanban approve iteration-3-v2
```

### Quick Bug Fix

```bash
# Sequential strategy for quick turnaround
/kanban pick --strategy sequential --stop-on-success --min-score 0.80

# Auto-approve if it meets threshold
/kanban approve --auto
```

### Batch Processing

```bash
# Process multiple tasks autonomously
gimli agent --mode autonomous --task-source kanban

# With auto-acceptance for routine tasks
gimli agent --mode autonomous --task-source kanban --auto-accept --min-score 0.90
```

## CLI Reference

```bash
# Sync tasks from sources
gimli kanban sync
gimli kanban sync --adapter github

# List tasks
gimli kanban list
gimli kanban list --status open --priority high
gimli kanban list --adapter markdown

# View task details
gimli kanban view TASK-001

# Move task status
gimli kanban move TASK-001 in_progress
gimli kanban close TASK-001 --comment "Completed via PR #123"

# Iteration management
gimli kanban iterate <task-id> --strategy parallel --models "claude-sonnet,gpt-4o"
gimli kanban iterations list
gimli kanban iterations status <plan-id>
gimli kanban iterations results <plan-id>
gimli kanban iterations cancel <plan-id>
```

## Integration

### With Memory System

Task context and solutions are stored in Gimli's memory system. When working on related tasks, relevant past solutions may surface automatically.

### With Learning System

The agent learns from your approval/rejection decisions to improve future:
- Task selection preferences
- Evaluation weight adjustments
- Model preferences for task types

### With Reminders

Set reminders for task deadlines:

```
remind me about TASK-001 the day before it's due
```

## Troubleshooting

### GitHub adapter not working

```bash
# Check gh CLI auth
gh auth status

# Verify repository access
gh repo view owner/repo

# Test issue listing
gh issue list -R owner/repo --limit 5
```

### Tasks not syncing

```bash
# Manual sync
gimli kanban sync --verbose

# Check adapter configuration
gimli config get kanban
```

### Iterations timing out

Increase timeout limits:

```yaml
kanban:
  iterations:
    perIterationTimeoutSeconds: 600  # 10 minutes
    totalTimeoutSeconds: 1800        # 30 minutes
```

### High costs

Reduce iteration count and use smaller models:

```yaml
kanban:
  iterations:
    maxTotal: 3
    modelPool:
      - "anthropic/claude-sonnet-4-20250514"  # Cost-effective
```

## References

- Design docs: `docs/design/kanban-*.md`
- Task intake: `docs/design/kanban-task-intake.md`
- Multi-iteration: `docs/design/kanban-multi-iteration.md`
- Evaluation criteria: `docs/design/kanban-evaluation-criteria.md`
- Presentation format: `docs/design/kanban-presentation-format.md`
