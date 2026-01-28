---
summary: "CLI reference for `gimli doctor` (health checks + guided repairs)"
read_when:
  - You have connectivity/auth issues and want guided fixes
  - You updated and want a sanity check
---

# `gimli doctor`

Health checks + quick fixes for the gateway and channels.

Related:
- Troubleshooting: [Troubleshooting](/gateway/troubleshooting)
- Security audit: [Security](/gateway/security)

## Examples

```bash
gimli doctor
gimli doctor --repair
gimli doctor --deep
```

Notes:
- Interactive prompts (like keychain/OAuth fixes) only run when stdin is a TTY and `--non-interactive` is **not** set. Headless runs (cron, Telegram, no terminal) will skip prompts.
- `--fix` (alias for `--repair`) writes a backup to `~/.gimli/gimli.json.bak` and drops unknown config keys, listing each removal.

## macOS: `launchctl` env overrides

If you previously ran `launchctl setenv GIMLI_GATEWAY_TOKEN ...` (or `...PASSWORD`), that value overrides your config file and can cause persistent “unauthorized” errors.

```bash
launchctl getenv GIMLI_GATEWAY_TOKEN
launchctl getenv GIMLI_GATEWAY_PASSWORD

launchctl unsetenv GIMLI_GATEWAY_TOKEN
launchctl unsetenv GIMLI_GATEWAY_PASSWORD
```
