# Chore Planning

## Purpose
Create a new plan in the `specs/` directory to resolve the maintenance chore using the specified plan format. Follow the instructions to create the plan, use the relevant files to focus on the right files.

## Instructions
1. Read the chore description carefully
2. Identify all files that need modification
3. Break down the work into clear, actionable steps
4. Include validation commands to verify the work
5. Consider Gimli's security-first principles
6. Save the plan to `specs/chore-<descriptive-name>.md`

## Relevant Files
When investigating the chore, consider these key areas:
- `src/cli/` - CLI wiring and commands
- `src/commands/` - Command implementations
- `src/infra/` - Infrastructure utilities
- `src/gateway/` - Gateway WebSocket server
- `src/channels/` - Channel implementations (Telegram, Discord, Slack, etc.)
- `extensions/` - Plugin extensions
- `package.json` - Dependencies and scripts
- `CLAUDE.md` - Repository guidelines

## Plan Format
Create a plan with the following structure:

```markdown
# Chore: [Descriptive Title]

## Description
[Clear description of what this chore accomplishes]

## Relevant Files
- `path/to/file1.ts` - [why this file is relevant]
- `path/to/file2.ts` - [why this file is relevant]

## New Files (if any)
- `path/to/new-file.ts` - [purpose of new file]

## Step-by-Step Tasks
Execute every step in order, top to bottom.

1. [ ] **Step 1**: [Action description]
   - Details about what to do
   - Any important considerations

2. [ ] **Step 2**: [Action description]
   - Details about what to do

[Continue with all necessary steps...]

## Validation
Run these commands to verify the work:
- `pnpm lint` - Check for linting errors
- `pnpm build` - Verify TypeScript compiles
- `pnpm test` - Run test suite
- [Add chore-specific validation commands]

## Notes
- [Any important caveats or considerations]
- [Security implications if relevant]
```

## Chore
$ARGUMENTS
