# OpenClaw Multi-Agent Patterns Research

> Research conducted: 2026-02-01
> Sources: OpenClaw documentation, GitHub issues, IBM Think, Armin Ronacher's blog

## Executive Summary

OpenClaw is an open-source autonomous AI assistant that demonstrates production-grade multi-agent patterns. Its architecture provides valuable lessons for building scalable, isolated, and secure multi-agent systems. Key patterns include **agent isolation via separate workspaces/sessions**, **deterministic routing hierarchies**, **tool access control per agent**, and **just-in-time context loading**.

---

## 1. Core Architecture

### 1.1 Gateway as Control Plane

OpenClaw uses a **single Gateway** as the control plane for all agent operations:
- WebSocket-based communication for clients, tools, and events
- Handles sessions, presence, config, cron, webhooks
- Routes messages between channels and agents via bindings
- Single process manages multiple isolated agents

### 1.2 Agent Composition

Each agent is a **"fully scoped brain"** comprising three components:

| Component | Location | Purpose |
|-----------|----------|---------|
| **Workspace** | `~/.openclaw/workspace-<agentId>/` | Files, personality (AGENTS.md, SOUL.md), persona rules |
| **State Directory** | `~/.openclaw/agents/<agentId>/agent/` | Auth profiles, model registry, per-agent config |
| **Session Store** | `~/.openclaw/agents/<agentId>/sessions/` | Chat history, routing state (JSONL) |

### 1.3 Pi: The Minimal Agent Core

OpenClaw builds on **Pi**, a minimal coding agent with a tiny system prompt and only four tools:
- **Read**: File reading
- **Write**: File creation
- **Edit**: File modification
- **Bash**: Command execution

This constraint encourages agents to **extend themselves through code** rather than relying on pre-built tools.

---

## 2. Multi-Agent Routing Patterns

### 2.1 Routing Hierarchy

Message routing follows a **deterministic, specificity-based hierarchy**:

```
1. Peer-specific matches (exact DM/group/channel ID)
2. Guild ID (Discord)
3. Team ID (Slack)
4. Account ID matching
5. Channel-level matches
6. Fallback to default agent
```

### 2.2 Binding Terminology

- **agentId**: The "brain" identity (workspace + auth + sessions)
- **accountId**: Channel account instance (e.g., multiple WhatsApp numbers)
- **binding**: Routes inbound via `(channel, accountId, peer)` tuple

### 2.3 Multi-Channel Patterns

**Pattern A: Single account, multiple agents**
```yaml
# Route different DMs to different agents on one WhatsApp number
bindings:
  - channel: whatsapp
    accountId: default
    peer:
      kind: dm
      id: "+1555123456"
    agentId: work-agent
  - channel: whatsapp
    accountId: default
    peer:
      kind: dm
      id: "+1555654321"
    agentId: family-agent
```

**Pattern B: Cross-channel splitting**
```yaml
# Different channels route to different agents/models
bindings:
  - channel: whatsapp
    agentId: fast-agent      # Uses Sonnet
  - channel: telegram
    agentId: deep-agent      # Uses Opus
```

---

## 3. Agent Isolation & Security

### 3.1 Critical Isolation Rule

> **Never reuse `agentDir` across agents—it causes auth/session collisions.**

Each agent must have:
- Separate `agentDir` path
- Independent `auth-profiles.json`
- Isolated session storage
- Own browser profile (if using browser tools)

### 3.2 Tool Access Control

```typescript
// Per-agent tool restrictions
agents: {
  list: [{
    id: "family",
    tools: {
      allow: ["read"],
      deny: ["exec", "write", "edit", "browser"]
    }
  }]
}
```

**Tool Groups (Shorthands):**
- `group:runtime` → exec, bash, process
- `group:fs` → read, write, edit, apply_patch
- `group:sessions` → session_* operations
- `group:ui` → browser, canvas
- `group:messaging` → message

### 3.3 Sandbox Profiles

```typescript
// Isolated containers per agent
agents: {
  list: [{
    id: "untrusted-agent",
    sandbox: {
      mode: "all",
      scope: "agent"  // Per-agent container
    },
    tools: {
      elevated: false
    }
  }]
}
```

### 3.4 Agent-to-Agent Communication

Agent-to-agent messaging is **disabled by default** and requires explicit enablement:

```typescript
agentToAgent: {
  enabled: true,
  allowlist: ["coordinator", "worker-1", "worker-2"]
}
```

---

## 4. Context Management Patterns

### 4.1 Bootstrap Files

| File | Purpose | Size Limit |
|------|---------|------------|
| `AGENTS.md` | Operating instructions | < 5KB |
| `SOUL.md` | Persona/tone | < 5KB |
| `USER.md` | User context | < 5KB |
| `IDENTITY.md` | Name/vibe | < 5KB |
| `HEARTBEAT.md` | Periodic tasks | < 5KB |
| `MEMORY.md` | Curated long-term memory | Optional |

**Critical**: These files are **injected every run**, so conciseness directly impacts token efficiency.

### 4.2 Memory Architecture

```
workspace/
├── MEMORY.md           # Curated, manually maintained
└── memory/
    ├── 2026-01-28.md   # Daily append-only logs
    ├── 2026-01-29.md
    └── 2026-01-30.md
```

**Memory Workflow:**
1. Daily logs → `memory/YYYY-MM-DD.md` (append-only)
2. Curated → `MEMORY.md` (private sessions)
3. Pre-compaction flush auto-saves durable notes
4. Compaction persists summaries in JSONL history

### 4.3 Just-in-Time Context Loading

**Recommended Pattern:**
- Skills metadata in system prompt; full instructions loaded on-demand via `read`
- Use `memory_search` + `memory_get` for semantic recall
- Keep MEMORY.md curated; daily files for raw logs

### 4.4 Session Pruning

```typescript
// Cache-TTL mode (default: 5-minute TTL)
session: {
  pruning: {
    mode: "cache-ttl",
    keepLastAssistantMessages: 3,
    softTrimLargeOutputs: true,
    hardClearReplaceWithPlaceholder: true
  }
}
```

**Note**: Pruning only affects tool results—conversation history remains intact.

---

## 5. Token & Cost Optimization

### 5.1 Token Drivers (Ranked)

1. **Tool schemas** (~2,500 tokens for browser alone)
2. **Tool outputs** from exec/read operations
3. **Bootstrap file injection** per session
4. **Conversation history** (grows despite compaction)
5. **Skills metadata** overhead

### 5.2 Budget Enforcement

```typescript
agents: {
  defaults: {
    contextTokens: 50000  // Per-agent cap
  },
  list: [{
    id: "orchestrator",
    contextTokens: 80000  // Higher for coordinator
  }]
}
// Global max: 200K tokens
```

### 5.3 Instrumentation Commands

| Command | Purpose |
|---------|---------|
| `/status` | Session model, context usage, cost estimate |
| `/usage tokens` | Per-response breakdown |
| `/context list` | Injected files, tools, skills breakdown |
| `/context detail` | Tool schema sizes + skill metrics |

---

## 6. Multi-Agent Orchestration Patterns

### 6.1 Coordinator + Specialist Topology

```
┌─────────────────────────────────────────────────────┐
│                    COORDINATOR                       │
│  - Full tool access                                 │
│  - Routes tasks to specialists                      │
│  - Manages cross-agent state                        │
│  - Higher token budget (80K)                        │
└─────────────────┬───────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┬─────────────┐
    ▼             ▼             ▼             ▼
┌────────┐  ┌────────┐   ┌────────┐   ┌────────┐
│RESEARCH│  │ CODING │   │ COMMS  │   │ ADMIN  │
│ AGENT  │  │ AGENT  │   │ AGENT  │   │ AGENT  │
├────────┤  ├────────┤   ├────────┤   ├────────┤
│read    │  │read    │   │message │   │read    │
│search  │  │write   │   │read    │   │exec    │
│browse  │  │edit    │   │        │   │        │
│        │  │exec    │   │        │   │        │
└────────┘  └────────┘   └────────┘   └────────┘
```

### 6.2 TaskMaster Pattern (Cost Optimization)

A community-developed pattern for intelligent model selection:

```typescript
// TaskMaster skill selects model based on complexity
const selectModel = (task: Task): Model => {
  if (task.complexity === 'trivial') return 'haiku';
  if (task.complexity === 'moderate') return 'sonnet';
  return 'opus';
};
// Achieves 70-80% cost savings through delegation
```

### 6.3 Gardener Architecture (Memory)

Proposed hierarchical memory model:
- **Summary layers**: Automatic abstraction at time boundaries
- **Bi-directional linking**: References between memories
- **Background indexing**: Async refinement decoupled from hot path
- **Merge-back mechanisms**: Isolated work reintegrates cleanly

---

## 7. Anti-Patterns to Avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| Shared `agentDir` | Auth/session collisions | One `agentDir` per agent |
| Shared browser profiles | Session leakage | Separate profiles per agent |
| `/new` on non-default agents | Resets other agents | Use agent-specific reset |
| Mental notes without files | Lost on compaction | Write to MEMORY.md |
| Large bootstrap files | Token waste | Keep < 5KB each |
| Tool schema bloat | Context overhead | Load tools on-demand |
| Competence creep | Agents exceed scope | Clear tool deny lists |

---

## 8. Quick Implementation Checklist

1. ✅ Never share `agentDir` across agents
2. ✅ Keep bootstrap files < 5KB each
3. ✅ Enable cache-ttl pruning globally
4. ✅ Use memory flush before compaction
5. ✅ Implement tool deny lists per agent
6. ✅ Sandbox untrusted agents (`mode: "all"`, `scope: "agent"`)
7. ✅ Write memories to files—no mental notes
8. ✅ Monitor `/context list` regularly
9. ✅ Load skills on demand, keep descriptions short
10. ✅ Maintain separate browser profiles for parallel work

---

## 9. Vertical vs. Hybrid Integration

OpenClaw demonstrates that **loosely-coupled, open-source agent architecture can rival tightly-integrated approaches**. IBM researchers note this challenges the assumption that autonomous agents "must be vertically integrated, with the provider tightly controlling the models, memory, tools, interface, execution layer and security stack."

**Hybrid Integration Principle**: Match integration depth to specific security contexts rather than applying uniform controls universally.

---

## 10. Key Takeaways for Gimli

1. **Agent isolation is non-negotiable**: Separate workspaces, auth, and sessions prevent cross-contamination
2. **Routing should be deterministic**: Specificity-based hierarchy makes behavior predictable
3. **Bootstrap files must be concise**: Every token injected per-run compounds cost
4. **Tool access control per agent**: Principle of least privilege applies to AI agents
5. **Memory needs explicit architecture**: Don't rely on context window alone
6. **Cost optimization through delegation**: Use cheaper models for simpler tasks
7. **Sandbox untrusted agents**: Container isolation for defense in depth

---

## Sources

- [Multi-Agent Routing - OpenClaw Docs](https://docs.openclaw.ai/concepts/multi-agent)
- [GitHub Issue #4561: Multi-Agent Orchestration Best Practices](https://github.com/openclaw/openclaw/issues/4561)
- [Pi: The Minimal Agent Within OpenClaw - Armin Ronacher](https://lucumr.pocoo.org/2026/1/31/pi/)
- [OpenClaw: Vertical Integration - IBM Think](https://www.ibm.com/think/news/clawdbot-ai-agent-testing-limits-vertical-integration)
- [OpenClaw Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- [GitHub: openclaw/openclaw](https://github.com/openclaw/openclaw)
