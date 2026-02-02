import { Type } from "@sinclair/typebox";

import type { GimliConfig } from "../../config/config.js";
import { loadConfig, readConfigFileSnapshot } from "../../config/io.js";
import { resolveConfigPath, resolveStateDir } from "../../config/paths.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";

const CONFIG_ACTIONS = ["get", "get-path", "validate", "list-keys"] as const;

// Flattened schema to avoid anyOf issues with some providers
const ConfigToolSchema = Type.Object({
  action: stringEnum(CONFIG_ACTIONS, {
    description:
      "Action: get (read config value), get-path (show config file path), validate (check config validity), list-keys (list top-level config sections)",
  }),
  // get params
  key: Type.Optional(
    Type.String({
      description:
        "Dot-notation config key path (e.g., 'agents.defaults.model', 'logging.level'). Omit for full config.",
    }),
  ),
});

/**
 * Safely traverse an object by dot-notation key path.
 */
function getNestedValue(obj: unknown, keyPath: string): unknown {
  if (!keyPath) return obj;
  const keys = keyPath.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Config tool for agent access to Gimli's configuration system.
 * Provides read-only access to config values and validation status.
 * Does NOT allow writes - config changes should go through gateway tool for safety.
 */
export function createConfigTool(opts?: {
  agentSessionKey?: string;
  config?: GimliConfig;
}): AnyAgentTool {
  return {
    label: "Config",
    name: "config",
    description:
      "Read-only access to Gimli's configuration. Use 'get' with a key path to read specific values (e.g., 'logging.level', 'agents.defaults.model'). Use 'validate' to check if config is valid. Use 'list-keys' to see available top-level sections.",
    parameters: ConfigToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "get") {
        const keyPath = readStringParam(params, "key") ?? "";

        try {
          const cfg = opts?.config ?? loadConfig();
          const value = getNestedValue(cfg, keyPath);

          // Redact sensitive values
          const redactPatterns = [/token/i, /key/i, /secret/i, /password/i, /credential/i, /auth/i];
          const shouldRedact = (key: string): boolean => {
            return redactPatterns.some((p) => p.test(key));
          };

          const redactValue = (val: unknown, currentKey: string): unknown => {
            if (val === null || val === undefined) return val;
            if (typeof val === "string") {
              if (shouldRedact(currentKey) && val.length > 0) {
                return "[REDACTED]";
              }
              return val;
            }
            if (Array.isArray(val)) {
              return val.map((v, i) => redactValue(v, `${currentKey}[${i}]`));
            }
            if (typeof val === "object") {
              const result: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
                result[k] = redactValue(v, k);
              }
              return result;
            }
            return val;
          };

          const safeValue = redactValue(value, keyPath.split(".").pop() ?? "");

          return jsonResult({
            ok: true,
            action: "get",
            key: keyPath || "(root)",
            value: safeValue,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to read config: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "get-path") {
        try {
          const stateDir = resolveStateDir(process.env, () => process.env.HOME ?? "");
          const configPath = resolveConfigPath(process.env, stateDir);

          return jsonResult({
            ok: true,
            action: "get-path",
            configPath,
            stateDir,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to resolve config path: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "validate") {
        try {
          const snapshot = await readConfigFileSnapshot();

          return jsonResult({
            ok: true,
            action: "validate",
            valid: snapshot.valid,
            exists: snapshot.exists,
            path: snapshot.path,
            issues: snapshot.issues.length > 0 ? snapshot.issues : undefined,
            warnings: snapshot.warnings.length > 0 ? snapshot.warnings : undefined,
            legacyIssues: snapshot.legacyIssues.length > 0 ? snapshot.legacyIssues : undefined,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to validate config: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      if (action === "list-keys") {
        try {
          const cfg = opts?.config ?? loadConfig();
          const topLevelKeys = Object.keys(cfg).sort();

          // Provide descriptions for known top-level keys
          const descriptions: Record<string, string> = {
            agents: "Agent configuration (defaults, memory, tools)",
            channels: "Messaging channel settings (telegram, discord, slack, etc.)",
            commands: "Command permissions (restart, sandbox settings)",
            compaction: "Conversation compaction settings",
            contextPruning: "Context window management",
            cron: "Scheduled task configuration",
            env: "Environment variable configuration",
            gateway: "Gateway server settings (auth, bind, port)",
            logging: "Log level and output settings",
            message: "Message handling settings",
            meta: "Config metadata (version, timestamps)",
            models: "Model provider configuration",
            session: "Session storage settings",
            tools: "Tool permissions and settings",
            webhooks: "Webhook endpoint configuration",
          };

          const keys = topLevelKeys.map((key) => ({
            key,
            description: descriptions[key] ?? "(no description)",
          }));

          return jsonResult({
            ok: true,
            action: "list-keys",
            keys,
          });
        } catch (err) {
          return jsonResult({
            ok: false,
            error: `Failed to list config keys: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      return jsonResult({
        ok: false,
        error: `Unknown action: ${action}`,
      });
    },
  };
}
