---
summary: "CLI reference for `gimli logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
---

# `gimli logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:
- Logging overview: [Logging](/logging)

## Examples

```bash
gimli logs
gimli logs --follow
gimli logs --json
gimli logs --limit 500
```

