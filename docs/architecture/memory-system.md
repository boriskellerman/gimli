# Memory System Architecture

This document describes the architecture and data flow of Gimli's memory system, which provides semantic search over agent workspace files and session transcripts.

## Overview

The memory system enables agents to recall relevant information from:
- **Memory files**: Markdown files in the workspace (`MEMORY.md`, `memory.md`, `memory/**/*.md`)
- **Session transcripts**: JSONL files containing conversation history

It uses a hybrid search approach combining vector similarity search with full-text search (BM25) for optimal retrieval.

## Architecture Diagram

```
                                 User Query
                                      |
                                      v
                        +---------------------------+
                        |   MemoryIndexManager      |
                        |   (src/memory/manager.ts) |
                        +---------------------------+
                                      |
            +-------------------------+-------------------------+
            |                         |                         |
            v                         v                         v
    +---------------+       +------------------+      +------------------+
    | Vector Search |       | Keyword Search   |      | Hybrid Merger    |
    | (sqlite-vec)  |       | (FTS5 BM25)      |      | (weighted blend) |
    +---------------+       +------------------+      +------------------+
            |                         |                         |
            +-------------------------+-------------------------+
                                      |
                                      v
                        +---------------------------+
                        |   SQLite Database         |
                        |   (files, chunks, cache)  |
                        +---------------------------+
                                      ^
                                      |
            +-------------------------+-------------------------+
            |                                                   |
            v                                                   v
    +--------------------+                          +------------------------+
    | Memory Files Sync  |                          | Session Files Sync     |
    | (MEMORY.md, etc.)  |                          | (*.jsonl transcripts)  |
    +--------------------+                          +------------------------+
            ^                                                   ^
            |                                                   |
    +--------------------+                          +------------------------+
    | File Watcher       |                          | Session Event Listener |
    | (chokidar)         |                          | (transcript-events)    |
    +--------------------+                          +------------------------+
```

## Key Components

### 1. MemoryIndexManager (`src/memory/manager.ts`)

The central class that orchestrates all memory operations.

**Key responsibilities:**
- Manages the SQLite database for storing files, chunks, and embeddings
- Coordinates sync operations between sources and the index
- Handles vector and FTS table management
- Provides the `search()` API for hybrid retrieval

**Singleton pattern:**
```typescript
// Cached by agent+workspace+config
const manager = await MemoryIndexManager.get({ cfg, agentId });
```

### 2. Embedding Providers (`src/memory/embeddings.ts`)

Supports multiple embedding backends with automatic fallback:

| Provider | Model Default | Notes |
|----------|--------------|-------|
| OpenAI | `text-embedding-3-small` | Remote API, batch support |
| Gemini | `gemini-embedding-001` | Remote API, batch support |
| Local | `embeddinggemma-300M-Q8_0.gguf` | Offline via node-llama-cpp |

**Provider selection logic:**
1. If `provider: "auto"` and local model file exists, use local
2. Try OpenAI, then Gemini (skip if API key missing)
3. Apply fallback if primary fails

### 3. Database Schema (`src/memory/memory-schema.ts`)

**Tables:**

```sql
-- Metadata storage
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexed files
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL,  -- 'memory' | 'sessions'
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);

-- Text chunks with embeddings
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Embedding cache (cross-file deduplication)
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

-- Virtual tables (created if enabled)
CREATE VIRTUAL TABLE chunks_vec USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[<dims>]
);

CREATE VIRTUAL TABLE chunks_fts USING fts5(
  text, id UNINDEXED, path UNINDEXED, source UNINDEXED,
  model UNINDEXED, start_line UNINDEXED, end_line UNINDEXED
);
```

### 4. Search Pipeline (`src/memory/manager-search.ts`, `src/memory/hybrid.ts`)

**Hybrid search flow:**

```
Query -> Embed Query -> Vector Search (top K * multiplier)
                    \-> Keyword Search (top K * multiplier)
                           \
                            +-> Merge Results -> Apply Weights -> Return top K
```

**Default weights:**
- Vector weight: 0.7
- Text weight: 0.3
- Candidate multiplier: 4x

### 5. Proactive Query (`src/memory/proactive-query.ts`)

Queries relevant memories before agent turns:

```typescript
const result = await queryProactiveMemories(manager, {
  userMessage: "What was our discussion about databases?",
  agentId: "agent-123",
  maxResults: 5,
  maxTokens: 500,
  minScore: 0.3,
});
```

Returns formatted context ready for injection into prompts.

## Data Flow

### Indexing Flow

```
1. File Change Detected
   |
   v
2. Read File Content
   |
   v
3. Chunk Content (tokens: 400, overlap: 80)
   |
   v
4. Check Embedding Cache
   |-- Cache Hit --> Use cached embedding
   |
   v (Cache Miss)
5. Generate Embeddings
   |-- Batch API (OpenAI/Gemini)
   |-- Local Model (node-llama-cpp)
   |
   v
6. Store in Database
   |-- chunks table (text + embedding)
   |-- chunks_vec table (vector index)
   |-- chunks_fts table (full-text index)
   |-- embedding_cache (for deduplication)
   |
   v
7. Update files table (hash for change detection)
```

### Search Flow

```
1. Query Received
   |
   v
2. Warm Session (if needed)
   |-- Trigger sync if dirty
   |
   v
3. Embed Query
   |-- With timeout (60s remote, 5min local)
   |
   v
4. Parallel Search
   |-- Vector: cosine distance via sqlite-vec
   |-- Keyword: BM25 via FTS5
   |
   v
5. Merge Results
   |-- Normalize scores
   |-- Apply weights
   |-- Deduplicate by ID
   |
   v
6. Filter & Rank
   |-- Apply minScore threshold
   |-- Sort by combined score
   |-- Return top maxResults
```

## Key Types and Interfaces

### MemorySearchResult

```typescript
type MemorySearchResult = {
  path: string;       // Relative path to source file
  startLine: number;  // Chunk start line
  endLine: number;    // Chunk end line
  score: number;      // Combined search score (0-1)
  snippet: string;    // Text content (max 700 chars)
  source: "memory" | "sessions";
};
```

### ResolvedMemorySearchConfig

```typescript
type ResolvedMemorySearchConfig = {
  enabled: boolean;
  sources: Array<"memory" | "sessions">;
  provider: "openai" | "local" | "gemini" | "auto";
  model: string;
  fallback: "openai" | "gemini" | "local" | "none";
  store: {
    driver: "sqlite";
    path: string;
    vector: { enabled: boolean; extensionPath?: string };
  };
  chunking: { tokens: number; overlap: number };
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
    sessions: { deltaBytes: number; deltaMessages: number };
  };
  query: {
    maxResults: number;
    minScore: number;
    hybrid: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
      candidateMultiplier: number;
    };
  };
  cache: { enabled: boolean; maxEntries?: number };
};
```

### EmbeddingProvider

```typescript
type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};
```

## Sync Triggers

The memory index can sync from multiple triggers:

| Trigger | When | What Syncs |
|---------|------|-----------|
| `session-start` | Agent turn begins | Memory files only |
| `search` | Before search if dirty | Both (if dirty) |
| `watch` | File change detected | Memory files only |
| `session-delta` | Transcript grows | Session files only |
| `interval` | Periodic timer | Both |
| `force` | Manual/explicit | Both (full reindex) |

## Batch Processing

For remote providers (OpenAI/Gemini), batch processing is supported:

**OpenAI Batch API:**
- Submits embeddings as a batch job
- Polls for completion with configurable timeout
- Falls back to individual requests on failure

**Gemini Batch API:**
- Uses `batchEmbedContents` endpoint
- Similar polling/fallback behavior

**Failure handling:**
- Track failure count per provider
- Disable batch after 2 consecutive failures
- Fall back to non-batch embedding

## Memory File Discovery

The system looks for memory files in this order:

```typescript
async function listMemoryFiles(workspaceDir: string): Promise<string[]> {
  // 1. MEMORY.md in workspace root
  // 2. memory.md in workspace root (alternate case)
  // 3. All *.md files in memory/ directory (recursive)
  // Deduplicates by realpath
}
```

## Session File Processing

Session transcripts (`.jsonl` files) are processed as:

1. Parse each line as JSON
2. Extract `message` records with `role: "user"` or `role: "assistant"`
3. Concatenate content text (normalize whitespace)
4. Format as `User: ...` or `Assistant: ...`
5. Chunk and index like memory files

## Chunking Strategy

Uses a token-based chunking approach:

```typescript
function chunkMarkdown(content: string, { tokens, overlap }) {
  // Default: 400 tokens per chunk, 80 token overlap
  // ~4 chars per token estimate
  // Preserves line boundaries where possible
  // Long lines are split at maxChars boundary
}
```

## Caching

**Embedding Cache:**
- Stores embeddings by `(provider, model, provider_key, hash)`
- Avoids re-embedding identical text chunks
- Prunable via `maxEntries` config

**Index Cache:**
- `MemoryIndexManager` instances cached by key
- Key: `${agentId}:${workspaceDir}:${JSON.stringify(settings)}`

## Related Components

### Recency Buffer (`src/agents/recency-buffer.ts`)

Preserves recent messages during context compaction:

```typescript
const { toSummarize, preserved } = applyRecencyBuffer(messages, bufferSize);
// Default buffer: 10 messages
```

### Memory Injection Hook (`src/hooks/memory-injection-hook.ts`)

Registers hook for `agent:turn:start` to inject relevant memories:

```typescript
registerMemoryInjectionHook({
  enabled: true,
  maxMemories: 5,
  maxTokens: 500,
  minScore: 0.3,
});
```

## Configuration

Memory search is configured per-agent:

```yaml
agents:
  defaults:
    memorySearch:
      enabled: true
      provider: auto  # openai | gemini | local | auto
      sources:
        - memory
        - sessions  # requires experimental.sessionMemory
      store:
        vector:
          enabled: true
      chunking:
        tokens: 400
        overlap: 80
      sync:
        onSessionStart: true
        onSearch: true
        watch: true
        watchDebounceMs: 1500
      query:
        maxResults: 6
        minScore: 0.35
        hybrid:
          enabled: true
          vectorWeight: 0.7
          textWeight: 0.3
      cache:
        enabled: true
```

## Storage Location

Default SQLite database path:
```
~/.gimli/state/memory/${agentId}.sqlite
```

Configurable via `store.path` with `{agentId}` token support.

## Performance Considerations

- **Vector search**: Uses sqlite-vec extension for efficient similarity search
- **Embedding cache**: Reduces API calls for repeated content
- **Batch processing**: Reduces API round-trips for large indexes
- **Incremental sync**: Only re-indexes changed files (via content hash)
- **Debounced watch**: Prevents excessive syncs during file editing

## Error Handling

- **Provider fallback**: Automatically switches to fallback provider on failure
- **Batch retry**: Retries batch operations on timeout (once)
- **Graceful degradation**: Falls back to in-memory cosine similarity if sqlite-vec unavailable
- **Sync isolation**: Atomic reindex via temp database + swap
