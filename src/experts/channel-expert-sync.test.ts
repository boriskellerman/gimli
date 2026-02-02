import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getFileHash,
  loadExpertiseYaml,
  checkExpertSync,
  generateResyncPrompt,
  touchExpertise,
  CHANNEL_EXPERT_CONFIG,
  type ExpertConfig,
} from "./channel-expert-sync.js";

describe("channel-expert-sync", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-expert-sync-test-"));
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

  describe("loadExpertiseYaml", () => {
    it("returns null for non-existent file", () => {
      const result = loadExpertiseYaml(path.join(tempDir, "nonexistent.yaml"));
      expect(result).toBeNull();
    });

    it("parses expertise YAML correctly", () => {
      const yamlPath = path.join(tempDir, "expertise.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: channel
domain: gimli-messaging-channels
updated_at: "2026-02-02T00:00:00Z"

data:
  key: value
`,
      );

      const result = loadExpertiseYaml(yamlPath);

      expect(result).not.toBeNull();
      expect(result!.metadata.version).toBe("1.0");
      expect(result!.metadata.expert).toBe("channel");
      expect(result!.metadata.domain).toBe("gimli-messaging-channels");
      expect(result!.metadata.updated_at).toBe("2026-02-02T00:00:00Z");
    });

    it("provides defaults for missing metadata fields", () => {
      const yamlPath = path.join(tempDir, "minimal.yaml");
      fs.writeFileSync(yamlPath, "data: test\n");

      const result = loadExpertiseYaml(yamlPath);

      expect(result).not.toBeNull();
      expect(result!.metadata.version).toBe("1.0");
      expect(result!.metadata.expert).toBe("unknown");
    });
  });

  describe("checkExpertSync", () => {
    it("detects stale expert when source files are newer", async () => {
      // Create expertise YAML with old timestamp
      const expertiseDir = path.join(tempDir, "skills", "channel-expert", "expertise");
      const srcDir = path.join(tempDir, "src", "channels");
      fs.mkdirSync(expertiseDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      const yamlPath = path.join(expertiseDir, "architecture.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: channel
domain: test
updated_at: "2026-01-01T00:00:00Z"
`,
      );

      // Create source file with current timestamp (newer than expertise)
      const sourceFile = path.join(srcDir, "registry.ts");
      fs.writeFileSync(sourceFile, "export const test = true;");

      const config: ExpertConfig = {
        skillPath: "skills/channel-expert/SKILL.md",
        expertiseFiles: ["skills/channel-expert/expertise/architecture.yaml"],
        sourceFiles: ["src/channels/registry.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.isStale).toBe(true);
      expect(result.staleSources).toContain("src/channels/registry.ts");
    });

    it("reports missing source files", () => {
      const expertiseDir = path.join(tempDir, "skills", "channel-expert", "expertise");
      fs.mkdirSync(expertiseDir, { recursive: true });

      const yamlPath = path.join(expertiseDir, "architecture.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: channel
domain: test
updated_at: "2026-02-02T00:00:00Z"
`,
      );

      const config: ExpertConfig = {
        skillPath: "skills/channel-expert/SKILL.md",
        expertiseFiles: ["skills/channel-expert/expertise/architecture.yaml"],
        sourceFiles: ["src/nonexistent.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.missingSources).toContain("src/nonexistent.ts");
    });

    it("reports not stale when expertise is newer", async () => {
      const expertiseDir = path.join(tempDir, "skills", "channel-expert", "expertise");
      const srcDir = path.join(tempDir, "src", "channels");
      fs.mkdirSync(expertiseDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      // Create source file first
      const sourceFile = path.join(srcDir, "registry.ts");
      fs.writeFileSync(sourceFile, "export const test = true;");

      // Wait a bit then create expertise with newer timestamp
      await new Promise((r) => setTimeout(r, 10));

      const yamlPath = path.join(expertiseDir, "architecture.yaml");
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: channel
domain: test
updated_at: "${new Date().toISOString()}"
`,
      );

      const config: ExpertConfig = {
        skillPath: "skills/channel-expert/SKILL.md",
        expertiseFiles: ["skills/channel-expert/expertise/architecture.yaml"],
        sourceFiles: ["src/channels/registry.ts"],
      };

      const result = checkExpertSync(config, tempDir);

      expect(result.isStale).toBe(false);
      expect(result.staleSources).toHaveLength(0);
    });
  });

  describe("generateResyncPrompt", () => {
    it("generates prompt with stale sources", () => {
      const result = {
        expert: "channel",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: ["src/channels/registry.ts"],
        missingSources: [],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(result);

      expect(prompt).toContain("Channel Expert Resync");
      expect(prompt).toContain("src/channels/registry.ts");
      expect(prompt).toContain("Modified Source Files");
    });

    it("generates prompt with missing sources", () => {
      const result = {
        expert: "channel",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: [],
        missingSources: ["src/old-file.ts"],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(result);

      expect(prompt).toContain("Missing Source Files");
      expect(prompt).toContain("src/old-file.ts");
    });

    it("includes resync instructions", () => {
      const result = {
        expert: "channel",
        isStale: true,
        lastUpdated: "2026-01-01T00:00:00Z",
        sourceFiles: [],
        staleSources: ["test.ts"],
        missingSources: [],
        recommendations: [],
      };

      const prompt = generateResyncPrompt(result);

      expect(prompt).toContain("Resync Instructions");
      expect(prompt).toContain("Channel plugin implementations");
      expect(prompt).toContain("Routing and session key patterns");
    });
  });

  describe("touchExpertise", () => {
    it("returns false for non-existent file", () => {
      const result = touchExpertise(path.join(tempDir, "nonexistent.yaml"));
      expect(result).toBe(false);
    });

    it("updates timestamp in existing file", () => {
      const yamlPath = path.join(tempDir, "expertise.yaml");
      const oldDate = "2026-01-01T00:00:00Z";
      fs.writeFileSync(
        yamlPath,
        `
version: "1.0"
expert: channel
domain: test
updated_at: "${oldDate}"
`,
      );

      const beforeUpdate = loadExpertiseYaml(yamlPath);
      expect(beforeUpdate!.metadata.updated_at).toBe(oldDate);

      const result = touchExpertise(yamlPath);
      expect(result).toBe(true);

      const afterUpdate = loadExpertiseYaml(yamlPath);
      expect(afterUpdate!.metadata.updated_at).not.toBe(oldDate);
      expect(new Date(afterUpdate!.metadata.updated_at).getTime()).toBeGreaterThan(
        new Date(oldDate).getTime(),
      );
    });
  });

  describe("CHANNEL_EXPERT_CONFIG", () => {
    it("has correct structure", () => {
      expect(CHANNEL_EXPERT_CONFIG.skillPath).toBe("skills/channel-expert/SKILL.md");
      expect(CHANNEL_EXPERT_CONFIG.expertiseFiles).toContain(
        "skills/channel-expert/expertise/architecture.yaml",
      );
      expect(CHANNEL_EXPERT_CONFIG.expertiseFiles).toContain(
        "skills/channel-expert/expertise/channels.yaml",
      );
      expect(CHANNEL_EXPERT_CONFIG.expertiseFiles).toContain(
        "skills/channel-expert/expertise/security.yaml",
      );
      expect(CHANNEL_EXPERT_CONFIG.expertiseFiles).toContain(
        "skills/channel-expert/expertise/troubleshooting.yaml",
      );
    });

    it("monitors key source files", () => {
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("src/channels/registry.ts");
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("src/channels/plugins/types.plugin.ts");
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("src/channels/plugins/types.core.ts");
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("src/routing/resolve-route.ts");
    });

    it("includes documentation files", () => {
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("docs/channels/index.md");
      expect(CHANNEL_EXPERT_CONFIG.sourceFiles).toContain("docs/channels/troubleshooting.md");
    });
  });
});
