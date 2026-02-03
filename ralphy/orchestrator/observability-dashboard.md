# Orchestrator Observability Dashboard

> Real-time visibility into all TAC Orchestrator operations

## Overview

The observability dashboard provides:
- **Status Overview** - Current orchestrator state
- **Active Workflows** - Running and queued workflows
- **Agent Fleet** - All spawned agents and their status
- **Metrics** - Performance and cost tracking
- **Drill-Down** - Deep inspection of any operation

## Dashboard Sections

### 1. Status Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ 🎛️ ORCHESTRATOR STATUS                                          │
├─────────────────────────────────────────────────────────────────┤
│ Status: 🟢 Running                    Uptime: 14h 32m           │
│ Model: claude-opus-4-5                Session: orchestrator     │
│ Context: 45,231 / 200,000 tokens (23%)                         │
│                                                                 │
│ Today's Stats:                                                  │
│ ├─ Workflows Run: 7                                             │
│ ├─ Issues Fixed: 12                                             │
│ ├─ Tests Passed: 847 / 852                                      │
│ └─ Cost: $4.23                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Active Workflows

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔄 ACTIVE WORKFLOWS                                              │
├─────────────────────────────────────────────────────────────────┤
│ ID          │ Workflow       │ Step         │ Duration │ Status │
│─────────────┼────────────────┼──────────────┼──────────┼────────│
│ wf-a3b2c1   │ self-improve   │ fix_issues   │ 12m 34s  │ 🔵     │
│ wf-d4e5f6   │ bug-investigate│ investigate  │ 3m 21s   │ 🔵     │
│ wf-g7h8i9   │ plan-build     │ [queued]     │ -        │ ⏳     │
├─────────────────────────────────────────────────────────────────┤
│ [View All] [Pause All] [Cancel]                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Agent Fleet

```
┌─────────────────────────────────────────────────────────────────┐
│ 🤖 AGENT FLEET                                                   │
├─────────────────────────────────────────────────────────────────┤
│ Agent           │ Session Key      │ Task          │ Tokens     │
│─────────────────┼──────────────────┼───────────────┼────────────│
│ orchestrator    │ agent:main:orch  │ coordinating  │ 45,231     │
│ backend-worker  │ agent:iso:bknd1  │ fixing bug    │ 23,456     │
│ gateway-worker  │ agent:iso:gw1    │ idle          │ 12,100     │
│ security-audit  │ agent:iso:sec1   │ scanning      │ 8,234      │
├─────────────────────────────────────────────────────────────────┤
│ Total Agents: 4    Total Tokens: 89,021    Est Cost: $2.67      │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Metrics Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ 📊 METRICS                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Success Rate (7d)        Context Utilization    Cost Trend      │
│ ████████████████░░ 89%   ████░░░░░░░░░░░ 23%   ▂▄▆▄▃▅▇ $28.45  │
│                                                                 │
│ Workflows/Day            Issues Fixed/Day      Tests Passing    │
│ ▁▂▃▄▅▆▇█▇▆▅ avg: 8      ▂▃▄▅▆▇▆▅▄▃▂ avg: 11   99.4% ▲0.2%     │
│                                                                 │
│ TAC KPIs:                                                       │
│ ├─ Presence: 12min/day (↓ good)                                │
│ ├─ Task Size: L avg (↑ improving)                              │
│ ├─ Streak: 23 successful runs                                  │
│ └─ Attempts: 1.2 avg per task (↓ improving)                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Workflow Drill-Down

When clicking on a workflow:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 WORKFLOW: wf-a3b2c1 (self-improve)                           │
├─────────────────────────────────────────────────────────────────┤
│ Started: 2026-02-03 23:00:00 EST                                │
│ Duration: 12m 34s (running)                                     │
│ Tokens Used: 34,567                                             │
│                                                                 │
│ Steps:                                                          │
│ ✅ detect_bugs        2m 12s    found 3 issues                  │
│ ✅ detect_test_gaps   1m 45s    found 2 gaps                    │
│ ✅ detect_performance 1m 23s    found 1 issue                   │
│ ✅ prioritize_issues  0m 34s    selected 5 to fix               │
│ 🔵 fix_issues         7m 20s    fixing issue 3/5                │
│ ⏳ run_full_tests     -         waiting                         │
│ ⏳ update_experts     -         waiting                         │
│                                                                 │
│ Current Agent: backend-worker                                   │
│ Current File: src/gateway/session-manager.ts                    │
│                                                                 │
│ [View Logs] [View Context] [Pause] [Cancel]                     │
└─────────────────────────────────────────────────────────────────┘
```

### 6. Agent Drill-Down

When clicking on an agent:

```
┌─────────────────────────────────────────────────────────────────┐
│ 🤖 AGENT: backend-worker (agent:iso:bknd1)                      │
├─────────────────────────────────────────────────────────────────┤
│ Model: claude-opus-4-5                                          │
│ Spawned: 2026-02-03 23:07:20 EST                                │
│ Parent Workflow: wf-a3b2c1 (self-improve)                       │
│                                                                 │
│ Context Window:                                                 │
│ ████████████░░░░░░░░ 23,456 / 200,000 (12%)                    │
│                                                                 │
│ Files in Context:                                               │
│ ├─ src/gateway/session-manager.ts (2,341 tokens)               │
│ ├─ ralphy/experts/gateway-expert.yaml (1,234 tokens)           │
│ └─ ralphy/templates/BUG_TEMPLATE.md (567 tokens)               │
│                                                                 │
│ Recent Actions:                                                 │
│ 23:12:34 - Read file: src/gateway/session-manager.ts           │
│ 23:12:45 - Edit file: session-manager.ts:127                   │
│ 23:12:56 - Exec: pnpm test session-manager.test.ts             │
│                                                                 │
│ [View Full Transcript] [View Context] [Terminate]               │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### Data Sources

| Data | Source | Update Frequency |
|------|--------|------------------|
| Workflow status | Orchestrator session | Real-time |
| Agent list | sessions_list | 5 seconds |
| Metrics | ralphy/metrics/*.json | 1 minute |
| Logs | /tmp/gimli/gimli-*.log | Real-time |
| Cost | Anthropic API usage | Per request |

### API Endpoints

```typescript
// Get dashboard overview
GET /orchestrator/dashboard
Response: { status, activeWorkflows, agents, metrics }

// Get workflow details
GET /orchestrator/workflow/:id
Response: { workflow, steps, currentAgent, logs }

// Get agent details
GET /orchestrator/agent/:sessionKey
Response: { agent, context, actions, transcript }

// Control operations
POST /orchestrator/workflow/:id/pause
POST /orchestrator/workflow/:id/resume
POST /orchestrator/workflow/:id/cancel
POST /orchestrator/agent/:sessionKey/terminate
```

### Manual Override Capabilities

The dashboard supports these override actions:

1. **Pause Workflow** - Suspend execution, agent retains context
2. **Resume Workflow** - Continue from paused state
3. **Cancel Workflow** - Terminate and cleanup
4. **Terminate Agent** - Kill specific agent session
5. **Inject Context** - Add context to running agent
6. **Override Decision** - Change agent's planned action
7. **Rollback** - Revert workflow to previous step

### Alerts

Configure alerts for:

- 🔴 **Critical**: Workflow failure, security issue detected
- 🟠 **Warning**: High token usage, multiple retries
- 🟡 **Info**: Workflow complete, significant learning captured

### Future Enhancements

1. **Cost Prediction** - Estimate cost before workflow runs
2. **A/B Testing View** - Compare multiple fix approaches
3. **Trend Analysis** - Long-term improvement tracking
4. **Anomaly Detection** - Alert on unusual patterns
5. **Replay** - Re-run workflows with different parameters

---

*Dashboard design for TAC Orchestrator observability*
