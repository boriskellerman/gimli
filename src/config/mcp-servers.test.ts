/**
 * Tests for MCP server configuration
 *
 * Verifies the .mcp.json configuration is valid and servers are accessible.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../.."); // src/config -> root

describe("MCP Server Configuration", () => {
  let mcpConfig: {
    mcpServers: Record<
      string,
      {
        command: string;
        args: string[];
        env?: Record<string, string>;
        description?: string;
      }
    >;
  };

  beforeAll(async () => {
    const configPath = resolve(projectRoot, ".mcp.json");
    const content = await readFile(configPath, "utf-8");
    mcpConfig = JSON.parse(content);
  });

  describe("Configuration Structure", () => {
    it("should have mcpServers object", () => {
      expect(mcpConfig).toHaveProperty("mcpServers");
      expect(typeof mcpConfig.mcpServers).toBe("object");
    });

    it("should have memory server configured", () => {
      expect(mcpConfig.mcpServers).toHaveProperty("memory");
      const memory = mcpConfig.mcpServers.memory;
      expect(memory.command).toBe("npx");
      expect(memory.args).toContain("@modelcontextprotocol/server-memory");
    });

    it("should have git server configured", () => {
      expect(mcpConfig.mcpServers).toHaveProperty("git");
      const git = mcpConfig.mcpServers.git;
      expect(git.command).toBe("npx");
      expect(git.args).toContain("@modelcontextprotocol/server-git");
    });

    it("should have sequential-thinking server configured", () => {
      expect(mcpConfig.mcpServers).toHaveProperty("sequential-thinking");
      const thinking = mcpConfig.mcpServers["sequential-thinking"];
      expect(thinking.command).toBe("npx");
      expect(thinking.args).toContain("@modelcontextprotocol/server-sequential-thinking");
    });
  });

  describe("Memory Server Configuration", () => {
    it("should have memory file path configured", () => {
      const memory = mcpConfig.mcpServers.memory;
      expect(memory.env).toBeDefined();
      expect(memory.env!.MEMORY_FILE_PATH).toContain("agent-memory.jsonl");
    });

    it("should have description for documentation", () => {
      const memory = mcpConfig.mcpServers.memory;
      expect(memory.description).toBeDefined();
      expect(memory.description).toContain("Agent Experts");
    });
  });

  describe("Server Descriptions", () => {
    it("should have descriptions for all servers", () => {
      for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
        expect(server.description, `${name} should have description`).toBeDefined();
        expect(server.description!.length).toBeGreaterThan(10);
      }
    });
  });

  describe("Memory Storage Directory", () => {
    it("should have .gimli directory for memory storage", () => {
      const gimliDir = resolve(projectRoot, ".gimli");
      expect(existsSync(gimliDir)).toBe(true);
    });
  });

  describe("Documentation", () => {
    it("should have MCP servers documentation", () => {
      const docsPath = resolve(projectRoot, "docs", "mcp-servers.md");
      expect(existsSync(docsPath)).toBe(true);
    });

    it("should document all configured servers", async () => {
      const docsPath = resolve(projectRoot, "docs", "mcp-servers.md");
      const content = await readFile(docsPath, "utf-8");

      // Check that each server is documented
      expect(content).toContain("Memory Server");
      expect(content).toContain("Git Server");
      expect(content).toContain("Sequential Thinking Server");

      // Check TAC alignment is documented
      expect(content).toContain("TAC Alignment");
      expect(content).toContain("Agent Experts");
    });
  });
});
