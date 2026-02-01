import { describe, it, expect, beforeEach } from "vitest";
import {
  extractEntities,
  calculateImportance,
  calculateRecencyBoost,
  calculateEntityMatchBonus,
  calculateCombinedScore,
  generateNgrams,
  ngramSimilarity,
  ensureEnhancedIndexes,
  ensureEntityTable,
  ensureImportanceTable,
  storeChunkEntities,
  storeChunkImportance,
  getChunkImportance,
  getChunkEntities,
  findChunksByEntities,
  indexChunkEnhanced,
  reindexEnhancedFeatures,
  type ExtractedEntities,
} from "./indexing.js";

// Mock database for testing
let mockDb: MockDatabase;

class MockDatabase {
  private tables: Map<string, Array<Record<string, unknown>>> = new Map();
  private indexes: Set<string> = new Set();

  exec(sql: string): void {
    // Track index creation
    const indexMatch = sql.match(/CREATE INDEX IF NOT EXISTS (\w+)/i);
    if (indexMatch) {
      this.indexes.add(indexMatch[1]);
    }

    // Track table creation
    const tableMatch = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
    if (tableMatch) {
      if (!this.tables.has(tableMatch[1])) {
        this.tables.set(tableMatch[1], []);
      }
    }
  }

  prepare(sql: string): {
    run: (...args: unknown[]) => void;
    get: (id: string) => unknown;
    all: (...args: unknown[]) => unknown[];
  } {
    const tables = this.tables;

    return {
      run: (...args: unknown[]) => {
        // Handle DELETE
        if (sql.includes("DELETE FROM chunk_entities")) {
          const chunkId = args[0] as string;
          const table = tables.get("chunk_entities") ?? [];
          tables.set(
            "chunk_entities",
            table.filter((r) => r.chunk_id !== chunkId),
          );
          return;
        }

        // Handle INSERT into chunk_entities
        if (sql.includes("INSERT") && sql.includes("chunk_entities")) {
          const table = tables.get("chunk_entities") ?? [];
          table.push({
            chunk_id: args[0],
            entity: args[1],
            entity_type: args[2],
          });
          tables.set("chunk_entities", table);
          return;
        }

        // Handle INSERT/UPDATE into chunk_importance
        if (sql.includes("chunk_importance")) {
          const table = tables.get("chunk_importance") ?? [];
          const existing = table.findIndex((r) => r.chunk_id === args[0]);
          if (existing >= 0) {
            table[existing] = {
              chunk_id: args[0],
              importance: args[1],
              computed_at: args[2],
            };
          } else {
            table.push({
              chunk_id: args[0],
              importance: args[1],
              computed_at: args[2],
            });
          }
          tables.set("chunk_importance", table);
          return;
        }
      },
      get: (id: string) => {
        if (sql.includes("chunk_importance")) {
          const table = tables.get("chunk_importance") ?? [];
          return table.find((r) => r.chunk_id === id);
        }
        if (sql.includes("chunks WHERE id")) {
          const table = tables.get("chunks") ?? [];
          return table.find((r) => r.id === id);
        }
        return undefined;
      },
      all: (...args: unknown[]) => {
        if (sql.includes("chunk_entities WHERE chunk_id")) {
          const table = tables.get("chunk_entities") ?? [];
          return table.filter((r) => r.chunk_id === args[0]);
        }
        if (sql.includes("chunk_entities") && sql.includes("entity IN")) {
          const table = tables.get("chunk_entities") ?? [];
          const entities = args.slice(0, -1) as string[];
          const seen = new Set<string>();
          return table.filter((r) => {
            if (entities.includes(r.entity as string) && !seen.has(r.chunk_id as string)) {
              seen.add(r.chunk_id as string);
              return true;
            }
            return false;
          });
        }
        if (sql.includes("SELECT id, text FROM chunks")) {
          return tables.get("chunks") ?? [];
        }
        return [];
      },
    };
  }

  hasIndex(name: string): boolean {
    return this.indexes.has(name);
  }

  addChunk(id: string, text: string, updatedAt: number = Date.now()): void {
    const table = this.tables.get("chunks") ?? [];
    table.push({ id, text, updated_at: updatedAt });
    this.tables.set("chunks", table);
  }
}

beforeEach(() => {
  mockDb = new MockDatabase();
});

describe("extractEntities", () => {
  it("extracts CamelCase identifiers", () => {
    const entities = extractEntities("The UserManager handles MyComponent data");
    expect(entities.identifiers).toContain("usermanager");
    expect(entities.identifiers).toContain("mycomponent");
  });

  it("extracts snake_case identifiers", () => {
    const entities = extractEntities("Use user_manager and my_component");
    expect(entities.identifiers).toContain("user_manager");
    expect(entities.identifiers).toContain("my_component");
  });

  it("extracts kebab-case identifiers", () => {
    const entities = extractEntities("The user-manager and my-component");
    expect(entities.identifiers).toContain("user-manager");
    expect(entities.identifiers).toContain("my-component");
  });

  it("extracts file paths", () => {
    const entities = extractEntities("Check /home/user/config.json and /var/log/app.log");
    expect(entities.paths).toContain("/home/user/config.json");
    expect(entities.paths).toContain("/var/log/app.log");
  });

  it("extracts URLs", () => {
    const entities = extractEntities("Visit https://example.com/path and http://api.test/v1");
    expect(entities.paths).toContain("https://example.com/path");
    expect(entities.paths).toContain("http://api.test/v1");
  });

  it("extracts function calls", () => {
    const entities = extractEntities("Call getData() and processItems()");
    expect(entities.codeRefs).toContain("getdata()");
    expect(entities.codeRefs).toContain("processitems()");
  });

  it("extracts version numbers", () => {
    const entities = extractEntities("Requires v2.1.0 or 1.0.0-beta.1");
    expect(entities.versions).toContain("v2.1.0");
    expect(entities.versions).toContain("1.0.0-beta.1");
  });

  it("extracts technical keywords", () => {
    const entities = extractEntities("TODO: Fix this. Remember to update config. IMPORTANT!");
    expect(entities.keywords).toContain("todo");
    expect(entities.keywords).toContain("remember");
    expect(entities.keywords).toContain("config");
    expect(entities.keywords).toContain("important");
  });

  it("deduplicates entities", () => {
    const entities = extractEntities("UserManager UserManager UserManager");
    expect(entities.identifiers.filter((e) => e === "usermanager")).toHaveLength(1);
  });

  it("combines all entities in all array", () => {
    const entities = extractEntities("UserManager /path/file.txt v1.0.0 TODO");
    expect(entities.all.length).toBeGreaterThan(0);
    expect(entities.all).toContain("usermanager");
    expect(entities.all).toContain("/path/file.txt");
  });

  it("handles empty text", () => {
    const entities = extractEntities("");
    expect(entities.all).toHaveLength(0);
  });
});

describe("calculateImportance", () => {
  it("returns base score for neutral text", () => {
    const score = calculateImportance("Just some regular text here");
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("increases score for important keywords", () => {
    const score = calculateImportance("This is important and critical");
    expect(score).toBeGreaterThan(0.5);
  });

  it("increases score for TODO markers", () => {
    const score = calculateImportance("TODO: Fix this bug FIXME: Also this");
    expect(score).toBeGreaterThan(0.5);
  });

  it("increases score for markdown headings", () => {
    const score = calculateImportance("# Main Heading\n## Subheading\nContent");
    expect(score).toBeGreaterThan(0.5);
  });

  it("increases score for bold text", () => {
    const score = calculateImportance("This is **very important** info");
    expect(score).toBeGreaterThan(0.5);
  });

  it("has diminishing returns for multiple matches", () => {
    const scoreBase = calculateImportance("hello world"); // baseline with no signals
    const score1 = calculateImportance("hello important world");
    const score3 = calculateImportance("hello important world important again important");
    // Score should increase with more matches
    expect(score1).toBeGreaterThan(scoreBase);
    // score3 should be >= score1 (more matches can't decrease score)
    expect(score3).toBeGreaterThanOrEqual(score1);
    // The increase from base to 3 matches should not be 3x linear
    // (log2(4) = 2, but we cap at 1, so 3 matches = same as 1 match per signal)
    const increase1 = score1 - scoreBase;
    const increase3 = score3 - scoreBase;
    // Diminishing returns: increase3 should be at most 2x increase1
    // (since log2(4) = 2, but capped at 1, they're equal)
    expect(increase3).toBeLessThanOrEqual(increase1 * 2);
  });

  it("clamps score to 0-1 range", () => {
    const text =
      "CRITICAL IMPORTANT ESSENTIAL MUST ALWAYS NEVER TODO FIXME BUG # Heading **bold** remember note config setting";
    const score = calculateImportance(text);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("calculateRecencyBoost", () => {
  it("returns 1 for current timestamp", () => {
    const now = Date.now();
    const score = calculateRecencyBoost(now, { referenceTime: now });
    expect(score).toBeCloseTo(1, 2);
  });

  it("returns lower score for older timestamps", () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const scoreNow = calculateRecencyBoost(now, { referenceTime: now });
    const scoreDay = calculateRecencyBoost(oneDayAgo, { referenceTime: now });
    const scoreWeek = calculateRecencyBoost(oneWeekAgo, { referenceTime: now });

    expect(scoreDay).toBeLessThan(scoreNow);
    expect(scoreWeek).toBeLessThan(scoreDay);
  });

  it("respects half-life parameter", () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const score = calculateRecencyBoost(thirtyDaysAgo, {
      referenceTime: now,
      halfLifeDays: 30,
      minScore: 0,
    });

    // After one half-life, score should be ~0.5
    expect(score).toBeCloseTo(0.5, 1);
  });

  it("never goes below minScore", () => {
    const now = Date.now();
    const veryOld = now - 365 * 24 * 60 * 60 * 1000; // 1 year ago

    const score = calculateRecencyBoost(veryOld, {
      referenceTime: now,
      minScore: 0.1,
    });

    expect(score).toBeGreaterThanOrEqual(0.1);
  });
});

describe("calculateEntityMatchBonus", () => {
  it("returns 0 when query has no entities", () => {
    const query: ExtractedEntities = {
      identifiers: [],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: [],
    };
    const chunk: ExtractedEntities = {
      identifiers: ["usermanager"],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: ["usermanager"],
    };

    expect(calculateEntityMatchBonus(query, chunk)).toBe(0);
  });

  it("returns 0 when chunk has no entities", () => {
    const query: ExtractedEntities = {
      identifiers: ["usermanager"],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: ["usermanager"],
    };
    const chunk: ExtractedEntities = {
      identifiers: [],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: [],
    };

    expect(calculateEntityMatchBonus(query, chunk)).toBe(0);
  });

  it("returns high score for exact match", () => {
    const entities: ExtractedEntities = {
      identifiers: ["usermanager"],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: ["usermanager"],
    };

    const score = calculateEntityMatchBonus(entities, entities);
    expect(score).toBe(1);
  });

  it("returns partial score for partial match", () => {
    const query: ExtractedEntities = {
      identifiers: ["usermanager", "dataservice"],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: ["usermanager", "dataservice"],
    };
    const chunk: ExtractedEntities = {
      identifiers: ["usermanager", "otherclass"],
      paths: [],
      codeRefs: [],
      versions: [],
      keywords: [],
      all: ["usermanager", "otherclass"],
    };

    const score = calculateEntityMatchBonus(query, chunk);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("calculateCombinedScore", () => {
  it("combines scores with default weights", () => {
    const score = calculateCombinedScore({
      vectorScore: 0.8,
      recencyScore: 0.6,
      importanceScore: 0.7,
      entityMatchScore: 0.5,
    });

    // With default weights (0.5, 0.2, 0.2, 0.1), normalized
    // Score = 0.5*0.8 + 0.2*0.6 + 0.2*0.7 + 0.1*0.5 = 0.4 + 0.12 + 0.14 + 0.05 = 0.71
    expect(score).toBeCloseTo(0.71, 2);
  });

  it("respects custom weights", () => {
    const score = calculateCombinedScore({
      vectorScore: 1.0,
      recencyScore: 0,
      importanceScore: 0,
      entityMatchScore: 0,
      options: {
        vectorWeight: 1,
        recencyWeight: 0,
        importanceWeight: 0,
        entityMatchWeight: 0,
      },
    });

    expect(score).toBeCloseTo(1.0, 2);
  });

  it("normalizes weights", () => {
    const score = calculateCombinedScore({
      vectorScore: 0.5,
      recencyScore: 0.5,
      importanceScore: 0.5,
      entityMatchScore: 0.5,
      options: {
        vectorWeight: 2,
        recencyWeight: 2,
        importanceWeight: 2,
        entityMatchWeight: 2,
      },
    });

    // All weights equal, all scores 0.5, result should be 0.5
    expect(score).toBeCloseTo(0.5, 2);
  });
});

describe("generateNgrams", () => {
  it("generates trigrams by default", () => {
    const ngrams = generateNgrams("hello");
    expect(ngrams).toEqual(["hel", "ell", "llo"]);
  });

  it("normalizes text to lowercase", () => {
    const ngrams = generateNgrams("HELLO");
    expect(ngrams).toEqual(["hel", "ell", "llo"]);
  });

  it("handles short text", () => {
    const ngrams = generateNgrams("ab");
    expect(ngrams).toEqual(["ab"]);
  });

  it("handles empty text", () => {
    const ngrams = generateNgrams("");
    expect(ngrams).toEqual([""]);
  });

  it("supports custom n value", () => {
    const ngrams = generateNgrams("hello", 2);
    expect(ngrams).toEqual(["he", "el", "ll", "lo"]);
  });

  it("normalizes whitespace", () => {
    const ngrams = generateNgrams("a  b");
    expect(ngrams).toEqual(["a b"]);
  });
});

describe("ngramSimilarity", () => {
  it("returns 1 for identical strings", () => {
    const similarity = ngramSimilarity("hello world", "hello world");
    expect(similarity).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    const similarity = ngramSimilarity("abc", "xyz");
    expect(similarity).toBe(0);
  });

  it("returns partial score for similar strings", () => {
    const similarity = ngramSimilarity("hello", "hella");
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("handles empty strings", () => {
    expect(ngramSimilarity("", "hello")).toBe(0);
    expect(ngramSimilarity("hello", "")).toBe(0);
  });

  it("is symmetric", () => {
    const sim1 = ngramSimilarity("hello", "world");
    const sim2 = ngramSimilarity("world", "hello");
    expect(sim1).toBe(sim2);
  });
});

describe("database operations", () => {
  beforeEach(() => {
    ensureEntityTable(mockDb as unknown as import("node:sqlite").DatabaseSync);
    ensureImportanceTable(mockDb as unknown as import("node:sqlite").DatabaseSync);
  });

  describe("ensureEnhancedIndexes", () => {
    it("creates required indexes", () => {
      ensureEnhancedIndexes(mockDb as unknown as import("node:sqlite").DatabaseSync);

      expect(mockDb.hasIndex("idx_chunks_model_source")).toBe(true);
      expect(mockDb.hasIndex("idx_chunks_hash")).toBe(true);
      expect(mockDb.hasIndex("idx_chunks_updated_at")).toBe(true);
      expect(mockDb.hasIndex("idx_files_source_path")).toBe(true);
    });
  });

  describe("storeChunkEntities and getChunkEntities", () => {
    it("stores and retrieves entities", () => {
      const entities: ExtractedEntities = {
        identifiers: ["usermanager"],
        paths: ["/path/to/file"],
        codeRefs: ["getdata()"],
        versions: ["v1.0.0"],
        keywords: ["important"],
        all: ["usermanager", "/path/to/file", "getdata()", "v1.0.0", "important"],
      };

      storeChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
        entities,
      );
      const retrieved = getChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );

      expect(retrieved.identifiers).toContain("usermanager");
      expect(retrieved.paths).toContain("/path/to/file");
      expect(retrieved.codeRefs).toContain("getdata()");
      expect(retrieved.versions).toContain("v1.0.0");
      expect(retrieved.keywords).toContain("important");
    });

    it("replaces existing entities on update", () => {
      const entities1: ExtractedEntities = {
        identifiers: ["old"],
        paths: [],
        codeRefs: [],
        versions: [],
        keywords: [],
        all: ["old"],
      };
      const entities2: ExtractedEntities = {
        identifiers: ["new"],
        paths: [],
        codeRefs: [],
        versions: [],
        keywords: [],
        all: ["new"],
      };

      storeChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
        entities1,
      );
      storeChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
        entities2,
      );

      const retrieved = getChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );
      expect(retrieved.identifiers).toContain("new");
      expect(retrieved.identifiers).not.toContain("old");
    });
  });

  describe("storeChunkImportance and getChunkImportance", () => {
    it("stores and retrieves importance score", () => {
      storeChunkImportance(mockDb as unknown as import("node:sqlite").DatabaseSync, "chunk1", 0.8);
      const importance = getChunkImportance(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );
      expect(importance).toBe(0.8);
    });

    it("returns default for unknown chunk", () => {
      const importance = getChunkImportance(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "unknown",
      );
      expect(importance).toBe(0.5);
    });

    it("updates existing importance", () => {
      storeChunkImportance(mockDb as unknown as import("node:sqlite").DatabaseSync, "chunk1", 0.3);
      storeChunkImportance(mockDb as unknown as import("node:sqlite").DatabaseSync, "chunk1", 0.9);
      const importance = getChunkImportance(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );
      expect(importance).toBe(0.9);
    });
  });

  describe("findChunksByEntities", () => {
    it("finds chunks with matching entities", () => {
      const entities: ExtractedEntities = {
        identifiers: ["usermanager"],
        paths: [],
        codeRefs: [],
        versions: [],
        keywords: [],
        all: ["usermanager"],
      };

      storeChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
        entities,
      );
      storeChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk2",
        entities,
      );

      const found = findChunksByEntities(mockDb as unknown as import("node:sqlite").DatabaseSync, [
        "usermanager",
      ]);
      expect(found).toContain("chunk1");
      expect(found).toContain("chunk2");
    });

    it("returns empty for no matches", () => {
      const found = findChunksByEntities(mockDb as unknown as import("node:sqlite").DatabaseSync, [
        "nonexistent",
      ]);
      expect(found).toHaveLength(0);
    });

    it("returns empty for empty entity list", () => {
      const found = findChunksByEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        [],
      );
      expect(found).toHaveLength(0);
    });
  });

  describe("indexChunkEnhanced", () => {
    it("extracts and stores entities and importance", () => {
      const text = "UserManager is important for config";
      const result = indexChunkEnhanced(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
        text,
      );

      expect(result.entities.identifiers).toContain("usermanager");
      expect(result.entities.keywords).toContain("important");
      expect(result.entities.keywords).toContain("config");
      expect(result.importance).toBeGreaterThan(0.5);

      // Verify stored
      const storedEntities = getChunkEntities(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );
      expect(storedEntities.identifiers).toContain("usermanager");

      const storedImportance = getChunkImportance(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        "chunk1",
      );
      expect(storedImportance).toBe(result.importance);
    });
  });

  describe("reindexEnhancedFeatures", () => {
    it("reindexes all chunks", async () => {
      mockDb.addChunk("chunk1", "UserManager handles users");
      mockDb.addChunk("chunk2", "Important config setting");

      const result = await reindexEnhancedFeatures(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
      );

      expect(result.indexed).toBe(2);
      expect(result.errors).toBe(0);
    });

    it("calls progress callback", async () => {
      mockDb.addChunk("chunk1", "test");

      const progressCalls: Array<[number, number]> = [];
      await reindexEnhancedFeatures(
        mockDb as unknown as import("node:sqlite").DatabaseSync,
        (completed, total) => {
          progressCalls.push([completed, total]);
        },
      );

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[progressCalls.length - 1]).toEqual([1, 1]);
    });
  });
});
