# Doctor Diagnostics

## Purpose
Run comprehensive diagnostics on the Gimli installation and fix reported issues.

## Instructions
1. Run `gimli doctor` to get current status
2. Analyze each warning/error
3. Create a plan to fix issues if requested
4. Verify fixes resolve the problems

## Common Issues and Solutions

### Gateway Not Running
```bash
# Check gateway status
gimli channels status --probe

# Restart (macOS)
./scripts/restart-mac.sh

# Restart (Linux)
pkill -9 -f gimli-gateway || true
nohup gimli gateway run --bind loopback --port 18789 --force > /tmp/gimli-gateway.log 2>&1 &
```

### Permissions Issues
```bash
# Check credential permissions
ls -la ~/.gimli/credentials/

# Fix permissions (should be 600)
chmod 600 ~/.gimli/credentials/*
```

### Configuration Issues
```bash
# View current config
gimli config list

# Reset specific config
gimli config set <key> <value>
```

### Channel Connection Issues
```bash
# Probe channels
gimli channels status --probe --all

# Check specific channel logs
```

## Security Checks
- Verify gateway binds to loopback only
- Confirm dmPolicy="pairing" is set
- Check credentials have proper permissions (600)
- Verify sandbox mode for non-main sessions

## Diagnostic Request
$ARGUMENTS
