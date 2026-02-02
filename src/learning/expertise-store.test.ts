import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEmptyExpertise,
  createExpertise,
  deleteExpertise,
  formatExpertiseSummary,
  getPendingUpdates,
  listExpertise,
  loadExpertise,
  mergeExpertise,
  recordExpertiseSync,
  resolveExpertiseDir,
  resolveExpertisePath,
  saveExpertise,
  searchExpertise,
  updateExpertiseKnowledge,
  type ExpertiseConfig,
  type ExpertiseSyncReport,
} from "./expertise-store.js";

describe("expertise-store", () => {
  const previousStateDir = process.env.GIMLI_STATE_DIR;
  let tempStateDir: string | null = null;

  beforeEach(async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-expertise-test-"));
    process.env.GIMLI_STATE_DIR = tempStateDir;
  });

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
    if (previousStateDir === undefined) {
      delete process.env.GIMLI_STATE_DIR;
    } else {
      process.env.GIMLI_STATE_DIR = previousStateDir;
    }
  });

  describe("resolveExpertiseDir", () => {
    it("resolves to the expertise directory for an agent", () => {
      const dir = resolveExpertiseDir("test-agent");
      expect(dir).toBe(path.join(tempStateDir!, "agents", "test-agent", "expertise"));
    });

    it("normalizes agent IDs", () => {
      const dir = resolveExpertiseDir("Test Agent");
      expect(dir).toBe(path.join(tempStateDir!, "agents", "test-agent", "expertise"));
    });

    it("uses main for empty agent ID", () => {
      const dir = resolveExpertiseDir("");
      expect(dir).toBe(path.join(tempStateDir!, "agents", "main", "expertise"));
    });
  });

  describe("resolveExpertisePath", () => {
    it("resolves to the YAML file path for an expert", () => {
      const filePath = resolveExpertisePath("test-agent", "database");
      expect(filePath).toBe(
        path.join(tempStateDir!, "agents", "test-agent", "expertise", "database.yaml"),
      );
    });

    it("sanitizes expert names for filenames", () => {
      const filePath = resolveExpertisePath("test-agent", "Database Expert!");
      expect(filePath).toBe(
        path.join(tempStateDir!, "agents", "test-agent", "expertise", "database-expert.yaml"),
      );
    });

    it("handles spaces in expert names", () => {
      const filePath = resolveExpertisePath("test-agent", "Gateway Expert");
      expect(filePath).toBe(
        path.join(tempStateDir!, "agents", "test-agent", "expertise", "gateway-expert.yaml"),
      );
    });
  });

  describe("createEmptyExpertise", () => {
    it("creates an empty expertise config with correct structure", () => {
      const config = createEmptyExpertise({
        name: "Database Expert",
        role: "Data layer specialist",
        expertiseAreas: ["SQLite", "Query optimization"],
      });

      expect(config.version).toBe(1);
      expect(config.expert.name).toBe("Database Expert");
      expect(config.expert.role).toBe("Data layer specialist");
      expect(config.expert.expertiseAreas).toEqual(["SQLite", "Query optimization"]);
      expect(config.keyKnowledge).toEqual([]);
      expect(config.mentalModel).toEqual([]);
      expect(config.commonIssues).toEqual([]);
      expect(config.relatedFiles).toEqual([]);
      expect(config.selfImprovement.pendingUpdates).toEqual([]);
      expect(config.selfImprovement.syncHistory).toEqual([]);
    });

    it("sets timestamps", () => {
      const before = new Date().toISOString();
      const config = createEmptyExpertise({
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });
      const after = new Date().toISOString();

      expect(config.expert.createdAt >= before).toBe(true);
      expect(config.expert.createdAt <= after).toBe(true);
      expect(config.expert.lastUpdated >= before).toBe(true);
      expect(config.selfImprovement.lastSync >= before).toBe(true);
    });
  });

  describe("saveExpertise and loadExpertise", () => {
    it("saves and loads expertise config in YAML format", async () => {
      const config = createEmptyExpertise({
        name: "Database Expert",
        role: "Data layer specialist",
        expertiseAreas: ["SQLite"],
      });
      config.keyKnowledge.push({
        title: "Index Types",
        summary: "Understanding B-tree and hash indexes",
        confidence: 0.9,
        lastUpdated: new Date().toISOString(),
      });

      await saveExpertise("test-agent", "database", config);

      const loaded = await loadExpertise("test-agent", "database");
      expect(loaded).not.toBeNull();
      expect(loaded!.expert.name).toBe("Database Expert");
      expect(loaded!.keyKnowledge).toHaveLength(1);
      expect(loaded!.keyKnowledge[0].title).toBe("Index Types");
    });

    it("returns null for non-existent expertise", async () => {
      const loaded = await loadExpertise("test-agent", "nonexistent");
      expect(loaded).toBeNull();
    });

    it("creates directory structure if it does not exist", async () => {
      const config = createEmptyExpertise({
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await saveExpertise("new-agent", "test", config);

      const filePath = resolveExpertisePath("new-agent", "test");
      const exists = await fs
        .access(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it("writes valid YAML that can be parsed", async () => {
      const config = createEmptyExpertise({
        name: "Test",
        role: "Test",
        expertiseAreas: ["Area 1"],
      });

      await saveExpertise("test-agent", "test", config);

      const filePath = resolveExpertisePath("test-agent", "test");
      const content = await fs.readFile(filePath, "utf8");
      const parsed = YAML.parse(content);
      expect(parsed.expert.name).toBe("Test");
    });
  });

  describe("createExpertise", () => {
    it("creates and saves a new expertise file", async () => {
      const config = await createExpertise("test-agent", {
        name: "Security Expert",
        role: "Auth and sandboxing specialist",
        expertiseAreas: ["Auth", "Sandboxing"],
      });

      expect(config.expert.name).toBe("Security Expert");

      const loaded = await loadExpertise("test-agent", "security-expert");
      expect(loaded).not.toBeNull();
      expect(loaded!.expert.role).toBe("Auth and sandboxing specialist");
    });
  });

  describe("listExpertise", () => {
    it("lists all expertise files for an agent", async () => {
      await createExpertise("test-agent", {
        name: "Database",
        role: "DB specialist",
        expertiseAreas: [],
      });
      await createExpertise("test-agent", {
        name: "Gateway",
        role: "WS specialist",
        expertiseAreas: [],
      });

      const experts = await listExpertise("test-agent");
      expect(experts).toContain("database");
      expect(experts).toContain("gateway");
      expect(experts).toHaveLength(2);
    });

    it("returns empty array for agent with no expertise", async () => {
      const experts = await listExpertise("nonexistent-agent");
      expect(experts).toEqual([]);
    });
  });

  describe("deleteExpertise", () => {
    it("deletes an expertise file", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      const deleted = await deleteExpertise("test-agent", "test");
      expect(deleted).toBe(true);

      const loaded = await loadExpertise("test-agent", "test");
      expect(loaded).toBeNull();
    });

    it("returns false for non-existent expertise", async () => {
      const deleted = await deleteExpertise("test-agent", "nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("updateExpertiseKnowledge", () => {
    it("adds new knowledge items", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      const updated = await updateExpertiseKnowledge("test-agent", "test", {
        addKnowledge: [
          {
            title: "New Knowledge",
            summary: "Summary of new knowledge",
            confidence: 0.8,
            tags: ["tag1"],
          },
        ],
      });

      expect(updated).not.toBeNull();
      expect(updated!.keyKnowledge).toHaveLength(1);
      expect(updated!.keyKnowledge[0].title).toBe("New Knowledge");
      expect(updated!.keyKnowledge[0].lastUpdated).toBeDefined();
    });

    it("updates existing knowledge by title", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "test", {
        addKnowledge: [
          {
            title: "Existing",
            summary: "Original summary",
            confidence: 0.5,
          },
        ],
      });

      const updated = await updateExpertiseKnowledge("test-agent", "test", {
        updateKnowledge: [
          {
            title: "Existing",
            updates: { summary: "Updated summary", confidence: 0.9 },
          },
        ],
      });

      expect(updated!.keyKnowledge[0].summary).toBe("Updated summary");
      expect(updated!.keyKnowledge[0].confidence).toBe(0.9);
    });

    it("adds mental model components", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      const updated = await updateExpertiseKnowledge("test-agent", "test", {
        addComponents: [
          {
            component: "MemoryManager",
            description: "Handles memory operations",
            patterns: ["Pattern 1", "Pattern 2"],
          },
        ],
      });

      expect(updated!.mentalModel).toHaveLength(1);
      expect(updated!.mentalModel[0].component).toBe("MemoryManager");
    });

    it("adds common issues", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      const updated = await updateExpertiseKnowledge("test-agent", "test", {
        addIssues: [
          {
            issue: "Connection timeout",
            cause: "Network latency",
            solution: "Increase timeout value",
          },
        ],
      });

      expect(updated!.commonIssues).toHaveLength(1);
      expect(updated!.commonIssues[0].issue).toBe("Connection timeout");
    });

    it("adds related files without duplicates", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "test", {
        addFiles: [{ path: "src/file.ts", importance: 8, reason: "Main file" }],
      });

      const updated = await updateExpertiseKnowledge("test-agent", "test", {
        addFiles: [
          { path: "src/file.ts", importance: 9, reason: "Updated reason" }, // Duplicate
          { path: "src/other.ts", importance: 5, reason: "Other file" },
        ],
      });

      expect(updated!.relatedFiles).toHaveLength(2);
      // Original file should not be updated (deduped by path)
      expect(updated!.relatedFiles.find((f) => f.path === "src/file.ts")?.importance).toBe(8);
    });

    it("manages pending updates", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "test", {
        addPendingUpdates: ["Update 1", "Update 2"],
      });

      let loaded = await loadExpertise("test-agent", "test");
      expect(loaded!.selfImprovement.pendingUpdates).toEqual(["Update 1", "Update 2"]);

      await updateExpertiseKnowledge("test-agent", "test", {
        completePendingUpdates: ["Update 1"],
      });

      loaded = await loadExpertise("test-agent", "test");
      expect(loaded!.selfImprovement.pendingUpdates).toEqual(["Update 2"]);
    });

    it("returns null for non-existent expert", async () => {
      const updated = await updateExpertiseKnowledge("test-agent", "nonexistent", {
        addKnowledge: [],
      });
      expect(updated).toBeNull();
    });
  });

  describe("recordExpertiseSync", () => {
    it("records a sync operation in history", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      const report: ExpertiseSyncReport = {
        expertName: "test",
        timestamp: new Date().toISOString(),
        filesChecked: 10,
        changesDetected: 3,
        knowledgeUpdated: 2,
        pendingUpdatesAdded: ["Update embeddings section"],
        summary: "Synced with latest code changes",
      };

      await recordExpertiseSync("test-agent", "test", report);

      const loaded = await loadExpertise("test-agent", "test");
      expect(loaded!.selfImprovement.lastSync).toBe(report.timestamp);
      expect(loaded!.selfImprovement.sources).toContainEqual(
        expect.objectContaining({
          type: "code_audit",
          filesChecked: 10,
          changesDetected: 3,
        }),
      );
      expect(loaded!.selfImprovement.syncHistory).toHaveLength(1);
      expect(loaded!.selfImprovement.syncHistory![0].summary).toBe(
        "Synced with latest code changes",
      );
      expect(loaded!.selfImprovement.pendingUpdates).toContain("Update embeddings section");
    });

    it("limits sync history to 50 entries", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      // Add 60 sync entries
      for (let i = 0; i < 60; i++) {
        await recordExpertiseSync("test-agent", "test", {
          expertName: "test",
          timestamp: new Date().toISOString(),
          filesChecked: 1,
          changesDetected: 0,
          knowledgeUpdated: 0,
          pendingUpdatesAdded: [],
          summary: `Sync ${i}`,
        });
      }

      const loaded = await loadExpertise("test-agent", "test");
      expect(loaded!.selfImprovement.syncHistory).toHaveLength(50);
      // Most recent should be first
      expect(loaded!.selfImprovement.syncHistory![0].summary).toBe("Sync 59");
    });
  });

  describe("getPendingUpdates", () => {
    it("returns pending updates for an expert", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "test", {
        addPendingUpdates: ["Pending 1", "Pending 2"],
      });

      const pending = await getPendingUpdates("test-agent", "test");
      expect(pending).toEqual(["Pending 1", "Pending 2"]);
    });

    it("returns empty array for non-existent expert", async () => {
      const pending = await getPendingUpdates("test-agent", "nonexistent");
      expect(pending).toEqual([]);
    });
  });

  describe("searchExpertise", () => {
    it("searches across all experts", async () => {
      await createExpertise("test-agent", {
        name: "Database",
        role: "DB specialist",
        expertiseAreas: [],
      });
      await createExpertise("test-agent", {
        name: "Security",
        role: "Security specialist",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "database", {
        addKnowledge: [
          { title: "SQLite Indexes", summary: "How indexes work in SQLite", confidence: 0.9 },
        ],
      });
      await updateExpertiseKnowledge("test-agent", "security", {
        addKnowledge: [
          { title: "JWT Tokens", summary: "Authentication with JWT", confidence: 0.85 },
        ],
      });

      const results = await searchExpertise("test-agent", "sqlite");
      expect(results).toHaveLength(1);
      expect(results[0].expert).toBe("database");
      expect(results[0].knowledge.title).toBe("SQLite Indexes");
    });

    it("searches by title, summary, details, and tags", async () => {
      await createExpertise("test-agent", {
        name: "Test",
        role: "Test",
        expertiseAreas: [],
      });

      await updateExpertiseKnowledge("test-agent", "test", {
        addKnowledge: [
          {
            title: "Title Match",
            summary: "Generic summary",
            confidence: 0.9,
          },
          {
            title: "Generic",
            summary: "Summary match here",
            confidence: 0.9,
          },
          {
            title: "Another",
            summary: "Generic",
            details: "Details match here",
            confidence: 0.9,
          },
          {
            title: "Tagged",
            summary: "Generic",
            confidence: 0.9,
            tags: ["tag-match"],
          },
        ],
      });

      expect(await searchExpertise("test-agent", "title match")).toHaveLength(1);
      expect(await searchExpertise("test-agent", "summary match")).toHaveLength(1);
      expect(await searchExpertise("test-agent", "details match")).toHaveLength(1);
      expect(await searchExpertise("test-agent", "tag-match")).toHaveLength(1);
    });

    it("returns empty array when no matches", async () => {
      const results = await searchExpertise("test-agent", "nonexistent");
      expect(results).toEqual([]);
    });
  });

  describe("formatExpertiseSummary", () => {
    it("formats expertise as human-readable summary", () => {
      const config: ExpertiseConfig = {
        version: 1,
        expert: {
          name: "Database Expert",
          role: "Data layer specialist",
          expertiseAreas: ["SQLite", "Query optimization"],
          createdAt: "2024-01-01T00:00:00Z",
          lastUpdated: "2024-06-01T00:00:00Z",
        },
        keyKnowledge: [
          {
            title: "Index Types",
            summary: "B-tree and hash indexes",
            confidence: 0.9,
            lastUpdated: "2024-05-01T00:00:00Z",
          },
        ],
        mentalModel: [
          {
            component: "QueryPlanner",
            description: "Optimizes query execution",
            patterns: ["Pattern 1"],
          },
        ],
        commonIssues: [
          {
            issue: "Slow queries",
            cause: "Missing index",
            solution: "Add appropriate index",
          },
        ],
        relatedFiles: [],
        selfImprovement: {
          lastSync: "2024-06-01T00:00:00Z",
          sources: [],
          pendingUpdates: ["Update index section"],
          syncHistory: [],
        },
      };

      const summary = formatExpertiseSummary(config);

      expect(summary).toContain("# Database Expert");
      expect(summary).toContain("Role: Data layer specialist");
      expect(summary).toContain("SQLite");
      expect(summary).toContain("Index Types");
      expect(summary).toContain("90% confidence");
      expect(summary).toContain("QueryPlanner");
      expect(summary).toContain("Slow queries");
      expect(summary).toContain("Update index section");
    });
  });

  describe("mergeExpertise", () => {
    it("merges two expertise configs", () => {
      const base: ExpertiseConfig = {
        version: 1,
        expert: {
          name: "Test",
          role: "Test",
          expertiseAreas: [],
          createdAt: "2024-01-01T00:00:00Z",
          lastUpdated: "2024-01-01T00:00:00Z",
        },
        keyKnowledge: [
          {
            title: "Old Knowledge",
            summary: "Old summary",
            confidence: 0.5,
            lastUpdated: "2024-01-01T00:00:00Z",
          },
        ],
        mentalModel: [{ component: "OldComponent", description: "Old", patterns: [] }],
        commonIssues: [],
        relatedFiles: [{ path: "old.ts", importance: 5, reason: "Old file" }],
        selfImprovement: {
          lastSync: "2024-01-01T00:00:00Z",
          sources: [],
          pendingUpdates: ["Old pending"],
          syncHistory: [],
        },
      };

      const incoming: ExpertiseConfig = {
        version: 1,
        expert: {
          name: "Test",
          role: "Test",
          expertiseAreas: [],
          createdAt: "2024-01-01T00:00:00Z",
          lastUpdated: "2024-06-01T00:00:00Z",
        },
        keyKnowledge: [
          {
            title: "Old Knowledge",
            summary: "Updated summary",
            confidence: 0.9,
            lastUpdated: "2024-06-01T00:00:00Z",
          },
          {
            title: "New Knowledge",
            summary: "New summary",
            confidence: 0.8,
            lastUpdated: "2024-06-01T00:00:00Z",
          },
        ],
        mentalModel: [{ component: "NewComponent", description: "New", patterns: [] }],
        commonIssues: [{ issue: "New issue", cause: "Cause", solution: "Solution" }],
        relatedFiles: [{ path: "new.ts", importance: 7, reason: "New file" }],
        selfImprovement: {
          lastSync: "2024-06-01T00:00:00Z",
          sources: [],
          pendingUpdates: ["New pending"],
          syncHistory: [],
        },
      };

      const merged = mergeExpertise(base, incoming);

      // Should have both knowledge items, preferring newer
      expect(merged.keyKnowledge).toHaveLength(2);
      const oldKnowledge = merged.keyKnowledge.find((k) => k.title === "Old Knowledge");
      expect(oldKnowledge?.summary).toBe("Updated summary"); // Newer version

      // Should have both mental model components
      expect(merged.mentalModel).toHaveLength(2);

      // Should have the new common issue
      expect(merged.commonIssues).toHaveLength(1);

      // Should have both files
      expect(merged.relatedFiles).toHaveLength(2);

      // Should merge pending updates
      expect(merged.selfImprovement.pendingUpdates).toContain("Old pending");
      expect(merged.selfImprovement.pendingUpdates).toContain("New pending");

      // Should use newer sync time
      expect(merged.selfImprovement.lastSync).toBe("2024-06-01T00:00:00Z");
    });
  });
});
