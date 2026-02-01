# Learning System Tracking Catalog

This document catalogs all metrics and data points tracked by Gimli's learning system, including how each is used for continuous improvement.

## Overview

The learning system tracks data across four main subsystems:
1. **User Interaction Learning** - Captures corrections, preferences, and patterns from conversations
2. **Reminder Effectiveness Tracking** - Measures how well reminders serve users
3. **Activity Pattern Detection** - Observes behavioral patterns for anticipation
4. **Memory System Indexing** - Tracks content for semantic retrieval

---

## 1. User Interaction Learning

**Source**: `src/learning/extract-learnings.ts`, `src/learning/learnings-store.ts`

### Tracked Data Points

| Metric | Type | Storage | Description |
|--------|------|---------|-------------|
| Learning Category | enum | LEARNINGS.md | One of: `preference`, `correction`, `pattern`, `tool-usage` |
| Learning Content | string | LEARNINGS.md | Extracted insight (max 150 chars) |
| Confidence Level | enum | LEARNINGS.md | `high`, `medium`, or `low` based on message explicitness |
| Source | string | LEARNINGS.md | `user_message`, `success_pattern`, or `file` |
| Timestamp | ISO date | LEARNINGS.md | When the learning was captured |
| Learning ID | string | LEARNINGS.md | Unique identifier (e.g., `l_<timestamp36>_<random>`) |

### How Each Is Used for Improvement

| Metric | Improvement Mechanism |
|--------|----------------------|
| **Category** | Routes learnings to appropriate LEARNINGS.md sections; enables filtering |
| **Content** | Loaded into agent context via bootstrap files to influence behavior |
| **Confidence** | High-confidence learnings prioritized; affects pattern weight |
| **Source** | Distinguishes auto-extracted vs. file-loaded learnings for debugging |
| **Timestamp** | Enables recency-based relevance; updates on duplicate detection |

### Detection Patterns

**Corrections** (high confidence):
- "Actually I meant...", "No, I want...", "Please don't..."
- "That's not what I asked", "Wrong, it should be..."

**Preferences** (medium/high confidence):
- "I prefer...", "Always use...", "Never..."
- "Keep it...", "My style is..."

**Tool Usage** (medium confidence):
- "Use the X tool...", "Don't run X..."
- "Instead of X...", "Prefer X command..."

**Success Patterns** (medium confidence):
- Triggered by: "Perfect!", "Exactly!", "Great job!", "That's right!"
- Extracts: tool usage and file operations from preceding agent reply

---

## 2. Reminder Effectiveness Tracking

**Source**: `src/reminders/learning-integration.ts`, `src/reminders/feedback-types.ts`

### Per-Reminder Metrics

| Metric | Type | Storage | Description |
|--------|------|---------|-------------|
| Total Showings | int | SQLite | Number of times reminder was displayed |
| Reaction Counts | object | SQLite | Breakdown by reaction type |
| Completion Rate | float | SQLite | `completed / totalShowings` |
| Dismissal Rate | float | SQLite | `dismissed / totalShowings` |
| Avg Reaction Time | ms | SQLite | Time from display to user action |
| Avg Context Relevance | float | SQLite | Semantic relevance score for context triggers |
| Effectiveness Score | float | SQLite | Weighted composite (0-1) |
| Trend | enum | SQLite | `improving`, `declining`, `stable` |
| Recent Scores | array | SQLite | Last 10 effectiveness scores |

### Reaction Types and Weights

| Reaction | Weight | Description |
|----------|--------|-------------|
| `completed` | 1.0 | User completed the reminder task |
| `acted` | 0.8 | User took related action (inferred) |
| `snoozed` | 0.3 | User postponed the reminder |
| `dismissed` | 0.1 | User explicitly dismissed without action |
| `ignored` | 0.0 | No engagement within observation window |

### Effectiveness Score Algorithm

```
score = (completionRate * 0.6) + ((1 - dismissalRate) * 0.25) + (reactionTimeScore * 0.15)
```

Where `reactionTimeScore = max(0, 1 - log10(reactionMinutes + 1) / 1.2)`

### Aggregated Pattern Statistics

| Metric | Granularity | Description |
|--------|-------------|-------------|
| By Priority | urgent/normal/low | Effectiveness per priority level |
| By Trigger Type | scheduled/recurring/context | Effectiveness per trigger type |
| By Time of Day | morning/afternoon/evening/night | Effectiveness per time window |
| Overall Stats | agent-level | Total reminders, showings, avg rates |

### How Each Is Used for Improvement

| Metric | Improvement Mechanism |
|--------|----------------------|
| **Effectiveness Score** | Triggers learning generation when crossing thresholds (>0.7 positive, <0.2 negative) |
| **Trend** | Declining trend + low score suggests priority reduction |
| **Completion Rate** | High rate (>80%) can trigger "increase frequency" suggestion |
| **Dismissal Rate** | High rate (>60%) triggers "reduce frequency" or "archive" suggestion |
| **Context Relevance** | Low score (<0.3) triggers "refine context" suggestion |
| **Time-of-Day Stats** | Generates system learnings about optimal reminder timing |

### Generated Learnings from Reminders

- **Positive**: `Reminder "X" is effective (context: Y) with Z% completion rate`
- **Negative**: `Reminder "X" is not working well - dismissed Y% of the time`
- **System**: `Reminders are most effective in the morning`
- **System**: `Avoid sending reminders in the evening - low engagement`

---

## 3. Activity Pattern Detection

**Source**: `src/patterns/tracker.ts`, `src/patterns/detector.ts`, `src/patterns/types.ts`

### Pattern Observation Data

#### Time-Based Observations

| Field | Type | Description |
|-------|------|-------------|
| hour | int (0-23) | Hour of day when action occurred |
| minute | int (0-59) | Minute when action occurred |
| dayOfWeek | int (1-7) | Day of week (Monday=1) |
| action | string | What the user did |

#### Event-Based Observations

| Field | Type | Description |
|-------|------|-------------|
| event | string | Triggering event (e.g., `tool-call:git_commit`) |
| followUp | string | What user did after the event |
| delaySeconds | int | Time between event and follow-up |

#### Context-Based Observations

| Field | Type | Description |
|-------|------|-------------|
| keywords | string[] | Keywords present in conversation context |
| need | string | What the user needed in this context |
| similarityScore | float | Semantic similarity score (optional) |

### Recognized Pattern Metrics

| Metric | Type | Description |
|--------|------|-------------|
| ID | string | Unique pattern identifier |
| Type | enum | `time-based`, `event-based`, `context-based` |
| Description | string | Human-readable pattern description |
| Confidence | float | Score (0-1) based on frequency and recency |
| Observation Count | int | Number of times pattern observed |
| First/Last Observed | Date | Temporal bounds of pattern |
| Active | boolean | Whether pattern can trigger reminders |
| Linked Reminder ID | string | Optional associated reminder |

### Confidence Calculation

```
countFactor = 1 - exp(-observationCount / 5)
recencyFactor = exp(-daysSinceLastObserved / 14)
confidence = (countFactor * 0.5) + (consistencyScore * 0.3) + (recencyFactor * 0.2)
```

### Pattern Detection Thresholds

| Parameter | Default | Description |
|-----------|---------|-------------|
| Activation Threshold | 0.4 | Minimum confidence to activate |
| Min Observations | 3 | Minimum observations before activation |
| Archive After Days | 90 | Days inactive before archival |
| Max Patterns Per Agent | 100 | Cap on stored patterns |
| Time Cluster Tolerance | 30 min | Window for grouping time observations |
| Time Consistency Threshold | 0.6 | Minimum consistency to form time pattern |
| Min Event Sequence Observations | 3 | Minimum for event pattern |
| Max Event Delay Variation | 0.5 | CV threshold for event timing |
| Min Keyword Overlap Ratio | 0.3 | For context pattern clustering |

### How Each Is Used for Improvement

| Metric | Improvement Mechanism |
|--------|----------------------|
| **Observation Count** | More observations increase confidence |
| **Recency** | Recent observations prevent confidence decay |
| **Consistency Score** | Consistent timing/behavior strengthens patterns |
| **Active Flag** | Only active patterns can trigger proactive reminders |
| **Linked Reminder** | Connects patterns to actionable reminders |
| **Confidence** | High confidence (>0.6) can auto-suggest reminders |

### Pattern Statistics

| Stat | Description |
|------|-------------|
| Total Observations | Count of all recorded observations |
| Total Patterns | Count of recognized patterns |
| Active Patterns | Patterns meeting activation criteria |
| By Type | Breakdown by time/event/context |

---

## 4. Memory System Tracking

**Source**: `src/memory/manager.ts`, `src/memory/memory-schema.ts`

### Indexed Content Metadata

| Metric | Type | Storage | Description |
|--------|------|---------|-------------|
| File Path | string | SQLite | Relative path to indexed file |
| Source | enum | SQLite | `memory` or `sessions` |
| Content Hash | string | SQLite | For change detection |
| Modification Time | int | SQLite | Unix timestamp |
| File Size | int | SQLite | Bytes |

### Chunk-Level Data

| Metric | Type | Storage | Description |
|--------|------|---------|-------------|
| Chunk ID | string | SQLite | Unique identifier |
| Start/End Line | int | SQLite | Source file location |
| Text | string | SQLite | Chunk content |
| Embedding | vector | SQLite (vec0) | Dense vector representation |
| Embedding Model | string | SQLite | Model used for embedding |

### Embedding Cache

| Field | Type | Description |
|-------|------|-------------|
| Provider | string | openai, gemini, local |
| Model | string | Model identifier |
| Provider Key | string | API key fingerprint |
| Hash | string | Content hash |
| Embedding | vector | Cached embedding |
| Dimensions | int | Vector dimensionality |

### Search Metrics

| Metric | Used For |
|--------|----------|
| Vector Score | Semantic similarity ranking |
| BM25 Score | Keyword relevance ranking |
| Combined Score | Hybrid search result ordering |
| Min Score Threshold | Filtering low-relevance results |

### How Each Is Used for Improvement

| Metric | Improvement Mechanism |
|--------|----------------------|
| **Content Hash** | Enables incremental sync (only re-index changed files) |
| **Embedding Cache** | Avoids redundant API calls; speeds up indexing |
| **Source Tracking** | Distinguishes memory files vs. session transcripts |
| **Search Scores** | Ranks results by relevance for context injection |
| **Chunk Boundaries** | Preserves semantic coherence in search results |

---

## 5. Deduplication Mechanisms

### Learning Deduplication

| Method | Parameter | Description |
|--------|-----------|-------------|
| Jaccard Similarity | 0.8 threshold | Word token overlap within same category |
| Timestamp Update | on duplicate | Refreshes timestamp instead of adding new entry |

### Pattern Deduplication

| Method | Description |
|--------|-------------|
| Action Similarity | Substring match or 50%+ word overlap |
| Time Clustering | Group observations within 30-minute windows |
| Event Sequence | Group by exact event + similar follow-up |
| Context Clustering | Keyword overlap ratio >= 30% |

### Embedding Deduplication

| Method | Description |
|--------|-------------|
| Content Hash | Same text gets same embedding from cache |
| Provider+Model Key | Separate cache per embedding configuration |

---

## 6. Configuration and Tunables

### Learning Capture Config

```typescript
interface LearningCaptureConfig {
  enabled: boolean;           // Default: true
  minMessageLength: number;   // Default: 10
  maxLearningsPerTurn: number; // Default: 3
}
```

### Reminder Feedback Config

```typescript
interface FeedbackSystemConfig {
  enabled: boolean;              // Default: true
  reactionWindowMs: number;      // Default: 300000 (5 min)
  minShowingsForMetrics: number; // Default: 3
  metricsWindowDays: number;     // Default: 14
  ineffectiveThreshold: number;  // Default: 0.2
  effectiveThreshold: number;    // Default: 0.7
  autoApplyAdjustments: boolean; // Default: false
  autoApplyMinConfidence: number; // Default: 0.8
}
```

### Pattern System Config

```typescript
interface PatternConfig {
  activationThreshold: number;       // Default: 0.4
  minObservations: number;           // Default: 3
  archiveAfterDays: number;          // Default: 90
  maxPatternsPerAgent: number;       // Default: 100
  autoSuggestReminders: boolean;     // Default: true
  reminderSuggestionThreshold: number; // Default: 0.6
}
```

### Memory Injection Config

```typescript
interface MemoryInjectionConfig {
  enabled: boolean;      // Default: true
  maxMemories: number;   // Default: 5
  maxTokens: number;     // Default: 500
  minScore: number;      // Default: 0.3
}
```

---

## 7. Storage Locations

| Data | Location | Format |
|------|----------|--------|
| User Learnings | `~/.gimli/agents/<agentId>/agent/LEARNINGS.md` | Markdown |
| Reminder Feedback | Agent SQLite database | SQLite tables |
| Pattern Observations | Agent SQLite database | SQLite tables |
| Patterns | Agent SQLite database | SQLite tables |
| Memory Index | `~/.gimli/state/memory/<agentId>.sqlite` | SQLite + vec0 |
| Embedding Cache | Memory SQLite database | SQLite table |

---

## 8. Data Flow Summary

```
User Interaction
     |
     v
+------------------+     +------------------+     +------------------+
| Learning Capture |---->| Learnings Store  |---->| LEARNINGS.md     |
| (extract + hook) |     | (dedupe + save)  |     | (per agent)      |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
+------------------+     +------------------+     +------------------+
| Reminder Shown   |---->| Feedback Track   |---->| SQLite Metrics   |
| (user reacts)    |     | (scores + trend) |     | (effectiveness)  |
+------------------+     +------------------+     +------------------+
                                |
                                v
+------------------+     +------------------+     +------------------+
| Pattern Detect   |---->| Pattern Track    |---->| SQLite Patterns  |
| (observation)    |     | (confidence)     |     | (active/archive) |
+------------------+     +------------------+     +------------------+
                                                          |
                                                          v
+------------------+     +------------------+     +------------------+
| Bootstrap Load   |<----| Memory Inject    |<----| Proactive Query  |
| (context fill)   |     | (turn start)     |     | (semantic search)|
+------------------+     +------------------+     +------------------+
```

---

## Related Documentation

- [Learning System Architecture](/architecture/learning-system)
- [Memory System Architecture](/architecture/memory-system)
- [Self-Improving Agent (User Guide)](/concepts/learnings)
- [Memory System (User Guide)](/concepts/memory)
- [Hooks System](/hooks)
