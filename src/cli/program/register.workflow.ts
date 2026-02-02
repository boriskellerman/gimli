/**
 * CLI registration for the workflow command.
 * Manages plan → build → test → review → document development workflows.
 */

import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { workflowCommand } from "../../workflow/workflow.js";

export function registerWorkflowCommand(program: Command): void {
  const workflow = program
    .command("workflow")
    .description("Manage development workflows: plan → build → test → review → document")
    .addHelpText(
      "after",
      `
Examples:
  gimli workflow create --name "Auth feature" --description "Add OAuth2 login"
  gimli workflow list
  gimli workflow show <id>
  gimli workflow advance <id>
  gimli workflow step <id> --stage build --description "Implement API endpoints"
  gimli workflow complete <id>
  gimli workflow delete <id>

Stages:
  plan      Planning and requirements gathering
  build     Implementation and coding
  test      Testing and quality assurance
  review    Code review and feedback
  document  Documentation and wrap-up

Documentation: https://docs.gimli.bot/workflows
`,
    );

  workflow
    .command("create")
    .description("Create a new workflow")
    .requiredOption("-n, --name <name>", "Workflow name")
    .option("-d, --description <description>", "Workflow description")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await workflowCommand(
        {
          subcommand: "create",
          name: opts.name,
          description: opts.description,
          json: opts.json,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("list")
    .description("List all workflows")
    .option("-s, --stage <stage>", "Filter by stage (plan, build, test, review, document)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      await workflowCommand(
        {
          subcommand: "list",
          stage: opts.stage,
          json: opts.json,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("show <id>")
    .description("Show workflow details")
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show verbose output including errors")
    .action(async (id, opts) => {
      await workflowCommand(
        {
          subcommand: "show",
          id,
          json: opts.json,
          verbose: opts.verbose,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("advance <id>")
    .description("Advance workflow to next stage")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      await workflowCommand(
        {
          subcommand: "advance",
          id,
          json: opts.json,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("step <id>")
    .description("Add a step to a workflow")
    .requiredOption(
      "-s, --stage <stage>",
      "Stage for the step (plan, build, test, review, document)",
    )
    .requiredOption("-d, --description <description>", "Step description")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      await workflowCommand(
        {
          subcommand: "step",
          id,
          stage: opts.stage,
          description: opts.description,
          json: opts.json,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("complete <id>")
    .description("Mark workflow as completed")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      await workflowCommand(
        {
          subcommand: "complete",
          id,
          json: opts.json,
        },
        defaultRuntime,
      );
    });

  workflow
    .command("delete <id>")
    .description("Delete a workflow")
    .option("--json", "Output as JSON")
    .action(async (id, opts) => {
      await workflowCommand(
        {
          subcommand: "delete",
          id,
          json: opts.json,
        },
        defaultRuntime,
      );
    });
}
