/**
 * Kanban task management module
 *
 * Provides adapters for ingesting tasks from external sources
 * (GitHub Issues, local TASKS.md) and a unified interface
 * for the Kanban agent system.
 */

export {
  // Types
  type TaskStatus,
  type TaskPriority,
  type TaskSourceId,
  type TaskListFilter,
  type ExternalTask,
  type TaskComment,
  type TaskAdapter,
  type AdapterConfig,
  type TaskAdapterFactory,
  type GitHubAdapterConfig,
  type MarkdownAdapterConfig,
  // Adapters
  GitHubIssuesAdapter,
  MarkdownTaskAdapter,
  // Registry
  AdapterRegistry,
  createAdapterRegistry,
  // Utilities
  parseTasksMarkdown,
  updateTaskStatusInMarkdown,
  addCommentToTaskInMarkdown,
  parseCommentsFromBody,
} from "./adapter.js";

export {
  // Presenter types
  type SolutionSummaryView,
  type SolutionSummaryRow,
  type SolutionDetailView,
  type ScoreBreakdown,
  type CategoryBreakdown,
  type CheckResult,
  type FileChange,
  type DiffView,
  type FileDiff,
  type DiffHunk,
  type DiffLine,
  type DiffRenderOptions,
  type PresentationAction,
  type ActionBarConfig,
  type PresentationChannel,
  type ActionHandlers,
  // Presenter constants
  CRITERION_WEIGHTS,
  CRITERION_LABELS,
  DEFAULT_DIFF_OPTIONS,
  // Presenter utilities
  isHighestScore,
  formatStatus,
  formatCheckPrefix,
  renderActionBar,
  parseAction,
  buildSummaryView,
  buildDetailView,
  // Presenter rendering
  renderSummaryCli,
  renderDetailCli,
  renderUnifiedDiffCli,
  renderSplitDiffCli,
  renderDiffCli,
  // Presenter channels
  CliPresentationChannel,
  ChatPresentationChannel,
  WebPresentationChannel,
  // Presenter class
  SolutionPresenter,
  // Presenter factories
  createPresenter,
  createDefaultHandlers,
} from "./presenter.js";

export {
  // Template chain types
  type TemplateType,
  type StageType,
  type StageStatus,
  type StageResult,
  type StageArtifact,
  type StageMetrics,
  type StageConfig,
  type ChainContext,
  type TemplateChain,
  type ChainExecutionPlan,
  type ChainExecutionResult,
  type ChainExecutorDeps,
  // Pre-defined chains
  BUG_FIX_CHAIN,
  FEATURE_DEV_CHAIN,
  CHORE_CHAIN,
  TEMPLATE_CHAINS,
  // Chain building
  buildChain,
  createStage,
  composeChains,
  // Chain execution
  createExecutionPlan,
  executeChain,
  // Template selection
  detectTemplateType,
  selectChain,
  // Dependencies
  createDefaultChainDeps,
} from "./template-chain.js";
