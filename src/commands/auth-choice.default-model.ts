import type { GimliConfig } from "../config/config.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export async function applyDefaultModelChoice(params: {
  config: GimliConfig;
  setDefaultModel: boolean;
  defaultModel: string;
  applyDefaultConfig: (config: GimliConfig) => GimliConfig;
  applyProviderConfig: (config: GimliConfig) => GimliConfig;
  noteDefault?: string;
  noteAgentModel: (model: string) => Promise<void>;
  prompter: WizardPrompter;
}): Promise<{ config: GimliConfig; agentModelOverride?: string }> {
  if (params.setDefaultModel) {
    const next = params.applyDefaultConfig(params.config);
    if (params.noteDefault) {
      await params.prompter.note(`Default model set to ${params.noteDefault}`, "Model configured");
    }
    return { config: next };
  }

  const next = params.applyProviderConfig(params.config);
  await params.noteAgentModel(params.defaultModel);
  return { config: next, agentModelOverride: params.defaultModel };
}
