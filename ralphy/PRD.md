# Gimli PRD - Ralphy Task List

> **Context**: Gimli is a security-hardened fork of OpenClaw/MoltBot - a personal AI assistant with multi-channel messaging, voice, browser control, Canvas, skills, cron, webhooks, and companion apps. Gimli already has built-in memory and learning systems. This PRD focuses on Linux deployment testing, security validation, enhancing existing systems, and adding AGI-style autonomous capabilities.

## ⚠️ Security-First Principles

**Gimli prioritizes security over OpenClaw defaults. All work must:**
- Never weaken existing security configurations
- Default to restrictive permissions (opt-in, not opt-out)
- Validate all external inputs (channels, webhooks, API responses)
- Keep credentials out of logs and error messages
- Use sandboxing for untrusted code execution
- Document security implications of any new feature
- Run security checks before merging experimental features

---

## Phase 1: Linux Setup & Deployment

- [x] Run `gimli onboard --install-daemon` on this Linux server and document any errors
- [x] Verify Node ≥22 is installed; if not, install it
- [x] Test `gimli gateway --port 18789 --verbose` starts successfully
- [x] Run `gimli doctor` and fix any reported issues
- [x] Test `gimli agent --message "test" --thinking high` completes without errors (requires API key - skipped on headless server)
- [x] Verify systemd/launchd daemon is installed and auto-starts on boot
- [x] Document any manual steps and create a one-liner setup script if possible
- [x] Test the Gateway WebSocket is accessible locally (ws://127.0.0.1:18789)

### Security Validation
- [x] Verify Gateway binds to loopback only by default (not 0.0.0.0)
- [x] Confirm DM pairing policy is enabled (dmPolicy="pairing")
- [x] Verify credentials are stored securely in `~/.gimli/credentials/` with proper permissions
- [x] Test that sandbox mode is active for non-main sessions
- [x] Run `gimli doctor` security checks and address any warnings
- [x] Review `~/.gimli/gimli.json` for any overly permissive settings

---

## Phase 2: Core Feature Testing

### Gateway & Sessions
- [x] Test session creation and isolation (main session vs group sessions)
- [x] Verify session persistence across gateway restarts
- [x] Test `/status`, `/new`, `/reset`, `/compact` chat commands
- [x] Test `/think` levels (off/minimal/low/medium/high/xhigh)
- [x] Verify agent-to-agent session tools: `sessions_list`, `sessions_history`, `sessions_send`

### Channel Testing (enable one at a time for testing)
- [x] Test WebChat connection via Gateway
- [x] If configured: Test Telegram bot token auth and message flow (not configured - skipped)
- [x] If configured: Test Discord bot token auth and message flow (not configured - skipped)
- [x] If configured: Test Slack bot/app token auth and message flow (not configured - skipped)
- [x] Verify DM pairing policy works (dmPolicy="pairing") (requires channel - skipped)
- [x] Test group message routing and mention gating (requires channel - skipped)

### Tools
- [x] Test `bash` tool execution (should run on host for main session)
- [x] Test `browser` tool - verify Chromium launches and snapshots work
- [x] Test `read`, `write`, `edit` file tools
- [x] Test `process` tool for running commands
- [x] Verify tool sandboxing works for non-main sessions (if Docker configured) (Docker not configured - skipped)

### Automation
- [x] Test cron job creation and execution
- [x] Test webhook endpoint receives and processes events
- [x] If configured: Test Gmail Pub/Sub trigger (not configured - skipped)

### Skills
- [x] List installed skills with `gimli skills list`
- [x] Test loading a bundled skill
- [x] Test workspace skill installation from `~/gimli/skills/`

---

## Phase 3: Bug Fixes & Improvements

- [x] Review `gimli doctor` output and fix all warnings/errors
- [x] Check Gateway logs for recurring errors and address them
- [x] Ensure graceful handling when channels are misconfigured (no crashes)
- [x] Verify media pipeline handles images/audio without memory leaks
- [x] Test long conversation sessions don't cause performance degradation
- [x] Add or improve error messages for common failure modes
- [x] Ensure consistent logging format across all modules

---

## Phase 4: Research - AGI Personal Assistant Patterns

- [x] Research how AutoGPT, BabyAGI, and similar systems handle autonomous task loops
- [x] Research proactive notification systems (when to interrupt vs queue)
- [x] Research user behavior modeling approaches (local, privacy-preserving)
- [x] Research Kanban/project management API integrations (Linear, Notion, GitHub Projects, Asana)
- [x] Research multi-agent coordination patterns for iteration/comparison
- [x] Document findings in `~/gimli/docs/AGI_RESEARCH.md`

---

## Phase 5: Anticipation & Reminder System (New Skill)

> **Note**: This skill should leverage Gimli's existing memory system for pattern storage, not create a parallel data store.

### Design
- [x] Design how reminders integrate with existing memory architecture
- [x] Design reminder priority system (urgent vs gentle nudge vs background)
- [x] Design feedback loop for reminder effectiveness
- [x] Define pattern types to track (time-based, event-based, context-based)

### Implementation
- [x] Create new skill: `~/gimli/skills/anticipate/SKILL.md`
- [x] Hook into existing memory system to track activity patterns
- [x] Build pattern detection for recurring tasks (daily standups, weekly reports, etc.)
- [x] Implement reminder queue that respects user's current context
- [x] Add natural language reminder creation ("remind me to X before Y")
- [x] Integrate with cron system for scheduled reminders
- [x] Add `/remind` chat command for manual reminder management
- [x] Connect to existing learning system for effectiveness tracking

### Testing
- [x] Test reminder creation and delivery across channels
- [x] Verify reminders don't fire during configured quiet hours
- [x] Test pattern detection with simulated activity data
- [x] Verify memory system integration doesn't create data silos

---

## Phase 6: Autonomous Kanban Agent (New Skill)

### Design
- [x] Design task intake from Kanban source (start with GitHub Issues or local markdown)
- [x] Design multi-iteration workflow (spawn sub-agents, run variations)
- [x] Design evaluation criteria for comparing solutions
- [x] Design presentation format for showing user the options

### Implementation
- [x] Create new skill: `~/gimli/skills/kanban-agent/SKILL.md`
- [x] Implement Kanban source adapter (GitHub Issues API or local `TASKS.md`)
- [x] Build task picker that selects next task based on priority/dependencies
- [x] Implement iteration runner using `sessions_spawn` for parallel work
- [x] Create solution comparator that evaluates each iteration's output
- [x] Build results presenter that summarizes options with pros/cons
- [x] Add `/kanban` chat commands: `status`, `pick`, `review`, `approve`

### Testing
- [x] Test task pickup from configured source
- [x] Test parallel iteration execution (2-3 approaches)
- [x] Test solution comparison and ranking
- [x] Test automated validation workflow (no human prompts)

---

## Phase 7: Enhance Existing Learning System

> **Note**: Gimli already has a built-in memory and learning system. This phase is about auditing, improving, and extending it - not replacing it.

### Audit Current System
- [x] Document current memory system architecture and data flow
- [x] Document current learning system capabilities and limitations
- [x] Identify what the learning system currently tracks and improves
- [x] Review how memory persists across sessions and restarts
- [x] Assess current privacy/security of stored learning data

### Memory System Enhancements
- [x] Evaluate memory retrieval relevance (does it surface the right context?)
- [x] Improve memory indexing for faster/better recall
- [x] Add memory categories (projects, people, preferences, decisions)
- [x] Implement memory decay for outdated information
- [x] Add `/memory` commands: `search`, `forget`, `export`

### Learning System Improvements
- [x] Implement learning feedback loop (explicit thumbs up/down on suggestions)
- [x] Add learning metrics dashboard (what has it learned, accuracy over time)
- [x] Improve preference extraction from conversation patterns
- [x] Add expertise detection (topics user knows well vs needs help with)
- [x] Implement communication style adaptation (learns formal vs casual, verbose vs terse)
- [x] Create learning checkpoints that can be rolled back if quality degrades

### Continuous Improvement
- [x] Design self-evaluation mechanism (did my response help?)
- [x] Implement A/B testing for response strategies
- [x] Add learning journal that documents what was learned and when
- [x] Create improvement velocity metric (is learning accelerating or plateauing?)

---

## Phase 8: OpenClaw Upstream Sync

> **Goal**: Automatically monitor OpenClaw for new features and security patches, evaluate them, and integrate beneficial changes while preserving Gimli's security hardening.

### Monitoring System
- [x] Create cron job that checks OpenClaw repo for new commits (daily or weekly)
- [x] Build changelog parser to extract meaningful feature descriptions
- [x] Implement diff analyzer to categorize changes (feature, bugfix, security, breaking)
- [x] Create notification system when significant changes detected
- [x] Store sync history in `~/.gimli/upstream/`

### Evaluation Pipeline
- [x] Design evaluation criteria (security impact, usefulness, complexity, conflicts)
- [x] Build automated security scanner for incoming changes (diff-analyzer detects security signals)
- [x] Create compatibility checker against Gimli's modifications (risk assessment checks sensitive paths)
- [x] Implement risk scoring for each potential merge (calculateRiskAssessment)
- [x] Generate human-readable summary of proposed changes

### Integration Workflow
- [x] Create staging branch for testing upstream changes (createStagingBranch in integration.ts)
- [x] Build automated test runner for merged changes (runTests, testStagedChanges in integration.ts)
- [x] Implement rollback mechanism if integration breaks something (rollback in integration.ts)
- [x] Add `/upstream` commands: `check`, `preview`, `apply`, `history` (upstream-cli.ts)
- [x] Create merge conflict resolver that preserves Gimli security defaults (resolveSecurityConflicts, shouldPreserveGimliVersion in integration.ts)

### Security Safeguards (Autonomous - No Human Prompts)
- [x] Log (don't block) changes that touch security-critical paths for post-run review
- [x] Flag any changes to: auth, permissions, sandboxing, credential handling in audit log
- [x] Auto-apply all changes; generate risk reports for human review AFTER completion (isAutoApplyable, generateRiskReport in integration.ts)
- [x] Maintain allowlist of safe-to-auto-merge file patterns (AllowlistConfig, defaultAllowlistConfig in integration.ts)
- [x] Log all upstream integrations for audit trail (sync-history)

### Reporting
- [x] Weekly summary of OpenClaw activity (generateWeeklySummary)
- [x] Highlight features that might benefit Gimli (in weekly summary)
- [x] Track which upstream changes were accepted/rejected and why (sync-history)

---

## Phase 9: TAC Orchestrator Agent with ADWs

> **Goal**: Build a self-operating system based on Tactical Agentic Coding (TAC) principles that runs Gimli itself, continuously improves the codebase, and fixes bugs automatically. This is the path to the "codebase singularity" - where agents run the codebase better than humans can.
>
> **Repo**: `~/github/orchestrator-agent-with-adws`
> **Reference**: TAC lesson transcripts in that folder

### Phase 9.1: Foundation - Study TAC Principles [COMPLETE]

- [x] Read all 14 TAC lesson transcripts thoroughly
- [x] Document the "12 Leverage Points of Agentic Coding"
- [x] Understand the Core Four: Context, Model, Prompt, Tools
- [x] Document the TAC progression: Base → Better → More → Custom → Orchestrator
- [x] Understand the three agentic layer classes and their grades
- [x] Create `~/github/orchestrator-agent-with-adws/docs/TAC_PRINCIPLES.md`

### Phase 9.2: Class 1 Agentic Layer (Grades 1-7)

> Build the foundational agentic layer around Gimli

#### Grade 1: Prime Prompts & Memory [COMPLETE]
- [x] Create `.claude/` directory structure in Gimli
- [x] Write `CLAUDE.md` memory file with Gimli-specific context
- [x] Create prime commands for common operations
- [x] Document codebase architecture for agent consumption

#### Grade 2: Sub-Agents [COMPLETE]
- [x] Identify parallelizable tasks in Gimli
- [x] Create sub-agent prompts for: frontend, backend, gateway, channels
- [x] Test sub-agent delegation patterns

#### Grade 3: Custom Tools [COMPLETE]
- [x] Build skills for Gimli-specific operations (channel testing, gateway health, etc.)
- [x] Create MCP server connections if beneficial
- [x] Write prime commands with tool access (database, config, logs)

#### Grade 4: Closed-Loop Prompts
- [x] Implement Request → Validate → Resolve pattern for all prompts
- [x] Add self-correction capabilities to agents
- [x] Create specialized closed-loop prompts for: testing, reviewing, documenting

#### Grade 5: Templates
- [x] Create bug template (how Gimli bugs should be investigated and fixed)
- [x] Create feature template (how new features should be planned and built)
- [x] Create chore template (maintenance tasks, dependency updates)
- [x] Encode Gimli's engineering standards into templates

#### Grade 6: Prompt Chains / Agentic Workflows
- [x] Build plan → build → test → review → document workflow
- [x] Create scout agents that research before building
- [x] Chain templates together for end-to-end feature development

#### Grade 7: Agent Experts
- [ ] Create Database Expert (Gimli's data layer mental model)
- [ ] Create Gateway Expert (WebSocket, sessions, channels)
- [ ] Create Security Expert (auth, sandboxing, credential handling)
- [ ] Create Channel Expert (WhatsApp, Telegram, Discord, etc.)
- [ ] Implement self-improve prompts to keep expertise synced with code
- [ ] Store expertise in YAML files that agents maintain automatically

### Phase 9.3: Class 2 Agentic Layer (Out-of-Loop)

> Build the PETER framework: Prompt → Environment → Trigger → Execute → Result

#### Grade 1: Outloop Foundation
- [ ] Set up webhook endpoints for external triggers
- [ ] Create programmatic agent execution via Claude Agent SDK
- [ ] Build basic HTTP trigger → agent execution pipeline

#### Grade 2: AI Developer Workflows (ADWs)
- [ ] Build deterministic code wrapper around agent calls
- [ ] Implement ADW for: plan-build, test-fix, review-document
- [ ] Add logging, validation, retries between agent steps
- [ ] Create ADW triggers from GitHub issues/PRs
- [ ] Store ADW results in structured format

### Phase 9.4: Class 3 Agentic Layer (Orchestrator)

> Build the O-Agent - One Agent to Rule Them All

#### Grade 1: Orchestrator Agent
- [ ] Create custom orchestrator agent with specialized system prompt
- [ ] Implement CRUD for agents (create, read, update, delete)
- [ ] Build multi-agent observability (see all agents, their context, their work)
- [ ] Implement single-interface pattern for fleet management

#### Grade 2: Orchestrator + ADWs
- [ ] Connect orchestrator to AI Developer Workflows
- [ ] Enable orchestrator to trigger deterministic pipelines
- [ ] Build orchestrator prompts specialized for Gimli operations

#### Grade 3: Full Autonomous Operation
- [ ] Orchestrator can run complete end-to-end workflows
- [ ] Implement ZTE (Zero Touch Engineering) capabilities
- [ ] Build parallel execution with git worktrees
- [ ] Create orchestrator developer workflows (ODWs)

### Phase 9.5: Self-Improvement Loop

> The system that improves itself

- [ ] Implement continuous bug detection (run tests, analyze logs)
- [ ] Auto-create issues/tasks when bugs detected
- [ ] Orchestrator picks up bugs and runs fix workflows
- [ ] Implement A/B testing for fixes (multiple iterations)
- [ ] Self-evaluate fix quality before merging
- [ ] Update Agent Experts when codebase changes
- [ ] Track improvement metrics over time

### Phase 9.6: Integration with Gimli's Existing Systems

- [ ] Connect to Gimli's existing memory system
- [ ] Connect to Gimli's existing learning system  
- [ ] Use Gimli's cron for scheduled orchestrator runs
- [ ] Use Gimli's sessions for multi-agent coordination
- [ ] Leverage Gimli's Kanban integration (from Phase 6)

### Phase 9.7: Observability & Control

- [ ] Build dashboard for orchestrator status
- [ ] Real-time agent activity monitoring
- [ ] Cost tracking per agent/workflow
- [ ] Context window utilization metrics
- [ ] One-click drill-down into any agent's work
- [ ] Manual override capabilities

### TAC Tactics Checklist (Apply Throughout)

- [ ] **Tactic 1**: Stop coding - use agents for all code changes
- [ ] **Tactic 2**: Adopt agent's perspective before every prompt
- [ ] **Tactic 3**: Template engineering into prompts
- [ ] **Tactic 4**: Stay out the loop - build outloop systems
- [ ] **Tactic 5**: Add feedback loops - more compute = more trust
- [ ] **Tactic 6**: One agent, one prompt, one purpose
- [ ] **Tactic 7**: R&D Framework - Reduce and Delegate context
- [ ] Apply the "Core Four" to every agent: Context, Model, Prompt, Tools

---

## Notes for Ralphy

### ⚡ Autonomous Operation Mode
- **Run all tasks without stopping or prompting for confirmation**
- Never pause to ask questions - make best judgment calls and continue
- Log decisions and flag concerns in reports for post-run human review
- If something fails, log it and move to next task (don't block on errors)
- Security concerns should be logged, not used as stop conditions

### Security First
- **Gimli is a security-hardened fork** - never compromise existing protections
- Default to restrictive permissions; require explicit opt-in for risky features
- Sandbox all untrusted code execution (non-main sessions use Docker)
- Validate and sanitize all external inputs
- Keep secrets out of logs, errors, and memory dumps
- When touching auth/permissions, log detailed changes for post-run audit (don't prompt)

### Existing Systems to Leverage
- **Memory System**: Already tracks conversation context - extend, don't replace
- **Learning System**: Already learns and improves - enhance its capabilities
- **Cron System**: Use for scheduled tasks (reminders, upstream sync)
- **Skills Platform**: Build new features as skills in `~/gimli/skills/`
- **Session Tools**: Use `sessions_spawn` for parallel agent work

### Environment
- **Target**: Linux server (this machine runs both dev and production)
- **Runtime**: Node ≥22
- **Package manager**: pnpm preferred, npm acceptable
- **Model**: Anthropic Claude (Opus 4.5 recommended for long-context)
- **Upstream**: OpenClaw at https://github.com/openclaw/openclaw.ai

### Principles
- **Security first**: Never weaken existing protections
- **Stability second**: Don't break existing features while adding new ones
- **Branch per feature**: Use `--branch-per-task` for experimental work
- **Document everything**: Mike values systematic approaches
- **Test iteratively**: Run `gimli doctor` after each major change
- **Privacy-preserving**: User data stays local, no external telemetry

### Mike's Context
- CTO at Aktion Associates, manages two data centers
- "Vibe coder" - strong infra/scripting, newer to formal dev
- Values structured approaches, documentation, continuous learning
- Working across multiple machines (WSL laptop, WSL desktop, MacBook)
- Currently focused on SupportMind project and DC move planning

### File Locations
- Workspace: `~/gimli/`
- Skills: `~/gimli/skills/<skill>/SKILL.md`
- Config: `~/.gimli/gimli.json`
- Credentials: `~/.gimli/credentials/`
- Upstream Sync: `~/gimli/upstream-sync/`
- **TAC Orchestrator**: `~/github/orchestrator-agent-with-adws/`

### TAC (Tactical Agentic Coding) Reference

The orchestrator system is based on 14 TAC lessons. Key concepts:

**The Core Four** (every agent has these):
1. Context - what the agent knows
2. Model - which LLM powers it
3. Prompt - instructions and templates
4. Tools - actions the agent can take

**Agent Progression**:
Base → Better → More → Custom → Orchestrator

**Three Classes of Agentic Layers**:
- **Class 1** (7 grades): Memory, sub-agents, tools, closed-loops, templates, chains, experts
- **Class 2** (2 grades): Outloop systems, AI Developer Workflows (ADWs)
- **Class 3** (3 grades): Orchestrator agent, ODWs, full autonomous operation

**Key Tactics**:
1. Stop coding (use agents)
2. Adopt agent's perspective
3. Template your engineering
4. Stay out the loop
5. Add feedback loops (more compute = more trust)
6. One agent, one prompt, one purpose
7. R&D Framework (Reduce & Delegate context)

**The Codebase Singularity**: The moment when agents can run the codebase better than you can. This is the goal.

Lesson transcripts are stored in: `~/github/orchestrator-agent-with-adws/`
