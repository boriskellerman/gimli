/**
 * Upstream sync module for OpenClaw repository monitoring.
 *
 * Provides functionality to:
 * - Monitor OpenClaw for new commits (commit-monitor)
 * - Parse changelog and commit messages (changelog-parser)
 * - Analyze diffs for categorization (diff-analyzer)
 * - Store sync history and risk assessments (sync-history)
 * - Send notifications for significant changes (notifications)
 * - Integration workflow with staging, testing, and rollback (integration)
 */

// Commit monitoring
export {
  checkForNewCommits,
  createCommitMonitorCronJob,
  createInitialState,
  DAILY_CRON_EXPRESSION,
  DEFAULT_STATE_PATH,
  DEFAULT_UPSTREAM_DIR,
  fetchGitHubCommits,
  formatNewCommitsMessage,
  loadState,
  saveState,
  UPSTREAM_DEFAULT_BRANCH,
  UPSTREAM_REPO_NAME,
  UPSTREAM_REPO_OWNER,
  UPSTREAM_REPO_URL,
  WEEKLY_CRON_EXPRESSION,
  type CommitCheckResult,
  type CommitInfo,
  type CommitMonitorDeps,
  type CommitMonitorState,
} from "./commit-monitor.js";

// Changelog parsing
export {
  COMMIT_TYPE_LABELS,
  COMMIT_TYPE_PRIORITY,
  extractFeatureDescriptions,
  filterByScope,
  filterByType,
  formatChangelog,
  formatEntry,
  generateSummary,
  getBreakingChanges,
  getUniqueScopes,
  groupChangelog,
  parseChangelogFile,
  parseCommitMessage,
  parseCommitMessages,
  parseGitLog,
  sortByPriority,
  toChangelogEntry,
  type ChangelogEntry,
  type CommitType,
  type GroupedChangelog,
  type ParsedCommit,
  type ParseResult,
} from "./changelog-parser.js";

// Diff analysis
export {
  analyzeDiff,
  hasBreakingIndicators,
  hasSecurityIndicators,
  parseDiff,
  type BreakingSignal,
  type ChangeCategory,
  type ChangePriority,
  type DetectionConfidence,
  type DiffAnalysis,
  type DiffHunk,
  type DiffInput,
  type FileAnalysis,
  type FileChange,
  type SecuritySignal,
} from "./diff-analyzer.js";

// Sync history
export {
  addHistoryEntry,
  calculateRiskAssessment,
  DEFAULT_HISTORY_DIR,
  generateWeeklySummary,
  getHistoryEntry,
  HISTORY_FILENAME,
  loadHistory,
  MAX_HISTORY_ENTRIES,
  queryHistory,
  resolveHistoryPath,
  saveHistory,
  updateHistoryEntry,
  type RiskAssessment,
  type SyncHistoryEntry,
  type SyncHistoryFile,
  type SyncStatus,
} from "./sync-history.js";

// Notifications
export {
  batchNotifications,
  createBreakingChangeNotification,
  createIntegrationResultNotification,
  createNewCommitsNotification,
  createSecurityNotification,
  createWeeklySummaryNotification,
  defaultNotificationConfig,
  formatNotificationForConsole,
  formatNotificationForSession,
  isQuietHours,
  mapChangePriorityToNotification,
  shouldNotify,
  type Notification,
  type NotificationChannel,
  type NotificationConfig,
  type NotificationPriority,
} from "./notifications.js";

// Integration workflow
export {
  applyChanges,
  cherryPickCommit,
  createStagingBranch,
  defaultAllowlistConfig,
  deleteBranch,
  generateRiskReport,
  generateStagingBranchName,
  getCurrentBranch,
  isAutoApplyable,
  isWorkingDirClean,
  resolveSecurityConflicts,
  rollback,
  runTests,
  shouldPreserveGimliVersion,
  stageUpstreamChanges,
  switchBranch,
  testStagedChanges,
  type AllowlistConfig,
  type ConflictStrategy,
  type IntegrationResult,
  type TestResults,
} from "./integration.js";
