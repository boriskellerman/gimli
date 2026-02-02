import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Tests for the MCP server configuration file.
 * Validates that .mcp.json is well-formed and contains expected servers.
 */
describe("MCP configuration", () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const mcpConfigPath = join(projectRoot, ".mcp.json");

  it("has a valid .mcp.json file", () => {
    expect(existsSync(mcpConfigPath)).toBe(true);
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);
    expect(config).toBeDefined();
    expect(config.mcpServers).toBeDefined();
  });

  it("contains expected MCP servers", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);
    const servers = Object.keys(config.mcpServers);

    // Should have at least the core servers
    expect(servers).toContain("github");
    expect(servers).toContain("filesystem");
    expect(servers).toContain("memory");
  });

  it("each server has required fields", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);

    for (const [_name, server] of Object.entries(config.mcpServers)) {
      const srv = server as Record<string, unknown>;
      expect(srv.command).toBeDefined();
      expect(typeof srv.command).toBe("string");
      expect(srv.args).toBeDefined();
      expect(Array.isArray(srv.args)).toBe(true);
      // Description is optional but recommended
      if (srv.description) {
        expect(typeof srv.description).toBe("string");
      }
    }
  });

  it("github server uses environment variable for token", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);
    const github = config.mcpServers.github as Record<string, unknown>;

    expect(github.env).toBeDefined();
    const env = github.env as Record<string, string>;
    // Token should use env var substitution, not hardcoded value
    expect(env.GITHUB_PERSONAL_ACCESS_TOKEN).toMatch(/^\$\{.+\}$/);
  });

  it("filesystem server is scoped to project directory", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);
    const filesystem = config.mcpServers.filesystem as Record<string, unknown>;
    const args = filesystem.args as string[];

    // Should have a path argument that's within the gimli project
    const hasProjectPath = args.some((arg) => arg.includes("gimli"));
    expect(hasProjectPath).toBe(true);
  });

  it("all server commands use npx for portability", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");
    const config = JSON.parse(content);

    for (const [_name, server] of Object.entries(config.mcpServers)) {
      const srv = server as Record<string, unknown>;
      // All servers should use npx for consistent installation
      expect(srv.command).toBe("npx");
      const args = srv.args as string[];
      // Should have -y flag for auto-confirm
      expect(args[0]).toBe("-y");
    }
  });

  it("no hardcoded secrets in configuration", () => {
    const content = readFileSync(mcpConfigPath, "utf-8");

    // Check for common secret patterns
    const secretPatterns = [
      /ghp_[a-zA-Z0-9]{36}/, // GitHub personal access token
      /gho_[a-zA-Z0-9]{36}/, // GitHub OAuth token
      /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/, // Fine-grained PAT
      /sk-[a-zA-Z0-9]{48}/, // OpenAI API key
      /sk-ant-[a-zA-Z0-9-]{95}/, // Anthropic API key
    ];

    for (const pattern of secretPatterns) {
      expect(content).not.toMatch(pattern);
    }
  });
});
