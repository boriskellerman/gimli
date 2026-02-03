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

### AI Developer Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `plan-build` | New feature request | End-to-end feature development |
| `test-fix` | Test failures | Automatically fix failing tests |
| `bug-investigate` | Bug report | Systematic investigation and fix |
| `security-audit` | Weekly / on-demand | Comprehensive security scan |
| `self-improve` | Nightly | Continuous autonomous improvement |

### Agent Experts

Specialized knowledge bases in YAML:
- `gateway-expert.yaml` - WebSocket, sessions, connections
- `channel-expert.yaml` - Telegram, Discord, WhatsApp
- `database-expert.yaml` - Data layer, queries, migrations
- `security-expert.yaml` - Auth, sandboxing, credentials

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

## 🛠️ Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run in development
pnpm dev loop

# Run tests
pnpm test
```

---

*Built on TAC (Tactical Agentic Coding) principles*
*Goal: The Codebase Singularity - where agents run Gimli better than humans can*
