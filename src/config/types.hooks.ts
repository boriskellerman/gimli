export type HookMappingMatch = {
  path?: string;
  source?: string;
};

export type HookMappingTransform = {
  module: string;
  export?: string;
};

export type HookMappingConfig = {
  id?: string;
  match?: HookMappingMatch;
  action?: "wake" | "agent";
  wakeMode?: "now" | "next-heartbeat";
  name?: string;
  sessionKey?: string;
  messageTemplate?: string;
  textTemplate?: string;
  deliver?: boolean;
  /** DANGEROUS: Disable external content safety wrapping for this hook. */
  allowUnsafeExternalContent?: boolean;
  channel?:
    | "last"
    | "whatsapp"
    | "telegram"
    | "discord"
    | "googlechat"
    | "slack"
    | "signal"
    | "imessage"
    | "msteams";
  to?: string;
  /** Override model for this hook (provider/model or alias). */
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
  transform?: HookMappingTransform;
};

export type HooksGmailTailscaleMode = "off" | "serve" | "funnel";

export type HooksGmailConfig = {
  account?: string;
  label?: string;
  topic?: string;
  subscription?: string;
  pushToken?: string;
  hookUrl?: string;
  includeBody?: boolean;
  maxBytes?: number;
  renewEveryMinutes?: number;
  /** DANGEROUS: Disable external content safety wrapping for Gmail hooks. */
  allowUnsafeExternalContent?: boolean;
  serve?: {
    bind?: string;
    port?: number;
    path?: string;
  };
  tailscale?: {
    mode?: HooksGmailTailscaleMode;
    path?: string;
    /** Optional tailscale serve/funnel target (port, host:port, or full URL). */
    target?: string;
  };
  /** Optional model override for Gmail hook processing (provider/model or alias). */
  model?: string;
  /** Optional thinking level override for Gmail hook processing. */
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
};

export type InternalHookHandlerConfig = {
  /** Event key to listen for (e.g., 'command:new', 'session:start') */
  event: string;
  /** Path to handler module (absolute or relative to cwd) */
  module: string;
  /** Export name from module (default: 'default') */
  export?: string;
};

export type HookConfig = {
  enabled?: boolean;
  env?: Record<string, string>;
  [key: string]: unknown;
};

export type HookInstallRecord = {
  source: "npm" | "archive" | "path";
  spec?: string;
  sourcePath?: string;
  installPath?: string;
  version?: string;
  installedAt?: string;
  hooks?: string[];
};

export type InternalHooksConfig = {
  /** Enable hooks system */
  enabled?: boolean;
  /** Legacy: List of internal hook handlers to register (still supported) */
  handlers?: InternalHookHandlerConfig[];
  /** Per-hook configuration overrides */
  entries?: Record<string, HookConfig>;
  /** Load configuration */
  load?: {
    /** Additional hook directories to scan */
    extraDirs?: string[];
  };
  /** Install records for hook packs or hooks */
  installs?: Record<string, HookInstallRecord>;
};

/** GitHub webhook event types that trigger agent runs */
export type GitHubEventType =
  | "issues"
  | "issue_comment"
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_comment"
  | "push"
  | "create"
  | "delete"
  | "release";

/** GitHub webhook configuration for ADW triggers */
export type HooksGitHubConfig = {
  /** GitHub webhook secret for signature verification (X-Hub-Signature-256) */
  webhookSecret?: string;
  /** Filter by event types (default: all supported events) */
  events?: GitHubEventType[];
  /** Filter by repository (owner/repo format, supports wildcards) */
  repositories?: string[];
  /** Filter by label prefix for issues/PRs (e.g., "adw:" to only trigger on "adw:*" labels) */
  labelPrefix?: string;
  /** Filter by action types (e.g., "opened", "closed", "labeled") */
  actions?: string[];
  /** DANGEROUS: Disable external content safety wrapping for GitHub hooks. */
  allowUnsafeExternalContent?: boolean;
  /** Optional model override for GitHub hook processing (provider/model or alias). */
  model?: string;
  /** Optional thinking level override for GitHub hook processing. */
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
};

export type HooksConfig = {
  enabled?: boolean;
  path?: string;
  token?: string;
  maxBodyBytes?: number;
  presets?: string[];
  transformsDir?: string;
  mappings?: HookMappingConfig[];
  gmail?: HooksGmailConfig;
  /** GitHub webhook configuration for ADW triggers */
  github?: HooksGitHubConfig;
  /** Internal agent event hooks */
  internal?: InternalHooksConfig;
};
