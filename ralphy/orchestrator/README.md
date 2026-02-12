# TAC Orchestrator - Gimli Self-Maintenance System

> The autonomous wrapper that keeps Gimli healthy, updated, and continuously improving.

## 🎯 What It Does

The TAC Orchestrator wraps around the Gimli codebase and automatically:

1. **Detects Issues** - Runs tests, scans logs, identifies bugs
2. **Fixes Problems** - Spawns AI agents to investigate and fix issues
3. **Syncs Upstream** - Pulls updates from Gimli and resolves conflicts
4. **Learns & Improves** - Updates its own expertise based on what it learns
5. **Tracks Progress** - Maintains metrics on bugs fixed, tests passing, etc.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TAC ORCHESTRATOR                           │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Gimli     │  │  ADW        │  │     Agent Experts       │ │
│  │   Wrapper   │──│  Executor   │──│  (gateway, security,    │ │
│  │             │  │             │  │   channels, database)   │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘ │
│         │                │                                      │
│         ▼                ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┤
│  │              AI Developer Workflows (ADWs)                   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │  │plan-build│ │ test-fix │ │bug-invest│ │self-improve  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │
│  └─────────────────────────────────────────────────────────────┘
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┤
│  │                    GIMLI CODEBASE                            │
│  │  src/ │ skills/ │ extensions/ │ tests/ │ docs/              │
│  └─────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────┘
```

## 🔄 The Autonomous Loop

Every night at 11pm (or on-demand), the orchestrator runs:

```
1. CHECK HEALTH
   └── Run tests
   └── Scan logs for errors
   └── Check for TODO/FIXME comments
   
2. FIX ISSUES (if any found)
   └── Prioritize by severity
   └── Spawn agents to fix each issue
   └── Verify fixes work
   └── Update tests
   
3. CHECK UPSTREAM
   └── Fetch latest from Gimli
   └── Identify new features/fixes
   └── Evaluate for integration
   
4. SELF-IMPROVE
   └── Run self-improve workflow
   └── Update agent experts
   └── Capture learnings
   
5. REPORT
   └── Log to memory/YYYY-MM-DD.md
   └── Update metrics
   └── Alert if critical issues
```

## 📦 Components

### Gimli Wrapper (`gimli-wrapper.ts`)

The main orchestrator that:
- Monitors Gimli health (tests, logs, security)
- Triggers workflows based on detected issues
- Tracks metrics over time
- Coordinates the autonomous loop

### ADW Executor (`adw-executor.ts`)

The runtime that:
- Loads workflow definitions from YAML
- Executes steps in dependency order
- Spawns agents via Gimli's `sessions_spawn`
- Handles retries, validation, and logging
- **Logs trajectories** for every workflow run

### Trajectory Logging (`trajectory.ts`)

Trajectories capture the "train of thought" for completed workflows:
- **Chapters** - Logical phases (investigation, planning, implementation, validation)
- **Events** - Decisions, actions, observations, reasoning, errors, checkpoints
- **Retrospectives** - Summary, successes, improvements, lessons learned

**Why trajectories?**
- Help future agents understand past work
- Enable learning from mistakes
- Provide audit trail for debugging
- Support confidence scoring

**Storage:** `runs/trajectories/traj_*.json`

**Schema:**
```json
{
  "id": "traj_xxx",
  "task": {"title": "Fix bug X", "workflowName": "bug-investigate"},
  "chapters": [
    {
      "title": "Investigation",
      "type": "investigation",
      "events": [
        {"type": "observation", "title": "Found root cause", "confidence": 0.9}
      ]
    }
  ],
  "retrospective": {
    "summary": "Fixed X by doing Y",
    "successes": ["Found root cause", "Fix verified"],
    "improvements": ["Could have checked logs earlier"],
    "lessons": ["Always check error boundaries"],
    "confidence": 0.85
  }
}
```

### AI Developer Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `plan-build` | New feature request | End-to-end feature development |
| `test-fix` | Test failures | Automatically fix failing tests |
| `bug-investigate` | Bug report | Systematic investigation and fix |
| `security-audit` | Weekly / on-demand | Comprehensive security scan |
| `self-improve` | Nightly | Continuous autonomous improvement |

### Agent Expert System (`expert-manager.ts`) — Act→Learn→Reuse

The expert system is how agents get smarter over time:

1. **LOAD** — Before a task, the ExpertManager auto-selects relevant experts based on task description and affected files
2. **ACT** — Agent works with expert knowledge injected into its context
3. **LEARN** — After task completion, learnings (patterns, anti-patterns, debugging tips, common errors) are extracted from results
4. **REUSE** — Learnings are appended to expert YAML files, enriching future agent context

**Expert Files:** `ralphy/experts/`
- `gateway-expert.yaml` - WebSocket, sessions, connections
- `channel-expert.yaml` - Telegram, Discord, WhatsApp
- `database-expert.yaml` - Data layer, queries, migrations
- `security-expert.yaml` - Auth, sandboxing, credentials
- `frontend-expert.yaml` - Portal, webchat, dashboards, CSS
- `plugin-expert.yaml` - Skills, MCP, hooks, extensions

**Features:**
- Auto-detection: experts are selected by keyword + file path matching
- Deduplication: similar learnings bump occurrence count instead of adding duplicates
- Pruning: each category is capped (default 25) — lowest-value learnings are pruned first
- Compact context: only top learnings and key info are injected (not the full YAML)

```typescript
// Usage
const expertMgr = executor.getExpertManager();

// Auto-select experts for a task
const selection = expertMgr.selectExperts('Fix WebSocket reconnection', ['src/gateway/ws.ts']);
// → Selects gateway-expert, builds compact context string

// Record learnings after a workflow
expertMgr.recordLearnings({
  workflowName: 'bug-investigate',
  runId: 'wf-abc123',
  domain: 'gateway',
  learnings: [
    { category: 'pattern', title: 'Exponential backoff', description: '...', confidence: 0.9 },
  ],
});
```

### Validation Pipeline (`validation-pipeline.ts`) — Closed-Loop Verification

The validation pipeline ensures agent-produced code actually works:

1. **Auto-detect** checks based on project structure (TypeScript, Python, shell, test suite, build)
2. **Run checks** after build steps (type checking, linting, syntax, tests)
3. **Retry loop** — on failure, error context is fed back to the agent for auto-fix
4. **Metrics** — track first-pass rate, common failures, retry counts

**Built-in checks:**
| Check | Language | Required | Description |
|-------|----------|----------|-------------|
| `tsc-type-check` | TypeScript | ✅ | `tsc --noEmit` |
| `eslint` | TS/JS | ⚠️ advisory | Lint check |
| `python-syntax` | Python | ✅ | `py_compile` |
| `bash-syntax` | Shell | ✅ | `bash -n` |
| `shellcheck` | Shell | ⚠️ advisory | Static analysis |
| `test-suite` | Any | ✅ | `npm test` |
| `build-check` | Any | ✅ | `npm run build` |

```typescript
// Usage
const pipeline = executor.getValidationPipeline();

// Validate everything
const result = await pipeline.validateAll();
// → { allPassed: true, passedCount: 4, failedCount: 0, errorSummary: '' }

// Validate with retry loop (agent fixes errors between attempts)
const retryResult = await pipeline.validateWithRetry({
  maxRetries: 2,
  onRetry: async (attempt, errorSummary) => {
    // Feed errorSummary back to agent for fixing
    await agent.fix(errorSummary);
  },
});
// → { finalResult, attempts: 2, passedOnAttempt: 2 }
```

## 🚀 Usage

### CLI Commands

```bash
# Run the full autonomous loop
orchestrator loop

# Check Gimli health
orchestrator health

# Run a specific workflow
orchestrator run self-improve
orchestrator run test-fix
orchestrator run security-audit scope=quick

# Check upstream status
orchestrator upstream

# View metrics
orchestrator metrics

# List available workflows
orchestrator list
```

### Integration with Gimli Cron

The orchestrator is triggered via Gimli's cron system:

```yaml
# Nightly self-improvement (11pm)
- name: "Nightly Orchestrator Loop"
  schedule: "0 23 * * *"
  command: "orchestrator loop"

# Weekly security audit (3am Sunday)  
- name: "Weekly Security Audit"
  schedule: "0 3 * * 0"
  command: "orchestrator run security-audit"
```

### Programmatic Usage

```typescript
import { GimliWrapper } from '@gimli/tac-orchestrator';

const wrapper = new GimliWrapper({
  gimliPath: '/home/gimli/github/gimli',
  orchestratorPath: '/home/gimli/github/gimli/ralphy/orchestrator',
});

// Run the autonomous loop
await wrapper.runAutonomousLoop();

// Or trigger specific workflows
await wrapper.triggerWorkflow('bug-investigate', {
  bug_description: 'Gateway crashes on reconnect',
  severity: 'high',
});

// Check health
const health = await wrapper.checkHealth();
console.log(`Tests passing: ${health.testsPass}`);
```

## 🧠 How ADWs Work

AI Developer Workflows are defined in YAML:

```yaml
name: test-fix
steps:
  - name: run_tests
    agent: backend
    prompt: |
      Run the test suite and capture failures...
    outputs:
      - failures: array
  
  - name: analyze_failures
    agent: backend
    depends_on: [run_tests]
    prompt: |
      Analyze these failures: {{run_tests.failures}}
    outputs:
      - root_causes: array
  
  - name: implement_fixes
    agent: backend
    depends_on: [analyze_failures]
    for_each: "analyze_failures.root_causes"
    prompt: |
      Fix this issue: {{item}}
```

The executor:
1. Parses the YAML definition
2. Topologically sorts steps by dependencies
3. Executes each step, passing outputs to the next
4. Spawns agents via `sessions_spawn`
5. Validates outputs and handles failures

## 📊 Metrics Tracked

The wrapper tracks:

| Metric | Description |
|--------|-------------|
| `bugsFixed` | Total bugs automatically fixed |
| `testsFixed` | Failing tests that were fixed |
| `securityIssuesResolved` | Security issues addressed |
| `upstreamSyncs` | Successful upstream merges |
| `totalWorkflowRuns` | Total workflow executions |
| `successfulRuns` | Workflows that completed successfully |
| `failedRuns` | Workflows that failed |

TAC KPIs (from TAC principles):
- **Presence**: Time requiring human attention (minimize)
- **Size**: Scope of tasks handled autonomously (maximize)
- **Streak**: Consecutive successful runs (maximize)
- **Attempts**: Retries per task (minimize)

## 🎯 The Goal: Zero Touch Engineering (ZTE)

The ultimate goal is **ZTE** - where agents can:
- Detect issues automatically
- Fix them without human review
- Ship improvements end-to-end
- Maintain the codebase better than humans

The orchestrator moves toward ZTE by:
1. Building trust through successful runs
2. Expanding scope of autonomous operations
3. Learning from every fix and failure
4. Updating its own expertise continuously

## 🔒 Security

The orchestrator follows security-first principles:
- Never weakens existing security configs
- Logs all changes for audit
- Runs in sandboxed sessions
- Validates all inputs
- Security issues trigger immediate alerts

## 📁 Directory Structure

```
ralphy/orchestrator/
├── README.md           # This file
├── package.json        # Dependencies
├── src/
│   ├── adw-executor.ts # Workflow runtime
│   ├── gimli-wrapper.ts # Main orchestrator
│   └── cli.ts          # CLI interface
├── adw/
│   ├── plan-build.yaml
│   ├── test-fix.yaml
│   ├── bug-investigate.yaml
│   ├── security-audit.yaml
│   └── self-improve.yaml
├── runs/               # Workflow run logs
└── metrics/            # Cumulative metrics
```

## 🔀 Git Worktree Parallel Execution

The orchestrator uses git worktrees to run multiple agents in parallel:

```typescript
import { WorktreeManager } from './worktree-manager';

const manager = new WorktreeManager({ repoPath: '/home/gimli/github/gimli' });

// Create isolated worktrees for parallel work
const worktrees = await manager.createParallelWorktrees({
  prefix: 'fix-bugs',
  count: 3,
});

// Each agent works in its own worktree
// No conflicts, parallel execution
// Merge winners back to main
```

This enables:
- **Parallel bug fixing** - Multiple bugs at once
- **A/B testing** - Different approaches to same problem
- **Feature branches** - Without switching contexts

## 🧪 A/B Testing for Fixes

Test multiple approaches and pick the best one:

```typescript
import { ABTestRunner } from './ab-testing';

const runner = new ABTestRunner({ repoPath, orchestratorPath });

const result = await runner.runTest({
  taskId: 'fix-session-crash',
  taskDescription: 'Fix gateway crash on reconnect',
  variants: 3,
  approaches: ['minimal', 'comprehensive', 'test-first'],
  evaluationCriteria: {
    weights: { testsPass: 50, codeQuality: 30, performance: 10, tokenEfficiency: 10 },
    mustPassTests: true,
    maxFilesModified: 5,
  },
  autoMerge: true,
  autoMergeThreshold: 80,
});

// Winner is auto-merged if score > 80
// Otherwise flagged for human review
```

## 🖥️ Dashboard

Start the visual dashboard:

```bash
pnpm dashboard
# Opens at http://localhost:3888
```

Features:
- Real-time workflow status
- Agent fleet overview
- TAC KPIs tracking
- Cost monitoring
- Activity logs
- Manual workflow triggers

API endpoints:
- `GET /api/dashboard` - Full state
- `GET /api/health` - Gimli health
- `GET /api/metrics` - Metrics
- `POST /api/workflow` - Trigger workflow
- `POST /api/loop` - Run autonomous loop

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run CLI
pnpm dev loop

# Run dashboard
pnpm dev:dashboard
```

## 📁 Full Directory Structure

```
ralphy/orchestrator/
├── README.md
├── package.json
├── tsconfig.json
├── src/
│   ├── adw-executor.ts      # Workflow runtime
│   ├── gimli-wrapper.ts     # Main orchestrator
│   ├── worktree-manager.ts  # Git worktree handling
│   ├── ab-testing.ts        # A/B test runner
│   ├── dashboard-server.ts  # Dashboard API
│   └── cli.ts               # CLI interface
├── adw/
│   ├── plan-build.yaml
│   ├── test-fix.yaml
│   ├── bug-investigate.yaml
│   ├── security-audit.yaml
│   └── self-improve.yaml
├── dashboard/
│   └── index.html           # Dashboard UI
├── runs/                    # Workflow logs
├── metrics/                 # Cumulative metrics
└── ab-results/              # A/B test results
```

---

*Built on TAC (Tactical Agentic Coding) principles*
*Goal: The Codebase Singularity - where agents run Gimli better than humans can*
