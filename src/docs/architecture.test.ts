/**
 * Architecture Documentation Accuracy Tests
 *
 * These tests verify that the paths and structures documented in ARCHITECTURE.md
 * actually exist in the codebase. This helps ensure documentation stays accurate
 * as the codebase evolves.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "../..");

describe("ARCHITECTURE.md accuracy", () => {
  describe("Core source directories exist", () => {
    const coreDirectories = [
      "src/agents",
      "src/channels",
      "src/cli",
      "src/commands",
      "src/config",
      "src/gateway",
      "src/hooks",
      "src/infra",
      "src/media",
      "src/plugins",
      "src/plugin-sdk",
      "src/routing",
      "src/terminal",
      "src/web",
      "src/telegram",
      "src/discord",
      "src/slack",
      "src/signal",
      "src/imessage",
    ];

    for (const dir of coreDirectories) {
      it(`${dir}/ exists`, () => {
        expect(existsSync(join(projectRoot, dir))).toBe(true);
      });
    }
  });

  describe("Key entry point files exist", () => {
    const entryFiles = [
      "src/entry.ts",
      "src/index.ts",
      "src/cli/run-main.ts",
      "src/cli/program.ts",
      "src/cli/deps.ts",
    ];

    for (const file of entryFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Plugin system files exist", () => {
    const pluginFiles = [
      "src/plugins/discovery.ts",
      "src/plugins/loader.ts",
      "src/plugins/registry.ts",
      "src/plugins/runtime.ts",
      "src/plugins/types.ts",
    ];

    for (const file of pluginFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Channel plugin types exist", () => {
    const channelFiles = ["src/channels/plugins/types.ts", "src/channels/registry.ts"];

    for (const file of channelFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Configuration system files exist", () => {
    const configFiles = ["src/config/config.ts", "src/config/io.ts"];

    for (const file of configFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Gateway files exist", () => {
    const gatewayFiles = [
      "src/gateway/server.ts",
      "src/gateway/server-chat.ts",
      "src/gateway/control-ui.ts",
    ];

    for (const file of gatewayFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Agent tool files exist", () => {
    it("src/agents/ contains gimli-tools files", () => {
      const agentsDir = join(projectRoot, "src/agents");
      if (existsSync(agentsDir)) {
        const files = readdirSync(agentsDir);
        const toolFiles = files.filter((f) => f.startsWith("gimli-tools"));
        expect(toolFiles.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Extensions directory structure", () => {
    it("extensions/ directory exists", () => {
      expect(existsSync(join(projectRoot, "extensions"))).toBe(true);
    });

    it("extensions/ contains channel plugins", () => {
      const extensionsDir = join(projectRoot, "extensions");
      if (existsSync(extensionsDir)) {
        const extensions = readdirSync(extensionsDir);
        // Should have multiple extensions
        expect(extensions.length).toBeGreaterThan(5);
      }
    });
  });

  describe("App directories exist", () => {
    const appDirs = ["apps/macos", "apps/ios", "apps/android"];

    for (const dir of appDirs) {
      it(`${dir}/ exists`, () => {
        expect(existsSync(join(projectRoot, dir))).toBe(true);
      });
    }
  });

  describe("Terminal utilities exist", () => {
    const terminalFiles = ["src/terminal/table.ts", "src/terminal/palette.ts"];

    for (const file of terminalFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("CLI progress utilities exist", () => {
    it("src/cli/progress.ts exists", () => {
      expect(existsSync(join(projectRoot, "src/cli/progress.ts"))).toBe(true);
    });
  });

  describe("Infrastructure utilities exist", () => {
    const infraFiles = [
      "src/infra/dotenv.ts",
      "src/infra/errors.ts",
      "src/infra/exec-approvals.ts",
    ];

    for (const file of infraFiles) {
      it(`${file} exists`, () => {
        expect(existsSync(join(projectRoot, file))).toBe(true);
      });
    }
  });

  describe("Documentation structure", () => {
    it("docs/ directory exists", () => {
      expect(existsSync(join(projectRoot, "docs"))).toBe(true);
    });

    it("docs/channels/ exists for channel documentation", () => {
      expect(existsSync(join(projectRoot, "docs/channels"))).toBe(true);
    });
  });

  describe("UI directory exists", () => {
    it("ui/ control dashboard exists", () => {
      expect(existsSync(join(projectRoot, "ui"))).toBe(true);
    });
  });

  describe("Scripts directory exists", () => {
    it("scripts/ directory exists", () => {
      expect(existsSync(join(projectRoot, "scripts"))).toBe(true);
    });
  });

  describe("Test utilities exist", () => {
    it("test/ directory exists", () => {
      expect(existsSync(join(projectRoot, "test"))).toBe(true);
    });
  });

  describe("Zod schema files exist", () => {
    it("src/config/ contains zod-schema files", () => {
      const configDir = join(projectRoot, "src/config");
      if (existsSync(configDir)) {
        const files = readdirSync(configDir);
        const schemaFiles = files.filter((f) => f.startsWith("zod-schema"));
        expect(schemaFiles.length).toBeGreaterThan(0);
      }
    });
  });
});
