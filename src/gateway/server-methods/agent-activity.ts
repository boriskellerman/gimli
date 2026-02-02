/**
 * Gateway RPC handlers for multi-agent observability.
 */

import {
  getMultiAgentObservabilitySnapshot,
  getRunSnapshot,
  listRuns,
} from "../../agents/agent-activity.js";
import type { AgentActivityQueryOptions } from "../../agents/agent-activity.types.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { ErrorCodes, errorShape, formatValidationErrors } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import AjvPkg from "ajv";
import {
  AgentsActivityListParamsSchema,
  AgentsActivityGetParamsSchema,
} from "../protocol/schema/agent-activity.js";
import type { Static } from "@sinclair/typebox";

const ajv = new (AjvPkg as unknown as new (opts?: object) => import("ajv").default)({
  allErrors: true,
  strict: false,
  removeAdditional: false,
});

type AgentsActivityListParams = Static<typeof AgentsActivityListParamsSchema>;
type AgentsActivityGetParams = Static<typeof AgentsActivityGetParamsSchema>;

const validateAgentsActivityListParams = ajv.compile<AgentsActivityListParams>(
  AgentsActivityListParamsSchema,
);
const validateAgentsActivityGetParams = ajv.compile<AgentsActivityGetParams>(
  AgentsActivityGetParamsSchema,
);

export const agentActivityHandlers: GatewayRequestHandlers = {
  /**
   * List all active and recent agent runs across all agents.
   */
  "agents.activity.list": ({ params, respond }) => {
    if (!validateAgentsActivityListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.activity.list params: ${formatValidationErrors(validateAgentsActivityListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as AgentsActivityListParams;

    const opts: AgentActivityQueryOptions = {
      agentIds: p.agentIds?.map(normalizeAgentId),
      activeOnly: p.activeOnly,
      limitPerAgent: p.limitPerAgent,
      windowMinutes: p.windowMinutes,
      includeSubagents: p.includeSubagents,
    };

    const snapshot = getMultiAgentObservabilitySnapshot(opts);
    respond(true, snapshot, undefined);
  },

  /**
   * Get details for a specific run.
   */
  "agents.activity.get": ({ params, respond }) => {
    if (!validateAgentsActivityGetParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.activity.get params: ${formatValidationErrors(validateAgentsActivityGetParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as AgentsActivityGetParams;

    const snapshot = getRunSnapshot(p.runId);
    if (!snapshot) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `run not found: ${p.runId}`),
      );
      return;
    }

    respond(true, snapshot, undefined);
  },

  /**
   * List runs for observation (raw list without aggregation).
   */
  "agents.activity.runs": ({ params, respond }) => {
    if (!validateAgentsActivityListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid agents.activity.runs params: ${formatValidationErrors(validateAgentsActivityListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as AgentsActivityListParams;

    const opts: AgentActivityQueryOptions = {
      agentIds: p.agentIds?.map(normalizeAgentId),
      activeOnly: p.activeOnly,
      limitPerAgent: p.limitPerAgent,
      windowMinutes: p.windowMinutes,
      includeSubagents: p.includeSubagents,
    };

    const runs = listRuns(opts);
    respond(true, { ts: Date.now(), runs }, undefined);
  },
};
