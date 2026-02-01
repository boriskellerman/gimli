/**
 * Learning capture hook
 *
 * Hooks into the agent session lifecycle to automatically extract
 * and store learnings from conversations.
 */

import {
  registerInternalHook,
  unregisterInternalHook,
  type InternalHookEvent,
  type InternalHookHandler,
} from "../hooks/internal-hooks.js";
import {
  extractFromMessage,
  type ExtractionOptions,
  defaultExtractionOptions,
} from "./extract-learnings.js";
import { addLearning } from "./learnings-store.js";

/**
 * Configuration for the learning capture hook
 */
export interface LearningCaptureConfig {
  /** Whether the hook is enabled */
  enabled: boolean;
  /** Extraction options */
  extractionOptions: ExtractionOptions;
  /** Minimum message length to analyze */
  minMessageLength: number;
  /** Maximum learnings to capture per session */
  maxPerSession: number;
}

/**
 * Default configuration
 */
export const defaultCaptureConfig: LearningCaptureConfig = {
  enabled: true,
  extractionOptions: defaultExtractionOptions,
  minMessageLength: 20,
  maxPerSession: 50,
};

// Track registered hooks
const registeredHooks = new Map<string, InternalHookHandler>();

// Track learnings captured per session
const sessionCounts = new Map<string, number>();

/**
 * Handle a session event that might contain user messages
 */
async function handleSessionEvent(
  event: InternalHookEvent,
  config: LearningCaptureConfig,
): Promise<void> {
  if (!config.enabled) return;

  const { agentId, content, message } = event.context as {
    agentId?: string;
    content?: string;
    message?: string;
  };

  const messageContent = content ?? message;
  if (!agentId || !messageContent) return;
  if (messageContent.length < config.minMessageLength) return;

  // Check session limit
  const sessionKey = event.sessionKey ?? `${agentId}:default`;
  const currentCount = sessionCounts.get(sessionKey) ?? 0;
  if (currentCount >= config.maxPerSession) return;

  // Extract learnings
  const learnings = extractFromMessage(messageContent, config.extractionOptions);

  // Store each learning
  for (const learning of learnings) {
    try {
      await addLearning(agentId, learning);
      sessionCounts.set(sessionKey, currentCount + 1);
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Register the learning capture hook
 */
export function registerLearningCaptureHook(
  config: LearningCaptureConfig = defaultCaptureConfig,
): void {
  const hookId = "learning-capture";

  if (registeredHooks.has(hookId)) {
    return; // Already registered
  }

  const handler: InternalHookHandler = async (event) => {
    // Listen for session events that might contain user messages
    if (event.type === "session" && event.action === "message") {
      await handleSessionEvent(event, config);
    }
  };

  registerInternalHook("session", handler);
  registeredHooks.set(hookId, handler);
}

/**
 * Unregister the learning capture hook
 */
export function unregisterLearningCaptureHook(): void {
  const hookId = "learning-capture";
  const handler = registeredHooks.get(hookId);

  if (handler) {
    unregisterInternalHook("session", handler);
    registeredHooks.delete(hookId);
  }
}

/**
 * Reset session counts (for testing or session cleanup)
 */
export function resetSessionCounts(): void {
  sessionCounts.clear();
}

/**
 * Get current session count
 */
export function getSessionCount(agentId: string, sessionId?: string): number {
  const sessionKey = `${agentId}:${sessionId ?? "default"}`;
  return sessionCounts.get(sessionKey) ?? 0;
}
