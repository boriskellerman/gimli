## Relevant Files

**Before starting any task, locate and read the relevant source files.**

### Discovery Commands
```bash
# Find files by name
find src/ -name "*keyword*" -type f

# Find files by content
grep -rn "pattern" src/ --include="*.ts" | head -20

# Find test files for a module
find src/ -name "*.test.ts" -path "*module*"

# Check recent changes to a file
git log --oneline -5 -- path/to/file.ts

# Find all imports/exports
grep -rn "from.*module\|import.*module" src/ --include="*.ts"
```

### Key Source Areas
| Area | Path | What's There |
|------|------|--------------|
| Gateway core | `src/gateway/` | WebSocket server, session routing, protocol |
| Channels | `src/channels/`, `src/telegram/`, `src/discord/` | Message handling per platform |
| CLI | `src/cli/`, `src/commands/` | User-facing commands |
| Config | `src/config/` | Configuration types and parsing |
| Tools | `src/tools/`, `src/agents/tools/` | Agent tool implementations |
| Sessions | `src/sessions/` | Session management, history |
| Media | `src/media/` | Image, audio, video processing |
| Cron | `src/cron/` | Scheduled job execution |
| UI | `ui/` | Webchat / control panel frontend |

### Read Before Editing
Always read the full file before modifying it. Understand:
1. What the file does (purpose)
2. What depends on it (imports)
3. What it depends on (imports from)
4. Existing patterns and conventions
