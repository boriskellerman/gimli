/**
 * Tests for expertise sync system
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  type ExpertDomain,
  type DomainExpertise,
  type ExpertiseEntry,
  DOMAIN_DEFINITIONS,
  createEmptyExpertise,
  serializeExpertise,
  parseExpertise,
  loadExpertise,
  saveExpertise,
  loadAllExpertise,
  addExpertiseEntry,
  updateExpertiseEntry,
  deactivateExpertiseEntry,
  detectAffectedDomains,
  analyzeCodeChanges,
  generateReviewPrompt,
  generateExtractPrompt,
  generateValidatePrompt,
  generateConsolidatePrompt,
  loadSyncState,
  saveSyncState,
  recordPendingChanges,
  clearPendingChanges,
  updateDomainSyncTime,
  getExpertiseSummary,
  getFullExpertiseContext,
  searchExpertise,
  applyExpertiseDecay,
  resolveDomainExpertisePath,
  resolveSyncStatePath,
} from "./expertise-sync.js";

// Test fixtures
const TEST_AGENT_ID = "test-agent-expertise";
let testStateDir: string;
let originalStateDir: string | undefined;

// Helper to create a mock expertise entry
function createMockEntry(overrides: Partial<ExpertiseEntry> = {}): ExpertiseEntry {
  const now = new Date().toISOString();
  return {
    id: `exp_test_${Math.random().toString(36).slice(2, 6)}`,
    summary: "Test entry summary",
    content: "Test entry content with details",
    confidence: "medium",
    source: "manual",
    relatedFiles: ["test/file.ts"],
    tags: ["test"],
    createdAt: now,
    updatedAt: now,
    active: true,
    ...overrides,
  };
}

// Helper to create expertise with entries
function createExpertiseWithEntries(
  domain: ExpertDomain,
  counts: { decisions?: number; patterns?: number; pitfalls?: number; bestPractices?: number } = {},
): DomainExpertise {
  const expertise = createEmptyExpertise(domain);

  for (let i = 0; i < (counts.decisions || 0); i++) {
    expertise.decisions.push(createMockEntry({ summary: `Decision ${i}` }));
  }
  for (let i = 0; i < (counts.patterns || 0); i++) {
    expertise.patterns.push(createMockEntry({ summary: `Pattern ${i}` }));
  }
  for (let i = 0; i < (counts.pitfalls || 0); i++) {
    expertise.pitfalls.push(createMockEntry({ summary: `Pitfall ${i}` }));
  }
  for (let i = 0; i < (counts.bestPractices || 0); i++) {
    expertise.bestPractices.push(createMockEntry({ summary: `Best Practice ${i}` }));
  }

  return expertise;
}

describe("expertise-sync", () => {
  beforeEach(async () => {
    // Create temp directory for test state
    testStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "gimli-expertise-test-"));
    // Store original and set test directory via env
    originalStateDir = process.env.GIMLI_STATE_DIR;
    process.env.GIMLI_STATE_DIR = testStateDir;
  });

  afterEach(async () => {
    // Restore original state dir
    if (originalStateDir) {
      process.env.GIMLI_STATE_DIR = originalStateDir;
    } else {
      delete process.env.GIMLI_STATE_DIR;
    }
    // Clean up temp directory
    try {
      await fs.rm(testStateDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Domain Definitions", () => {
    it("should have definitions for all domains", () => {
      const domains: ExpertDomain[] = ["database", "gateway", "security", "channel"];
      for (const domain of domains) {
        expect(DOMAIN_DEFINITIONS[domain]).toBeDefined();
        expect(DOMAIN_DEFINITIONS[domain].name).toBeTruthy();
        expect(DOMAIN_DEFINITIONS[domain].description).toBeTruthy();
        expect(DOMAIN_DEFINITIONS[domain].filePatterns.length).toBeGreaterThan(0);
      }
    });

    it("should have unique file patterns per domain", () => {
      const allPatterns = new Set<string>();
      for (const [domain, def] of Object.entries(DOMAIN_DEFINITIONS)) {
        for (const pattern of def.filePatterns) {
          // Some overlap is acceptable, but core patterns should be unique
          if (!pattern.includes("**/*")) {
            expect(allPatterns.has(pattern)).toBe(false);
          }
          allPatterns.add(`${domain}:${pattern}`);
        }
      }
    });
  });

  describe("createEmptyExpertise", () => {
    it("should create empty expertise for each domain", () => {
      const domains: ExpertDomain[] = ["database", "gateway", "security", "channel"];
      for (const domain of domains) {
        const expertise = createEmptyExpertise(domain);

        expect(expertise.domain).toBe(domain);
        expect(expertise.name).toBe(DOMAIN_DEFINITIONS[domain].name);
        expect(expertise.description).toBe(DOMAIN_DEFINITIONS[domain].description);
        expect(expertise.filePatterns).toEqual(DOMAIN_DEFINITIONS[domain].filePatterns);
        expect(expertise.decisions).toEqual([]);
        expect(expertise.patterns).toEqual([]);
        expect(expertise.pitfalls).toEqual([]);
        expect(expertise.bestPractices).toEqual([]);
        expect(expertise.version).toBe(1);
        expect(expertise.lastSync).toBeTruthy();
      }
    });
  });

  describe("Serialization", () => {
    it("should serialize empty expertise to YAML format", () => {
      const expertise = createEmptyExpertise("database");
      const yaml = serializeExpertise(expertise);

      expect(yaml).toContain("# Database Expert");
      expect(yaml).toContain("domain: database");
      expect(yaml).toContain("file_patterns:");
      expect(yaml).toContain("**/db/**");
    });

    it("should serialize expertise with entries", () => {
      const expertise = createExpertiseWithEntries("gateway", { decisions: 2, patterns: 1 });
      const yaml = serializeExpertise(expertise);

      expect(yaml).toContain("# Gateway Expert");
      expect(yaml).toContain("decisions:");
      expect(yaml).toContain("Decision 0");
      expect(yaml).toContain("Decision 1");
      expect(yaml).toContain("patterns:");
      expect(yaml).toContain("Pattern 0");
    });

    it("should preserve multiline content", () => {
      const expertise = createEmptyExpertise("security");
      expertise.decisions.push(
        createMockEntry({
          summary: "Multiline test",
          content: "Line 1\nLine 2\nLine 3",
        }),
      );

      const yaml = serializeExpertise(expertise);
      expect(yaml).toContain("content: |");
      expect(yaml).toContain("      Line 1");
      expect(yaml).toContain("      Line 2");
    });

    it("should skip inactive entries", () => {
      const expertise = createEmptyExpertise("channel");
      expertise.decisions.push(createMockEntry({ summary: "Active", active: true }));
      expertise.decisions.push(createMockEntry({ summary: "Inactive", active: false }));

      const yaml = serializeExpertise(expertise);
      expect(yaml).toContain("Active");
      expect(yaml).not.toContain("Inactive");
    });
  });

  describe("Parsing", () => {
    it("should parse serialized expertise back to object", () => {
      const original = createExpertiseWithEntries("database", {
        decisions: 2,
        patterns: 1,
        pitfalls: 1,
        bestPractices: 1,
      });
      const yaml = serializeExpertise(original);
      const parsed = parseExpertise(yaml, "database");

      expect(parsed.domain).toBe("database");
      expect(parsed.decisions.length).toBe(2);
      expect(parsed.patterns.length).toBe(1);
      expect(parsed.pitfalls.length).toBe(1);
      expect(parsed.bestPractices.length).toBe(1);
    });

    it("should handle empty YAML", () => {
      const parsed = parseExpertise("", "gateway");
      expect(parsed.domain).toBe("gateway");
      expect(parsed.decisions).toEqual([]);
    });

    it("should preserve entry metadata through round-trip", () => {
      const original = createEmptyExpertise("security");
      const entry = createMockEntry({
        summary: "Test round-trip",
        confidence: "high",
        source: "code_analysis",
        tags: ["auth", "jwt"],
      });
      original.decisions.push(entry);

      const yaml = serializeExpertise(original);
      const parsed = parseExpertise(yaml, "security");

      expect(parsed.decisions[0].summary).toBe("Test round-trip");
      expect(parsed.decisions[0].confidence).toBe("high");
      expect(parsed.decisions[0].source).toBe("code_analysis");
      expect(parsed.decisions[0].tags).toContain("auth");
    });
  });

  describe("File Operations", () => {
    it("should save and load expertise", async () => {
      const expertise = createExpertiseWithEntries("database", { decisions: 3 });
      await saveExpertise(TEST_AGENT_ID, expertise);

      const loaded = await loadExpertise(TEST_AGENT_ID, "database");
      expect(loaded.domain).toBe("database");
      expect(loaded.decisions.length).toBe(3);
    });

    it("should return empty expertise for non-existent file", async () => {
      const loaded = await loadExpertise("nonexistent-agent", "gateway");
      expect(loaded.domain).toBe("gateway");
      expect(loaded.decisions).toEqual([]);
    });

    it("should load all domains", async () => {
      // Save expertise for each domain
      for (const domain of ["database", "gateway", "security", "channel"] as ExpertDomain[]) {
        const expertise = createExpertiseWithEntries(domain, { patterns: 1 });
        await saveExpertise(TEST_AGENT_ID, expertise);
      }

      const all = await loadAllExpertise(TEST_AGENT_ID);
      expect(all.size).toBe(4);
      expect(all.get("database")?.patterns.length).toBe(1);
      expect(all.get("gateway")?.patterns.length).toBe(1);
    });

    it("should resolve correct file paths", () => {
      const expertisePath = resolveDomainExpertisePath(TEST_AGENT_ID, "security");
      expect(expertisePath).toContain("security-expertise.yaml");
      // normalizeAgentId keeps dashes, just lowercases
      expect(expertisePath).toContain(TEST_AGENT_ID.toLowerCase());

      const syncPath = resolveSyncStatePath(TEST_AGENT_ID);
      expect(syncPath).toContain("sync-state.json");
    });
  });

  describe("Entry Operations", () => {
    it("should add expertise entry", async () => {
      const entry = await addExpertiseEntry(TEST_AGENT_ID, "database", "decisions", {
        summary: "New decision",
        content: "Decision content",
        confidence: "high",
        source: "manual",
        relatedFiles: ["src/db.ts"],
        tags: ["storage"],
      });

      expect(entry.id).toMatch(/^exp_/);
      expect(entry.summary).toBe("New decision");
      expect(entry.active).toBe(true);

      const loaded = await loadExpertise(TEST_AGENT_ID, "database");
      expect(loaded.decisions.length).toBe(1);
      expect(loaded.decisions[0].id).toBe(entry.id);
    });

    it("should update expertise entry", async () => {
      // Add entry first
      const entry = await addExpertiseEntry(TEST_AGENT_ID, "gateway", "patterns", {
        summary: "Original",
        content: "Original content",
        confidence: "low",
        source: "manual",
        relatedFiles: [],
        tags: [],
      });

      // Update it
      const updated = await updateExpertiseEntry(TEST_AGENT_ID, "gateway", entry.id, {
        summary: "Updated",
        confidence: "high",
      });

      expect(updated).not.toBeNull();
      expect(updated?.summary).toBe("Updated");
      expect(updated?.confidence).toBe("high");
      expect(updated?.updatedAt).not.toBe(entry.updatedAt);
    });

    it("should return null when updating non-existent entry", async () => {
      const result = await updateExpertiseEntry(TEST_AGENT_ID, "security", "nonexistent", {
        summary: "Should fail",
      });
      expect(result).toBeNull();
    });

    it("should deactivate expertise entry", async () => {
      const entry = await addExpertiseEntry(TEST_AGENT_ID, "channel", "pitfalls", {
        summary: "To be deactivated",
        content: "Content",
        confidence: "medium",
        source: "manual",
        relatedFiles: [],
        tags: [],
      });

      const result = await deactivateExpertiseEntry(TEST_AGENT_ID, "channel", entry.id);
      expect(result).toBe(true);

      const loaded = await loadExpertise(TEST_AGENT_ID, "channel");
      expect(loaded.pitfalls[0].active).toBe(false);
    });
  });

  describe("Code Change Detection", () => {
    it("should detect database domain from file paths", () => {
      const files = ["src/db/connection.ts", "src/storage/user-store.ts"];
      const domains = detectAffectedDomains(files);
      expect(domains).toContain("database");
    });

    it("should detect gateway domain from file paths", () => {
      const files = ["src/gateway/websocket.ts", "src/routing/handler.ts"];
      const domains = detectAffectedDomains(files);
      expect(domains).toContain("gateway");
    });

    it("should detect security domain from file paths", () => {
      const files = ["src/auth/jwt.ts", "src/sandbox/container.ts"];
      const domains = detectAffectedDomains(files);
      expect(domains).toContain("security");
    });

    it("should detect channel domain from file paths", () => {
      const files = ["src/telegram/bot.ts", "extensions/msteams/index.ts"];
      const domains = detectAffectedDomains(files);
      expect(domains).toContain("channel");
    });

    it("should detect multiple domains", () => {
      const files = ["src/db/users.ts", "src/auth/login.ts", "src/telegram/handler.ts"];
      const domains = detectAffectedDomains(files);
      expect(domains).toContain("database");
      expect(domains).toContain("security");
      expect(domains).toContain("channel");
    });

    it("should return empty for unmatched files", () => {
      const files = ["src/cli/commands.ts", "README.md"];
      const domains = detectAffectedDomains(files);
      expect(domains.length).toBe(0);
    });
  });

  describe("Code Change Analysis", () => {
    it("should analyze changes and provide suggestions", () => {
      const files = ["src/db/migration/001.ts", "src/db/config.ts"];
      const analysis = analyzeCodeChanges(files);

      expect(analysis.changedFiles).toEqual(files);
      expect(analysis.affectedDomains).toContain("database");
      expect(analysis.suggestions.length).toBeGreaterThan(0);
    });

    it("should include commit messages in summary", () => {
      const files = ["src/auth/jwt.ts"];
      const commits = ["Fix JWT validation bug", "Add refresh token support"];
      const analysis = analyzeCodeChanges(files, commits);

      expect(analysis.summary).toContain("Fix JWT validation bug");
      expect(analysis.summary).toContain("Add refresh token support");
    });

    it("should generate summary from file count when no commits", () => {
      const files = ["src/gateway/ws.ts", "src/gateway/session.ts"];
      const analysis = analyzeCodeChanges(files);

      expect(analysis.summary).toContain("2 files changed");
      expect(analysis.summary).toContain("1 domain");
    });
  });

  describe("Self-Improve Prompts", () => {
    it("should generate review prompt", () => {
      const expertise = createExpertiseWithEntries("database", { decisions: 2 });
      const files = ["src/db/new-feature.ts"];
      const prompt = generateReviewPrompt("database", files, expertise);

      expect(prompt.domain).toBe("database");
      expect(prompt.promptType).toBe("review");
      expect(prompt.prompt).toContain("Database Expert");
      expect(prompt.prompt).toContain("src/db/new-feature.ts");
      expect(prompt.prompt).toContain("2 entries");
      expect(prompt.contextFiles).toContain("src/db/new-feature.ts");
      expect(prompt.outputFormat).toBe("entries");
    });

    it("should generate extract prompt", () => {
      const files = ["src/gateway/websocket.ts"];
      const prompt = generateExtractPrompt("gateway", files);

      expect(prompt.domain).toBe("gateway");
      expect(prompt.promptType).toBe("extract");
      expect(prompt.prompt).toContain("Gateway Expert");
      expect(prompt.prompt).toContain("Architectural Decisions");
      expect(prompt.prompt).toContain("Patterns & Conventions");
      expect(prompt.prompt).toContain("Pitfalls & Gotchas");
    });

    it("should generate validate prompt", () => {
      const expertise = createExpertiseWithEntries("security", {
        decisions: 2,
        pitfalls: 1,
      });
      const prompt = generateValidatePrompt("security", expertise);

      expect(prompt.domain).toBe("security");
      expect(prompt.promptType).toBe("validate");
      expect(prompt.prompt).toContain("Security Expert");
      expect(prompt.prompt).toContain("Decision 0");
      expect(prompt.prompt).toContain("Pitfall 0");
      expect(prompt.outputFormat).toBe("validation");
    });

    it("should generate consolidate prompt", () => {
      const expertise = createExpertiseWithEntries("channel", {
        patterns: 5,
        bestPractices: 3,
      });
      const prompt = generateConsolidatePrompt("channel", expertise);

      expect(prompt.domain).toBe("channel");
      expect(prompt.promptType).toBe("consolidate");
      expect(prompt.prompt).toContain("Channel Expert");
      expect(prompt.prompt).toContain("Patterns: 5 entries");
      expect(prompt.prompt).toContain("Best Practices: 3 entries");
    });
  });

  describe("Sync State", () => {
    it("should save and load sync state", async () => {
      const state = {
        lastSyncByDomain: {
          database: "2024-01-01T00:00:00Z",
          gateway: "",
          security: "",
          channel: "",
        },
        lastProcessedFiles: ["file1.ts"],
        pendingChanges: ["file2.ts"],
        totalSyncs: 5,
      };

      await saveSyncState(TEST_AGENT_ID, state);
      const loaded = await loadSyncState(TEST_AGENT_ID);

      expect(loaded.lastSyncByDomain.database).toBe("2024-01-01T00:00:00Z");
      expect(loaded.totalSyncs).toBe(5);
    });

    it("should return default state for new agent", async () => {
      const state = await loadSyncState("new-agent");
      expect(state.totalSyncs).toBe(0);
      expect(state.pendingChanges).toEqual([]);
    });

    it("should record pending changes", async () => {
      await recordPendingChanges(TEST_AGENT_ID, ["file1.ts", "file2.ts"]);
      const state = await loadSyncState(TEST_AGENT_ID);

      expect(state.pendingChanges).toContain("file1.ts");
      expect(state.pendingChanges).toContain("file2.ts");
    });

    it("should avoid duplicate pending changes", async () => {
      await recordPendingChanges(TEST_AGENT_ID, ["file1.ts"]);
      await recordPendingChanges(TEST_AGENT_ID, ["file1.ts", "file2.ts"]);
      const state = await loadSyncState(TEST_AGENT_ID);

      expect(state.pendingChanges.filter((f) => f === "file1.ts").length).toBe(1);
    });

    it("should clear pending changes and increment sync count", async () => {
      await recordPendingChanges(TEST_AGENT_ID, ["file1.ts", "file2.ts"]);
      const cleared = await clearPendingChanges(TEST_AGENT_ID);

      expect(cleared).toContain("file1.ts");
      expect(cleared).toContain("file2.ts");

      const state = await loadSyncState(TEST_AGENT_ID);
      expect(state.pendingChanges).toEqual([]);
      expect(state.lastProcessedFiles).toContain("file1.ts");
      expect(state.totalSyncs).toBe(1);
    });

    it("should update domain sync time", async () => {
      await updateDomainSyncTime(TEST_AGENT_ID, "database");
      const state = await loadSyncState(TEST_AGENT_ID);

      expect(state.lastSyncByDomain.database).toBeTruthy();
      expect(new Date(state.lastSyncByDomain.database).getTime()).toBeGreaterThan(0);
    });
  });

  describe("Expertise Summary", () => {
    it("should generate summary for domain", async () => {
      const expertise = createEmptyExpertise("security");
      expertise.decisions.push(
        createMockEntry({
          summary: "Use JWT for auth",
          content: "All authentication uses JWT tokens with RS256",
          confidence: "high",
        }),
      );
      expertise.pitfalls.push(
        createMockEntry({
          summary: "Don't store tokens in localStorage",
          confidence: "medium",
        }),
      );
      await saveExpertise(TEST_AGENT_ID, expertise);

      const summary = await getExpertiseSummary(TEST_AGENT_ID, "security");

      expect(summary).toContain("Security Expert");
      expect(summary).toContain("Key Architectural Decisions");
      expect(summary).toContain("Use JWT for auth");
      expect(summary).toContain("Watch Out For");
    });

    it("should generate full context for all domains", async () => {
      // Save expertise for multiple domains
      for (const domain of ["database", "security"] as ExpertDomain[]) {
        const expertise = createEmptyExpertise(domain);
        expertise.patterns.push(
          createMockEntry({ summary: `${domain} pattern`, confidence: "high" }),
        );
        await saveExpertise(TEST_AGENT_ID, expertise);
      }

      const context = await getFullExpertiseContext(TEST_AGENT_ID);

      expect(context).toContain("Database Expert");
      expect(context).toContain("Security Expert");
      expect(context).toContain("database pattern");
      expect(context).toContain("security pattern");
    });
  });

  describe("Search", () => {
    it("should search expertise across domains", async () => {
      // Add entries to different domains
      await addExpertiseEntry(TEST_AGENT_ID, "database", "patterns", {
        summary: "Connection pooling",
        content: "Use connection pools for efficiency",
        confidence: "high",
        source: "manual",
        relatedFiles: [],
        tags: ["performance"],
      });

      await addExpertiseEntry(TEST_AGENT_ID, "gateway", "patterns", {
        summary: "WebSocket connection handling",
        content: "Maintain persistent connections",
        confidence: "medium",
        source: "manual",
        relatedFiles: [],
        tags: ["websocket"],
      });

      const results = await searchExpertise(TEST_AGENT_ID, "connection");

      expect(results.length).toBe(2);
      expect(results.some((r) => r.domain === "database")).toBe(true);
      expect(results.some((r) => r.domain === "gateway")).toBe(true);
    });

    it("should search by tags", async () => {
      await addExpertiseEntry(TEST_AGENT_ID, "security", "bestPractices", {
        summary: "Input validation",
        content: "Validate all user input",
        confidence: "high",
        source: "manual",
        relatedFiles: [],
        tags: ["validation", "security"],
      });

      const results = await searchExpertise(TEST_AGENT_ID, "validation");
      expect(results.length).toBe(1);
      expect(results[0].tags).toContain("validation");
    });

    it("should filter by domains", async () => {
      await addExpertiseEntry(TEST_AGENT_ID, "database", "patterns", {
        summary: "Query optimization",
        content: "Optimize database queries",
        confidence: "high",
        source: "manual",
        relatedFiles: [],
        tags: [],
      });

      await addExpertiseEntry(TEST_AGENT_ID, "gateway", "patterns", {
        summary: "Request optimization",
        content: "Optimize HTTP requests",
        confidence: "high",
        source: "manual",
        relatedFiles: [],
        tags: [],
      });

      const results = await searchExpertise(TEST_AGENT_ID, "optimization", {
        domains: ["database"],
      });

      expect(results.length).toBe(1);
      expect(results[0].domain).toBe("database");
    });

    it("should sort results by confidence", async () => {
      await addExpertiseEntry(TEST_AGENT_ID, "channel", "patterns", {
        summary: "Low confidence",
        content: "Content",
        confidence: "low",
        source: "manual",
        relatedFiles: [],
        tags: ["test"],
      });

      await addExpertiseEntry(TEST_AGENT_ID, "channel", "patterns", {
        summary: "High confidence",
        content: "Content",
        confidence: "high",
        source: "manual",
        relatedFiles: [],
        tags: ["test"],
      });

      const results = await searchExpertise(TEST_AGENT_ID, "test");

      expect(results[0].confidence).toBe("high");
      expect(results[1].confidence).toBe("low");
    });
  });

  describe("Expertise Decay", () => {
    it("should deactivate old low-confidence entries", async () => {
      // Create expertise with old low-confidence entry
      const expertise = createEmptyExpertise("database");
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100); // 100 days ago

      expertise.patterns.push({
        ...createMockEntry({
          summary: "Old low-confidence",
          confidence: "low",
        }),
        updatedAt: oldDate.toISOString(),
      });

      expertise.patterns.push(
        createMockEntry({
          summary: "Recent low-confidence",
          confidence: "low",
        }),
      );

      expertise.patterns.push({
        ...createMockEntry({
          summary: "Old high-confidence",
          confidence: "high",
        }),
        updatedAt: oldDate.toISOString(),
      });

      await saveExpertise(TEST_AGENT_ID, expertise);

      const results = await applyExpertiseDecay(TEST_AGENT_ID, { decayDays: 90 });

      expect(results.length).toBe(1);
      expect(results[0].domain).toBe("database");
      expect(results[0].deactivated).toBe(1);

      const loaded = await loadExpertise(TEST_AGENT_ID, "database");
      const activePatterns = loaded.patterns.filter((p) => p.active);
      expect(activePatterns.length).toBe(2);
    });

    it("should not decay high-confidence entries", async () => {
      const expertise = createEmptyExpertise("gateway");
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 200);

      expertise.decisions.push({
        ...createMockEntry({
          summary: "Old but important",
          confidence: "high",
        }),
        updatedAt: oldDate.toISOString(),
      });

      await saveExpertise(TEST_AGENT_ID, expertise);

      const results = await applyExpertiseDecay(TEST_AGENT_ID);

      expect(results.length).toBe(0);

      const loaded = await loadExpertise(TEST_AGENT_ID, "gateway");
      expect(loaded.decisions[0].active).toBe(true);
    });
  });
});
