import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearExpertCache,
  formatExpertContext,
  getAuthGuidance,
  getCodeReferences,
  getDecisionPattern,
  getMentalModel,
  getPitfalls,
  getSandboxingGuidance,
  getSecurityPhilosophy,
  getThreatModel,
  listDecisionPatterns,
  listExperts,
  loadExpert,
  queryExpert,
  setExpertsDir,
  type AgentExpert,
  type ExpertDomain,
} from "./agent-experts.js";

let testDir: string;
let expertsDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-experts-test-"));
  expertsDir = path.join(testDir, "ralphy", "experts");
  await fs.mkdir(expertsDir, { recursive: true });
  setExpertsDir(expertsDir);
  clearExpertCache();
});

afterEach(async () => {
  setExpertsDir(null);
  clearExpertCache();
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

const sampleSecurityExpert: AgentExpert = {
  name: "security-expert",
  domain: "security",
  version: "1.0.0",
  updated: "2026-02-02",
  description: "Security expert knowledge for Gimli",
  mental_model: {
    philosophy: "Gimli's security follows a defense in depth model with five distinct layers.",
    principle: "Access control before intelligence - limit blast radius, not model capabilities",
    five_layers: [
      {
        name: "Identity Layer",
        purpose: "Control WHO can communicate with Gimli",
        mechanisms: ["DM pairing", "Channel allowlists"],
        config_keys: ["channels.<channel>.dmPolicy"],
        critical_files: ["src/pairing/pairing-store.ts"],
      },
      {
        name: "Sandbox Layer",
        purpose: "Contain blast radius of untrusted code",
        mechanisms: ["Docker-based sandboxing", "Network isolation"],
        config_keys: ["agents.defaults.sandbox.mode"],
        critical_files: ["src/agents/sandbox/*.ts"],
      },
    ],
  },
  authentication: {
    gateway_auth: {
      description: "HTTP/WebSocket authentication to the Gimli gateway",
      modes: {
        token: {
          description: "Bearer token authentication",
          config: "gateway.auth.token",
        },
        password: {
          description: "Hashed password authentication",
          config: "GIMLI_GATEWAY_PASSWORD env",
        },
      },
    },
    dm_pairing: {
      description: "Identity verification for messaging channel DMs",
      default_policy: "pairing",
    },
  },
  sandboxing: {
    docker_sandbox: {
      description: "Container-based isolation",
      modes: {
        off: "No sandboxing",
        "non-main": "Sandbox all non-main sessions",
        all: "Sandbox everything",
      },
    },
  },
  decision_patterns: {
    new_channel_integration: {
      name: "New Channel Integration",
      steps: [
        'Set dmPolicy to "pairing" by default',
        "Configure allowFrom for known senders",
        "Set groupPolicy appropriately",
        "Document security implications",
      ],
    },
    handling_credentials: {
      name: "Handling Credentials",
      steps: [
        "Store in ~/.gimli/credentials/ or agent-specific paths",
        "Set file permissions to 0600 (files) or 0700 (dirs)",
        "Use atomic writes with proper-lockfile",
        "Enable redaction in logging",
      ],
    },
  },
  pitfalls: [
    {
      name: "World-readable credentials",
      symptom: "gimli security audit reports file permission issues",
      cause: "Credentials created without proper umask",
      fix: "Run gimli security audit --fix",
      prevention: "Always create credential files with 0600 mode",
    },
    {
      name: "Open DM policy on multi-user",
      symptom: "Multiple users accessing same session context",
      cause: 'dmPolicy="open" without dmScope consideration',
      fix: 'Set dmScope="session" for isolation',
      prevention: "Use pairing policy by default",
    },
  ],
  code_references: {
    authentication: {
      gateway_auth: "src/gateway/auth.ts",
      device_auth: "src/infra/device-auth-store.ts",
    },
    access_control: {
      dm_pairing: "src/pairing/pairing-store.ts",
      tool_policy: "src/agents/tool-policy.ts",
    },
    sandboxing: {
      sandbox_core: "src/agents/sandbox/*.ts",
    },
  },
  threat_model: {
    attack_vectors_addressed: {
      prompt_injection: {
        mitigations: ["DM pairing", "Mention gating", "Sandboxing"],
      },
    },
  },
};

async function writeExpertFile(domain: ExpertDomain, content: AgentExpert): Promise<void> {
  const filePath = path.join(expertsDir, `${domain}-expert.yaml`);
  await fs.writeFile(filePath, YAML.stringify(content), "utf8");
}

describe("loadExpert", () => {
  it("returns null when expert file does not exist", async () => {
    const result = await loadExpert("security");
    expect(result).toBeNull();
  });

  it("loads and parses expert from YAML file", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await loadExpert("security");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("security-expert");
    expect(result!.domain).toBe("security");
    expect(result!.version).toBe("1.0.0");
  });

  it("caches loaded expert for subsequent calls", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const first = await loadExpert("security");
    const second = await loadExpert("security");

    expect(first).toBe(second); // Same reference
  });

  it("returns null for invalid YAML", async () => {
    const filePath = path.join(expertsDir, "security-expert.yaml");
    await fs.writeFile(filePath, "not: valid: yaml: {{{{", "utf8");

    const result = await loadExpert("security");
    expect(result).toBeNull();
  });

  it("returns null for YAML missing required fields", async () => {
    const filePath = path.join(expertsDir, "security-expert.yaml");
    await fs.writeFile(filePath, "name: test\n", "utf8");

    const result = await loadExpert("security");
    expect(result).toBeNull();
  });
});

describe("listExperts", () => {
  it("returns empty array when no experts exist", async () => {
    const result = await listExperts();
    expect(result).toEqual([]);
  });

  it("lists available expert domains", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const gatewayExpert = { ...sampleSecurityExpert, name: "gateway-expert", domain: "gateway" };
    await writeExpertFile("gateway", gatewayExpert as AgentExpert);

    const result = await listExperts();

    expect(result).toContain("security");
    expect(result).toContain("gateway");
    expect(result.length).toBe(2);
  });

  it("only lists files matching *-expert.yaml pattern", async () => {
    await writeExpertFile("security", sampleSecurityExpert);
    await fs.writeFile(path.join(expertsDir, "notes.yaml"), "test: true", "utf8");
    await fs.writeFile(path.join(expertsDir, "readme.md"), "# Readme", "utf8");

    const result = await listExperts();

    expect(result).toEqual(["security"]);
  });
});

describe("getMentalModel", () => {
  it("returns null when expert not found", async () => {
    const result = await getMentalModel("security");
    expect(result).toBeNull();
  });

  it("returns mental model from expert", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getMentalModel("security");

    expect(result).not.toBeNull();
    expect(result!.philosophy).toContain("defense in depth");
    expect(result!.principle).toContain("Access control before intelligence");
    expect(result!.five_layers).toHaveLength(2);
  });
});

describe("getDecisionPattern", () => {
  it("returns null when expert not found", async () => {
    const result = await getDecisionPattern("security", "new_channel_integration");
    expect(result).toBeNull();
  });

  it("returns decision pattern by name", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getDecisionPattern("security", "new_channel_integration");

    expect(result).not.toBeNull();
    expect(result!.name).toBe("New Channel Integration");
    expect(result!.steps).toHaveLength(4);
    expect(result!.steps[0]).toContain("dmPolicy");
  });

  it("normalizes pattern name with spaces and dashes", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result1 = await getDecisionPattern("security", "handling credentials");
    const result2 = await getDecisionPattern("security", "handling-credentials");
    const result3 = await getDecisionPattern("security", "HANDLING_CREDENTIALS");

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result3).not.toBeNull();
    expect(result1!.name).toBe(result2!.name);
    expect(result2!.name).toBe(result3!.name);
  });

  it("returns null for non-existent pattern", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getDecisionPattern("security", "non_existent_pattern");
    expect(result).toBeNull();
  });
});

describe("listDecisionPatterns", () => {
  it("returns empty array when expert not found", async () => {
    const result = await listDecisionPatterns("security");
    expect(result).toEqual([]);
  });

  it("lists all decision pattern names", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await listDecisionPatterns("security");

    expect(result).toContain("new_channel_integration");
    expect(result).toContain("handling_credentials");
    expect(result.length).toBe(2);
  });
});

describe("getPitfalls", () => {
  it("returns empty array when expert not found", async () => {
    const result = await getPitfalls("security");
    expect(result).toEqual([]);
  });

  it("returns pitfalls from expert", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getPitfalls("security");

    expect(result.length).toBe(2);
    expect(result[0].name).toBe("World-readable credentials");
    expect(result[0].fix).toContain("gimli security audit --fix");
    expect(result[1].name).toBe("Open DM policy on multi-user");
  });
});

describe("getCodeReferences", () => {
  it("returns empty object when expert not found", async () => {
    const result = await getCodeReferences("security");
    expect(result).toEqual({});
  });

  it("returns all code references when no category specified", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getCodeReferences("security");

    expect(result).toHaveProperty("gateway_auth", "src/gateway/auth.ts");
    expect(result).toHaveProperty("dm_pairing", "src/pairing/pairing-store.ts");
    expect(result).toHaveProperty("sandbox_core", "src/agents/sandbox/*.ts");
  });

  it("returns only specified category when provided", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getCodeReferences("security", "authentication");

    expect(result).toHaveProperty("gateway_auth");
    expect(result).toHaveProperty("device_auth");
    expect(result).not.toHaveProperty("dm_pairing");
  });

  it("returns empty object for non-existent category", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getCodeReferences("security", "nonexistent");
    expect(result).toEqual({});
  });
});

describe("queryExpert", () => {
  it("returns null when expert not found", async () => {
    const result = await queryExpert("security", "authentication");
    expect(result).toBeNull();
  });

  it("finds content matching topic in mental model", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await queryExpert("security", "defense");

    expect(result).not.toBeNull();
    expect(result!.relevantContent).toContain("Philosophy:");
    expect(result!.relevantContent).toContain("defense in depth");
  });

  it("finds matching security layers", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await queryExpert("security", "sandbox");

    expect(result).not.toBeNull();
    expect(result!.relevantContent).toContain("Sandbox Layer");
    expect(result!.relevantContent).toContain("blast radius");
    expect(result!.codeReferences).toContain("src/agents/sandbox/*.ts");
  });

  it("finds matching decision patterns", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await queryExpert("security", "channel");

    expect(result).not.toBeNull();
    expect(result!.relatedPatterns).toContain("new_channel_integration");
  });

  it("finds matching pitfalls", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await queryExpert("security", "permission");

    expect(result).not.toBeNull();
    expect(result!.relevantContent).toContain("World-readable credentials");
    expect(result!.relevantContent).toContain("gimli security audit --fix");
  });

  it("deduplicates code references", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await queryExpert("security", "pairing");

    expect(result).not.toBeNull();
    const uniqueRefs = new Set(result!.codeReferences);
    expect(result!.codeReferences.length).toBe(uniqueRefs.size);
  });
});

describe("getSecurityPhilosophy", () => {
  it("returns null when security expert not found", async () => {
    const result = await getSecurityPhilosophy();
    expect(result).toBeNull();
  });

  it("returns philosophy and principle", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getSecurityPhilosophy();

    expect(result).not.toBeNull();
    expect(result!.philosophy).toContain("defense in depth");
    expect(result!.principle).toContain("Access control before intelligence");
  });
});

describe("getAuthGuidance", () => {
  it("returns null when security expert not found", async () => {
    const result = await getAuthGuidance("gateway_auth");
    expect(result).toBeNull();
  });

  it("returns authentication guidance by type", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getAuthGuidance("gateway_auth");

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("description");
    expect(result).toHaveProperty("modes");
  });

  it("normalizes auth type name", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result1 = await getAuthGuidance("dm pairing");
    const result2 = await getAuthGuidance("dm-pairing");

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  it("returns null for non-existent auth type", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getAuthGuidance("nonexistent");
    expect(result).toBeNull();
  });
});

describe("getSandboxingGuidance", () => {
  it("returns null when security expert not found", async () => {
    const result = await getSandboxingGuidance();
    expect(result).toBeNull();
  });

  it("returns sandboxing configuration guidance", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getSandboxingGuidance();

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("docker_sandbox");
  });
});

describe("getThreatModel", () => {
  it("returns null when security expert not found", async () => {
    const result = await getThreatModel();
    expect(result).toBeNull();
  });

  it("returns threat model information", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await getThreatModel();

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("attack_vectors_addressed");
  });
});

describe("formatExpertContext", () => {
  it("returns empty string when expert not found", async () => {
    const result = await formatExpertContext("security");
    expect(result).toBe("");
  });

  it("formats expert knowledge for agent prompt", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await formatExpertContext("security");

    expect(result).toContain("# security-expert Mental Model");
    expect(result).toContain("**Philosophy:**");
    expect(result).toContain("**Core Principle:**");
    expect(result).toContain("## Common Pitfalls");
  });

  it("includes relevant decision patterns when topics provided", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const result = await formatExpertContext("security", ["handling_credentials"]);

    expect(result).toContain("## Relevant Decision Patterns");
    expect(result).toContain("### Handling Credentials");
    expect(result).toContain("1. Store in ~/.gimli/credentials/");
  });

  it("limits pitfalls to 5 items", async () => {
    const expertWithManyPitfalls = {
      ...sampleSecurityExpert,
      pitfalls: Array.from({ length: 10 }, (_, i) => ({
        name: `Pitfall ${i + 1}`,
        symptom: "Symptom",
        cause: "Cause",
        fix: "Fix",
        prevention: "Prevention",
      })),
    };
    await writeExpertFile("security", expertWithManyPitfalls);

    const result = await formatExpertContext("security");

    const pitfallMatches = result.match(/\*\*Pitfall \d+\*\*/g);
    expect(pitfallMatches?.length).toBe(5);
  });
});

describe("clearExpertCache", () => {
  it("clears cached experts", async () => {
    await writeExpertFile("security", sampleSecurityExpert);

    const first = await loadExpert("security");
    clearExpertCache();

    // Modify the file
    const modified = { ...sampleSecurityExpert, version: "2.0.0" };
    await writeExpertFile("security", modified);

    const second = await loadExpert("security");

    expect(first!.version).toBe("1.0.0");
    expect(second!.version).toBe("2.0.0");
  });
});
