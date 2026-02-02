# Parallelization Opportunities in Gimli

This document identifies areas in the Gimli codebase where parallel execution could improve performance. Each opportunity is categorized by impact level and includes specific file locations and implementation guidance.

## Summary

| Priority | Area | Current Pattern | Improvement | Files |
|----------|------|-----------------|-------------|-------|
| HIGH | Build Scripts | Sequential post-TSC steps | Run independent scripts in parallel | `package.json` |
| HIGH | Memory Embedding | Sequential batch processing | Parallel batches (concurrency=4) | `src/memory/manager.ts` |
| HIGH | PNG Optimization | Nested sequential loops | Promise.all for size/compression grid | `src/media/image-ops.ts` |
| MEDIUM | Workspace Bootstrap | Sequential template loads & writes | Parallel I/O operations | `src/agents/workspace.ts` |
| MEDIUM | Status Command | Sequential service checks | Parallel service probing | `src/commands/status-all.ts` |
| LOW | Channel Catalog | Sequential file loading | Parallel file reads | `src/channels/plugins/catalog.ts` |

---

## HIGH Priority

### 1. Build Scripts (package.json)

**Location:** `package.json:88`

**Current:**
```json
"build": "pnpm canvas:a2ui:bundle && tsc -p tsconfig.json && node --import tsx scripts/canvas-a2ui-copy.ts && node --import tsx scripts/copy-hook-metadata.ts && node --import tsx scripts/write-build-info.ts"
```

**Analysis:**
After TypeScript compilation completes, three independent post-build scripts run sequentially:
- `scripts/canvas-a2ui-copy.ts` - Copies A2UI assets to dist
- `scripts/copy-hook-metadata.ts` - Copies HOOK.md files to dist
- `scripts/write-build-info.ts` - Writes build-info.json

These scripts operate on independent output paths and have no data dependencies.

**Recommended Change:**
```json
"build": "pnpm canvas:a2ui:bundle && tsc -p tsconfig.json && pnpm run build:post",
"build:post": "concurrently 'node --import tsx scripts/canvas-a2ui-copy.ts' 'node --import tsx scripts/copy-hook-metadata.ts' 'node --import tsx scripts/write-build-info.ts'"
```

Or use a simple parallel runner script.

**Expected Impact:** Reduces build time by running 3 independent I/O operations concurrently.

---

### 2. Memory Embedding Batch Processing (src/memory/manager.ts)

**Location:** `src/memory/manager.ts:1637-1673`

**Current Pattern:**
```typescript
for (const batch of batches) {
  const batchEmbeddings = await this.embedBatchWithRetry(batch.map((chunk) => chunk.text));
  // Process results...
  cursor += batch.length;
}
```

**Analysis:**
The `embedChunksInBatches` method processes embedding batches sequentially, even though:
- The constant `EMBEDDING_INDEX_CONCURRENCY = 4` exists at line 99
- Each batch is independent (results are collected by index)
- The API typically supports concurrent requests

**Recommended Change:**
```typescript
// Use existing runWithConcurrency pattern from media-understanding/concurrency.ts
const batchTasks = batches.map((batch, batchIndex) => async () => {
  return this.embedBatchWithRetry(batch.map((chunk) => chunk.text));
});

const batchResults = await runWithConcurrency(batchTasks, EMBEDDING_INDEX_CONCURRENCY);
// Then merge results using cursor tracking
```

**Expected Impact:** Up to 4x faster memory indexing for large document sets.

---

### 3. PNG Optimization Grid Search (src/media/image-ops.ts)

**Location:** `src/media/image-ops.ts:394-442`

**Current Pattern:**
```typescript
const sides = [2048, 1536, 1280, 1024, 800];
const compressionLevels = [6, 7, 8, 9];

for (const side of sides) {
  for (const compressionLevel of compressionLevels) {
    const out = await resizeToPng({ buffer, maxSide: side, compressionLevel, ... });
    // Check if under size limit...
  }
}
```

**Analysis:**
The function tries 20 combinations (5 sizes × 4 compression levels) sequentially to find an image that fits under `maxBytes`. Early exit happens when a valid result is found, but all prior combinations run serially.

**Recommended Change (with early-exit optimization):**
```typescript
// Process all size/compression combinations in parallel, but allow early termination
const combinations = sides.flatMap(side =>
  compressionLevels.map(level => ({ side, level }))
);

// Use Promise.race with AbortController for early exit
const controller = new AbortController();
const results = await Promise.allSettled(
  combinations.map(async ({ side, level }) => {
    if (controller.signal.aborted) return null;
    const out = await resizeToPng({ buffer, maxSide: side, compressionLevel: level, ... });
    if (out.length <= maxBytes) {
      controller.abort(); // Signal other operations to stop
      return { buffer: out, size: out.length, resizeSide: side, compressionLevel: level };
    }
    return { buffer: out, size: out.length, resizeSide: side, compressionLevel: level };
  })
);

// Find smallest valid result
```

**Note:** Should be capped at reasonable concurrency (4-6) to avoid memory pressure.

**Expected Impact:** Significantly faster image optimization, especially when valid results are found in later iterations.

---

## MEDIUM Priority

### 4. Workspace Bootstrap File Operations (src/agents/workspace.ts)

**Location:** `src/agents/workspace.ts:145-176`

**Current Pattern:**
```typescript
// Template loads (sequential)
const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
// ... 5 more template loads

// File writes (sequential)
await writeFileIfMissing(agentsPath, agentsTemplate);
await writeFileIfMissing(soulPath, soulTemplate);
// ... 5 more writes
```

**Analysis:**
Already uses `Promise.all` for existence checks (lines 147-156), but template loading and file writing are sequential. All 7 templates are independent.

**Recommended Change:**
```typescript
// Parallel template loading
const [agentsTemplate, soulTemplate, toolsTemplate, identityTemplate, userTemplate, heartbeatTemplate, bootstrapTemplate] = await Promise.all([
  loadTemplate(DEFAULT_AGENTS_FILENAME),
  loadTemplate(DEFAULT_SOUL_FILENAME),
  loadTemplate(DEFAULT_TOOLS_FILENAME),
  loadTemplate(DEFAULT_IDENTITY_FILENAME),
  loadTemplate(DEFAULT_USER_FILENAME),
  loadTemplate(DEFAULT_HEARTBEAT_FILENAME),
  loadTemplate(DEFAULT_BOOTSTRAP_FILENAME),
]);

// Parallel file writes
await Promise.all([
  writeFileIfMissing(agentsPath, agentsTemplate),
  writeFileIfMissing(soulPath, soulTemplate),
  writeFileIfMissing(toolsPath, toolsTemplate),
  writeFileIfMissing(identityPath, identityTemplate),
  writeFileIfMissing(userPath, userTemplate),
  writeFileIfMissing(heartbeatPath, heartbeatTemplate),
  ...(isBrandNewWorkspace ? [writeFileIfMissing(bootstrapPath, bootstrapTemplate)] : []),
]);
```

**Expected Impact:** Faster workspace initialization, especially on slower filesystems.

---

### 5. Status Command Service Checks (src/commands/status-all.ts)

**Location:** `src/commands/status-all.ts:169-189`

**Current Pattern:**
```typescript
const daemon = await readServiceSummary(resolveGatewayService());
const nodeService = await readServiceSummary(resolveNodeService());
```

**Analysis:**
Service summaries are fetched sequentially, but each service check is independent. The `readServiceSummary` function already uses `Promise.all` internally (line 171-175) for its sub-operations.

**Recommended Change:**
```typescript
const [daemon, nodeService] = await Promise.all([
  readServiceSummary(resolveGatewayService()),
  readServiceSummary(resolveNodeService()),
]);
```

**Expected Impact:** Minor improvement in `gimli status --all` latency.

---

### 6. Status All Multiple Progress Stages

**Location:** `src/commands/status-all.ts:39-197`

**Analysis:**
The status command runs 11 sequential progress stages. Several stages are independent:
- Tailscale check (lines 46-81) ✓
- Update check (lines 83-122) ✓
- Gateway probe (lines 124-166) - depends on config
- Service checks (lines 168-190) ✓
- Agent status (lines 192-194) ✓
- Channel summary (lines 195-197) - depends on config

**Recommended Change:**
Group independent checks into parallel batches:
```typescript
// Batch 1: Independent network/external checks
const [tailscale, update, channelInfo] = await Promise.all([
  readTailscaleStatusJson(...),
  checkUpdateStatus(...),
  // ...
]);

// Batch 2: Local service + agent checks (can run while network checks complete)
const [daemon, nodeService, agentStatus, channels] = await Promise.all([
  readServiceSummary(resolveGatewayService()),
  readServiceSummary(resolveNodeService()),
  getAgentLocalStatuses(cfg),
  buildChannelsTable(cfg, { showSecrets: false }),
]);
```

**Expected Impact:** Faster `gimli status --all` command.

---

## LOW Priority

### 7. Channel Plugin Catalog Loading (src/channels/plugins/catalog.ts)

**Location:** `src/channels/plugins/catalog.ts:101-115`

**Current Pattern:**
```typescript
for (const rawPath of paths) {
  const resolved = resolveUserPath(rawPath);
  if (!fs.existsSync(resolved)) continue;
  const payload = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  entries.push(...parseCatalogEntries(payload));
}
```

**Analysis:**
Multiple catalog files are loaded and parsed sequentially. Uses synchronous `fs.readFileSync`.

**Recommended Change:**
```typescript
const loadTasks = paths.map(async (rawPath) => {
  const resolved = resolveUserPath(rawPath);
  try {
    const content = await fs.promises.readFile(resolved, "utf-8");
    return parseCatalogEntries(JSON.parse(content));
  } catch {
    return [];
  }
});

const results = await Promise.all(loadTasks);
return results.flat();
```

**Expected Impact:** Minor improvement; typically only 1-2 catalog files exist.

---

## Already Optimized Patterns

These areas already implement good parallelization patterns that can serve as reference:

### Test Execution (scripts/test-parallel.mjs)
- Runs unit, extensions, and gateway tests in parallel (lines 88)
- Dynamic worker allocation based on CPU cores (lines 33-39)
- Serial fallback for Windows CI stability

### Media Understanding (src/media-understanding/concurrency.ts)
- Worker pool pattern with configurable concurrency limit
- Clean `runWithConcurrency<T>()` utility function
- Error handling that continues processing other tasks

### Agent Status Gathering (src/commands/status-all/agents.ts)
- Uses `Promise.all()` to check all agent statuses concurrently (lines 21-62)

### Model Scanning (src/agents/model-scan.ts)
- Custom `mapWithConcurrency()` helper (lines 321-350)
- Progress callbacks for UI updates
- Configurable concurrency with `DEFAULT_CONCURRENCY = 3`

---

## Implementation Notes

### Concurrency Utilities

The codebase has two concurrency patterns that could be unified:

1. **`runWithConcurrency`** in `src/media-understanding/concurrency.ts` - swallows errors silently
2. **`mapWithConcurrency`** in `src/agents/model-scan.ts` - propagates errors, has progress callback

Consider creating a shared utility in `src/infra/` or `src/utils/` that combines the best of both:
```typescript
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  options: {
    limit: number;
    onProgress?: (completed: number, total: number) => void;
    onError?: (error: Error, index: number) => void;
  }
): Promise<T[]>;
```

### Memory Considerations

When parallelizing image operations, be mindful of memory pressure. Each PNG buffer can be several MB. Use a reasonable concurrency limit (4-6) rather than unbounded `Promise.all()`.

### Error Handling

Parallel operations should use `Promise.allSettled()` when partial success is acceptable, or wrap with proper error aggregation when all-or-nothing semantics are needed.

---

## Metrics to Track

After implementing parallelization:
1. Build time (`pnpm build`)
2. Memory indexing time for large document sets
3. Image optimization latency
4. `gimli status --all` command latency
5. Workspace bootstrap time
