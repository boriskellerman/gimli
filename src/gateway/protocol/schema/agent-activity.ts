/**
 * Protocol schema for multi-agent observability RPC methods.
 */

import { Type } from "@sinclair/typebox";

import { NonEmptyString } from "./primitives.js";

/**
 * Parameters for agents.activity.list - list active and recent agent runs.
 */
export const AgentsActivityListParamsSchema = Type.Object(
  {
    /** Filter to specific agent IDs. */
    agentIds: Type.Optional(Type.Array(NonEmptyString)),
    /** Include only active runs (running/pending). */
    activeOnly: Type.Optional(Type.Boolean()),
    /** Maximum runs per agent (default: 10). */
    limitPerAgent: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    /** Observation window in minutes (default: 30). */
    windowMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1440 })),
    /** Include subagent runs (default: true). */
    includeSubagents: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

/**
 * Parameters for agents.activity.get - get details for a specific run.
 */
export const AgentsActivityGetParamsSchema = Type.Object(
  {
    /** Run ID to retrieve. */
    runId: NonEmptyString,
  },
  { additionalProperties: false },
);

/**
 * Parameters for agents.activity.subscribe - subscribe to activity events.
 */
export const AgentsActivitySubscribeParamsSchema = Type.Object(
  {
    /** Filter to specific agent IDs. */
    agentIds: Type.Optional(Type.Array(NonEmptyString)),
    /** Subscribe only to active run events. */
    activeOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
