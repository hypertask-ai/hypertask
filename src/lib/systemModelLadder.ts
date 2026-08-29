import {
  aiImageModelDefinitions,
  aiModelOptions,
  defaultAiModelOption,
  getAiModelDefinition,
  getAiModelOptionById,
  pickAutoAiModelOption,
  type TAiImageModelDefinition,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import {
  resolveTeamProviderEnabled,
  type TAiProviderKey,
} from "@/lib/aiProviders";

export type SystemModel = {
  provider: TAiProviderKey;
  model: string;
};

export const SYSTEM_MODEL_LADDERS = {
  fast: [
    { provider: "google", model: "google/gemini-3.5-flash-lite" },
    { provider: "xai", model: "xai/grok-4.1-fast-non-reasoning" },
    { provider: "openai", model: "openai/gpt-5.4-mini" },
    { provider: "anthropic", model: "anthropic/claude-haiku-4.5" },
    { provider: "deepseek", model: "deepseek/deepseek-v4-flash" },
    { provider: "moonshot", model: "moonshotai/kimi-k2.5" },
    { provider: "alibaba", model: "alibaba/qwen3.7-plus" },
    { provider: "zhipu", model: "zai/glm-5.2" },
  ],
} as const satisfies Record<string, readonly SystemModel[]>;

export type SystemModelRole = keyof typeof SYSTEM_MODEL_LADDERS;

export const AI_FEATURES = {
  aiChat: { label: "AI chat", modelKind: "catalog" },
  taskWriter: { label: "Task writer", modelKind: "catalog" },
  writeWithAi: { label: "Write with AI", modelKind: "catalog" },
  improveWriting: { label: "Improve writing", modelKind: "catalog" },
  askAi: { label: "Ask AI", modelKind: "catalog" },
  boardGeneration: { label: "Board generation", modelKind: "catalog" },
  imageGeneration: { label: "Image generation", modelKind: "image" },
  hyperAi: { label: "@HyperAI", modelKind: "catalog" },
  summaries: { label: "Task summaries", modelKind: "fast" },
  questionSuggestions: { label: "Question suggestions", modelKind: "fast" },
  statusUpdates: { label: "Status updates", modelKind: "fast" },
  dictation: { label: "Dictation", modelKind: "none" },
} as const;

export type AiFeature = keyof typeof AI_FEATURES;
export type AiFeatureModelKind = (typeof AI_FEATURES)[AiFeature]["modelKind"];
export type ModelAiFeature = Exclude<AiFeature, "dictation">;
export type UserFacingModelFeature =
  | "aiChat"
  | "taskWriter"
  | "writeWithAi"
  | "improveWriting"
  | "askAi"
  | "boardGeneration"
  | "hyperAi";
export type ImageModelFeature = "imageGeneration";

export const SYSTEM_FEATURES = {
  summaries: { role: "fast", label: AI_FEATURES.summaries.label },
  questionSuggestions: {
    role: "fast",
    label: AI_FEATURES.questionSuggestions.label,
  },
  statusUpdates: { role: "fast", label: AI_FEATURES.statusUpdates.label },
} as const satisfies Record<string, { role: SystemModelRole; label: string }>;

export type SystemFeature = keyof typeof SYSTEM_FEATURES;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && !Array.isArray(value) && typeof value === "object";

export function isAiFeature(value: unknown): value is AiFeature {
  return typeof value === "string" && value in AI_FEATURES;
}

export function isSystemFeature(value: unknown): value is SystemFeature {
  return typeof value === "string" && value in SYSTEM_FEATURES;
}

export function isAiFeatureEnabled(
  feature: AiFeature,
  aiProviderSettings: unknown,
): boolean {
  if (!isObjectRecord(aiProviderSettings)) return true;
  const featureToggles = aiProviderSettings.featureToggles;
  if (!isObjectRecord(featureToggles)) return true;
  return featureToggles[feature] !== false;
}

export function getAiFeatureModelOverride(
  feature: ModelAiFeature,
  aiProviderSettings: unknown,
): string | null {
  if (!isObjectRecord(aiProviderSettings)) return null;

  const featureModels = aiProviderSettings.featureModels;
  if (!isObjectRecord(featureModels)) return null;

  const model = featureModels[feature];
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

export function getSystemFeatureModelOverride(
  feature: SystemFeature,
  aiProviderSettings: unknown,
): string | null {
  return getAiFeatureModelOverride(feature, aiProviderSettings);
}

export function getSystemModelsForFeature(
  feature: SystemFeature,
): readonly SystemModel[] {
  return SYSTEM_MODEL_LADDERS[SYSTEM_FEATURES[feature].role];
}

export function isSystemModelForFeature(
  feature: SystemFeature,
  model: unknown,
): model is string {
  return (
    typeof model === "string" &&
    getSystemModelsForFeature(feature).some((entry) => entry.model === model)
  );
}

export function isAiFeatureModelAllowed(
  feature: ModelAiFeature,
  model: unknown,
): model is string {
  if (typeof model !== "string") return false;
  const kind = AI_FEATURES[feature].modelKind;
  if (kind === "fast") {
    return isSystemModelForFeature(feature as SystemFeature, model);
  }
  if (kind === "image") {
    return aiImageModelDefinitions.some(
      (definition) => definition.key === model,
    );
  }
  return Boolean(getAiModelOptionById(model));
}

export function isAiFeatureModelEnabled(
  feature: ModelAiFeature,
  model: unknown,
  aiProviderSettings: unknown,
  customEndpointConfigured = true,
): model is string {
  if (!isAiFeatureModelAllowed(feature, model)) return false;
  const kind = AI_FEATURES[feature].modelKind;
  if (kind === "fast") {
    const definition = getSystemModelsForFeature(feature as SystemFeature).find(
      (entry) => entry.model === model,
    );
    return Boolean(
      definition &&
      resolveTeamProviderEnabled(aiProviderSettings, definition.provider),
    );
  }
  if (kind === "image") {
    const definition = aiImageModelDefinitions.find(
      (entry) => entry.key === model,
    );
    return Boolean(
      definition &&
      resolveTeamProviderEnabled(aiProviderSettings, definition.provider),
    );
  }
  const option = getAiModelOptionById(model);
  const definition = option && getAiModelDefinition(option.modelKey);
  return Boolean(
    option &&
    (!definition ||
      (definition.provider === "custom"
        ? customEndpointConfigured
        : resolveTeamProviderEnabled(aiProviderSettings, definition.provider))),
  );
}

function isModelOptionEnabled(
  option: TAiModelOption | undefined,
  aiProviderSettings: unknown,
  customEndpointConfigured: boolean,
): option is TAiModelOption {
  if (!option) return false;
  const definition = getAiModelDefinition(option.modelKey);
  if (definition?.provider === "custom") {
    return customEndpointConfigured;
  }
  return (
    !definition ||
    resolveTeamProviderEnabled(aiProviderSettings, definition.provider)
  );
}

export function resolveUserFacingModelOption(
  feature: UserFacingModelFeature,
  aiProviderSettings: unknown,
  personalModelOptionId?: string | null,
  options?: {
    customEndpointConfigured?: boolean;
    defaultModelOption?: TAiModelOption;
  },
): TAiModelOption | null {
  if (!isAiFeatureEnabled(feature, aiProviderSettings)) return null;
  const customEndpointConfigured = options?.customEndpointConfigured ?? true;
  const defaultModelOption = options?.defaultModelOption ?? defaultAiModelOption;

  const personal = getAiModelOptionById(personalModelOptionId);
  if (
    isModelOptionEnabled(personal, aiProviderSettings, customEndpointConfigured)
  ) {
    return personal;
  }

  const teamDefault = getAiModelOptionById(
    getAiFeatureModelOverride(feature, aiProviderSettings),
  );
  if (
    isModelOptionEnabled(
      teamDefault,
      aiProviderSettings,
      customEndpointConfigured,
    )
  ) {
    return teamDefault;
  }

  if (
    isModelOptionEnabled(
      defaultModelOption,
      aiProviderSettings,
      customEndpointConfigured,
    )
  ) {
    return defaultModelOption;
  }

  return (
    pickAutoAiModelOption(
      aiModelOptions.filter((option) =>
        isModelOptionEnabled(
          option,
          aiProviderSettings,
          customEndpointConfigured,
        ),
      ),
    ) ?? null
  );
}

export function resolveImageModel(
  aiProviderSettings: unknown,
): TAiImageModelDefinition | null {
  if (!isAiFeatureEnabled("imageGeneration", aiProviderSettings)) return null;
  const override = getAiFeatureModelOverride(
    "imageGeneration",
    aiProviderSettings,
  );
  const available = (definition: TAiImageModelDefinition) =>
    resolveTeamProviderEnabled(aiProviderSettings, definition.provider);
  return (
    aiImageModelDefinitions.find(
      (definition) => definition.key === override && available(definition),
    ) ??
    aiImageModelDefinitions.find(available) ??
    null
  );
}

export function resolveSystemModel(
  feature: SystemFeature,
  aiProviderSettings: unknown,
): SystemModel | null {
  if (!isAiFeatureEnabled(feature, aiProviderSettings)) return null;

  const ladder = getSystemModelsForFeature(feature);
  const override = getSystemFeatureModelOverride(feature, aiProviderSettings);
  const selectedOverride = ladder.find(
    ({ model, provider }) =>
      model === override &&
      resolveTeamProviderEnabled(aiProviderSettings, provider),
  );

  if (selectedOverride) return selectedOverride;

  return (
    ladder.find(({ provider }) =>
      resolveTeamProviderEnabled(aiProviderSettings, provider),
    ) ?? ladder[0]
  );
}

export function updateAiFeatureModelSettings(
  aiProviderSettings: unknown,
  feature: ModelAiFeature,
  model: string | null,
): Record<string, unknown> {
  const nextSettings = isObjectRecord(aiProviderSettings)
    ? { ...aiProviderSettings }
    : {};
  const currentFeatureModels = isObjectRecord(nextSettings.featureModels)
    ? nextSettings.featureModels
    : {};
  const featureModels = { ...currentFeatureModels };

  if (model) featureModels[feature] = model;
  else delete featureModels[feature];

  return { ...nextSettings, featureModels };
}

export function updateSystemFeatureModelSettings(
  aiProviderSettings: unknown,
  feature: SystemFeature,
  model: string | null,
): Record<string, unknown> {
  return updateAiFeatureModelSettings(aiProviderSettings, feature, model);
}

export function updateAiFeatureToggleSettings(
  aiProviderSettings: unknown,
  feature: AiFeature,
  enabled: boolean,
): Record<string, unknown> {
  const nextSettings = isObjectRecord(aiProviderSettings)
    ? { ...aiProviderSettings }
    : {};
  const currentFeatureToggles = isObjectRecord(nextSettings.featureToggles)
    ? nextSettings.featureToggles
    : {};

  return {
    ...nextSettings,
    featureToggles: { ...currentFeatureToggles, [feature]: enabled },
  };
}

export function resetAiFeatureSettings(
  aiProviderSettings: unknown,
): Record<string, unknown> {
  const nextSettings = isObjectRecord(aiProviderSettings)
    ? { ...aiProviderSettings }
    : {};
  delete nextSettings.featureModels;
  delete nextSettings.featureToggles;
  delete nextSettings.dictationProvider;
  return nextSettings;
}
