/**
 * Workflow command implementation.
 * Manages plan → build → test → review → document development workflows.
 */

import type { RuntimeEnv } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { createWorkflowStore, type WorkflowStore } from "./store.js";
import type { WorkflowCommandOpts, WorkflowStage, WorkflowState, WorkflowStep } from "./types.js";
import { isValidStage, WORKFLOW_STAGES } from "./types.js";

function formatDate(date: Date): string {
  return date.toLocaleString();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatAge(date: Date): string {
  const now = Date.now();
  const age = now - date.getTime();
  return formatDuration(age) + " ago";
}

function formatStageIcon(stage: WorkflowStage): string {
  const icons: Record<WorkflowStage, string> = {
    plan: "📋",
    build: "🔨",
    test: "🧪",
    review: "👀",
    document: "📝",
  };
  return icons[stage] ?? "•";
}

function formatStatusIcon(status: WorkflowState["status"]): string {
  switch (status) {
    case "active":
      return theme.info("●");
    case "completed":
      return theme.success("✓");
    case "failed":
      return theme.error("✗");
    case "paused":
      return theme.warn("⏸");
  }
}

function formatStepStatus(status: WorkflowStep["status"]): string {
  switch (status) {
    case "pending":
      return theme.muted("○ pending");
    case "in_progress":
      return theme.info("● in progress");
    case "completed":
      return theme.success("✓ completed");
    case "failed":
      return theme.error("✗ failed");
    case "skipped":
      return theme.muted("⊘ skipped");
  }
}

function showHelp(runtime: RuntimeEnv): void {
  runtime.log("Usage: gimli workflow <subcommand> [options]");
  runtime.log("");
  runtime.log("Manage development workflows: plan → build → test → review → document");
  runtime.log("");
  runtime.log("Subcommands:");
  runtime.log("  create    Create a new workflow");
  runtime.log("  list      List all workflows");
  runtime.log("  show      Show workflow details");
  runtime.log("  advance   Advance to next stage");
  runtime.log("  step      Add or update a step");
  runtime.log("  complete  Mark workflow as completed");
  runtime.log("  delete    Delete a workflow");
  runtime.log("  help      Show this help message");
  runtime.log("");
  runtime.log("Examples:");
  runtime.log('  gimli workflow create --name "Auth feature" --description "Add OAuth2"');
  runtime.log("  gimli workflow list");
  runtime.log("  gimli workflow show <id>");
  runtime.log("  gimli workflow advance <id>");
  runtime.log('  gimli workflow step <id> --stage build --description "Implement API"');
  runtime.log("  gimli workflow complete <id>");
  runtime.log("  gimli workflow delete <id>");
}

function handleCreate(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  if (!opts.name) {
    runtime.error(theme.error("Error: --name is required for create"));
    return;
  }

  const workflow = store.create({
    name: opts.name,
    description: opts.description ?? "",
  });

  if (opts.json) {
    runtime.log(JSON.stringify(workflow, null, 2));
    return;
  }

  runtime.log(theme.success(`Workflow created: ${workflow.id}`));
  runtime.log(`  Name: ${workflow.name}`);
  runtime.log(`  Stage: ${formatStageIcon(workflow.currentStage)} ${workflow.currentStage}`);
  runtime.log("");
  runtime.log("Next steps:");
  runtime.log(`  Show details: gimli workflow show ${workflow.id.slice(0, 8)}`);
  runtime.log(
    `  Add a step:   gimli workflow step ${workflow.id.slice(0, 8)} --stage plan --description "Define requirements"`,
  );
  runtime.log(`  Advance:      gimli workflow advance ${workflow.id.slice(0, 8)}`);
}

function handleList(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  const stageFilter = opts.stage && isValidStage(opts.stage) ? opts.stage : undefined;
  const workflows = store.list({ stage: stageFilter, limit: 20 });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          count: workflows.length,
          workflows: workflows.map((w) => store.getSummary(w.id)),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (workflows.length === 0) {
    runtime.log(theme.muted("No workflows found."));
    runtime.log("");
    runtime.log("Create one with:");
    runtime.log('  gimli workflow create --name "My feature" --description "What it does"');
    return;
  }

  runtime.log(theme.accent(`Workflows (${workflows.length})`));
  runtime.log("");

  for (const workflow of workflows) {
    const summary = store.getSummary(workflow.id);
    if (!summary) continue;

    const statusIcon = formatStatusIcon(workflow.status);
    const stageIcon = formatStageIcon(workflow.currentStage);
    const progress =
      summary.progress.total > 0 ? `${summary.progress.completed}/${summary.progress.total}` : "-";

    runtime.log(`${statusIcon} ${theme.accent(workflow.id.slice(0, 8))} ${workflow.name}`);
    runtime.log(
      `  ${stageIcon} ${workflow.currentStage} · ${progress} steps · ${formatAge(workflow.updatedAt)}`,
    );
  }
}

function handleShow(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  if (!opts.id) {
    runtime.error(theme.error("Error: workflow ID is required"));
    return;
  }

  const workflow = store.get(opts.id);
  if (!workflow) {
    runtime.error(theme.error(`Error: No workflow found with ID: ${opts.id}`));
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify(workflow, null, 2));
    return;
  }

  const summary = store.getSummary(workflow.id);

  runtime.log(theme.accent(`Workflow: ${workflow.name}`));
  runtime.log("");
  runtime.log(`ID:          ${workflow.id}`);
  runtime.log(`Status:      ${formatStatusIcon(workflow.status)} ${workflow.status}`);
  runtime.log(`Stage:       ${formatStageIcon(workflow.currentStage)} ${workflow.currentStage}`);
  runtime.log(`Description: ${workflow.description || theme.muted("(none)")}`);
  runtime.log(`Created:     ${formatDate(workflow.createdAt)}`);
  runtime.log(`Updated:     ${formatDate(workflow.updatedAt)}`);
  if (workflow.completedAt) {
    runtime.log(`Completed:   ${formatDate(workflow.completedAt)}`);
  }

  runtime.log("");
  runtime.log(theme.accent("Stages:"));
  for (const stage of WORKFLOW_STAGES) {
    const isCurrent = stage === workflow.currentStage;
    const stageSteps = workflow.steps.filter((s) => s.stage === stage);
    const completedCount = stageSteps.filter((s) => s.status === "completed").length;
    const marker = isCurrent ? theme.info("→") : " ";
    const label = isCurrent ? theme.info(stage) : stage;
    const stepInfo = stageSteps.length > 0 ? ` (${completedCount}/${stageSteps.length} steps)` : "";
    runtime.log(`  ${marker} ${formatStageIcon(stage)} ${label}${stepInfo}`);
  }

  if (workflow.steps.length > 0) {
    runtime.log("");
    runtime.log(theme.accent("Steps:"));
    for (const step of workflow.steps) {
      runtime.log(`  ${formatStepStatus(step.status)} [${step.stage}] ${step.description}`);
      if (step.error && opts.verbose) {
        runtime.log(`    ${theme.error(`Error: ${step.error}`)}`);
      }
    }
  }

  runtime.log("");
  if (summary) {
    runtime.log(
      theme.muted(
        `Progress: ${summary.progress.percentage}% (${summary.progress.completed}/${summary.progress.total} steps)`,
      ),
    );
  }
}

function handleAdvance(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  if (!opts.id) {
    runtime.error(theme.error("Error: workflow ID is required"));
    return;
  }

  const workflow = store.get(opts.id);
  if (!workflow) {
    runtime.error(theme.error(`Error: No workflow found with ID: ${opts.id}`));
    return;
  }

  const previousStage = workflow.currentStage;
  const updated = store.advanceStage(workflow.id);

  if (!updated) {
    runtime.error(theme.error("Error: Could not advance workflow"));
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify(updated, null, 2));
    return;
  }

  if (updated.status === "completed") {
    runtime.log(theme.success(`Workflow completed! 🎉`));
    runtime.log(`  ${workflow.name}`);
    runtime.log(`  Final stage: ${formatStageIcon(previousStage)} ${previousStage}`);
  } else {
    runtime.log(
      theme.success(
        `Advanced workflow to: ${formatStageIcon(updated.currentStage)} ${updated.currentStage}`,
      ),
    );
    runtime.log(`  From: ${formatStageIcon(previousStage)} ${previousStage}`);
    runtime.log(`  To:   ${formatStageIcon(updated.currentStage)} ${updated.currentStage}`);
  }
}

function handleStep(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  if (!opts.id) {
    runtime.error(theme.error("Error: workflow ID is required"));
    return;
  }

  if (!opts.stage || !isValidStage(opts.stage)) {
    runtime.error(theme.error(`Error: --stage must be one of: ${WORKFLOW_STAGES.join(", ")}`));
    return;
  }

  if (!opts.description) {
    runtime.error(theme.error("Error: --description is required"));
    return;
  }

  const workflow = store.get(opts.id);
  if (!workflow) {
    runtime.error(theme.error(`Error: No workflow found with ID: ${opts.id}`));
    return;
  }

  const step = store.addStep(workflow.id, opts.stage as WorkflowStage, opts.description);
  if (!step) {
    runtime.error(theme.error("Error: Could not add step"));
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify(step, null, 2));
    return;
  }

  runtime.log(theme.success(`Step added: ${step.id.slice(0, 8)}`));
  runtime.log(`  Stage:       ${formatStageIcon(step.stage)} ${step.stage}`);
  runtime.log(`  Description: ${step.description}`);
}

function handleComplete(
  opts: WorkflowCommandOpts,
  runtime: RuntimeEnv,
  store: WorkflowStore,
): void {
  if (!opts.id) {
    runtime.error(theme.error("Error: workflow ID is required"));
    return;
  }

  const workflow = store.get(opts.id);
  if (!workflow) {
    runtime.error(theme.error(`Error: No workflow found with ID: ${opts.id}`));
    return;
  }

  const updated = store.update(workflow.id, {
    status: "completed",
    completedAt: new Date(),
  });

  if (!updated) {
    runtime.error(theme.error("Error: Could not complete workflow"));
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify(updated, null, 2));
    return;
  }

  runtime.log(theme.success(`Workflow completed: ${workflow.name} 🎉`));
}

function handleDelete(opts: WorkflowCommandOpts, runtime: RuntimeEnv, store: WorkflowStore): void {
  if (!opts.id) {
    runtime.error(theme.error("Error: workflow ID is required"));
    return;
  }

  const workflow = store.get(opts.id);
  if (!workflow) {
    runtime.error(theme.error(`Error: No workflow found with ID: ${opts.id}`));
    return;
  }

  const deleted = store.delete(workflow.id);
  if (!deleted) {
    runtime.error(theme.error("Error: Could not delete workflow"));
    return;
  }

  if (opts.json) {
    runtime.log(JSON.stringify({ deleted: true, id: workflow.id }, null, 2));
    return;
  }

  runtime.log(theme.success(`Workflow deleted: ${workflow.name}`));
}

export async function workflowCommand(
  opts: WorkflowCommandOpts,
  runtime: RuntimeEnv,
): Promise<void> {
  const store = createWorkflowStore();

  try {
    switch (opts.subcommand) {
      case "create":
        handleCreate(opts, runtime, store);
        break;
      case "list":
        handleList(opts, runtime, store);
        break;
      case "show":
        handleShow(opts, runtime, store);
        break;
      case "advance":
        handleAdvance(opts, runtime, store);
        break;
      case "step":
        handleStep(opts, runtime, store);
        break;
      case "complete":
        handleComplete(opts, runtime, store);
        break;
      case "delete":
        handleDelete(opts, runtime, store);
        break;
      case "help":
      case undefined:
        showHelp(runtime);
        break;
      default:
        runtime.error(theme.error(`Unknown subcommand: ${opts.subcommand}`));
        runtime.log("");
        showHelp(runtime);
    }
  } finally {
    store.close();
  }
}
