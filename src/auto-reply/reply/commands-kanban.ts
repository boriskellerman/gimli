/**
 * /kanban slash command handler
 *
 * Provides in-chat access to the Kanban board management:
 * - /kanban status - Show board overview
 * - /kanban pick - Pick next task
 * - /kanban review <id> - Review solutions
 * - /kanban approve <id> - Approve a solution
 */

import { logVerbose } from "../../globals.js";
import { kanbanCommand, type KanbanCommandOpts } from "../../commands/kanban.js";
import type { CommandHandler } from "./commands-types.js";
import type { RuntimeEnv } from "../../runtime.js";

function parseKanbanArgs(body: string): KanbanCommandOpts {
  // Remove /kanban prefix
  const argsStr = body.replace(/^\/kanban\s*/i, "").trim();
  const parts = argsStr.split(/\s+/);

  const subcommand = parts[0] || "status";
  const opts: KanbanCommandOpts = { subcommand };

  // Parse remaining args based on subcommand
  if (subcommand === "review" || subcommand === "approve") {
    opts.taskId = parts[1];
    if (subcommand === "approve" && parts[2]) {
      opts.solutionId = parts[2];
    }
  }

  // Parse flags
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--count" && parts[i + 1]) {
      opts.count = parseInt(parts[i + 1], 10);
      i++;
    } else if (part === "--labels" && parts[i + 1]) {
      opts.labels = parts[i + 1];
      i++;
    } else if (part === "--force") {
      opts.force = true;
    } else if (part === "--json") {
      opts.json = true;
    } else if (part === "--unassigned") {
      opts.unassigned = true;
    }
  }

  return opts;
}

export const handleKanbanCommand: CommandHandler = async (params) => {
  const normalized = params.command.commandBodyNormalized;
  const isKanban = normalized === "/kanban" || normalized.startsWith("/kanban ");

  if (!isKanban) return null;

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /kanban from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  // Parse the command arguments
  const opts = parseKanbanArgs(params.ctx.CommandBody ?? params.ctx.RawBody ?? normalized);

  // Capture output with a custom runtime
  const outputLines: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...args: unknown[]) => outputLines.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => outputLines.push(`❌ ${args.map(String).join(" ")}`),
    exit: (code: number): never => {
      throw new Error(`KanbanExit:${code}`);
    },
  };

  try {
    await kanbanCommand(opts, runtime);
  } catch (error) {
    // Handle expected exit calls (e.g., for help display)
    if (error instanceof Error && error.message.startsWith("KanbanExit:")) {
      // Normal exit, output is already captured
    } else {
      const errorMsg = error instanceof Error ? error.message : String(error);
      outputLines.push(`❌ Kanban error: ${errorMsg}`);
    }
  }

  const output = outputLines.join("\n").trim() || "📋 Kanban command completed.";
  return {
    shouldContinue: false,
    reply: { text: output },
  };
};
