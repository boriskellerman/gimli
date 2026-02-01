# Memory Retrieval Relevance Evaluation

This document evaluates the relevance of Gimli's memory retrieval system, analyzing how well it surfaces the right context for agent queries.

## Executive Summary

Gimli's memory system uses a **hybrid search approach** combining:
- **Vector similarity search** (semantic understanding via embeddings)
- **Full-text search** (BM25 keyword matching)

With default weights of **70% vector + 30% text**, the system prioritizes semantic relevance while maintaining keyword precision. This evaluation identifies strengths, limitations, and improvement opportunities.

## Current Retrieval Algorithm Analysis

### Hybrid Search Flow

```
Query -> [Embed Query] -> [Vector Search (sqlite-vec)]  --> \
                       -> [Keyword Search (FTS5 BM25)] --> Merge -> Score -> Filter -> Results
```

### Scoring Formula

The final score for each result is computed as:

```
score = (vectorWeight * vectorScore) + (textWeight * textScore)
```

Where:
- `vectorScore` = 1 - cosine_distance (range: 0-1, higher is better)
- `textScore` = 1 / (1 + bm25_rank) (normalized, range: 0-1)
- Default `vectorWeight` = 0.7
- Default `textWeight` = 0.3

### Key Configuration Defaults

| Parameter | Default | Purpose |
|-----------|---------|---------|
| `maxResults` | 6 | Maximum results returned |
| `minScore` | 0.35 | Minimum combined score threshold |
| `vectorWeight` | 0.7 | Weight for semantic similarity |
| `textWeight` | 0.3 | Weight for keyword matching |
| `candidateMultiplier` | 4x | Fetch 4x candidates before merge |
| `chunkTokens` | 400 | Tokens per chunk (~1600 chars) |
| `chunkOverlap` | 80 | Overlap between chunks (~320 chars) |

## Strengths of Current Implementation

### 1. Semantic Understanding via Embeddings

**What it does well:**
- Understands synonyms and related concepts
- Matches queries to content with different wording
- Captures topic-level relevance

**Example:**
```
Query: "database configuration"
Matches: "Setting up PostgreSQL connection parameters" (no exact keywords)
```

### 2. Keyword Precision via BM25

**What it does well:**
- Exact term matching for technical terms
- Catches specific function/class names
- Handles acronyms and proper nouns

**Example:**
```
Query: "PostgreSQL"
Matches exactly on "PostgreSQL" mentions even if semantically different context
```

### 3. Hybrid Merging Strategy

**What it does well:**
- Results appearing in both searches get boosted
- Reduces false positives from either method alone
- Candidate multiplier (4x) provides recall buffer

### 4. Source Filtering

**What it does well:**
- Can filter by source type (memory files vs sessions)
- Maintains separation between workspace knowledge and conversation history

### 5. Chunk Overlap

**What it does well:**
- 80-token overlap prevents context loss at chunk boundaries
- Ensures continuous passages aren't artificially split

## Identified Limitations

### 1. No Recency Bias

**Issue:** All memories are weighted equally regardless of age.

**Impact:**
- Outdated information may surface over recent, more relevant updates
- No decay function for stale content

**Example scenario:**
```
Memory from 6 months ago: "Database server is at 192.168.1.10"
Memory from yesterday: "Migrated database to new server at 10.0.0.50"
Query: "What's the database server address?"
Result: May return outdated address
```

**Recommendation:** Add optional temporal weighting:
```
adjusted_score = base_score * recency_factor
recency_factor = max(0.5, 1 - (days_old / decay_period))
```

### 2. No Query Expansion

**Issue:** Single-point query embedding limits recall.

**Impact:**
- Misses relevant content with different terminology
- No handling of abbreviations or alternate phrasings

**Example scenario:**
```
Query: "DB connection"
Memory: "PostgreSQL database link configuration"
Issue: "DB" abbreviation may not match well semantically
```

**Recommendation:** Consider query expansion techniques:
- Hypothetical document generation (HyDE)
- Multi-query retrieval
- Synonym injection

### 3. No Negative Filtering

**Issue:** No way to exclude irrelevant but similar content.

**Impact:**
- Similar but outdated versions of content surface together
- Cannot filter out deprecated information

### 4. Fixed Chunk Boundaries

**Issue:** Chunk boundaries are based on token counts, not semantic units.

**Impact:**
- Important context may be split across chunks
- Headers separated from their content

**Recommendation:** Consider semantic chunking:
- Split on markdown headers
- Keep code blocks together
- Respect paragraph boundaries

### 5. Single Embedding Model

**Issue:** One embedding model for all content types.

**Impact:**
- Technical content and conversational content embedded the same way
- No domain adaptation

### 6. No Relevance Feedback Loop

**Issue:** System doesn't learn from user behavior.

**Impact:**
- Cannot adapt to user preferences
- Repeated poor results aren't corrected

## Test Scenarios for Retrieval Relevance

### Scenario 1: Exact Match Queries

**Test:** Query contains exact text from memory.

```
Memory: "API key should be stored in GIMLI_API_KEY environment variable"
Query: "Where is the API key stored?"
Expected: High score (>0.8), exact match
```

**Metrics to verify:**
- [ ] Result appears in top 3
- [ ] Score > 0.8
- [ ] Correct snippet returned

### Scenario 2: Semantic Equivalence

**Test:** Query uses different words with same meaning.

```
Memory: "The authentication token expires after 24 hours"
Query: "How long until the login credential becomes invalid?"
Expected: High score (>0.6), semantic match
```

**Metrics to verify:**
- [ ] Result appears in top 5
- [ ] Score > 0.6
- [ ] Vector score contributes majority

### Scenario 3: Technical Term Precision

**Test:** Query contains specific technical terms.

```
Memory: "Configure PostgreSQL with SSL_MODE=verify-full"
Query: "PostgreSQL SSL_MODE setting"
Expected: High score from BM25, exact term match
```

**Metrics to verify:**
- [ ] Result appears in top 3
- [ ] Text score > 0.5
- [ ] Exact terms highlighted

### Scenario 4: Cross-Chunk Context

**Test:** Relevant information spans multiple chunks.

```
Memory (chunk 1): "## Database Configuration"
Memory (chunk 2): "Set host=localhost, port=5432"
Query: "Database configuration host and port"
Expected: Both chunks returned, related context visible
```

**Metrics to verify:**
- [ ] Related chunks both appear
- [ ] Scores within 0.2 of each other
- [ ] Path indicates same file

### Scenario 5: Temporal Disambiguation

**Test:** Multiple versions of same information exist.

```
Memory (2024-01): "Server is at 192.168.1.10"
Memory (2024-06): "Migrated server to 10.0.0.50"
Query: "What's the current server address?"
Expected: Most recent information ranks higher
```

**Current behavior:** Both may rank equally
**Desired behavior:** Recent information prioritized

### Scenario 6: Session vs Memory Source

**Test:** Information exists in both sources.

```
Memory file: "Project uses TypeScript with strict mode"
Session transcript: "User mentioned they like TypeScript"
Query: "TypeScript configuration"
Expected: Memory file ranks higher (authoritative source)
```

**Metrics to verify:**
- [ ] Memory source result appears first
- [ ] Source filtering works correctly

### Scenario 7: Low Relevance Filtering

**Test:** Query has minimal overlap with stored content.

```
Memory: "API documentation for user authentication"
Query: "Recipe for chocolate cake"
Expected: No results (below minScore threshold)
```

**Metrics to verify:**
- [ ] Results array is empty
- [ ] minScore (0.35) correctly filters

### Scenario 8: Multi-Concept Queries

**Test:** Query contains multiple distinct concepts.

```
Memory 1: "Database uses PostgreSQL 15"
Memory 2: "Cache layer uses Redis"
Query: "What database and cache technologies are we using?"
Expected: Both memories returned
```

**Metrics to verify:**
- [ ] Both relevant memories appear
- [ ] Neither dominates unfairly

## Improvement Opportunities

### High Priority

1. **Temporal Weighting**
   - Add optional recency decay
   - Configuration: `query.temporal.decayDays: 180`
   - Impact: Better for frequently updated content

2. **Semantic Chunking**
   - Respect markdown structure
   - Keep code blocks intact
   - Impact: Better context preservation

3. **Score Calibration**
   - Benchmark against labeled test set
   - Tune vectorWeight/textWeight per use case
   - Impact: More predictable relevance

### Medium Priority

4. **Query Classification**
   - Detect query type (factual, conceptual, procedural)
   - Adjust weights based on query type
   - Impact: Better handling of diverse queries

5. **Source Priority**
   - Allow configurable source weighting
   - Memory files > session transcripts by default
   - Impact: Authoritative sources prioritized

6. **Reranking Layer**
   - Optional cross-encoder reranking
   - More expensive but more accurate
   - Impact: Higher precision for top results

### Lower Priority

7. **Negative Examples**
   - Allow marking content as deprecated
   - Exclude from results
   - Impact: Cleaner result set

8. **Feedback Integration**
   - Track which results users engage with
   - Boost frequently-accessed content
   - Impact: Personalized relevance

## Evaluation Metrics

To systematically evaluate retrieval quality, measure:

### Precision@K
```
Precision@K = (relevant results in top K) / K
```
Target: Precision@5 > 0.8

### Recall@K
```
Recall@K = (relevant results in top K) / (total relevant in corpus)
```
Target: Recall@10 > 0.9

### Mean Reciprocal Rank (MRR)
```
MRR = average(1 / rank_of_first_relevant_result)
```
Target: MRR > 0.7

### Normalized Discounted Cumulative Gain (nDCG)
```
nDCG = DCG / ideal_DCG
```
Target: nDCG@10 > 0.8

## Recommendations Summary

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| High | Temporal weighting | Medium | High |
| High | Semantic chunking | Medium | Medium |
| High | Score calibration benchmark | Low | High |
| Medium | Query classification | High | Medium |
| Medium | Source priority config | Low | Medium |
| Medium | Reranking layer | High | High |
| Low | Negative examples | Medium | Low |
| Low | Feedback integration | High | Medium |

## Conclusion

Gimli's hybrid retrieval system provides a solid foundation with:
- Good balance of semantic and keyword search
- Configurable weights and thresholds
- Efficient caching and incremental sync

Key areas for improvement:
1. **Temporal awareness** - Recency should influence relevance
2. **Smarter chunking** - Preserve semantic units
3. **Benchmark suite** - Systematic quality measurement

The 70/30 vector/text default weighting is reasonable for general use, but specific applications may benefit from tuning based on content characteristics and query patterns.
