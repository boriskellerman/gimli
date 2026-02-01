# Memory Persistence and Security

This document describes how Gimli persists memory across sessions, implements data retention policies, ensures session isolation, and protects stored data.

## Overview

Gimli uses a multi-layered persistence architecture:

1. **SQLite databases** for vector embeddings and semantic memory
2. **JSONL files** for session transcripts (conversation history)
3. **JSON files** for session metadata
4. **Markdown files** for learnings (LEARNINGS.md)

## Storage Locations

All persistent data is stored under the state directory (default: `~/.gimli`):

```
~/.gimli/
  agents/
    <agent-id>/
      sessions/
        sessions.json           # Session metadata store
        sessions.json.lock      # Write lock for concurrent access
        <session-id>.jsonl      # Session transcript files
      agent/
        LEARNINGS.md           # Extracted learnings
        memory-index.db        # SQLite memory index (embeddings)
```

The state directory can be overridden via `GIMLI_STATE_DIR` environment variable.

## Session Isolation

### Per-Agent Isolation

Each agent has its own isolated storage namespace:

- Memory indexes are keyed by `agentId:workspaceDir:settings`
- Session transcripts are stored in agent-specific directories
- Learnings are stored per-agent in `LEARNINGS.md`

```typescript
// Memory index cache key ensures agent isolation
const key = `${agentId}:${workspaceDir}:${JSON.stringify(settings)}`;
```

### Per-Session Isolation

Sessions are isolated by session key:

- Direct chats collapse to a canonical "main" session key
- Group chats use unique keys with format: `agent:<agentId>:<channel>:group:<groupId>`
- Topic threads include topic IDs: `<session-id>-topic-<topic-id>.jsonl`

### Source Isolation in Memory

Memory chunks are tagged with their source ("memory" or "sessions"):

```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',  -- 'memory' or 'sessions'
  ...
);
```

Searches can filter by source to isolate memory from session transcripts.

## Data Retention Policies

### Session Store Cleanup

Ephemeral hook sessions are automatically cleaned up:

- **Max age**: 48 hours (`HOOK_SESSION_MAX_AGE_MS`)
- **Max count**: 500 sessions (`HOOK_SESSION_MAX_COUNT`)

```typescript
const HOOK_SESSION_MAX_AGE_MS = 48 * 60 * 60 * 1000;  // 48 hours
const HOOK_SESSION_MAX_COUNT = 500;
```

Hook sessions (keys starting with `hook:`) are pruned on every session store write to prevent unbounded growth and OOM on low-memory systems.

### Embedding Cache Pruning

The embedding cache has configurable maximum entries:

- Oldest entries (by `updated_at`) are evicted when limit is exceeded
- Cache is pruned after each full reindex operation

### Memory File Cleanup

Stale memory entries are automatically removed during sync:

- Files removed from disk are deleted from the index
- Orphaned chunks are cleaned up when their parent file is removed

## File Permissions and Security

### Session Store Security

Session store files are created with restricted permissions:

```typescript
await fs.promises.writeFile(tmp, json, { mode: 0o600, encoding: "utf-8" });
await fs.promises.chmod(storePath, 0o600);
```

This ensures:
- Owner read/write only (no group or world access)
- Protected from other users on shared systems

### Atomic Writes

Session store updates use atomic write patterns:

1. Write to temporary file with unique name
2. Rename temporary file to target (atomic operation)
3. Clean up temporary file on failure

This prevents data corruption from concurrent writes or crashes.

### Write Locking

Session store operations use file-based locking:

- Lock file: `sessions.json.lock`
- Timeout: 10 seconds
- Stale lock detection: 30 seconds
- Automatic stale lock eviction

```typescript
const lockPath = `${storePath}.lock`;
const timeoutMs = 10_000;
const staleMs = 30_000;
```

## Memory Index Persistence

### SQLite Schema

The memory index uses SQLite with the following schema:

```sql
-- Metadata storage
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexed files
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);

-- Text chunks with embeddings
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Embedding cache for reuse
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);
```

### Vector Storage

When sqlite-vec is available, vector embeddings are stored in a virtual table:

```sql
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[<dimensions>]
);
```

### Full-Text Search

When FTS5 is available, text content is indexed for hybrid search:

```sql
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text,
  id UNINDEXED,
  path UNINDEXED,
  source UNINDEXED,
  model UNINDEXED,
  start_line UNINDEXED,
  end_line UNINDEXED
);
```

## Session Transcript Persistence

### Format

Session transcripts are stored as JSONL (JSON Lines) files:

- One JSON object per line
- Each line represents a message event
- Preserves full conversation history

### Sync Triggers

Session transcripts are synced to the memory index based on:

- **Bytes threshold**: Configurable delta bytes before sync
- **Messages threshold**: Configurable delta messages before sync
- **Debounce**: 5 second debounce for batch processing

## Learnings Persistence

### Storage Format

Learnings are stored in `LEARNINGS.md` as structured markdown:

```markdown
# Agent Learnings

## User Preferences
- [2024-01-15] User prefers concise responses

## Corrections
- [2024-01-14] API endpoint changed to v2

## Successful Patterns
- [2024-01-13] Use bullet points for lists

## Tool Usage
- [2024-01-12] Always confirm before file deletion
```

### Deduplication

New learnings are deduplicated using Jaccard similarity:

- Threshold: 80% similarity
- Comparison within same category only
- Duplicate matches update timestamp instead of creating new entry

## Restart Recovery

### Memory Index Recovery

On restart:

1. Existing SQLite database is opened
2. Metadata is read to detect configuration changes
3. If model/provider/chunking settings changed, full reindex is triggered
4. Otherwise, incremental sync updates changed files

### Safe Reindex

Full reindexes use a safe atomic swap pattern:

1. Create temporary database file
2. Build new index in temporary database
3. Seed embedding cache from original database
4. Swap files atomically
5. Clean up old database

This ensures:
- No data loss during reindex
- Rollback on failure
- Preserved embedding cache

### Session Recovery

Sessions are restored from:

1. Session store (`sessions.json`) for metadata
2. Session transcript files (`.jsonl`) for conversation history
3. Recency buffer preserves recent messages during compaction

## Privacy Considerations

### Stored Data

The following data is persisted:

- **Session transcripts**: Full conversation history (user messages, assistant responses)
- **Memory embeddings**: Vector representations of indexed content
- **Session metadata**: Channel info, timestamps, user preferences
- **Learnings**: Extracted patterns and preferences

### Data Location

All data remains local to the configured state directory. No data is transmitted externally except:

- Embedding API calls (to OpenAI, Gemini, or local model)
- Model API calls for agent responses

### Sensitive Data Handling

Embedding cache stores only:

- Provider and model identifiers
- Content hashes (not raw content)
- Vector embeddings (not reversible to original text)

Session store does NOT encrypt content at rest. For sensitive deployments:

- Use encrypted filesystem
- Configure restricted state directory
- Set appropriate file permissions

## Configuration

### Memory Search Config

```typescript
interface ResolvedMemorySearchConfig {
  provider: "openai" | "gemini" | "local" | "auto";
  model: string;
  sources: ("memory" | "sessions")[];
  store: {
    path: string;  // SQLite database path
    vector: { enabled: boolean; extensionPath?: string };
  };
  cache: {
    enabled: boolean;
    maxEntries?: number;
  };
  sync: {
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
    onSearch: boolean;
    onSessionStart: boolean;
    sessions?: {
      deltaBytes: number;
      deltaMessages: number;
    };
  };
}
```

### Environment Variables

- `GIMLI_STATE_DIR`: Override state directory location
- `GIMLI_SESSION_CACHE_TTL_MS`: Session store cache TTL (default: 45000ms)
