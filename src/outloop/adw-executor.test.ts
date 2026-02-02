import { describe, expect, test } from "vitest";
import { buildADWMessage, createGitHubIssueADWPayload } from "./adw-executor.js";

describe("ADW executor helpers", () => {
  describe("buildADWMessage", () => {
    test("replaces single variable", () => {
      const result = buildADWMessage("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    test("replaces multiple variables", () => {
      const result = buildADWMessage("Issue #{{number}}: {{title}}", {
        number: "123",
        title: "Fix bug",
      });
      expect(result).toBe("Issue #123: Fix bug");
    });

    test("replaces multiple occurrences of same variable", () => {
      const result = buildADWMessage("{{name}} said hello, {{name}}!", { name: "Alice" });
      expect(result).toBe("Alice said hello, Alice!");
    });

    test("handles variables with special characters", () => {
      const result = buildADWMessage("URL: {{url}}", {
        url: "https://example.com/path?a=1&b=2",
      });
      expect(result).toBe("URL: https://example.com/path?a=1&b=2");
    });

    test("leaves unreplaced variables as-is", () => {
      const result = buildADWMessage("Hello {{name}}, welcome to {{place}}!", {
        name: "Bob",
      });
      expect(result).toBe("Hello Bob, welcome to {{place}}!");
    });

    test("handles empty variables object", () => {
      const result = buildADWMessage("Static message", {});
      expect(result).toBe("Static message");
    });

    test("handles multiline template", () => {
      const result = buildADWMessage(
        `Issue #{{number}}
Title: {{title}}
Body: {{body}}`,
        {
          number: "42",
          title: "Test Issue",
          body: "This is the body",
        },
      );
      expect(result).toBe(`Issue #42
Title: Test Issue
Body: This is the body`);
    });
  });

  describe("createGitHubIssueADWPayload", () => {
    test("creates payload from basic issue", () => {
      const payload = createGitHubIssueADWPayload({
        number: 123,
        title: "Fix authentication bug",
        body: "Users cannot log in",
        url: "https://github.com/org/repo/issues/123",
      });

      expect(payload.name).toBe("GitHub Issue #123");
      expect(payload.sessionKey).toBe("adw:github:issue:123");
      expect(payload.message).toContain("Issue #123");
      expect(payload.message).toContain("Fix authentication bug");
      expect(payload.message).toContain("Users cannot log in");
      expect(payload.message).toContain("https://github.com/org/repo/issues/123");
      expect(payload.deliver).toBe(false);
      expect(payload.channel).toBe("last");
      expect(payload.wakeMode).toBe("now");
      expect(payload.allowUnsafeExternalContent).toBe(false);
      expect(payload.metadata?.source).toBe("github-issue");
      expect(payload.metadata?.externalId).toBe("123");
    });

    test("handles missing body", () => {
      const payload = createGitHubIssueADWPayload({
        number: 456,
        title: "Empty issue",
        url: "https://github.com/org/repo/issues/456",
      });

      expect(payload.message).toContain("(No description provided)");
    });

    test("includes labels in metadata tags", () => {
      const payload = createGitHubIssueADWPayload({
        number: 789,
        title: "Bug with labels",
        url: "https://github.com/org/repo/issues/789",
        labels: ["bug", "high-priority", "security"],
      });

      expect(payload.metadata?.tags).toEqual(["bug", "high-priority", "security"]);
    });

    test("handles issue without labels", () => {
      const payload = createGitHubIssueADWPayload({
        number: 100,
        title: "No labels",
        url: "https://github.com/org/repo/issues/100",
      });

      expect(payload.metadata?.tags).toBeUndefined();
    });

    test("generates unique session key per issue number", () => {
      const payload1 = createGitHubIssueADWPayload({
        number: 1,
        title: "Issue 1",
        url: "https://github.com/org/repo/issues/1",
      });

      const payload2 = createGitHubIssueADWPayload({
        number: 2,
        title: "Issue 2",
        url: "https://github.com/org/repo/issues/2",
      });

      expect(payload1.sessionKey).not.toBe(payload2.sessionKey);
      expect(payload1.sessionKey).toBe("adw:github:issue:1");
      expect(payload2.sessionKey).toBe("adw:github:issue:2");
    });
  });
});
