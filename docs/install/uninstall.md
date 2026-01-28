---
summary: "Uninstall Gimli completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Gimli from a machine
  - The gateway service is still running after uninstall
---

# Uninstall

Two paths:
- **Easy path** if `gimli` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
gimli uninstall
```

Non-interactive (automation / npx):

```bash
gimli uninstall --all --yes --non-interactive
npx -y gimli uninstall --all --yes --non-interactive
```

Manual steps (same result):

1) Stop the gateway service:

```bash
gimli gateway stop
```

2) Uninstall the gateway service (launchd/systemd/schtasks):

```bash
gimli gateway uninstall
```

3) Delete state + config:

```bash
rm -rf "${GIMLI_STATE_DIR:-$HOME/.gimli}"
```

If you set `GIMLI_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4) Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/gimli
```

5) Remove the CLI install (pick the one you used):

```bash
npm rm -g gimli
pnpm remove -g gimli
bun remove -g gimli
```

6) If you installed the macOS app:

```bash
rm -rf /Applications/Gimli.app
```

Notes:
- If you used profiles (`--profile` / `GIMLI_PROFILE`), repeat step 3 for each state dir (defaults are `~/.gimli-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `gimli` is missing.

### macOS (launchd)

Default label is `bot.molt.gateway` (or `bot.molt.<profile>`; legacy `com.gimli.*` may still exist):

```bash
launchctl bootout gui/$UID/bot.molt.gateway
rm -f ~/Library/LaunchAgents/bot.molt.gateway.plist
```

If you used a profile, replace the label and plist name with `bot.molt.<profile>`. Remove any legacy `com.gimli.*` plists if present.

### Linux (systemd user unit)

Default unit name is `gimli-gateway.service` (or `gimli-gateway-<profile>.service`):

```bash
systemctl --user disable --now gimli-gateway.service
rm -f ~/.config/systemd/user/gimli-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Gimli Gateway` (or `Gimli Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Gimli Gateway"
Remove-Item -Force "$env:USERPROFILE\.gimli\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.gimli-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://gimli.bot/install.sh` or `install.ps1`, the CLI was installed with `npm install -g gimli@latest`.
Remove it with `npm rm -g gimli` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `gimli ...` / `bun run gimli ...`):

1) Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2) Delete the repo directory.
3) Remove state + workspace as shown above.
