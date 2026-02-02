# OpenClaw Skills Documentation Study

This document summarizes the key learnings from studying the OpenClaw skills documentation at https://docs.openclaw.ai/tools/skills

## What Are Skills?

Skills teach agents how to use tools. Each skill is a directory containing a `SKILL.md` file with YAML frontmatter and markdown instructions. Skills are AgentSkills-compatible, following a standard specification.

## Skill Loading Precedence

Skills load from three sources (highest to lowest priority):

1. **Workspace skills** (`<workspace>/skills`) - project-specific, highest priority
2. **Managed/local skills** (`~/.openclaw/skills`) - user-installed
3. **Bundled skills** - shipped with OpenClaw, lowest priority

When naming conflicts occur, higher-priority skills override lower-priority ones. Additional folders can be configured via `skills.load.extraDirs`.

## SKILL.md File Format

### Minimum Required Structure

```yaml
---
name: skill-name
description: Brief description of what the skill does
---

[Markdown instructions for the agent]
```

### Key Frontmatter Fields

| Field | Description | Default |
|-------|-------------|---------|
| `name` | Skill identifier (required) | - |
| `description` | Human-readable purpose (required) | - |
| `homepage` | Optional website URL | - |
| `user-invocable` | Expose as slash command | `true` |
| `disable-model-invocation` | Exclude from model prompt | `false` |
| `metadata` | Single-line JSON with gating rules | - |
| `command-dispatch` | Set to "tool" for direct dispatch | - |
| `command-tool` | Tool name to invoke | - |
| `command-arg-mode` | Argument handling mode | `"raw"` |

## Gating & Requirements

Skills can specify requirements that must be met for the skill to load:

```yaml
---
name: my-skill
description: Does something cool
metadata: {"openclaw": {"requires": {"bins": ["ffmpeg"], "env": ["API_KEY"], "config": ["some.config.path"]}}}
---
```

### Gating Options

- **bins**: Required binary executables (e.g., `["ffmpeg", "docker"]`)
- **env**: Required environment variables (e.g., `["OPENAI_API_KEY"]`)
- **config**: Required OpenClaw config paths
- **os**: Target operating systems (darwin, linux, win32)
- **installers**: Optional installers for dependencies

## Skills as Slash Commands

Skills automatically become slash commands when `user-invocable: true` (the default). The skill name is sanitized to `a-z0-9_` (max 32 chars).

### Direct Tool Dispatch

Skills can bypass the language model for deterministic execution:

```yaml
---
name: quick-action
description: Performs a quick action
command-dispatch: tool
command-tool: my-tool-name
---
```

This routes `/quick-action` directly to the specified tool without model inference.

## Per-Skill Configuration

Configure individual skills in `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "entries": {
      "skill-name": {
        "enabled": true,
        "env": { "API_KEY": "secret-value" },
        "apiKey": "primary-secret",
        "config": { "custom": "fields" }
      }
    }
  }
}
```

## System Prompt Integration

Skills appear in the agent's system prompt via a compact XML list. The `formatSkillsForPrompt` function handles this with deterministic token costs based on metadata fields.

## Plugin Integration

Plugins can ship skills by listing directories in `openclaw.plugin.json`. Plugin skills participate in normal precedence rules.

## ClawHub Registry

ClawHub (https://clawhub.com) is the public skills registry:

- `clawhub install <skill-slug>` - install a skill
- `clawhub update --all` - refresh installed skills
- `clawhub sync --all` - publish updates

## Security Considerations

- Treat third-party skills as untrusted code
- Review skills before enabling
- Secrets injected via `env` or `apiKey` run in the host process, not sandboxes
- For untrusted inputs, use sandboxed execution

## Performance Optimization

- OpenClaw snapshots eligible skills at session start
- Changes take effect on new sessions
- Skills watcher (enabled by default) can refresh mid-session when SKILL.md files change
- Configure watcher: `skills.load.watch` and `skills.load.watchDebounceMs`

## Best Practices

1. **Clear descriptions**: State capability + service clearly (e.g., "Generate or edit images via Gemini 3 Pro Image")
2. **Appropriate gating**: Use `requires` metadata to ensure dependencies are available
3. **Security-conscious**: Don't expose sensitive operations without proper gating
4. **Deterministic when possible**: Use `command-dispatch: tool` for simple, predictable operations
5. **Single responsibility**: Each skill should do one thing well

## Relationship to Claude Code

This documentation is for OpenClaw, which is compatible with/related to Claude Code. The skills system uses the AgentSkills specification which appears to be shared across these tools. Key similarities:

- SKILL.md file format with YAML frontmatter
- Markdown instructions for the agent
- Slash command integration
- User-invocable vs model-invocable distinction
- Gating/requirements system

## References

- Main skills documentation: https://docs.openclaw.ai/tools/skills
- Skills configuration: https://docs.openclaw.ai/tools/skills-config
- Slash commands: https://docs.openclaw.ai/tools/slash-commands
- ClawHub registry: https://clawhub.com
