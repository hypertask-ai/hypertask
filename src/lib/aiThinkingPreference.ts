import { getAiModelDefinition, type TAiModelKey } from "@/lib/aiModelOptions";

export const AI_THINKING_EFFORTS = ["low", "medium", "high"] as const;

export type TAiThinkingEffort = (typeof AI_THINKING_EFFORTS)[number];

export type TAiThinkingPreference = {
  enabled: boolean;
  effort: TAiThinkingEffort;
};

export const DEFAULT_AI_THINKING_PREFERENCE: TAiThinkingPreference = {
  enabled: false,
  effort: "low",
};

const THINKING_PROVIDERS = new Set(["openai", "anthropic", "google", "deepseek"]);

export function isAiThinkingEffort(value: unknown): value is TAiThinkingEffort {
  return AI_THINKING_EFFORTS.includes(value as TAiThinkingEffort);
}

export function parseAiThinkingPreference(value: unknown): TAiThinkingPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_AI_THINKING_PREFERENCE;
  const { enabled, effort } = value as Record<string, unknown>;
  return {
    enabled: enabled === true,
    effort: isAiThinkingEffort(effort) ? effort : DEFAULT_AI_THINKING_PREFERENCE.effort,
  };
}

export function thinkingPreferenceToEffort(preference: TAiThinkingPreference): "none" | TAiThinkingEffort {
  return preference.enabled ? preference.effort : "none";
}

export function modelSupportsThinkingControl(modelKey: TAiModelKey): boolean {
  const provider = getAiModelDefinition(modelKey)?.provider;
  return provider !== undefined && THINKING_PROVIDERS.has(provider);
}
