/**
 * Gimli Security Module
 *
 * Central export for all security hardening components.
 * Import from "gimli/security" for access to:
 * - Rate limiting
 * - Encrypted secret storage
 * - Prompt injection detection
 * - Audit logging
 * - HTTP hardening (CORS, CSRF, security headers)
 */

export { RateLimiter, type RateLimiterConfig } from "./rate-limiter.js";
export { EncryptedStore, encrypt, decrypt, type EncryptedStoreOptions } from "./encrypted-store.js";
export {
  detectPromptInjection,
  classifyExternalContent,
  type InjectionDetectionResult,
} from "./prompt-injection.js";
export {
  AuditLogger,
  type AuditLoggerConfig,
  type AuditEvent,
  type AuditEventType,
} from "./audit-logger.js";
export {
  applySecurityHeaders,
  handleCors,
  CsrfTokenManager,
  type HttpHardeningConfig,
} from "./http-hardening.js";
