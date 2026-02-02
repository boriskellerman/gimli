/**
 * Orchestrator Agent Module
 *
 * Exports all orchestrator-related types, factories, and utilities.
 * The Orchestrator Agent (O-Agent) coordinates multi-agent operations
 * and integrates with AI Developer Workflows (ADWs).
 */

// Types
export type {
  OrchestratorConfig,
  ManagedAgentState,
  WorkflowStep,
  ExecutionPlan,
  OrchestratorEvent,
  OrchestratorSpawnParams,
  OrchestratorSpawnResult,
  CreateOrchestratorParams,
  FleetStatus,
} from "./orchestrator-types.js";

export { ORCHESTRATOR_PRESETS, applyOrchestratorPreset } from "./orchestrator-types.js";

// System Prompts
export type { OrchestratorRole } from "./orchestrator-system-prompt.js";
export {
  buildOrchestratorSystemPrompt,
  buildMinimalOrchestratorPrompt,
  buildGimliOrchestratorPrompt,
} from "./orchestrator-system-prompt.js";

// Orchestrator Lifecycle
export {
  createOrchestratorConfig,
  createOrchestratorSession,
  shutdownOrchestrator,
  sendToOrchestrator,
} from "./orchestrator-agent.js";

// Agent Management (CRUD)
export {
  orchestratorSpawnAgent,
  getOrchestratorFleetStatus,
  updateManagedAgentStatus,
  removeManagedAgent,
} from "./orchestrator-agent.js";

// ADW Integration
export {
  orchestratorTriggerADW,
  orchestratorGetADWStatus,
  orchestratorListADWs,
  orchestratorCancelADW,
} from "./orchestrator-agent.js";

// Observability
export {
  getOrchestratorEvents,
  getOrchestratorConfig,
  listOrchestrators,
} from "./orchestrator-agent.js";
