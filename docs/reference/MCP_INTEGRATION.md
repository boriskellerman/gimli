# MCP Server Integration

> **Status**: Evaluated - No dedicated Gimli MCP servers needed at this time.

This document covers Model Context Protocol (MCP) integration with Gimli and provides guidance for when MCP connections might be beneficial.

## Current MCP Capabilities

### Existing Integrations

1. **mcporter** - External MCP tool caller
   - Used by `gimli docs` command to search documentation
   - Can call any MCP server via `mcporter call <server.tool>`
   - Docs: `/skills/mcporter/SKILL.md`

2. **ACP (Agent Client Protocol)** - IDE integration
   - Exposes Gimli as an MCP-compatible agent for IDEs
   - Supports Zed, and other ACP-compatible editors
   - CLI: `gimli acp [--url] [--token]`
   - Docs: `/docs.acp.md`

3. **Claude Code Plugins** - Already enabled
   - GitHub, Playwright, Context7, Greptile, and 30+ others
   - Configured via `~/.claude/settings.json`

## Evaluation: Gimli-Specific MCP Servers

### Not Beneficial (Current State)

The following capabilities are already available without dedicated MCP servers:

| Capability | Current Solution | Why MCP Not Needed |
|------------|-----------------|-------------------|
| Gateway health | `gimli doctor` | CLI works via bash |
| Channel status | `gimli channels status` | CLI works via bash |
| Config access | `gimli config list` | CLI works via bash |
| Log analysis | `gimli gateway logs` | CLI works via bash |
| Session management | `sessions_*` tools | Built into Pi agent |

### Potentially Beneficial (Future)

MCP servers might be beneficial when:

1. **Cross-process communication** - If non-Gimli agents need Gimli data
2. **Language-agnostic tooling** - If tools need to be called from Python/Go
3. **Remote access** - If agents need Gimli data without shell access
4. **Structured schemas** - When type-safe tool definitions are required

## Adding MCP Servers (When Needed)

### Option 1: Use mcporter (External Servers)

Configure external MCP servers via mcporter:

```bash
# Install mcporter globally
npm i -g mcporter

# Configure a server
mcporter auth https://example.com/mcp

# Call a tool
mcporter call https://example.com/mcp.SearchDocs query="auth setup"
```

### Option 2: Create Gimli MCP Server (If Needed)

If a Gimli-specific MCP server becomes beneficial:

1. Create `/src/mcp/server.ts` implementing MCP protocol
2. Expose via `gimli mcp` command
3. Register tools for gateway health, channels, config
4. Document in this file

## Claude Code Plugin Integration

This project already benefits from Claude Code's MCP plugins:

- **github** - Issue/PR management
- **playwright** - Browser automation testing
- **context7** - Documentation search
- **greptile** - Semantic code search

These are configured at the user level (`~/.claude/settings.json`) and apply to all projects.

## References

- [MCP Specification](https://modelcontextprotocol.io/)
- [mcporter Skill](/skills/mcporter/SKILL.md)
- [ACP Documentation](/docs.acp.md)
- [Claude Code Plugins](https://docs.claudecode.ai/plugins)
