---
summary: "CLI reference for `gimli config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
---

# `gimli config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `gimli configure`).

## Examples

```bash
gimli config get browser.executablePath
gimli config set browser.executablePath "/usr/bin/google-chrome"
gimli config set agents.defaults.heartbeat.every "2h"
gimli config set agents.list[0].tools.exec.node "node-id-or-name"
gimli config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
gimli config get agents.defaults.workspace
gimli config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
gimli config get agents.list
gimli config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
gimli config set agents.defaults.heartbeat.every "0m"
gimli config set gateway.port 19001 --json
gimli config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
