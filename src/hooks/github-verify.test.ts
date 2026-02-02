import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isGitHubWebhook, verifyGitHubSignature } from "./github-verify.js";

describe("GitHub signature verification", () => {
  const secret = "test-webhook-secret";

  function generateSignature(body: string, secretKey: string): string {
    const sig = createHmac("sha256", secretKey).update(body).digest("hex");
    return `sha256=${sig}`;
  }

  describe("verifyGitHubSignature", () => {
    it("returns true for valid signature", () => {
      const body = '{"action":"opened"}';
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
    });

    it("returns false for invalid signature", () => {
      const body = '{"action":"opened"}';
      const signature = "sha256=invalid";
      expect(verifyGitHubSignature(body, signature, secret)).toBe(false);
    });

    it("returns false for tampered body", () => {
      const body = '{"action":"opened"}';
      const signature = generateSignature(body, secret);
      const tamperedBody = '{"action":"closed"}';
      expect(verifyGitHubSignature(tamperedBody, signature, secret)).toBe(false);
    });

    it("returns false for wrong secret", () => {
      const body = '{"action":"opened"}';
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, "wrong-secret")).toBe(false);
    });

    it("returns false for missing signature", () => {
      const body = '{"action":"opened"}';
      expect(verifyGitHubSignature(body, undefined, secret)).toBe(false);
    });

    it("returns false for empty secret", () => {
      const body = '{"action":"opened"}';
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, "")).toBe(false);
    });

    it("returns false for malformed signature format", () => {
      const body = '{"action":"opened"}';
      expect(verifyGitHubSignature(body, "invalid-format", secret)).toBe(false);
      expect(verifyGitHubSignature(body, "sha1=abc123", secret)).toBe(false);
    });

    it("handles special characters in body", () => {
      const body = '{"message":"Hello, 世界! 🎉"}';
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
    });

    it("handles empty body", () => {
      const body = "";
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
    });

    it("handles large body", () => {
      const body = JSON.stringify({ data: "x".repeat(100000) });
      const signature = generateSignature(body, secret);
      expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
    });
  });

  describe("isGitHubWebhook", () => {
    it("returns true for GitHub webhook headers", () => {
      const headers = {
        "x-github-event": "issues",
        "x-github-delivery": "abc123",
        "x-hub-signature-256": "sha256=...",
      };
      expect(isGitHubWebhook(headers)).toBe(true);
    });

    it("returns true with legacy signature header", () => {
      const headers = {
        "x-github-event": "issues",
        "x-github-delivery": "abc123",
        "x-hub-signature": "sha1=...",
      };
      expect(isGitHubWebhook(headers)).toBe(true);
    });

    it("returns false without event header", () => {
      const headers = {
        "x-github-delivery": "abc123",
        "x-hub-signature-256": "sha256=...",
      };
      expect(isGitHubWebhook(headers)).toBe(false);
    });

    it("returns false without delivery header", () => {
      const headers = {
        "x-github-event": "issues",
        "x-hub-signature-256": "sha256=...",
      };
      expect(isGitHubWebhook(headers)).toBe(false);
    });

    it("returns false without signature header", () => {
      const headers = {
        "x-github-event": "issues",
        "x-github-delivery": "abc123",
      };
      expect(isGitHubWebhook(headers)).toBe(false);
    });

    it("returns false for empty headers", () => {
      expect(isGitHubWebhook({})).toBe(false);
    });
  });
});
