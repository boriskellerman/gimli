/**
 * Upstream sync module for OpenClaw repository monitoring.
 */
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
