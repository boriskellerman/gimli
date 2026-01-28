import type { SlackSlashCommandConfig } from "../../config/config.js";

export function normalizeSlackSlashCommandName(raw: string) {
  return raw.replace(/^\/+/, "");
}

export function resolveSlackSlashCommandConfig(
  raw?: SlackSlashCommandConfig,
): Required<SlackSlashCommandConfig> {
  const normalizedName = normalizeSlackSlashCommandName(raw?.name?.trim() || "gimli");
  const name = normalizedName || "gimli";
  return {
    enabled: raw?.enabled === true,
    name,
    sessionPrefix: raw?.sessionPrefix?.trim() || "slack:slash",
    ephemeral: raw?.ephemeral !== false,
  };
}

export function buildSlackSlashCommandMatcher(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^/?${escaped}$`);
}
