import { type TAiModelOption, defaultAiModelOption, getAiModelOptionById } from "@/lib/aiModelOptions";
import { type UserFacingModelFeature, resolveUserFacingModelOption } from "@/lib/systemModelLadder";
import { filterModelOptionForTeam } from "@/app/api/ai/_lib/providerGate";
import { type AiModelCredential, type AiGatewayTags, type AiProviderOptions, aiUsageProviderForCredential, isVercelAiGatewayKey, resolveAiModel, providerOptionsForAiModel, isCustomEndpointConfig } from "@/app/api/ai/_lib/modelProvider";
import { type LanguageModel } from "ai";
import { CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES } from "@/lib/ai/chatStream/prompt";
import { ProviderId } from "@/lib/ai/chatStream/types";
import { DEFAULT_PROVIDER, CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, OPENAI_MODELS, DEFAULT_MODEL } from "@/lib/ai/tools/constants";

export function claudeAcceptsTemperature(model: string | null | undefined) {
  const normalized = String(model || "").toLowerCase();
  return !CLAUDE_TEMPERATURE_UNSUPPORTED_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function selectionFromModelOption(option: TAiModelOption): {
  provider: ProviderId;
  model: string;
  modelOption: TAiModelOption;
} {
  return {
    provider: option.source,
    model: option.model,
    modelOption: option,
  };
}

export type ModelSelection = {
  provider: ProviderId;
  model: string;
  modelOption?: TAiModelOption;
};

export function defaultModelSelection(
  settings?: unknown,
  feature: UserFacingModelFeature = "aiChat",
  personalModelOptionId?: string | null,
  customEndpointConfigured = true,
  defaultModelOption = defaultAiModelOption,
  haiku55Enabled = defaultModelOption.modelKey === "claude-haiku-5-5",
) {
  const option = resolveUserFacingModelOption(
    feature,
    settings,
    personalModelOptionId,
    { customEndpointConfigured, defaultModelOption, haiku55Enabled },
  );
  if (!option) throw new Error("This AI feature is turned off for your team");
  return selectionFromModelOption(filterModelOptionForTeam(option, settings, haiku55Enabled));
}

export function normalizeProviderId(provider: string | null | undefined): ProviderId {
  const source = String(provider ?? "").trim().toLowerCase();
  if (
    source === "claude" ||
    source === "openai" ||
    source === "openrouter" ||
    source === "gateway" ||
    source === "custom"
  ) {
    return source;
  }
  return DEFAULT_PROVIDER;
}

export function resolveModelSelection(
  providerInput: string | null | undefined,
  modelInput: string | null | undefined,
  modelOptionId: string | null | undefined,
  settings: unknown,
  feature: UserFacingModelFeature,
  personalModelOptionId: string | null,
  defaultModelOption: TAiModelOption,
  haiku55Enabled = defaultModelOption.modelKey === "claude-haiku-5-5",
): ModelSelection {
  const provider = normalizeProviderId(providerInput);
  const requestedModel = modelInput?.trim();

  if (provider === "openrouter" && requestedModel) {
    return { provider, model: requestedModel };
  }

  const modelOption =
    getAiModelOptionById(modelOptionId, haiku55Enabled) ?? getAiModelOptionById(requestedModel, haiku55Enabled);
  if (modelOption) return selectionFromModelOption(modelOption);

  return defaultModelSelection(
    settings,
    feature,
    personalModelOptionId,
    true,
    defaultModelOption,
    haiku55Enabled,
  );
}

export function selectModel(
  provider: ProviderId,
  modelId: string | null | undefined,
  byokCredential: AiModelCredential | undefined,
  modelOption?: TAiModelOption,
  tags?: AiGatewayTags
): {
  model: LanguageModel;
  settings: { temperature?: number; maxOutputTokens?: number };
  providerOptions?: AiProviderOptions;
  usageProvider: string;
  resolvedModelId: string;
} {
  const requestedModel = modelId?.trim();
  const usageProvider = aiUsageProviderForCredential(
    provider,
    byokCredential,
    modelOption
  );

  switch (provider) {
    case "claude": {
      const model =
        requestedModel && CLAUDE_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_CLAUDE_MODEL;
      const directModel = typeof byokCredential === "string" &&
        !isVercelAiGatewayKey(byokCredential)
        ? modelOption?.directModel ?? model
        : model;
      const aiModel = resolveAiModel(provider, directModel, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: claudeAcceptsTemperature(model) ? { temperature: 0.2 } : {},
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openai": {
      const model =
        requestedModel && OPENAI_MODELS.has(requestedModel)
          ? requestedModel
          : DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: {
          temperature: /^gpt-([5-9]|\d{2,})/.test(model.toLowerCase()) ? 1 : 0.2,
        },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "openrouter": {
      const model = requestedModel || DEFAULT_MODEL;
      const aiModel = resolveAiModel(provider, model, byokCredential);
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(aiModel, "chat", tags),
      };
    }
    case "gateway": {
      const model = requestedModel || defaultAiModelOption.model;
      const aiModel = resolveAiModel(
        provider,
        model,
        byokCredential,
        modelOption
      );
      return {
        model: aiModel,
        resolvedModelId: model,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
        providerOptions: providerOptionsForAiModel(
          aiModel,
          "chat",
          tags,
          modelOption
        ),
      };
    }
    case "custom": {
      if (!isCustomEndpointConfig(byokCredential)) {
        throw new Error("A complete custom endpoint is required");
      }
      return {
        model: resolveAiModel(provider, "custom", byokCredential),
        resolvedModelId: byokCredential.modelId,
        usageProvider,
        settings: { temperature: 0.2, maxOutputTokens: 16000 },
      };
    }
  }
}
