import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
// The skill files are in the skills/ directory, not src/skills/
const skillDir = join(__dirname, "..", "..", "..", "skills", "gateway-expert");

describe("Gateway Expert Skill", () => {
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
      expect(parsed.name).toBe("gateway-expert");
      expect(parsed.description).toBeDefined();
      expect(parsed.description.length).toBeGreaterThan(20);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.gimli).toBeDefined();
      expect(parsed.metadata.gimli.emoji).toBeDefined();
    });

    it("should contain required sections", () => {
      const content = readFileSync(skillPath, "utf-8");

      // Core sections
      expect(content).toContain("# Gateway Expert");
      expect(content).toContain("## When to Load This Expert");
      expect(content).toContain("## Core Mental Models");
      expect(content).toContain("## Key Files");
      expect(content).toContain("## Common Patterns");
      expect(content).toContain("## Debugging Tips");
      expect(content).toContain("## RPC Methods Reference");
    });

    it("should document Gateway Architecture", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("### Gateway Architecture");
      expect(content).toContain("WebSocket");
      expect(content).toContain("Protocol Layer");
      expect(content).toContain("Session Manager");
      expect(content).toContain("Channel Router");
    });

    it("should document Connection Lifecycle", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("### Connection Lifecycle");
      expect(content).toContain("connect.challenge");
      expect(content).toContain("HelloOk");
    });

    it("should document Protocol Frames", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("### Protocol Frames");
      expect(content).toContain("RequestFrame");
      expect(content).toContain("ResponseFrame");
      expect(content).toContain("EventFrame");
    });

    it("should document Session Key Anatomy", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("### Session Key Anatomy");
      expect(content).toContain("agent:<agentId>");
      expect(content).toContain("group");
      expect(content).toContain("channel");
    });

    it("should document Channel Capabilities", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("### Channel Capabilities");
      expect(content).toContain("ChannelCapabilities");
      expect(content).toContain("chatTypes");
    });

    it("should reference key source files", () => {
      const content = readFileSync(skillPath, "utf-8");

      // Gateway core files
      expect(content).toContain("src/gateway/client.ts");
      expect(content).toContain("src/gateway/protocol/");
      expect(content).toContain("src/gateway/session-utils.ts");

      // Channel files
      expect(content).toContain("src/channels/dock.ts");
      expect(content).toContain("src/channels/registry.ts");
    });

    it("should include CLI commands", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("## CLI Commands");
      expect(content).toContain("gimli gateway");
      expect(content).toContain("gimli sessions");
      expect(content).toContain("gimli channels");
      expect(content).toContain("gimli doctor");
    });

    it("should include security considerations", () => {
      const content = readFileSync(skillPath, "utf-8");

      expect(content).toContain("## Security Considerations");
      expect(content).toContain("loopback");
      expect(content).toContain("pairing");
      expect(content).toContain("sandbox");
    });
  });

  describe("Expertise YAML files", () => {
    const expertiseDir = join(skillDir, "expertise");

    const expertiseFiles = [
      "protocol.yaml",
      "sessions.yaml",
      "channels.yaml",
      "authentication.yaml",
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
          expect(parsed.domain).toBeDefined();
          expect(parsed.updated).toBeDefined();
          expect(parsed.mental_model).toBeDefined();
          expect(parsed.mental_model.name).toBeDefined();
          expect(parsed.mental_model.description).toBeDefined();
        });
      });
    }
  });

  describe("protocol.yaml content", () => {
    const filePath = join(skillDir, "expertise", "protocol.yaml");

    it("should document frame types", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.frame_types).toBeDefined();
      expect(parsed.frame_types.request).toBeDefined();
      expect(parsed.frame_types.response).toBeDefined();
      expect(parsed.frame_types.event).toBeDefined();
    });

    it("should document connection flow", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.connection_flow).toBeDefined();
      expect(parsed.connection_flow.steps).toBeDefined();
      expect(parsed.connection_flow.steps.length).toBeGreaterThan(0);
    });

    it("should document error codes", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.error_codes).toBeDefined();
      expect(parsed.error_codes.common).toBeDefined();
      expect(parsed.error_codes.common.length).toBeGreaterThan(0);
    });

    it("should include troubleshooting", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.troubleshooting).toBeDefined();
    });
  });

  describe("sessions.yaml content", () => {
    const filePath = join(skillDir, "expertise", "sessions.yaml");

    it("should document session key anatomy", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.session_key_anatomy).toBeDefined();
      expect(parsed.session_key_anatomy.formats).toBeDefined();
    });

    it("should document session scopes", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.session_scopes).toBeDefined();
      expect(parsed.session_scopes.per_sender).toBeDefined();
      expect(parsed.session_scopes.per_agent).toBeDefined();
    });

    it("should document RPC methods", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.rpc_methods).toBeDefined();
      expect(parsed.rpc_methods["sessions.list"]).toBeDefined();
      expect(parsed.rpc_methods["sessions.reset"]).toBeDefined();
    });

    it("should document agent tools", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.agent_tools).toBeDefined();
      expect(parsed.agent_tools.sessions_list).toBeDefined();
      expect(parsed.agent_tools.sessions_spawn).toBeDefined();
    });
  });

  describe("channels.yaml content", () => {
    const filePath = join(skillDir, "expertise", "channels.yaml");

    it("should document channel types", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.channel_types).toBeDefined();
      expect(parsed.channel_types.core_channels).toBeDefined();
      expect(parsed.channel_types.core_channels.length).toBeGreaterThan(0);
    });

    it("should document channel capabilities", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.channel_capabilities).toBeDefined();
      expect(parsed.channel_capabilities.examples).toBeDefined();
    });

    it("should document routing", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.routing).toBeDefined();
      expect(parsed.routing.message_flow).toBeDefined();
    });

    it("should document allowlist", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.allowlist).toBeDefined();
      expect(parsed.allowlist.formats).toBeDefined();
    });

    it("should document DM pairing", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.dm_pairing).toBeDefined();
      expect(parsed.dm_pairing.flow).toBeDefined();
    });
  });

  describe("authentication.yaml content", () => {
    const filePath = join(skillDir, "expertise", "authentication.yaml");

    it("should document device identity", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.device_identity).toBeDefined();
      expect(parsed.device_identity.keypair).toBeDefined();
      expect(parsed.device_identity.keypair.algorithm).toBe("Ed25519");
    });

    it("should document challenge-response", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.challenge_response).toBeDefined();
      expect(parsed.challenge_response.flow).toBeDefined();
    });

    it("should document token management", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.token_management).toBeDefined();
      expect(parsed.token_management.token_rotation).toBeDefined();
      expect(parsed.token_management.token_revocation).toBeDefined();
    });

    it("should document pairing", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.pairing).toBeDefined();
      expect(parsed.pairing.dm_policy).toBeDefined();
      expect(parsed.pairing.pairing_flow).toBeDefined();
    });

    it("should document roles and scopes", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.roles_and_scopes).toBeDefined();
      expect(parsed.roles_and_scopes.roles).toBeDefined();
      expect(parsed.roles_and_scopes.scopes).toBeDefined();
    });
  });

  describe("troubleshooting.yaml content", () => {
    const filePath = join(skillDir, "expertise", "troubleshooting.yaml");

    it("should document diagnostic commands", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.diagnostic_commands).toBeDefined();
      expect(parsed.diagnostic_commands.gateway_health).toBeDefined();
      expect(parsed.diagnostic_commands.connection_diagnostics).toBeDefined();
    });

    it("should document common issues", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.common_issues).toBeDefined();
      expect(parsed.common_issues.connection_refused).toBeDefined();
      expect(parsed.common_issues.authentication_failed).toBeDefined();
      expect(parsed.common_issues.session_not_found).toBeDefined();
      expect(parsed.common_issues.channel_not_connecting).toBeDefined();
    });

    it("should document debugging patterns", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.debugging_patterns).toBeDefined();
      expect(parsed.debugging_patterns.connection_debugging).toBeDefined();
      expect(parsed.debugging_patterns.session_debugging).toBeDefined();
    });

    it("should document escalation path", () => {
      const content = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(content);

      expect(parsed.escalation_path).toBeDefined();
      expect(parsed.escalation_path.level_1).toBeDefined();
      expect(parsed.escalation_path.level_4).toBeDefined();
    });
  });
});
