---
summary: "CLI reference for `gimli agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `gimli agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
gimli agents list
gimli agents add work --workspace ~/gimli-work
gimli agents set-identity --workspace ~/gimli --from-identity
gimli agents set-identity --agent main --avatar avatars/gimli.png
gimli agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:
- Example path: `~/gimli/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:
- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
gimli agents set-identity --workspace ~/gimli --from-identity
```

Override fields explicitly:

```bash
gimli agents set-identity --agent main --name "Gimli" --emoji "🪓" --avatar avatars/gimli.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Gimli",
          theme: "space lobster",
          emoji: "🪓",
          avatar: "avatars/gimli.png"
        }
      }
    ]
  }
}
```
