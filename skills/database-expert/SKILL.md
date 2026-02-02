---
name: database-expert
description: Expert knowledge of Gimli's data layer - SQLite, JSON stores, file locking, caching, and persistence patterns. Load this expertise for database-related tasks.
metadata: {"gimli":{"emoji":"💾","expertise_file":"experts/database-expert.yaml"}}
---

# Database Expert

This skill provides deep expertise on Gimli's data layer architecture. Load this when working on:
- Session management and persistence
- Memory indexing and retrieval
- Reminder storage and queries
- Auth profile management
- Any data storage decisions

## Architecture Overview

Gimli uses a **hybrid persistence strategy**:

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Structured/queryable data | SQLite | SQL queries, joins, FTS, vectors |
| User-editable config | JSON/JSON5 files | Human-readable, hand-editable |
| Secrets | AES-256-GCM encrypted files | Security-first |
| Temporary media | File system with TTL | Auto-cleanup |

### Key Technologies

- **SQLite**: `node:sqlite` (DatabaseSync) - synchronous, blocking I/O
- **sqlite-vec**: Vector extension for semantic search
- **JSON5**: Sessions and config (allows comments, trailing commas)
- **proper-lockfile**: File-based mutex for concurrent access
- **PBKDF2**: Key derivation with 600k iterations (OWASP 2023)

## Core Data Entities

### Sessions (`~/.gimli/sessions/sessions.json`)

Session state stored as JSON5 with file locking and in-memory caching (45s TTL).

```typescript
// Key functions in src/infra/sessions-store.ts
loadSessionStore()       // Cached load
saveSessionStore()       // Atomic write (temp + rename)
updateSessionStoreEntry() // Read-modify-write with lock
```

**Schema highlights**:
- `sessionId`, `updatedAt`, `sessionFile`
- Delivery context (channel, to, accountId, threadId)
- Model/auth overrides
- Queue configuration
- Token usage tracking

### Memory (`~/.gimli/agents/{agentId}/memory.db`)

SQLite database with FTS5 and sqlite-vec for search.

**Tables**:
| Table | Purpose |
|-------|---------|
| `meta` | Embedding metadata (model, dimensions) |
| `files` | File tracking with hash and mtime |
| `chunks` | Text chunks with line references |
| `embedding_cache` | Provider-agnostic embedding cache |
| `chunks_fts` | FTS5 virtual table for keyword search |
| `chunks_vec` | sqlite-vec for vector similarity |

**Access class**: `MemoryIndexManager` in `src/infra/memory-index.ts`

### Reminders (`~/.gimli/agents/{agentId}/reminders.db`)

SQLite database for scheduled and context-triggered reminders.

**Tables**:
| Table | Purpose |
|-------|---------|
| `reminders` | Main reminder storage |
| `reminder_feedback` | Effectiveness tracking |
| `reminder_effectiveness` | Computed metrics |

**Access class**: `ReminderStore` in `src/infra/reminder-store.ts`

### Auth Profiles (`~/.gimli/agents/{agentId}/auth-profiles.json`)

JSON file with versioning and file locking.

Features:
- Round-robin rotation with cooldowns
- Failure tracking and exponential backoff
- Pre-emptive OAuth token refresh

### Secrets (`~/.gimli/credentials/*.enc`)

Encrypted with AES-256-GCM. Defensive overwrite before deletion.

## Access Patterns

### File Store Transaction (JSON stores)

```
1. Load current state (JSON5 parse)
2. Acquire lock via proper-lockfile
3. Apply mutation inside lock
4. Write to temp file
5. Atomic rename to target
6. Release lock
```

Error handling: stale lock detection, exponential backoff retry, graceful degradation.

### SQLite Direct Access

```typescript
// Synchronous, blocking I/O
const db = new DatabaseSync(path);
db.prepare(sql).run(params);
db.exec(ddl);
```

Characteristics:
- No connection pooling
- Manual index management via PRAGMA
- Raw SQL strings (no query builder)

## Decision Guide

### Where should I store this data?

| Need | Recommendation |
|------|----------------|
| SQL queries, joins, aggregations | SQLite |
| User may hand-edit | JSON/JSON5 file |
| Contains secrets | Encrypted store |
| Temporary with auto-cleanup | Media directory |
| Full-text search | SQLite FTS5 |
| Semantic/vector search | SQLite + sqlite-vec |

### How should I handle concurrency?

| Scenario | Recommendation |
|----------|----------------|
| File-based JSON store | proper-lockfile mutex |
| SQLite database | Single connection per agent |
| Read-heavy, write-rare | In-memory cache with TTL |

## Common Operations

### Create a new session

```typescript
// In src/infra/sessions-store.ts
const entry: SessionEntry = {
  sessionId: generateId(),
  updatedAt: Date.now(),
  // ... other fields
};
await updateSessionStoreEntry(sessionId, entry);
```

### Query memory

```typescript
// In src/infra/memory-index.ts
const manager = new MemoryIndexManager(agentId);

// Keyword search (FTS)
const results = manager.searchKeywords(query);

// Semantic search (vector)
const results = manager.searchSemantic(embedding, topK);
```

### Create a reminder

```typescript
// In src/infra/reminder-store.ts
const store = new ReminderStore(agentId);
const id = store.create({
  content: "Review PRs",
  triggerType: "scheduled",
  scheduledAt: Date.now() + 3600000,
  priority: "normal"
});
```

## Migrations

Gimli uses **idempotent ensure functions** instead of version tracking:

```typescript
// Creates tables/indices if they don't exist
ensureMemoryIndexSchema(db);
ensureReminderSchema(db);

// Adds columns if missing
ensureColumn(db, 'reminders', 'new_field', 'TEXT');
```

State migrations for config format changes are in `src/infra/state-migrations.ts`.

## Security Considerations

- **Directories**: Mode 0o700 (owner only)
- **Files**: Mode 0o600 (owner read/write)
- **Secrets**: AES-256-GCM, PBKDF2 600k iterations
- **Credentials**: Never in logs or error messages
- **Sessions**: Isolated per agent

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Lock timeout errors | Stale locks or high contention | Check orphaned .lock files |
| Session not persisting | Cache or write failure | Check permissions, verify write |
| Stale memory results | Files not re-indexed | Run memory reindex |
| Auth rotation failing | All profiles in cooldown | Check cooldowns, add profiles |
| SQLite BUSY errors | Concurrent access | Use file locking |

## Self-Improvement

This expertise should be kept in sync with the codebase. When making changes to:

- `src/infra/sessions-store.ts`
- `src/infra/memory-index.ts`
- `src/infra/reminder-store.ts`
- `src/infra/auth-profiles-store.ts`
- `src/infra/encrypted-store.ts`
- `src/infra/file-locking.ts`
- `src/infra/state-migrations*.ts`

Update the expertise file at `experts/database-expert.yaml` to reflect changes.

### Resync Workflow

To check if expertise is stale and needs updating:

1. Review recent commits to monitored source files
2. Compare current YAML with actual implementations
3. Update YAML sections that have drifted

## Expert Mental Model Location

Full YAML expertise: `experts/database-expert.yaml`

This file contains:
- Complete schema definitions
- All access patterns
- Performance considerations
- Full troubleshooting guide
- Self-improvement prompts
