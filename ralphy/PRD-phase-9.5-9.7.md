# Gimli PRD - Phase 9.5-9.7: Self-Improvement, Integration & Observability

> **Context**: This PRD covers the final sub-phases of the TAC Orchestrator Agent implementation. These phases build the self-improving loop, integrate with Gimli's existing systems, and add observability/control capabilities.
>
> **Reference**: Main PRD at `ralphy/PRD.md`, TAC principles at `ralphy/TAC_PRINCIPLES.md`

## Security-First Principles

**All work must:**
- Never weaken existing security configurations
- Default to restrictive permissions (opt-in, not opt-out)
- Validate all external inputs
- Keep credentials out of logs and error messages
- Use sandboxing for untrusted code execution
- Document security implications of any new feature

---

## Phase 9.5: Self-Improvement Loop

> The system that improves itself

- [ ] Implement continuous bug detection (run tests, analyze logs)
- [ ] Auto-create issues/tasks when bugs detected
- [ ] Orchestrator picks up bugs and runs fix workflows
- [ ] Implement A/B testing for fixes (multiple iterations)
- [ ] Self-evaluate fix quality before merging
- [ ] Update Agent Experts when codebase changes
- [ ] Track improvement metrics over time

---

## Phase 9.6: Integration with Gimli's Existing Systems

- [ ] Connect to Gimli's existing memory system
- [ ] Connect to Gimli's existing learning system
- [ ] Use Gimli's cron for scheduled orchestrator runs
- [ ] Use Gimli's sessions for multi-agent coordination
- [ ] Leverage Gimli's Kanban integration (from Phase 6)

---

## Phase 9.7: Observability & Control

- [ ] Build dashboard for orchestrator status
- [ ] Real-time agent activity monitoring
- [ ] Cost tracking per agent/workflow
- [ ] Context window utilization metrics
- [ ] One-click drill-down into any agent's work
- [ ] Manual override capabilities

---

## Notes for Ralphy

### Autonomous Operation Mode
- **Run all tasks without stopping or prompting for confirmation**
- Never pause to ask questions - make best judgment calls and continue
- Log decisions and flag concerns in reports for post-run human review
- If something fails, log it and move to next task (don't block on errors)

### Existing Systems to Leverage
- **Memory System**: `src/memory/` - conversation context tracking
- **Learning System**: `src/learning/` - learning and improvement
- **Cron System**: `src/cron/` - scheduled task execution
- **Skills Platform**: `skills/` directory
- **Session Tools**: `sessions_spawn` for parallel agent work
- **Kanban Agent**: `skills/kanban-agent/`

### File Locations
- Workspace: `/home/gimli/github/gimli/`
- Skills: `skills/<skill>/SKILL.md`
- Config: `~/.gimli/gimli.json`
- TAC Orchestrator: `~/github/orchestrator-agent-with-adws/`

### Key Architectural Files
- `src/gateway/` - WebSocket gateway
- `src/agents/` - Agent runtime
- `src/plugins/` - Plugin system
- `src/config/` - Configuration
- `ARCHITECTURE.md` - System architecture guide
