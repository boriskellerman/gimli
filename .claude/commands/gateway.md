# Gateway Operations

## Purpose
Perform gateway-specific operations including health checks, restart, log analysis, and diagnostics.

## Available Operations
- **status**: Check gateway status and connections
- **logs**: Analyze recent gateway logs
- **restart**: Restart the gateway (macOS only)
- **diagnose**: Run comprehensive gateway diagnostics

## Instructions
Based on the operation requested, perform the appropriate actions:

### Status Check
```bash
gimli channels status --probe
ss -ltnp | grep 18789 || netstat -tlnp | grep 18789
```

### Log Analysis
```bash
# macOS
./scripts/clawlog.sh --tail 100

# Linux
tail -n 100 /tmp/gimli-gateway.log
```

### Restart (macOS only)
```bash
./scripts/restart-mac.sh
```

### Diagnose
```bash
gimli doctor
gimli channels status --all
```

## Security Notes
- Gateway should bind to loopback only (127.0.0.1), not 0.0.0.0
- Verify dmPolicy is set to "pairing"
- Credentials stored in ~/.gimli/credentials/ should have restricted permissions

## Operation
$ARGUMENTS
