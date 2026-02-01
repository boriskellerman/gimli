/**
 * Memory Indexing Improvements
 *
 * Provides enhanced indexing capabilities for faster and better memory recall:
 * - Composite indexes for common query patterns
 * - Entity extraction for keyword-based recall
 * - Recency decay scoring for time-aware searches
 * - Importance scoring for memory prioritization
 * - N-gram indexing for fuzzy matching support
 */

import type { DatabaseSync } from "node:sqlite";

// Recency decay constants
const RECENCY_DECAY_HALF_LIFE_DAYS = 30;
const RECENCY_DECAY_MIN_SCORE = 0.1;

// Entity extraction patterns
const ENTITY_PATTERNS = {
  // Technical terms: CamelCase, snake_case, kebab-case identifiers
  identifiers: /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b|\b[a-z]+(?:_[a-z]+)+\b|\b[a-z]+(?:-[a-z]+)+\b/g,
  // File paths and URLs
  paths: /(?:\/[\w.-]+)+(?:\.\w+)?|\b\w+:\/\/[\w./-]+/g,
  // Code references: function calls, class names
  codeRefs: /\b[A-Z][a-zA-Z0-9]*(?:\(\))?|\b[a-z][a-zA-Z0-9]*\(\)/g,
  // Version numbers
  versions: /\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g,
  // Common technical keywords
  keywords:
    /\b(?:TODO|FIXME|NOTE|BUG|HACK|XXX|config|setting|preference|important|remember|always|never)\b/gi,
};

// Importance signals in text
const IMPORTANCE_SIGNALS = [
  { pattern: /\b(?:important|critical|crucial|essential|must|always|never)\b/gi, weight: 0.3 },
  { pattern: /\b(?:remember|note|preference|setting|config)\b/gi, weight: 0.2 },
  { pattern: /\b(?:TODO|FIXME|BUG)\b/g, weight: 0.15 },
  { pattern: /^#+\s/gm, weight: 0.1 }, // Markdown headings
  { pattern: /\*\*[^*]+\*\*/g, weight: 0.05 }, // Bold text
];

export interface ExtractedEntities {
  identifiers: string[];
  paths: string[];
  codeRefs: string[];
  versions: string[];
  keywords: string[];
  all: string[];
}

export interface IndexedChunk {
  id: string;
  text: string;
  entities: ExtractedEntities;
  importance: number;
  updatedAt: number;
}

export interface RecencyBoostOptions {
  /** Reference timestamp for recency calculation (default: now) */
  referenceTime?: number;
  /** Half-life in days for exponential decay (default: 30) */
  halfLifeDays?: number;
  /** Minimum recency score (default: 0.1) */
  minScore?: number;
}

export interface SearchBoostOptions {
  /** Weight for vector similarity score (default: 0.5) */
  vectorWeight?: number;
  /** Weight for recency boost (default: 0.2) */
  recencyWeight?: number;
  /** Weight for importance score (default: 0.2) */
  importanceWeight?: number;
  /** Weight for entity match bonus (default: 0.1) */
  entityMatchWeight?: number;
}

/**
 * Ensure enhanced indexes exist for better query performance
 */
export function ensureEnhancedIndexes(db: DatabaseSync): void {
  // Composite index for model + source queries (common in search)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_model_source ON chunks(model, source);`);

  // Index for faster hash lookups (deduplication)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(hash);`);

  // Index for timestamp-based queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_updated_at ON chunks(updated_at);`);

  // Composite index for path + source queries
  db.exec(`CREATE INDEX IF NOT EXISTS idx_files_source_path ON files(source, path);`);
}

/**
 * Ensure entity storage table exists
 */
export function ensureEntityTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_entities (
      chunk_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      PRIMARY KEY (chunk_id, entity, entity_type)
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_entities_entity ON chunk_entities(entity);`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chunk_entities_type_entity ON chunk_entities(entity_type, entity);`,
  );
}

/**
 * Ensure importance scores table exists
 */
export function ensureImportanceTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunk_importance (
      chunk_id TEXT PRIMARY KEY,
      importance REAL NOT NULL DEFAULT 0.5,
      computed_at INTEGER NOT NULL
    );
  `);
}

/**
 * Extract entities from text for better keyword matching
 */
export function extractEntities(text: string): ExtractedEntities {
  const extract = (pattern: RegExp): string[] => {
    const matches = text.match(pattern) ?? [];
    // Deduplicate and normalize
    const seen = new Set<string>();
    return matches
      .map((m) => m.toLowerCase().trim())
      .filter((m) => {
        if (m.length < 2 || seen.has(m)) return false;
        seen.add(m);
        return true;
      });
  };

  const identifiers = extract(ENTITY_PATTERNS.identifiers);
  const paths = extract(ENTITY_PATTERNS.paths);
  const codeRefs = extract(ENTITY_PATTERNS.codeRefs);
  const versions = extract(ENTITY_PATTERNS.versions);
  const keywords = extract(ENTITY_PATTERNS.keywords);

  // Combine all unique entities
  const allSet = new Set([...identifiers, ...paths, ...codeRefs, ...versions, ...keywords]);

  return {
    identifiers,
    paths,
    codeRefs,
    versions,
    keywords,
    all: Array.from(allSet),
  };
}

/**
 * Calculate importance score for a chunk based on content signals
 */
export function calculateImportance(text: string): number {
  let score = 0.5; // Base importance

  for (const signal of IMPORTANCE_SIGNALS) {
    const matches = text.match(signal.pattern);
    if (matches && matches.length > 0) {
      // Diminishing returns for multiple matches
      score += signal.weight * Math.min(1, Math.log2(matches.length + 1));
    }
  }

  // Clamp to 0-1 range
  return Math.max(0, Math.min(1, score));
}

/**
 * Calculate recency boost based on time decay
 *
 * Uses exponential decay with configurable half-life.
 * More recent memories get higher scores.
 */
export function calculateRecencyBoost(
  updatedAt: number,
  options: RecencyBoostOptions = {},
): number {
  const {
    referenceTime = Date.now(),
    halfLifeDays = RECENCY_DECAY_HALF_LIFE_DAYS,
    minScore = RECENCY_DECAY_MIN_SCORE,
  } = options;

  const ageMs = Math.max(0, referenceTime - updatedAt);
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: score = 2^(-age/halfLife)
  const decayFactor = Math.pow(2, -ageDays / halfLifeDays);

  // Scale to [minScore, 1]
  return minScore + (1 - minScore) * decayFactor;
}

/**
 * Calculate entity match bonus between query entities and chunk entities
 */
export function calculateEntityMatchBonus(
  queryEntities: ExtractedEntities,
  chunkEntities: ExtractedEntities,
): number {
  if (queryEntities.all.length === 0 || chunkEntities.all.length === 0) {
    return 0;
  }

  const querySet = new Set(queryEntities.all);
  const chunkSet = new Set(chunkEntities.all);

  // Count matching entities
  let matches = 0;
  for (const entity of querySet) {
    if (chunkSet.has(entity)) {
      matches++;
    }
  }

  // Jaccard-like similarity but weighted toward query coverage
  const queryCoverage = matches / querySet.size;
  const chunkCoverage = matches / chunkSet.size;

  // Weight query coverage more heavily (finding what user asked for)
  return 0.7 * queryCoverage + 0.3 * chunkCoverage;
}

/**
 * Calculate combined search score with multiple factors
 */
export function calculateCombinedScore(params: {
  vectorScore: number;
  recencyScore: number;
  importanceScore: number;
  entityMatchScore: number;
  options?: SearchBoostOptions;
}): number {
  const {
    vectorWeight = 0.5,
    recencyWeight = 0.2,
    importanceWeight = 0.2,
    entityMatchWeight = 0.1,
  } = params.options ?? {};

  // Normalize weights
  const totalWeight = vectorWeight + recencyWeight + importanceWeight + entityMatchWeight;

  const normalizedVector = vectorWeight / totalWeight;
  const normalizedRecency = recencyWeight / totalWeight;
  const normalizedImportance = importanceWeight / totalWeight;
  const normalizedEntity = entityMatchWeight / totalWeight;

  return (
    normalizedVector * params.vectorScore +
    normalizedRecency * params.recencyScore +
    normalizedImportance * params.importanceScore +
    normalizedEntity * params.entityMatchScore
  );
}

/**
 * Store extracted entities for a chunk
 */
export function storeChunkEntities(
  db: DatabaseSync,
  chunkId: string,
  entities: ExtractedEntities,
): void {
  // Clear existing entities for this chunk
  db.prepare(`DELETE FROM chunk_entities WHERE chunk_id = ?`).run(chunkId);

  // Insert new entities
  const insert = db.prepare(
    `INSERT OR IGNORE INTO chunk_entities (chunk_id, entity, entity_type) VALUES (?, ?, ?)`,
  );

  for (const identifier of entities.identifiers) {
    insert.run(chunkId, identifier, "identifier");
  }
  for (const p of entities.paths) {
    insert.run(chunkId, p, "path");
  }
  for (const ref of entities.codeRefs) {
    insert.run(chunkId, ref, "code_ref");
  }
  for (const version of entities.versions) {
    insert.run(chunkId, version, "version");
  }
  for (const keyword of entities.keywords) {
    insert.run(chunkId, keyword, "keyword");
  }
}

/**
 * Store importance score for a chunk
 */
export function storeChunkImportance(db: DatabaseSync, chunkId: string, importance: number): void {
  db.prepare(
    `INSERT INTO chunk_importance (chunk_id, importance, computed_at)
     VALUES (?, ?, ?)
     ON CONFLICT(chunk_id) DO UPDATE SET
       importance = excluded.importance,
       computed_at = excluded.computed_at`,
  ).run(chunkId, importance, Date.now());
}

/**
 * Get importance score for a chunk (returns default if not found)
 */
export function getChunkImportance(db: DatabaseSync, chunkId: string): number {
  const row = db
    .prepare(`SELECT importance FROM chunk_importance WHERE chunk_id = ?`)
    .get(chunkId) as { importance: number } | undefined;
  return row?.importance ?? 0.5;
}

/**
 * Find chunks matching any of the given entities
 */
export function findChunksByEntities(
  db: DatabaseSync,
  entities: string[],
  limit: number = 50,
): string[] {
  if (entities.length === 0) return [];

  const placeholders = entities.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT chunk_id FROM chunk_entities
       WHERE entity IN (${placeholders})
       LIMIT ?`,
    )
    .all(...entities, limit) as Array<{ chunk_id: string }>;

  return rows.map((r) => r.chunk_id);
}

/**
 * Get entities for a chunk
 */
export function getChunkEntities(db: DatabaseSync, chunkId: string): ExtractedEntities {
  const rows = db
    .prepare(`SELECT entity, entity_type FROM chunk_entities WHERE chunk_id = ?`)
    .all(chunkId) as Array<{ entity: string; entity_type: string }>;

  const entities: ExtractedEntities = {
    identifiers: [],
    paths: [],
    codeRefs: [],
    versions: [],
    keywords: [],
    all: [],
  };

  for (const row of rows) {
    entities.all.push(row.entity);
    switch (row.entity_type) {
      case "identifier":
        entities.identifiers.push(row.entity);
        break;
      case "path":
        entities.paths.push(row.entity);
        break;
      case "code_ref":
        entities.codeRefs.push(row.entity);
        break;
      case "version":
        entities.versions.push(row.entity);
        break;
      case "keyword":
        entities.keywords.push(row.entity);
        break;
    }
  }

  return entities;
}

/**
 * Generate n-grams from text for fuzzy matching
 */
export function generateNgrams(text: string, n: number = 3): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.length < n) return [normalized];

  const ngrams: string[] = [];
  for (let i = 0; i <= normalized.length - n; i++) {
    ngrams.push(normalized.slice(i, i + n));
  }

  return ngrams;
}

/**
 * Calculate n-gram similarity between two texts
 */
export function ngramSimilarity(text1: string, text2: string, n: number = 3): number {
  const ngrams1 = new Set(generateNgrams(text1, n));
  const ngrams2 = new Set(generateNgrams(text2, n));

  if (ngrams1.size === 0 || ngrams2.size === 0) return 0;

  let intersection = 0;
  for (const ng of ngrams1) {
    if (ngrams2.has(ng)) intersection++;
  }

  // Jaccard similarity
  const union = ngrams1.size + ngrams2.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Boost search results with enhanced scoring
 *
 * Takes raw search results and applies recency, importance, and entity matching boosts.
 */
export function boostSearchResults<T extends { id: string; score: number; snippet: string }>(
  db: DatabaseSync,
  results: T[],
  queryText: string,
  options?: SearchBoostOptions & RecencyBoostOptions,
): Array<
  T & { boostedScore: number; recencyBoost: number; importanceBoost: number; entityBoost: number }
> {
  const queryEntities = extractEntities(queryText);

  return results
    .map((result) => {
      // Get chunk metadata
      const row = db.prepare(`SELECT updated_at FROM chunks WHERE id = ?`).get(result.id) as
        | { updated_at: number }
        | undefined;
      const updatedAt = row?.updated_at ?? Date.now();

      // Calculate boost factors
      const recencyBoost = calculateRecencyBoost(updatedAt, options);
      const importanceBoost = getChunkImportance(db, result.id);
      const chunkEntities = getChunkEntities(db, result.id);
      const entityBoost = calculateEntityMatchBonus(queryEntities, chunkEntities);

      // Calculate combined score
      const boostedScore = calculateCombinedScore({
        vectorScore: result.score,
        recencyScore: recencyBoost,
        importanceScore: importanceBoost,
        entityMatchScore: entityBoost,
        options,
      });

      return {
        ...result,
        boostedScore,
        recencyBoost,
        importanceBoost,
        entityBoost,
      };
    })
    .sort((a, b) => b.boostedScore - a.boostedScore);
}

/**
 * Index a chunk with enhanced features (entities and importance)
 */
export function indexChunkEnhanced(
  db: DatabaseSync,
  chunkId: string,
  text: string,
): { entities: ExtractedEntities; importance: number } {
  const entities = extractEntities(text);
  const importance = calculateImportance(text);

  storeChunkEntities(db, chunkId, entities);
  storeChunkImportance(db, chunkId, importance);

  return { entities, importance };
}

/**
 * Reindex all existing chunks with enhanced features
 *
 * This is useful for upgrading existing indexes to use the new features.
 */
export async function reindexEnhancedFeatures(
  db: DatabaseSync,
  onProgress?: (completed: number, total: number) => void,
): Promise<{ indexed: number; errors: number }> {
  // Ensure tables exist
  ensureEntityTable(db);
  ensureImportanceTable(db);

  // Get all chunks
  const chunks = db.prepare(`SELECT id, text FROM chunks`).all() as Array<{
    id: string;
    text: string;
  }>;

  let indexed = 0;
  let errors = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;
    try {
      indexChunkEnhanced(db, chunk.id, chunk.text);
      indexed++;
    } catch {
      errors++;
    }

    if (onProgress && (i + 1) % 100 === 0) {
      onProgress(i + 1, chunks.length);
    }
  }

  if (onProgress) {
    onProgress(chunks.length, chunks.length);
  }

  return { indexed, errors };
}
