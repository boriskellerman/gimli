import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify GitHub webhook signature using X-Hub-Signature-256 header.
 * Uses HMAC-SHA256 and timing-safe comparison to prevent timing attacks.
 *
 * @param rawBody - The raw request body as a string
 * @param signature - The X-Hub-Signature-256 header value
 * @param secret - The webhook secret configured in GitHub
 * @returns true if signature is valid, false otherwise
 */
export function verifyGitHubSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  // GitHub signature format: sha256=<hex>
  const match = signature.match(/^sha256=([a-fA-F0-9]+)$/);
  if (!match) return false;
  const receivedSig = match[1];
  if (!receivedSig) return false;

  const expectedSig = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(receivedSig, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

/**
 * Check if request appears to be from GitHub based on headers.
 */
export function isGitHubWebhook(headers: Record<string, string>): boolean {
  return Boolean(
    headers["x-github-event"] &&
    headers["x-github-delivery"] &&
    (headers["x-hub-signature-256"] || headers["x-hub-signature"]),
  );
}
