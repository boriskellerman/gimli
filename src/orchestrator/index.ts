/**
 * Orchestrator module - TAC (Tactical Agentic Coding) implementation
 *
 * Provides the single-interface pattern for agent fleet management,
 * implementing the three pillars:
 * 1. CRUD for Agents
 * 2. Observability
 * 3. Orchestration
 */

export {
  FleetManager,
  getFleetManager,
  resetFleetManager,
  type AgentSummary,
  type AgentRuntimeState,
  type FleetStats,
  type CreateAgentOptions,
  type UpdateAgentOptions,
  type FleetEventListener,
} from "./fleet-manager.js";
