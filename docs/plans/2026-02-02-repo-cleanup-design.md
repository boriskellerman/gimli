# Repository Cleanup Design

**Date**: 2026-02-02
**Goal**: Get Gimli building and running, organize the repository, refresh documentation

## Current State

### Build Status
- **56 TypeScript errors** blocking compilation
- `gimli doctor` cannot run

### Root Folder Issues
- 12 markdown files (some obsolete or misplaced)
- Docker files scattered in root instead of `docker/`
- Stray directories: `Swabble/`, `ralphy/`, `.ralphy/`, `research/`, `experts/`
- Tracking file `progress.txt` in root

### Documentation Issues
- README.md has outdated lobster branding references
- IMAGES_TO_REPLACE.md tracks needed branding updates
- Some docs may be stale

---

## Phase 1: Fix TypeScript Errors

### 1.1 Missing Type Exports in `src/adw/types.ts`
Files importing non-existent types:
- `agent-wrapper.ts`: `AgentCallConfig`, `AgentCallInput`, `AgentCallOutput`, `StepRetryConfig`
- `workflow-runner.ts`: `StepDefinition`, `StepResult`, `WorkflowDefinition`, `WorkflowEvent`, `WorkflowEventListener`, `WorkflowRun`, `WorkflowStepLog`
- `workflow-builder.ts`: `StepDefinition`, `StepRetryConfig`, `WorkflowDefinition`
- `logger.ts`: `WorkflowEvent`

**Fix**: Add missing type definitions to `src/adw/types.ts`

### 1.2 Duplicate Exports in `src/learning/index.ts`
Both `expertise-detection.ts` and `expertise-store.ts` export:
- `formatExpertiseSummary`
- `resolveExpertisePath`

**Fix**: Use explicit re-exports with aliases

### 1.3 Function Signature Mismatches in `src/cli/upstream-cli.ts`
- `loadState()` called without required `statePath` argument
- `createInitialState()` called without required `branch` argument
- `CommitMonitorState` uses `lastCommitSha` not `lastCheckedCommitSha`
- `CommitInfo` missing `url` in object literals

**Fix**: Update function calls to match signatures

### 1.4 Other Type Issues
- `src/adw/connector.ts`: SpawnResult type issues
- `src/agents/tools/prime-tools.ts`: SessionEntry missing properties
- `src/agents/adw/runner.ts`: Type narrowing issues
- `src/workflows/adw-*.ts`: Type coercion issues

---

## Phase 2: Organize Root Folder

### 2.1 Docker Files
Move to `docker/`:
- `Dockerfile` → `docker/Dockerfile`
- `Dockerfile.sandbox` → `docker/Dockerfile.sandbox`
- `Dockerfile.sandbox-browser` → `docker/Dockerfile.sandbox-browser`
- `docker-compose.yml` → `docker/docker-compose.yml`
- `docker-setup.sh` → `docker/setup.sh`

Update references in scripts and documentation.

### 2.2 Research/Working Files
Consolidate into `docs/internal/`:
- `ralphy/` → `docs/internal/ralphy/` (TAC transcripts, PRD, research)
- `research/` → merge into `docs/internal/research/`
- `experts/` → `docs/internal/experts/`
- `.ralphy/` → keep as config (dotfile convention)

### 2.3 Swabble Directory
`Swabble/` is a standalone Swift package. Options:
- A) Keep as submodule/separate project
- B) Move to `packages/swabble/`
- C) Extract to separate repository

**Decision needed**: What is Swabble's relationship to Gimli?

### 2.4 Root Markdown Cleanup
Keep in root:
- `README.md` - Project entry point
- `CHANGELOG.md` - Release history
- `CONTRIBUTING.md` - Contribution guide
- `LICENSE` - MIT license
- `SECURITY.md` - Security policy

Move to `docs/`:
- `ARCHITECTURE.md` → `docs/architecture/overview.md`
- `WALKTHROUGH.md` → `docs/start/walkthrough.md`
- `RESEARCH.md` → `docs/internal/research.md`
- `LYNIS_BASELINE.md` → `docs/internal/lynis-baseline.md`
- `IMAGES_TO_REPLACE.md` → `docs/internal/images-to-replace.md`

Remove or archive:
- `docs.acp.md` - Evaluate if still needed
- `gimli-prompt.md` / `gimli-prompt.json` - Move to `docs/internal/`
- `progress.txt` - Temporary file, remove from root

---

## Phase 3: Update Documentation

### 3.1 README.md Refresh
- Remove lobster emoji (🪓) references
- Verify all links work
- Update badges if needed
- Ensure installation instructions are current

### 3.2 AGENTS.md (CLAUDE.md) Update
- Verify architecture diagram matches current code
- Update directory descriptions
- Ensure security model is accurate
- Add any new conventions

### 3.3 Script Comments
Review and update header comments in `scripts/`:
- Ensure each script has a description
- Update outdated references

---

## Execution Order

1. **Fix TypeScript errors** (unblocks testing)
2. **Run `gimli doctor`** (verify build works)
3. **Organize root folder** (with working build to verify)
4. **Update documentation** (final polish)
5. **Commit incrementally** (one logical change per commit)

---

## Success Criteria

- [ ] `pnpm build` completes without errors
- [ ] `pnpm gimli doctor` runs successfully
- [ ] Root folder has ≤10 non-config files
- [ ] All markdown files have accurate content
- [ ] No duplicate exports or missing types
