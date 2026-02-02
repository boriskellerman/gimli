import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getFileHash,
  loadExpertYaml,
  checkExpertSync,
  generateResyncPrompt,
  touchExpert,
  DATABASE_EXPERT_CONFIG,
  type ExpertConfig,
} from "./expert-sync.js";

describe("expert-sync", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "expert-sync-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("getFileHash", () => {
    it("returns empty string for non-existent file", () => {
      const hash = getFileHash(path.join(tempDir, "nonexistent.txt"));
      expect(hash).toBe("");
    });

    it("returns consistent hash for same content", () => {
      const filePath = path.join(tempDir, "test.txt");
      fs.writeFileSync(filePath, "test content");

      const hash1 = getFileHash(filePath);
      const hash2 = getFileHash(filePath);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(16); // Truncated SHA256
    });

    it("returns different hash for different content", () => {
      const file1 = path.join(tempDir, "test1.txt");
      const file2 = path.join(tempDir, "test2.txt");
      fs.writeFileSync(file1, "content A");
      fs.writeFileSync(file2, "content B");

      const hash1 = getFileHash(file1);
      const hash2 = getFileHash(file2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("loadExpertYaml", () => {
    it("returns null for non-existent file", () => {
      const result = loadExpertYaml(path.join(tempDir, "nonexistent.yaml"));
      expect(result).toBeNull();
    });

    it("parses expert YAML correctly", () => {
      const yamlPath = path.join(tempDir, "expert.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: test-expert
domain: test-domain
updated_at: "2026-01-15T00:00:00Z"

data:
  key: value
`,
      );

      const result = loadExpertYaml(yamlPath);

      expect(result).not.toBeNull();
      expect(result!.metadata.version).toBe("1.0");
      expect(result!.metadata.expert).toBe("test-expert");
      expect(result!.metadata.domain).toBe("test-domain");
      expect(result!.metadata.updated_at).toBe("2026-01-15T00:00:00Z");
    });

    it("provides defaults for missing metadata fields", () => {
      const yamlPath = path.join(tempDir, "minimal.yaml");
      fs.writeFileSync(yamlPath, "data: test\n");

      const result = loadExpertYaml(yamlPath);

      expect(result).not.toBeNull();
      expect(result!.metadata.version).toBe("1.0");
      expect(result!.metadata.expert).toBe("unknown");
    });
  });

  describe("checkExpertSync", () => {
    it("detects stale expert when source files are newer", async () => {
      // Create expert YAML with old timestamp
      const expertsDir = path.join(tempDir, "experts");
      const srcDir = path.join(tempDir, "src", "infra");
      fs.mkdirSync(expertsDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const yamlPath = path.join(expertsDir, "test-expert.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: test
domain: test
updated_at: "2026-01-01T00:00:00Z"
`,
      );

      // Create source file with current timestamp (newer than expert)
      const sourceFile = path.join(srcDir, "test-store.ts");
      fs.writeFileSync(sourceFile, "export const test = true;");

      const config: ExpertConfig = {
        yamlPath: path.join("experts", "test-expert.yaml"),
        sourceFiles: ["src/infra/test-store.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.isStale).toBe(true);
      expect(result.staleSources).toContain("src/infra/test-store.ts");
    });

    it("reports missing source files", () => {
      const expertsDir = path.join(tempDir, "experts");
      fs.mkdirSync(expertsDir, { recursive: true });

      const yamlPath = path.join(expertsDir, "test-expert.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: test
domain: test
updated_at: "2026-02-01T00:00:00Z"
`,
      );

      const config: ExpertConfig = {
        yamlPath: path.join("experts", "test-expert.yaml"),
        sourceFiles: ["src/nonexistent.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.isStale).toBe(true);
      expect(result.missingSources).toContain("src/nonexistent.ts");
    });

    it("reports up-to-date when expert is newer than sources", () => {
      // Create directories
      const expertsDir = path.join(tempDir, "experts");
      const srcDir = path.join(tempDir, "src", "infra");
      fs.mkdirSync(expertsDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // Create source file first
      const sourceFile = path.join(srcDir, "old-store.ts");
      fs.writeFileSync(sourceFile, "export const old = true;");

      // Wait briefly then create expert YAML with future timestamp
      const yamlPath = path.join(expertsDir, "test-expert.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: test
domain: test
updated_at: "2099-12-31T23:59:59Z"
`,
      );

      const config: ExpertConfig = {
        yamlPath: path.join("experts", "test-expert.yaml"),
        sourceFiles: ["src/infra/old-store.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.isStale).toBe(false);
      expect(result.staleSources).toHaveLength(0);
      expect(result.missingSources).toHaveLength(0);
    });
  });

  describe("generateResyncPrompt", () => {
    it("generates prompt for stale sources", () => {
      const checkResult = {
        expert: "database",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: ["src/infra/sessions-store.ts", "src/infra/memory-index.ts"],
        missingSources: [],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(checkResult, tempDir);

      expect(prompt).toContain("Expert Resync: database");
      expect(prompt).toContain("Modified Source Files");
      expect(prompt).toContain("src/infra/sessions-store.ts");
      expect(prompt).toContain("src/infra/memory-index.ts");
    });

    it("generates prompt for missing sources", () => {
      const checkResult = {
        expert: "test",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: [],
        missingSources: ["src/deleted-file.ts"],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(checkResult, tempDir);

      expect(prompt).toContain("Missing Source Files");
      expect(prompt).toContain("src/deleted-file.ts");
    });

    it("includes resync instructions", () => {
      const checkResult = {
        expert: "database",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: ["src/test.ts"],
        missingSources: [],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(checkResult, tempDir);

      expect(prompt).toContain("Resync Instructions");
      expect(prompt).toContain("Database schemas");
      expect(prompt).toContain("Access patterns");
      expect(prompt).toContain("updated_at");
    });
  });

  describe("touchExpert", () => {
    it("updates the updated_at field", () => {
      const yamlPath = path.join(tempDir, "expert.yaml");
      const oldTimestamp = "2020-01-01T00:00:00Z";
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: test
domain: test
updated_at: "${oldTimestamp}"
`,
      );

      const result = touchExpert(yamlPath);

      expect(result).toBe(true);

      const updated = loadExpertYaml(yamlPath);
      expect(updated!.metadata.updated_at).not.toBe(oldTimestamp);
      // Should be a valid ISO timestamp
      expect(new Date(updated!.metadata.updated_at).getTime()).toBeGreaterThan(0);
    });

    it("returns false for non-existent file", () => {
      const result = touchExpert(path.join(tempDir, "nonexistent.yaml"));
      expect(result).toBe(false);
    });
  });

  describe("DATABASE_EXPERT_CONFIG", () => {
    it("has correct YAML path", () => {
      expect(DATABASE_EXPERT_CONFIG.yamlPath).toBe("experts/database-expert.yaml");
    });

    it("monitors expected source files", () => {
      const expectedFiles = [
        "src/infra/sessions-store.ts",
        "src/infra/memory-index.ts",
        "src/infra/reminder-store.ts",
        "src/infra/auth-profiles-store.ts",
        "src/infra/encrypted-store.ts",
        "src/infra/file-locking.ts",
        "src/infra/state-migrations.ts",
      ];

      for (const file of expectedFiles) {
        expect(DATABASE_EXPERT_CONFIG.sourceFiles).toContain(file);
      }
    });
  });
});
