/**
 * ADW (AI Developer Workflow) Module
 *
 * Exports all ADW-related types, stores, and utilities.
 */

// Types
export type {
  ADWWorkflowType,
  ADWStatus,
  ADWTrigger,
  ADWStep,
  ADWArtifact,
  ADWRun,
  ADWRunFilter,
  ADWSummary,
  ADWDefinition,
  ADWTriggerParams,
  ADWTriggerResult,
} from "./types.js";

// Store
export { ADWStore, getADWStore, resetADWStore, resolveADWStorePath } from "./store.js";

// Registry
export {
  getAllWorkflows,
  getEnabledWorkflows,
  getWorkflow,
  isWorkflowAvailable,
  getWorkflowsByType,
  registerWorkflow,
  unregisterWorkflow,
  setWorkflowEnabled,
  getRegistrySummary,
  formatWorkflowForDisplay,
  getWorkflowListForPrompt,
} from "./registry.js";

// Connector (Orchestrator integration)
export {
  triggerADW,
  getADWRunStatus,
  listAvailableADWs,
  isADWAvailable,
  getRecentADWRuns,
  getADWSummaryStats,
  cancelADWRun,
} from "./connector.js";
