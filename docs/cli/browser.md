---
summary: "CLI reference for `gimli browser` (profiles, tabs, actions, extension relay)"
read_when:
  - You use `gimli browser` and want examples for common tasks
  - You want to control a browser running on another machine via a node host
  - You want to use the Chrome extension relay (attach/detach via toolbar button)
---

# `gimli browser`

Manage Gimli’s browser control server and run browser actions (tabs, snapshots, screenshots, navigation, clicks, typing).

Related:
- Browser tool + API: [Browser tool](/tools/browser)
- Chrome extension relay: [Chrome extension](/tools/chrome-extension)

## Common flags

- `--url <gatewayWsUrl>`: Gateway WebSocket URL (defaults to config).
- `--token <token>`: Gateway token (if required).
- `--timeout <ms>`: request timeout (ms).
- `--browser-profile <name>`: choose a browser profile (default from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
gimli browser --browser-profile chrome tabs
gimli browser --browser-profile gimli start
gimli browser --browser-profile gimli open https://example.com
gimli browser --browser-profile gimli snapshot
```

## Profiles

Profiles are named browser routing configs. In practice:
- `gimli`: launches/attaches to a dedicated Gimli-managed Chrome instance (isolated user data dir).
- `chrome`: controls your existing Chrome tab(s) via the Chrome extension relay.

```bash
gimli browser profiles
gimli browser create-profile --name work --color "#FF5A36"
gimli browser delete-profile --name work
```

Use a specific profile:

```bash
gimli browser --browser-profile work tabs
```

## Tabs

```bash
gimli browser tabs
gimli browser open https://docs.gimli.bot
gimli browser focus <targetId>
gimli browser close <targetId>
```

## Snapshot / screenshot / actions

Snapshot:

```bash
gimli browser snapshot
```

Screenshot:

```bash
gimli browser screenshot
```

Navigate/click/type (ref-based UI automation):

```bash
gimli browser navigate https://example.com
gimli browser click <ref>
gimli browser type <ref> "hello"
```

## Chrome extension relay (attach via toolbar button)

This mode lets the agent control an existing Chrome tab that you attach manually (it does not auto-attach).

Install the unpacked extension to a stable path:

```bash
gimli browser extension install
gimli browser extension path
```

Then Chrome → `chrome://extensions` → enable “Developer mode” → “Load unpacked” → select the printed folder.

Full guide: [Chrome extension](/tools/chrome-extension)

## Remote browser control (node host proxy)

If the Gateway runs on a different machine than the browser, run a **node host** on the machine that has Chrome/Brave/Edge/Chromium. The Gateway will proxy browser actions to that node (no separate browser control server required).

Use `gateway.nodes.browser.mode` to control auto-routing and `gateway.nodes.browser.node` to pin a specific node if multiple are connected.

Security + remote setup: [Browser tool](/tools/browser), [Remote access](/gateway/remote), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
