# MCP Server Integration

Gimli supports Model Context Protocol (MCP) servers for enhanced agent capabilities. This document describes the available MCP servers and how to configure them.

## Overview

MCP servers extend Gimli's tool ecosystem by providing standardized interfaces to external services. The `.mcp.json` configuration file in the project root defines available servers.

## Enabled Servers

### GitHub (`github`)

GitHub API integration for working with repositories, issues, PRs, and workflows.

**Use cases:**
- Kanban-agent task intake from GitHub Issues
- TAC orchestrator PR management
- CI/CD workflow monitoring

**Required environment:**
```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxxxx
```

### Filesystem (`filesystem`)

Secure filesystem access scoped to the project and Gimli configuration directories.

**Accessible paths:**
- Project workspace directory
- `~/.gimli/` (configuration, credentials, sessions)

### Memory (`memory`)

Persistent knowledge graph for cross-session context retention.

**Use cases:**
- Agent-specific knowledge storage
- Complements Gimli's built-in memory system
- Pattern and decision tracking

### Sequential Thinking (`sequential-thinking`)

Enhanced reasoning for complex multi-step tasks.

**Use cases:**
- TAC workflow planning
- Debugging complex issues
- Architectural decisions

### Fetch (`fetch`)

HTTP request capabilities for web interactions.

**Use cases:**
- API testing
- Webhook development
- External service integration

### Time (`time`)

Current time and timezone operations.

**Use cases:**
- Cron job development
- Reminder system testing
- Timezone-aware scheduling

## Disabled Servers

The following servers are available but disabled by default. Enable them by removing the `"disabled": true` line and providing required environment variables.

### PostgreSQL (`postgres`)

Database access for PostgreSQL instances.

**Required environment:**
```bash
export POSTGRES_CONNECTION_STRING=postgresql://user:pass@host:5432/db
```

### Brave Search (`brave-search`)

Web search via Brave Search API.

**Required environment:**
```bash
export BRAVE_API_KEY=BSA_xxxxx
```

### Slack (`slack`)

Slack workspace integration for channel development/testing.

**Required environment:**
```bash
export SLACK_BOT_TOKEN=xoxb-xxxxx
export SLACK_TEAM_ID=T12345678
```

### Puppeteer (`puppeteer`)

Alternative browser automation via Puppeteer (Gimli uses Playwright by default).

## Configuration

### Adding a New Server

1. Add the server definition to `.mcp.json`:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-my-server"],
      "env": {
        "API_KEY": "${MY_API_KEY}"
      },
      "description": "Description of what this server provides."
    }
  }
}
```

2. Set required environment variables
3. Restart your IDE/agent session

### Disabling a Server

Add `"disabled": true` to the server configuration:
```json
{
  "my-server": {
    "disabled": true,
    ...
  }
}
```

## Integration with Gimli

### Current Status

Gimli's ACP (Agent Client Protocol) implementation currently ignores MCP servers passed from clients. This is intentional as Gimli provides its own tool ecosystem.

The `.mcp.json` file is primarily for:
- Claude Code IDE integration
- External MCP-compatible clients
- Future Gimli MCP support

### Gimli's Built-in Alternatives

| MCP Server | Gimli Equivalent |
|------------|------------------|
| filesystem | `read`, `write`, `edit` tools |
| puppeteer | `browser` tool (Playwright) |
| memory | Memory system (`/memory` commands) |
| github | `gh` CLI via bash tool |
| slack | Slack channel extension |

### Future MCP Support

Gimli may add native MCP server support in a future release. The ACP translator (`src/acp/translator.ts`) is designed to be extended for MCP integration.

## Security Considerations

- Environment variables are interpolated at runtime
- Never commit actual credentials to `.mcp.json`
- Use environment variable references: `${VAR_NAME}`
- Filesystem server is scoped to specific directories
- Review server permissions before enabling

## Troubleshooting

### Server Not Starting

1. Check that the MCP server package is available:
   ```bash
   npx -y @modelcontextprotocol/server-<name> --help
   ```

2. Verify environment variables are set:
   ```bash
   echo $GITHUB_PERSONAL_ACCESS_TOKEN
   ```

3. Check for conflicting port usage

### Connection Issues

1. Restart your IDE/agent session
2. Check server logs in your IDE's output panel
3. Verify network connectivity for remote services

## Related Documentation

- [Gimli Skills](/skills)
- [Gateway Configuration](/configuration)
- [TAC Orchestrator](/tac-orchestrator)
- [MCP Specification](https://modelcontextprotocol.io)
