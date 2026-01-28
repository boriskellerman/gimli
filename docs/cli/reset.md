---
summary: "CLI reference for `gimli reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `gimli reset`

Reset local config/state (keeps the CLI installed).

```bash
gimli reset
gimli reset --dry-run
gimli reset --scope config+creds+sessions --yes --non-interactive
```

