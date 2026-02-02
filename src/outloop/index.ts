/**
 * Outloop module - HTTP trigger → agent execution pipeline.
 *
 * This module implements Phase 9.3 Grade 1 of the TAC Orchestrator:
 * the "Outloop Foundation" that enables programmatic agent execution
 * via HTTP triggers.
 *
 * The PETER framework:
 * - Prompt: The message/instruction sent to the agent
 * - Environment: Agent configuration, model, tools
 * - Trigger: HTTP endpoint that initiates execution
 * - Execute: Isolated agent turn via existing Gimli infrastructure
 * - Result: Structured output with status, summary, timing
 */

export {
  // Types
  type ADWTriggerRequest,
  type ADWTriggerResponse,
  type ADWTriggerErrorResponse,
  type ADWExecutionResult,
  type ADWExecutionState,
  type ADWTriggerConfig,
  type ADWTriggerMetadata,
  type NormalizedADWPayload,
} from "./types.js";

export {
  // Trigger handler
  createADWRequestHandler,
  resolveADWConfig,
  normalizeADWPayload,
  getADWExecutionStatus,
  listActiveADWExecutions,
  type ADWRequestHandler,
} from "./adw-trigger.js";

export {
  // Executor
  executeADW,
  loadADWResult,
  buildADWMessage,
  createGitHubIssueADWPayload,
} from "./adw-executor.js";
