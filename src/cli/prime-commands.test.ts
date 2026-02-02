import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIME_COMMANDS_PATH = path.resolve(__dirname, "../../.claude/prime-commands.md");

describe("Prime Commands Documentation", () => {
  const content = fs.readFileSync(PRIME_COMMANDS_PATH, "utf-8");

  it("should exist and be readable", () => {
    expect(fs.existsSync(PRIME_COMMANDS_PATH)).toBe(true);
    expect(content.length).toBeGreaterThan(1000);
  });

  it("should have required sections", () => {
    const requiredSections = [
      "# Prime Commands Reference",
      "## Quick Reference",
      "## Agent Operations",
      "## System Status",
      "## Configuration",
      "## Gateway",
      "## Channels",
      "## Messaging",
      "## Memory",
      "## Sessions",
      "## Logs",
      "## Models",
      "## Automation",
      "## Browser",
      "## Skills",
      "## Command Patterns",
      "## Common Workflows",
    ];

    for (const section of requiredSections) {
      expect(content).toContain(section);
    }
  });

  it("should document core agent commands", () => {
    expect(content).toContain("`gimli agent`");
    expect(content).toContain("--message");
    expect(content).toContain("--agent");
    expect(content).toContain("--thinking");
    expect(content).toContain("`gimli agents list`");
  });

  it("should document status and health commands", () => {
    expect(content).toContain("`gimli status`");
    expect(content).toContain("--all");
    expect(content).toContain("--deep");
    expect(content).toContain("`gimli health`");
    expect(content).toContain("`gimli doctor`");
  });

  it("should document configuration commands", () => {
    expect(content).toContain("`gimli config get`");
    expect(content).toContain("`gimli config set`");
    expect(content).toContain("gateway.mode");
    expect(content).toContain("gateway.port");
  });

  it("should document gateway commands", () => {
    expect(content).toContain("`gimli gateway run`");
    expect(content).toContain("--port");
    expect(content).toContain("--bind loopback");
  });

  it("should document channel commands", () => {
    expect(content).toContain("`gimli channels status`");
    expect(content).toContain("--probe");
    expect(content).toContain("`gimli channels list`");
  });

  it("should document messaging commands", () => {
    expect(content).toContain("`gimli message send`");
    expect(content).toContain("--target");
    expect(content).toContain("--channel");
    expect(content).toContain("whatsapp");
    expect(content).toContain("discord");
    expect(content).toContain("slack");
    expect(content).toContain("telegram");
  });

  it("should document memory commands", () => {
    expect(content).toContain("`gimli memory search`");
    expect(content).toContain("`gimli memory status`");
    expect(content).toContain("--max-results");
  });

  it("should document session commands", () => {
    expect(content).toContain("`gimli sessions`");
    expect(content).toContain("--active");
  });

  it("should document log commands", () => {
    expect(content).toContain("`gimli logs`");
    expect(content).toContain("--follow");
    expect(content).toContain("--level");
  });

  it("should document model commands", () => {
    expect(content).toContain("`gimli models list`");
    expect(content).toContain("`gimli models set`");
  });

  it("should document cron commands", () => {
    expect(content).toContain("`gimli cron list`");
    expect(content).toContain("`gimli cron add`");
    expect(content).toContain("--schedule");
  });

  it("should document browser commands", () => {
    expect(content).toContain("`gimli browser snapshot`");
    expect(content).toContain("`gimli browser tabs`");
  });

  it("should document skills commands", () => {
    expect(content).toContain("`gimli skills list`");
  });

  it("should document upstream commands", () => {
    expect(content).toContain("`gimli upstream check`");
    expect(content).toContain("`gimli upstream preview`");
  });

  it("should have JSON output pattern documentation", () => {
    expect(content).toContain("--json");
    expect(content).toContain("JSON Output");
    expect(content).toContain("jq");
  });

  it("should have verbose/debug pattern documentation", () => {
    expect(content).toContain("--verbose");
    expect(content).toContain("--debug");
    expect(content).toContain("Verbose/Debug Mode");
  });

  it("should have timeout pattern documentation", () => {
    expect(content).toContain("--timeout");
    expect(content).toContain("Timeout Control");
  });

  it("should have common workflow examples", () => {
    expect(content).toContain("Initial Setup Verification");
    expect(content).toContain("Debugging Channel Issues");
    expect(content).toContain("Agent Development");
    expect(content).toContain("Monitoring");
  });

  it("should document environment variables", () => {
    expect(content).toContain("Environment Variables");
    expect(content).toContain("ANTHROPIC_API_KEY");
    expect(content).toContain("GIMLI_STATE_DIR");
  });

  it("should document exit codes", () => {
    expect(content).toContain("Exit Codes");
    expect(content).toContain("| 0 |");
    expect(content).toContain("| 1 |");
  });

  it("should have docs links", () => {
    expect(content).toContain("https://docs.gimli.bot");
  });

  it("should have approximately 20 prime commands in the quick reference", () => {
    // Count commands by looking for backtick-wrapped gimli commands in the quick reference table
    const quickRefSection = content.split("## Quick Reference")[1]?.split("\n\n---")[0] ?? "";
    const commandMatches = quickRefSection.match(/`gimli [^`]+`/g) ?? [];
    // Should have approximately 18-25 commands in quick reference
    expect(commandMatches.length).toBeGreaterThanOrEqual(15);
    expect(commandMatches.length).toBeLessThanOrEqual(25);
  });
});
