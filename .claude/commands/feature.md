# Feature Planning

## Purpose
Create a comprehensive plan in the `specs/` directory to implement the new feature using the specified plan format. Follow the instructions to create the plan, use the relevant files to focus on the right files.

## Instructions
1. Understand the feature requirements thoroughly
2. Think hard about the architecture and design
3. Research existing patterns in the codebase
4. Plan for all affected areas (CLI, gateway, channels, tests, docs)
5. Include comprehensive test coverage
6. Consider security implications at every step
7. Avoid over-engineering - keep it focused on requirements
8. Save the plan to `specs/feature-<descriptive-name>.md`

## Relevant Files
When planning features, consider these key areas:
- `src/cli/` - If adding new CLI commands or options
- `src/commands/` - Command implementations
- `src/gateway/` - Gateway WebSocket functionality
- `src/channels/` - Channel-specific implementations
- `src/routing/` - Message routing logic
- `src/media/` - Media processing pipeline
- `src/infra/` - Infrastructure utilities
- `src/agents/` - Agent functionality
- `extensions/` - Plugin extensions
- `docs/` - Documentation (Mintlify format)
- `apps/` - Mobile/desktop apps if UI changes needed
- `CLAUDE.md` - Repository guidelines

## Security Considerations
For every feature, verify:
- [ ] Input validation at system boundaries
- [ ] No credential exposure in logs/errors
- [ ] Respects sandbox boundaries for non-main sessions
- [ ] Follows opt-in permissions model
- [ ] Channel-specific auth requirements considered

## Plan Format
Create a plan with the following structure:

```markdown
# Feature: [Descriptive Title]

## Description
[Clear description of what this feature does and why it's needed]

## Requirements
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

## Design Decisions
- **Decision 1**: [Approach chosen and why]
- **Decision 2**: [Approach chosen and why]

## Relevant Files
- `path/to/file1.ts` - [why this file is relevant]
- `path/to/file2.ts` - [why this file is relevant]

## New Files
- `path/to/new-file.ts` - [purpose of new file]
- `path/to/new-file.test.ts` - [test coverage]

## Step-by-Step Tasks
Execute every step in order, top to bottom.

### Phase 1: Foundation
1. [ ] **Task 1**: [Action description]
   - Implementation details
   - Key considerations

2. [ ] **Task 2**: [Action description]
   - Implementation details

### Phase 2: Core Implementation
3. [ ] **Task 3**: [Action description]
   - Implementation details

4. [ ] **Task 4**: [Action description]
   - Implementation details

### Phase 3: Testing & Documentation
5. [ ] **Task 5**: Add comprehensive tests
   - Unit tests for new functionality
   - Integration tests if applicable

6. [ ] **Task 6**: Update documentation
   - Update relevant docs in `docs/`
   - Update CLAUDE.md if needed

## Validation
Run these commands to verify the feature:
- `pnpm lint` - Check for linting errors
- `pnpm build` - Verify TypeScript compiles
- `pnpm test` - Run full test suite
- `pnpm test <specific-file>` - Run targeted tests
- [Add feature-specific manual tests]

## API Changes (if applicable)
- New endpoints: [list any new API endpoints]
- Changed endpoints: [list any changed API endpoints]
- New CLI commands: [list any new CLI commands]

## Migration Notes
[Any steps needed to migrate existing users/data]

## Security Implications
- [Security consideration 1]
- [Security consideration 2]

## Notes
- [Performance considerations]
- [Future enhancement ideas]
- [Known limitations]
```

## Feature
$ARGUMENTS
