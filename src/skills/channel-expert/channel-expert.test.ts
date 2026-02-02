import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The skill files are in the skills/ directory, not src/skills/
const skillDir = join(__dirname, "..", "..", "..", "skills", "channel-expert");

describe("Channel Expert Skill", () => {
  describe("SKILL.md", () => {
    const skillPath = join(skillDir, "SKILL.md");

    it("should exist", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    it("should have valid frontmatter", () => {
      const content = readFileSync(skillPath, "utf-8");

      // Check frontmatter markers
      expect(content.startsWith("---")).toBe(true);
      const endMarker = content.indexOf("---", 3);
      expect(endMarker).toBeGreaterThan(3);

      // Parse frontmatter
      const frontmatter = content.slice(3, endMarker).trim();
      const parsed = parseYaml(frontmatter);

      // Validate required fields
      expect(parsed.name).toBe("channel-expert");
      expect(parsed.description).toBeDefined();
      expect(parsed.description.length).toBeGreaterThan(20);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.gimli).toBeDefined();
      expect(parsed.metadata.gimli.emoji).toBeDefined();
    });

    it("should contain required sections", () => {
      const content = readFileSync(skillPath, "utf-8");

      // Core sections
      expect(content).toContain("# Channel Expert");
      expect(content).toContain("## Supported Channels Overview");
      expect(content).toContain("## Architecture");
      expect(content).toContain("## Routing System");
      expect(content).toContain("## Security");
      expect(content).toContain("## Troubleshooting");
    });

    it("should document all core channels", () => {
      const content = readFileSync(skillPath, "utf-8");

      // Core channels
      expect(content).toContain("Telegram");
      expect(content).toContain("WhatsApp");
      expect(content).toContain("Discord");
      expect(content).toContain("Slack");
      expect(content).toContain("Signal");
      expect(content).toContain("iMessage");
      expect(content).toContain("Google Chat");
    });

    it("should document plugin contract", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("ChannelPlugin");
      expect(content).toContain("ChannelId");
      expect(content).toContain("ChannelMeta");
      expect(content).toContain("ChannelCapabilities");
    });

    it("should document capabilities matrix", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("capabilities");
      expect(content).toContain("chatTypes");
      expect(content).toContain("reactions");
      expect(content).toContain("threads");
    });

    it("should document DM policies", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("DM Policies");
      expect(content).toContain("pairing");
      expect(content).toContain("allowlist");
    });

    it("should document pairing commands", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("gimli pairing list");
      expect(content).toContain("gimli pairing approve");
    });

    it("should reference key source files", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("src/channels/registry.ts");
      expect(content).toContain("src/channels/plugins/types.plugin.ts");
      expect(content).toContain("src/routing/resolve-route.ts");
    });

    it("should include quick setup guides", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("## Quick Setup by Channel");
      expect(content).toContain("### Telegram");
      expect(content).toContain("### Discord");
      expect(content).toContain("### WhatsApp");
      expect(content).toContain("### Slack");
    });

    it("should include troubleshooting info", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("gimli doctor");
      expect(content).toContain("gimli channels status");
      expect(content).toContain("--probe");
    });

    it("should document routing system", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("binding.peer");
      expect(content).toContain("binding.guild");
      expect(content).toContain("Session key format");
    });

    it("should document multi-account support", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("## Multi-Account Support");
      expect(content).toContain("accounts");
    });

    it("should include self-improvement section", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("## Self-Improvement");
      expect(content).toContain("When to Resync");
      expect(content).toContain("Source Files to Monitor");
    });
  });

  describe("Expertise YAML files", () => {
    const expertiseDir = join(skillDir, "expertise");

    const expertiseFiles = [
      "architecture.yaml",
      "channels.yaml",
      "security.yaml",
      "troubleshooting.yaml",
    ];

    for (const file of expertiseFiles) {
      describe(file, () => {
        const filePath = join(expertiseDir, file);

        it("should exist", () => {
          expect(existsSync(filePath)).toBe(true);
        });

        it("should be valid YAML", () => {
          const content = readFileSync(filePath, "utf-8");
          expect(() => parseYaml(content)).not.toThrow();
        });

        it("should have required metadata", () => {
          const content = readFileSync(filePath, "utf-8");
          const parsed = parseYaml(content);

          expect(parsed.version).toBeDefined();
          expect(parsed.expert).toBe("channel");
          expect(parsed.domain).toBeDefined();
          expect(parsed.updated_at).toBeDefined();
        });
      });
    }
  });

  describe("architecture.yaml content", () => {
    const filePath = join(skillDir, "expertise", "architecture.yaml");

    it("should document architecture overview", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.architecture).toBeDefined();
      expect(parsed.architecture.description).toBeDefined();
      expect(parsed.architecture.design_principles).toBeDefined();
      expect(parsed.architecture.design_principles.length).toBeGreaterThan(0);
    });

    it("should document plugin contract", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.plugin_contract).toBeDefined();
      expect(parsed.plugin_contract.required_fields).toBeDefined();
      expect(parsed.plugin_contract.optional_adapters).toBeDefined();
    });

    it("should document capabilities", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.capabilities).toBeDefined();
      expect(parsed.capabilities.chat_types).toBeDefined();
      expect(parsed.capabilities.feature_flags).toBeDefined();
      expect(parsed.capabilities.channel_matrix).toBeDefined();
    });

    it("should document routing", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.routing).toBeDefined();
      expect(parsed.routing.resolution_priority).toBeDefined();
      expect(parsed.routing.dm_scope_options).toBeDefined();
    });

    it("should document security model", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.security).toBeDefined();
      expect(parsed.security.dm_policy).toBeDefined();
      expect(parsed.security.group_gating).toBeDefined();
      expect(parsed.security.credentials).toBeDefined();
    });

    it("should document plugin discovery", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.plugin_discovery).toBeDefined();
      expect(parsed.plugin_discovery.sources).toBeDefined();
      expect(parsed.plugin_discovery.bundled_channels).toBeDefined();
      expect(parsed.plugin_discovery.extension_channels).toBeDefined();
    });
  });

  describe("channels.yaml content", () => {
    const filePath = join(skillDir, "expertise", "channels.yaml");

    it("should document core channels", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.core_channels).toBeDefined();
      expect(parsed.core_channels.telegram).toBeDefined();
      expect(parsed.core_channels.whatsapp).toBeDefined();
      expect(parsed.core_channels.discord).toBeDefined();
      expect(parsed.core_channels.slack).toBeDefined();
      expect(parsed.core_channels.signal).toBeDefined();
      expect(parsed.core_channels.imessage).toBeDefined();
    });

    it("should document channel setup steps", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.core_channels.telegram.setup_steps).toBeDefined();
      expect(parsed.core_channels.telegram.setup_steps.length).toBeGreaterThan(0);
    });

    it("should document channel capabilities", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.core_channels.discord.capabilities).toBeDefined();
      expect(parsed.core_channels.discord.capabilities.chatTypes).toBeDefined();
    });

    it("should document channel quirks", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.core_channels.telegram.quirks).toBeDefined();
      expect(parsed.core_channels.telegram.quirks.length).toBeGreaterThan(0);
    });

    it("should document channel troubleshooting", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.core_channels.telegram.troubleshooting).toBeDefined();
      expect(parsed.core_channels.telegram.troubleshooting.length).toBeGreaterThan(0);
    });

    it("should document extension channels", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.extension_channels).toBeDefined();
      expect(parsed.extension_channels.msteams).toBeDefined();
      expect(parsed.extension_channels.matrix).toBeDefined();
    });

    it("should include selection guide", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.selection_guide).toBeDefined();
      expect(parsed.selection_guide.by_priority).toBeDefined();
      expect(parsed.selection_guide.by_feature).toBeDefined();
    });
  });

  describe("security.yaml content", () => {
    const filePath = join(skillDir, "expertise", "security.yaml");

    it("should document DM policies", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.dm_policy).toBeDefined();
      expect(parsed.dm_policy.policies).toBeDefined();
      expect(parsed.dm_policy.policies.pairing).toBeDefined();
      expect(parsed.dm_policy.policies.allowlist).toBeDefined();
      expect(parsed.dm_policy.policies.open).toBeDefined();
    });

    it("should document pairing system", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.pairing).toBeDefined();
      expect(parsed.pairing.commands).toBeDefined();
      expect(parsed.pairing.commands.list).toBeDefined();
      expect(parsed.pairing.commands.approve).toBeDefined();
      expect(parsed.pairing.commands.reject).toBeDefined();
    });

    it("should document allowlists", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.allowlists).toBeDefined();
      expect(parsed.allowlists.types).toBeDefined();
    });

    it("should document group security", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.group_security).toBeDefined();
      expect(parsed.group_security.mention_gating).toBeDefined();
    });

    it("should document credential storage", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.credentials).toBeDefined();
      expect(parsed.credentials.base_directory).toBeDefined();
      expect(parsed.credentials.permissions).toBeDefined();
    });

    it("should document incident response", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.incident_response).toBeDefined();
      expect(parsed.incident_response.token_compromise).toBeDefined();
    });
  });

  describe("troubleshooting.yaml content", () => {
    const filePath = join(skillDir, "expertise", "troubleshooting.yaml");

    it("should document diagnostic commands", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.diagnostics).toBeDefined();
      expect(parsed.diagnostics.primary_commands).toBeDefined();
      expect(parsed.diagnostics.primary_commands.doctor).toBeDefined();
      expect(parsed.diagnostics.primary_commands.channels_status).toBeDefined();
    });

    it("should document common issues", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.issues).toBeDefined();
      expect(parsed.issues.connection).toBeDefined();
      expect(parsed.issues.authentication).toBeDefined();
      expect(parsed.issues.messaging).toBeDefined();
    });

    it("should document platform-specific issues", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.platform_issues).toBeDefined();
      expect(parsed.platform_issues.telegram).toBeDefined();
      expect(parsed.platform_issues.discord).toBeDefined();
      expect(parsed.platform_issues.whatsapp).toBeDefined();
      expect(parsed.platform_issues.slack).toBeDefined();
    });

    it("should document recovery procedures", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.recovery).toBeDefined();
      expect(parsed.recovery.full_reset).toBeDefined();
      expect(parsed.recovery.token_rotation).toBeDefined();
      expect(parsed.recovery.gateway_restart).toBeDefined();
    });

    it("should include debugging tips", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.debugging).toBeDefined();
      expect(parsed.debugging.log_analysis).toBeDefined();
      expect(parsed.debugging.common_gotchas).toBeDefined();
    });
  });
});

describe("Channel Expert Integration", () => {
  it("should reference actual source files that exist", () => {
    const skillPath = join(skillDir, "SKILL.md");
    const content = readFileSync(skillPath, "utf-8");

    // Check that referenced source files should exist
    // (these paths are relative to repo root)
    const referencedFiles = [
      "src/channels/registry.ts",
      "src/channels/plugins/types.plugin.ts",
      "src/channels/plugins/types.core.ts",
      "src/routing/resolve-route.ts",
    ];

    for (const file of referencedFiles) {
      expect(content).toContain(file);
    }
  });

  it("should have consistent channel names across files", () => {
    const channelsPath = join(skillDir, "expertise", "channels.yaml");
    const architecturePath = join(skillDir, "expertise", "architecture.yaml");

    const channelsContent = parseYaml(readFileSync(channelsPath, "utf-8"));
    const architectureContent = parseYaml(readFileSync(architecturePath, "utf-8"));

    // Core channels in channels.yaml
    const coreChannelNames = Object.keys(channelsContent.core_channels);

    // Bundled channels in architecture.yaml
    const bundledChannels = architectureContent.plugin_discovery.bundled_channels;

    // All bundled channels should be documented
    for (const channel of bundledChannels) {
      expect(coreChannelNames).toContain(channel);
    }
  });

  it("expertise files should use same version format", () => {
    const expertiseDir = join(skillDir, "expertise");
    const files = ["architecture.yaml", "channels.yaml", "security.yaml", "troubleshooting.yaml"];

    for (const file of files) {
      const content = parseYaml(readFileSync(join(expertiseDir, file), "utf-8"));
      expect(content.version).toBe("1.0");
      expect(content.expert).toBe("channel");
    }
  });
});
