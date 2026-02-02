# MCP Server Configuration Analysis

This document evaluates MCP (Model Context Protocol) server connections for the Gimli codebase.

## Current MCP Coverage (via Claude Code Plugins)

The following MCP servers are already available through installed Claude Code plugins:

| Plugin | MCP Capabilities | Use Case |
|--------|-----------------|----------|
| **Greptile** | Code search, PR review, custom context | Semantic codebase search, PR analysis |
| **Context7** | Library documentation lookup | Query docs for dependencies |
| **Pinecone** | Vector database operations | Embeddings, similarity search |
| **Playwright** | Browser automation | Web testing, scraping |
| **TypeScript LSP** | Code intelligence | Type checking, completions |
| **Swift LSP** | Swift code intelligence | macOS/iOS development |
| **Kotlin LSP** | Kotlin code intelligence | Android development |

## Evaluated But Not Added

### SQLite MCP
- **Purpose**: Query Gimli's memory database at `~/.gimli/memory/`
- **Status**: Not beneficial - LanceDB (vector store) is used, not raw SQLite
- **Alternative**: Use `gimli` CLI commands for memory operations

### GitHub MCP
- **Purpose**: Repository operations, issue/PR management
- **Status**: Already covered by `gh` CLI and Greptile plugin
- **Alternative**: `gh` commands work well via Bash tool

### Filesystem MCP
- **Purpose**: Enhanced file operations
- **Status**: Already covered by Claude Code's built-in Read/Write/Edit tools
- **Alternative**: Native tools are more integrated

### Brave Search MCP
- **Purpose**: Web search
- **Status**: WebSearch tool already available
- **Alternative**: Built-in WebSearch works well

## Recommended Configuration

No additional MCP servers are needed at this time. The current setup provides:

1. **Code Intelligence**: TypeScript/Swift/Kotlin LSPs
2. **Search**: Greptile for code, WebSearch for web
3. **Documentation**: Context7 for library docs
4. **Browser**: Playwright for automation
5. **Vector DB**: Pinecone for embeddings
6. **Git**: `gh` CLI via Bash tool

## Future Considerations

If these capabilities become needed, consider adding:

1. **Database MCP** - If direct SQL access to memory DB is required
2. **Linear/Notion MCP** - If Kanban integration beyond GitHub is needed
3. **Slack/Discord MCP** - If channel management beyond Gimli's tools is needed

## Sample `.mcp.json` Template

If project-level MCP configuration is needed in the future:

```json
{
  "$schema": "https://raw.githubusercontent.com/anthropics/claude-code/main/schemas/mcp-config.schema.json",
  "mcpServers": {
    "gimli-memory": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-sqlite", "~/.gimli/memory/memory.db"],
      "env": {}
    }
  }
}
```

Note: This is a template only. The actual memory system uses LanceDB, not SQLite.

## Conclusion

The existing Claude Code plugin ecosystem provides comprehensive MCP coverage for Gimli development. Additional servers would add complexity without significant benefit.

---
*Generated: 2026-02-01*
*Task: Phase 9.2 Grade 3 - Evaluate MCP server connections*
