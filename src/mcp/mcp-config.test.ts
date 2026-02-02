import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");
const mcpConfigPath = join(projectRoot, ".mcp.json");

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  description?: string;
}

interface McpConfig {
  $schema?: string;
  mcpServers: Record<string, McpServerConfig>;
}

describe("MCP Configuration", () => {
  let config: McpConfig;

  beforeAll(() => {
    if (!existsSync(mcpConfigPath)) {
      throw new Error(`.mcp.json not found at ${mcpConfigPath}`);
    }
    const content = readFileSync(mcpConfigPath, "utf-8");
    config = JSON.parse(content) as McpConfig;
  });

  it("should have valid JSON schema reference", () => {
    expect(config.$schema).toBeDefined();
    expect(config.$schema).toContain("modelcontextprotocol");
  });

  it("should have mcpServers object", () => {
    expect(config.mcpServers).toBeDefined();
    expect(typeof config.mcpServers).toBe("object");
  });

  describe("Server Configurations", () => {
    it("should have required enabled servers", () => {
      const requiredServers = ["github", "filesystem", "memory", "fetch", "time"];
      for (const server of requiredServers) {
        expect(config.mcpServers[server], `Missing required server: ${server}`).toBeDefined();
        expect(config.mcpServers[server].disabled).not.toBe(true);
      }
    });

    it("each server should have a command", () => {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        expect(serverConfig.command, `Server ${name} missing command`).toBeDefined();
        expect(typeof serverConfig.command).toBe("string");
        expect(serverConfig.command.length).toBeGreaterThan(0);
      }
    });

    it("each server should have a description", () => {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        expect(serverConfig.description, `Server ${name} missing description`).toBeDefined();
        expect(typeof serverConfig.description).toBe("string");
        expect(serverConfig.description.length).toBeGreaterThan(10);
      }
    });

    it("environment variables should use interpolation syntax", () => {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (serverConfig.env) {
          for (const [envKey, envValue] of Object.entries(serverConfig.env)) {
            // Env values should either be literal or use ${VAR} interpolation
            if (envValue.includes("$")) {
              expect(envValue, `Server ${name} env ${envKey} should use \${VAR} syntax`).toMatch(
                /\$\{[A-Z_]+\}/,
              );
            }
          }
        }
      }
    });
  });

  describe("GitHub Server", () => {
    it("should be configured with npx", () => {
      const github = config.mcpServers.github;
      expect(github.command).toBe("npx");
      expect(github.args).toContain("-y");
      expect(github.args?.some((arg) => arg.includes("github"))).toBe(true);
    });

    it("should reference GitHub token environment variable", () => {
      const github = config.mcpServers.github;
      expect(github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBeDefined();
      expect(github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    });
  });

  describe("Filesystem Server", () => {
    it("should include workspace and gimli config paths", () => {
      const fs = config.mcpServers.filesystem;
      expect(fs.args).toBeDefined();
      // Should have workspace folder reference
      expect(fs.args?.some((arg) => arg.includes("workspaceFolder"))).toBe(true);
      // Should have gimli config directory
      expect(fs.args?.some((arg) => arg.includes(".gimli"))).toBe(true);
    });
  });

  describe("Disabled Servers", () => {
    it("optional servers should be explicitly disabled", () => {
      const optionalServers = ["postgres", "brave-search", "slack", "puppeteer"];
      for (const server of optionalServers) {
        if (config.mcpServers[server]) {
          expect(
            config.mcpServers[server].disabled,
            `Optional server ${server} should be disabled by default`,
          ).toBe(true);
        }
      }
    });

    it("disabled servers should still have valid configurations", () => {
      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (serverConfig.disabled) {
          // Even disabled servers need valid config for when they're enabled
          expect(serverConfig.command, `Disabled server ${name} needs command`).toBeDefined();
          expect(
            serverConfig.description,
            `Disabled server ${name} needs description`,
          ).toBeDefined();
        }
      }
    });
  });

  describe("Security", () => {
    it("should not contain hardcoded credentials", () => {
      const configString = JSON.stringify(config);
      // Check for common credential patterns
      expect(configString).not.toMatch(/ghp_[a-zA-Z0-9]{36}/); // GitHub PAT
      expect(configString).not.toMatch(/xoxb-[0-9]+/); // Slack bot token
      expect(configString).not.toMatch(/sk-[a-zA-Z0-9]{48}/); // OpenAI key
      expect(configString).not.toMatch(/postgresql:\/\/[^$]/); // Hardcoded postgres URL
    });

    it("should use environment variable references for sensitive values", () => {
      const sensitiveEnvKeys = ["TOKEN", "KEY", "SECRET", "PASSWORD", "CONNECTION_STRING"];

      for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
        if (serverConfig.env) {
          for (const [envKey, envValue] of Object.entries(serverConfig.env)) {
            const isSensitive = sensitiveEnvKeys.some((key) => envKey.toUpperCase().includes(key));
            if (isSensitive) {
              expect(
                envValue.startsWith("${"),
                `Server ${name} env ${envKey} should use interpolation for sensitive value`,
              ).toBe(true);
            }
          }
        }
      }
    });
  });
});
