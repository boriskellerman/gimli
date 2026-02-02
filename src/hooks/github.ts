import { createHmac, timingSafeEqual } from "node:crypto";

import type { HooksGitHubConfig, GitHubEventType } from "../config/types.hooks.js";
import type { HookMappingContext } from "../gateway/hooks-mapping.js";

// GitHub webhook event types supported for ADW triggers
export const SUPPORTED_GITHUB_EVENTS: GitHubEventType[] = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "create",
  "delete",
  "release",
];

export type GitHubWebhookPayload = {
  action?: string;
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string };
  };
  sender?: { login?: string };
  issue?: {
    number?: number;
    title?: string;
    body?: string;
    state?: string;
    user?: { login?: string };
    labels?: Array<{ name?: string }>;
    html_url?: string;
  };
  pull_request?: {
    number?: number;
    title?: string;
    body?: string;
    state?: string;
    user?: { login?: string };
    labels?: Array<{ name?: string }>;
    html_url?: string;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
    merged?: boolean;
    draft?: boolean;
  };
  comment?: {
    id?: number;
    body?: string;
    user?: { login?: string };
    html_url?: string;
  };
  review?: {
    id?: number;
    body?: string;
    state?: string;
    user?: { login?: string };
    html_url?: string;
  };
  ref?: string;
  ref_type?: string;
  release?: {
    tag_name?: string;
    name?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    html_url?: string;
  };
  commits?: Array<{
    id?: string;
    message?: string;
    author?: { name?: string; email?: string };
  }>;
};

export type GitHubTransformResult = {
  message: string;
  sessionKey: string;
  name: string;
} | null;

/**
 * Verify GitHub webhook signature using X-Hub-Signature-256 header.
 * Uses HMAC-SHA256 and timing-safe comparison to prevent timing attacks.
 */
export function verifyGitHubSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  // GitHub signature format: sha256=<hex>
  const match = signature.match(/^sha256=([a-fA-F0-9]+)$/);
  if (!match) return false;
  const receivedSig = match[1];

  const expectedSig = createHmac("sha256", secret).update(payload).digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(receivedSig, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

/**
 * Check if the webhook event should be processed based on config filters.
 */
export function shouldProcessEvent(
  payload: GitHubWebhookPayload,
  eventType: string,
  config?: HooksGitHubConfig,
): boolean {
  if (!config) return true;

  // Filter by event type
  if (config.events && config.events.length > 0) {
    if (!config.events.includes(eventType as GitHubEventType)) {
      return false;
    }
  }

  // Filter by repository
  if (config.repositories && config.repositories.length > 0) {
    const repoName = payload.repository?.full_name;
    if (!repoName) return false;
    const matches = config.repositories.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
        return regex.test(repoName);
      }
      return pattern === repoName;
    });
    if (!matches) return false;
  }

  // Filter by label prefix (for issues and PRs)
  if (config.labelPrefix) {
    const labels = payload.issue?.labels ?? payload.pull_request?.labels ?? [];
    const hasMatchingLabel = labels.some(
      (label) => label.name && label.name.startsWith(config.labelPrefix!),
    );
    if (!hasMatchingLabel) return false;
  }

  // Filter by action
  if (config.actions && config.actions.length > 0) {
    if (!payload.action || !config.actions.includes(payload.action)) {
      return false;
    }
  }

  return true;
}

/**
 * Extract a human-readable summary from the GitHub payload.
 */
export function buildEventSummary(
  payload: GitHubWebhookPayload,
  eventType: string,
): { message: string; sessionKey: string; name: string } {
  const repo = payload.repository?.full_name ?? "unknown/repo";
  const action = payload.action ?? eventType;

  let message = "";
  let sessionKey = `hook:github:${repo}`;
  const name = "GitHub";

  switch (eventType) {
    case "issues": {
      const issue = payload.issue;
      if (issue) {
        sessionKey = `${sessionKey}:issue:${issue.number}`;
        message = buildIssueMessage(issue, action, repo);
      }
      break;
    }

    case "issue_comment": {
      const issue = payload.issue;
      const comment = payload.comment;
      if (issue && comment) {
        sessionKey = `${sessionKey}:issue:${issue.number}`;
        message = buildCommentMessage(issue, comment, action, repo, "issue");
      }
      break;
    }

    case "pull_request": {
      const pr = payload.pull_request;
      if (pr) {
        sessionKey = `${sessionKey}:pr:${pr.number}`;
        message = buildPullRequestMessage(pr, action, repo);
      }
      break;
    }

    case "pull_request_review": {
      const pr = payload.pull_request;
      const review = payload.review;
      if (pr && review) {
        sessionKey = `${sessionKey}:pr:${pr.number}`;
        message = buildReviewMessage(pr, review, action, repo);
      }
      break;
    }

    case "pull_request_review_comment": {
      const pr = payload.pull_request;
      const comment = payload.comment;
      if (pr && comment) {
        sessionKey = `${sessionKey}:pr:${pr.number}`;
        message = buildCommentMessage(pr, comment, action, repo, "PR");
      }
      break;
    }

    case "push": {
      const commits = payload.commits ?? [];
      const ref = payload.ref ?? "";
      sessionKey = `${sessionKey}:push:${Date.now()}`;
      message = buildPushMessage(commits, ref, repo);
      break;
    }

    case "release": {
      const release = payload.release;
      if (release) {
        sessionKey = `${sessionKey}:release:${release.tag_name}`;
        message = buildReleaseMessage(release, action, repo);
      }
      break;
    }

    case "create":
    case "delete": {
      const refType = payload.ref_type ?? "branch";
      const ref = payload.ref ?? "";
      sessionKey = `${sessionKey}:${eventType}:${ref}`;
      message = `${eventType === "create" ? "Created" : "Deleted"} ${refType} \`${ref}\` in ${repo}`;
      break;
    }

    default:
      message = `GitHub event: ${eventType} (${action}) on ${repo}`;
      sessionKey = `${sessionKey}:${eventType}:${Date.now()}`;
  }

  return { message, sessionKey, name };
}

function buildIssueMessage(
  issue: NonNullable<GitHubWebhookPayload["issue"]>,
  action: string,
  repo: string,
): string {
  const labels = issue.labels?.map((l) => l.name).join(", ") ?? "";
  const labelInfo = labels ? `\nLabels: ${labels}` : "";

  return `Issue ${action} in ${repo}

**#${issue.number}: ${issue.title}**
State: ${issue.state}
Author: ${issue.user?.login ?? "unknown"}${labelInfo}
URL: ${issue.html_url}

${truncateBody(issue.body)}`;
}

function buildPullRequestMessage(
  pr: NonNullable<GitHubWebhookPayload["pull_request"]>,
  action: string,
  repo: string,
): string {
  const labels = pr.labels?.map((l) => l.name).join(", ") ?? "";
  const labelInfo = labels ? `\nLabels: ${labels}` : "";
  const draftInfo = pr.draft ? " (Draft)" : "";
  const mergedInfo = pr.merged ? " [MERGED]" : "";

  return `Pull Request ${action}${draftInfo}${mergedInfo} in ${repo}

**#${pr.number}: ${pr.title}**
State: ${pr.state}
Author: ${pr.user?.login ?? "unknown"}
Branch: ${pr.head?.ref} → ${pr.base?.ref}${labelInfo}
URL: ${pr.html_url}

${truncateBody(pr.body)}`;
}

function buildCommentMessage(
  target:
    | NonNullable<GitHubWebhookPayload["issue"]>
    | NonNullable<GitHubWebhookPayload["pull_request"]>,
  comment: NonNullable<GitHubWebhookPayload["comment"]>,
  action: string,
  repo: string,
  targetType: "issue" | "PR",
): string {
  return `Comment ${action} on ${targetType} #${target.number} in ${repo}

**${target.title}**
Comment by: ${comment.user?.login ?? "unknown"}
URL: ${comment.html_url}

${truncateBody(comment.body)}`;
}

function buildReviewMessage(
  pr: NonNullable<GitHubWebhookPayload["pull_request"]>,
  review: NonNullable<GitHubWebhookPayload["review"]>,
  action: string,
  repo: string,
): string {
  const reviewState = review.state ?? "unknown";
  return `PR Review ${action} (${reviewState}) on #${pr.number} in ${repo}

**${pr.title}**
Reviewer: ${review.user?.login ?? "unknown"}
URL: ${review.html_url}

${truncateBody(review.body)}`;
}

function buildPushMessage(
  commits: NonNullable<GitHubWebhookPayload["commits"]>,
  ref: string,
  repo: string,
): string {
  const branch = ref.replace("refs/heads/", "");
  const commitSummary = commits
    .slice(0, 5)
    .map((c) => `- ${c.message?.split("\n")[0] ?? "No message"} (${c.id?.slice(0, 7)})`)
    .join("\n");
  const moreCommits = commits.length > 5 ? `\n... and ${commits.length - 5} more commits` : "";

  return `Push to ${branch} in ${repo}

${commits.length} commit(s):
${commitSummary}${moreCommits}`;
}

function buildReleaseMessage(
  release: NonNullable<GitHubWebhookPayload["release"]>,
  action: string,
  repo: string,
): string {
  const typeInfo = release.prerelease ? " (prerelease)" : release.draft ? " (draft)" : "";
  return `Release ${action}${typeInfo} in ${repo}

**${release.name ?? release.tag_name}** (${release.tag_name})
URL: ${release.html_url}

${truncateBody(release.body)}`;
}

function truncateBody(body?: string | null, maxLen = 2000): string {
  if (!body) return "(No description)";
  const trimmed = body.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen) + "\n... (truncated)";
}

/**
 * GitHub hook transform function for use with the hook mapping system.
 * Returns null to skip processing (e.g., filtered out by config).
 */
export function createGitHubTransform(config?: HooksGitHubConfig) {
  return (ctx: HookMappingContext): GitHubTransformResult => {
    const eventType = ctx.headers["x-github-event"] ?? "";
    const payload = ctx.payload as GitHubWebhookPayload;

    // Validate event type
    if (!SUPPORTED_GITHUB_EVENTS.includes(eventType as GitHubEventType)) {
      return null;
    }

    // Apply config filters
    if (!shouldProcessEvent(payload, eventType, config)) {
      return null;
    }

    return buildEventSummary(payload, eventType);
  };
}

/**
 * Default export for use as a transform module.
 * Reads config from the hook mapping context or uses defaults.
 */
export default function transform(ctx: HookMappingContext): GitHubTransformResult {
  return createGitHubTransform()(ctx);
}
