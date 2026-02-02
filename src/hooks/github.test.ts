import { describe, expect, it } from "vitest";
import {
  buildEventSummary,
  createGitHubTransform,
  shouldProcessEvent,
  SUPPORTED_GITHUB_EVENTS,
  type GitHubWebhookPayload,
} from "./github.js";
import type { HooksGitHubConfig } from "../config/types.hooks.js";
import type { HookMappingContext } from "../gateway/hooks-mapping.js";

describe("GitHub hook", () => {
  describe("SUPPORTED_GITHUB_EVENTS", () => {
    it("includes expected event types", () => {
      expect(SUPPORTED_GITHUB_EVENTS).toContain("issues");
      expect(SUPPORTED_GITHUB_EVENTS).toContain("pull_request");
      expect(SUPPORTED_GITHUB_EVENTS).toContain("issue_comment");
      expect(SUPPORTED_GITHUB_EVENTS).toContain("push");
      expect(SUPPORTED_GITHUB_EVENTS).toContain("release");
    });
  });

  describe("shouldProcessEvent", () => {
    const basePayload: GitHubWebhookPayload = {
      action: "opened",
      repository: { full_name: "owner/repo" },
      issue: {
        number: 42,
        title: "Test Issue",
        labels: [{ name: "adw:task" }],
      },
    };

    it("returns true when no config is provided", () => {
      expect(shouldProcessEvent(basePayload, "issues")).toBe(true);
    });

    it("filters by event type", () => {
      const config: HooksGitHubConfig = { events: ["issues"] };
      expect(shouldProcessEvent(basePayload, "issues", config)).toBe(true);
      expect(shouldProcessEvent(basePayload, "pull_request", config)).toBe(false);
    });

    it("filters by repository", () => {
      const config: HooksGitHubConfig = { repositories: ["owner/repo"] };
      expect(shouldProcessEvent(basePayload, "issues", config)).toBe(true);

      const otherPayload = { ...basePayload, repository: { full_name: "other/repo" } };
      expect(shouldProcessEvent(otherPayload, "issues", config)).toBe(false);
    });

    it("supports repository wildcards", () => {
      const config: HooksGitHubConfig = { repositories: ["owner/*"] };
      expect(shouldProcessEvent(basePayload, "issues", config)).toBe(true);

      const otherPayload = { ...basePayload, repository: { full_name: "other/repo" } };
      expect(shouldProcessEvent(otherPayload, "issues", config)).toBe(false);
    });

    it("filters by label prefix", () => {
      const config: HooksGitHubConfig = { labelPrefix: "adw:" };
      expect(shouldProcessEvent(basePayload, "issues", config)).toBe(true);

      const noLabelPayload: GitHubWebhookPayload = {
        ...basePayload,
        issue: { ...basePayload.issue, labels: [{ name: "bug" }] },
      };
      expect(shouldProcessEvent(noLabelPayload, "issues", config)).toBe(false);
    });

    it("filters by action", () => {
      const config: HooksGitHubConfig = { actions: ["opened", "labeled"] };
      expect(shouldProcessEvent(basePayload, "issues", config)).toBe(true);

      const closedPayload = { ...basePayload, action: "closed" };
      expect(shouldProcessEvent(closedPayload, "issues", config)).toBe(false);
    });
  });

  describe("buildEventSummary", () => {
    it("builds issue summary", () => {
      const payload: GitHubWebhookPayload = {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 42,
          title: "Test Issue",
          body: "Issue description",
          state: "open",
          user: { login: "testuser" },
          labels: [{ name: "bug" }],
          html_url: "https://github.com/owner/repo/issues/42",
        },
      };

      const result = buildEventSummary(payload, "issues");
      expect(result.sessionKey).toBe("hook:github:owner/repo:issue:42");
      expect(result.name).toBe("GitHub");
      expect(result.message).toContain("Issue opened");
      expect(result.message).toContain("#42: Test Issue");
      expect(result.message).toContain("Issue description");
    });

    it("builds PR summary", () => {
      const payload: GitHubWebhookPayload = {
        action: "opened",
        repository: { full_name: "owner/repo" },
        pull_request: {
          number: 123,
          title: "New Feature",
          body: "PR description",
          state: "open",
          user: { login: "contributor" },
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main" },
          html_url: "https://github.com/owner/repo/pull/123",
        },
      };

      const result = buildEventSummary(payload, "pull_request");
      expect(result.sessionKey).toBe("hook:github:owner/repo:pr:123");
      expect(result.message).toContain("Pull Request opened");
      expect(result.message).toContain("#123: New Feature");
      expect(result.message).toContain("feature-branch → main");
    });

    it("builds comment summary", () => {
      const payload: GitHubWebhookPayload = {
        action: "created",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 42,
          title: "Test Issue",
        },
        comment: {
          id: 999,
          body: "This is a comment",
          user: { login: "commenter" },
          html_url: "https://github.com/owner/repo/issues/42#issuecomment-999",
        },
      };

      const result = buildEventSummary(payload, "issue_comment");
      expect(result.sessionKey).toBe("hook:github:owner/repo:issue:42");
      expect(result.message).toContain("Comment created");
      expect(result.message).toContain("This is a comment");
      expect(result.message).toContain("commenter");
    });

    it("builds push summary", () => {
      const payload: GitHubWebhookPayload = {
        repository: { full_name: "owner/repo" },
        ref: "refs/heads/main",
        commits: [
          { id: "abc1234", message: "First commit", author: { name: "Dev" } },
          { id: "def5678", message: "Second commit", author: { name: "Dev" } },
        ],
      };

      const result = buildEventSummary(payload, "push");
      expect(result.sessionKey).toMatch(/^hook:github:owner\/repo:push:\d+$/);
      expect(result.message).toContain("Push to main");
      expect(result.message).toContain("2 commit(s)");
      expect(result.message).toContain("First commit");
    });

    it("builds release summary", () => {
      const payload: GitHubWebhookPayload = {
        action: "published",
        repository: { full_name: "owner/repo" },
        release: {
          tag_name: "v1.0.0",
          name: "Version 1.0.0",
          body: "Release notes here",
          html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
        },
      };

      const result = buildEventSummary(payload, "release");
      expect(result.sessionKey).toBe("hook:github:owner/repo:release:v1.0.0");
      expect(result.message).toContain("Release published");
      expect(result.message).toContain("Version 1.0.0");
    });

    it("truncates long body content", () => {
      const longBody = "x".repeat(3000);
      const payload: GitHubWebhookPayload = {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 1,
          title: "Long Issue",
          body: longBody,
          state: "open",
        },
      };

      const result = buildEventSummary(payload, "issues");
      expect(result.message).toContain("(truncated)");
      expect(result.message.length).toBeLessThan(3000);
    });
  });

  describe("createGitHubTransform", () => {
    function makeContext(eventType: string, payload: GitHubWebhookPayload): HookMappingContext {
      return {
        payload: payload as unknown as Record<string, unknown>,
        headers: {
          "x-github-event": eventType,
          "x-github-delivery": "test-delivery-id",
        },
        url: new URL("http://localhost/hooks/github"),
        path: "github",
      };
    }

    it("returns null for unsupported events", () => {
      const transform = createGitHubTransform();
      const ctx = makeContext("unknown_event", { action: "test" });
      expect(transform(ctx)).toBeNull();
    });

    it("returns null when event is filtered out", () => {
      const config: HooksGitHubConfig = { events: ["pull_request"] };
      const transform = createGitHubTransform(config);
      const ctx = makeContext("issues", {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: { number: 1, title: "Test" },
      });
      expect(transform(ctx)).toBeNull();
    });

    it("returns event summary for matching events", () => {
      const transform = createGitHubTransform();
      const ctx = makeContext("issues", {
        action: "opened",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 42,
          title: "Test Issue",
          body: "Test body",
          state: "open",
        },
      });

      const result = transform(ctx);
      expect(result).not.toBeNull();
      expect(result?.sessionKey).toBe("hook:github:owner/repo:issue:42");
      expect(result?.message).toContain("Issue opened");
    });

    it("applies label prefix filter", () => {
      const config: HooksGitHubConfig = { labelPrefix: "adw:" };
      const transform = createGitHubTransform(config);

      const withLabel = makeContext("issues", {
        action: "labeled",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 1,
          title: "ADW Task",
          labels: [{ name: "adw:task" }],
        },
      });
      expect(transform(withLabel)).not.toBeNull();

      const withoutLabel = makeContext("issues", {
        action: "labeled",
        repository: { full_name: "owner/repo" },
        issue: {
          number: 2,
          title: "Regular Issue",
          labels: [{ name: "bug" }],
        },
      });
      expect(transform(withoutLabel)).toBeNull();
    });
  });
});
