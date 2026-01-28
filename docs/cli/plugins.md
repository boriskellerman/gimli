---
summary: "CLI reference for `gimli plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
---

# `gimli plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:
- Plugin system: [Plugins](/plugin)
- Plugin manifest + schema: [Plugin manifest](/plugins/manifest)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
gimli plugins list
gimli plugins info <id>
gimli plugins enable <id>
gimli plugins disable <id>
gimli plugins doctor
gimli plugins update <id>
gimli plugins update --all
```

Bundled plugins ship with Gimli but start disabled. Use `plugins enable` to
activate them.

All plugins must ship a `gimli.plugin.json` file with an inline JSON Schema
(`configSchema`, even if empty). Missing/invalid manifests or schemas prevent
the plugin from loading and fail config validation.

### Install

```bash
gimli plugins install <path-or-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

Supported archives: `.zip`, `.tgz`, `.tar.gz`, `.tar`.

Use `--link` to avoid copying a local directory (adds to `plugins.load.paths`):

```bash
gimli plugins install -l ./my-plugin
```

### Update

```bash
gimli plugins update <id>
gimli plugins update --all
gimli plugins update <id> --dry-run
```

Updates only apply to plugins installed from npm (tracked in `plugins.installs`).
