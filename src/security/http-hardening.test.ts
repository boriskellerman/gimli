import { describe, it, expect, beforeEach } from "vitest";
import { CsrfTokenManager } from "./http-hardening.js";

describe("CsrfTokenManager", () => {
  let csrf: CsrfTokenManager;

  beforeEach(() => {
    csrf = new CsrfTokenManager();
  });

  it("generates unique tokens per session", () => {
    const token1 = csrf.generateToken("session1");
    const token2 = csrf.generateToken("session2");
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it("validates correct tokens", () => {
    const token = csrf.generateToken("session1");
    expect(csrf.validateToken("session1", token)).toBe(true);
  });

  it("rejects incorrect tokens", () => {
    csrf.generateToken("session1");
    expect(csrf.validateToken("session1", "wrong-token-value")).toBe(false);
  });

  it("rejects tokens for unknown sessions", () => {
    expect(csrf.validateToken("unknown-session", "any-token")).toBe(false);
  });

  it("rejects tokens with wrong length (timing-safe)", () => {
    csrf.generateToken("session1");
    expect(csrf.validateToken("session1", "short")).toBe(false);
  });

  it("generates a new token replacing the old one", () => {
    const token1 = csrf.generateToken("session1");
    const token2 = csrf.generateToken("session1");
    expect(token1).not.toBe(token2);
    expect(csrf.validateToken("session1", token1)).toBe(false);
    expect(csrf.validateToken("session1", token2)).toBe(true);
  });
});
