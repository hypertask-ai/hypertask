import {
  aiModelOptions,
  getDefaultAiModelOptionForPlan,
  hasHaikuByokProvider,
  isAiModelOptionVisible,
  getAiModelDefinition,
  isPremiumAiModelDefinition,
  pickAutoAiModelOption,
  preferredAiModelOption,
  type TAiModelOption,
  type AiDefaultModelContext,
} from "@/lib/aiModelOptions";
import { getAiProviderInfo, type TAiProviderKey } from "@/lib/aiProviders";
import {
  isAiFeatureEnabled,
  isAiFeatureModelEnabled,
  resolveUserFacingModelOption,
} from "@/lib/systemModelLadder";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";
import { modelOptionsForKeyOnlyTeam } from "@/lib/ai/teamAiFunding";

export type ComposerModel = {
  id: string;
  title: string;
  description: string;
  model: string;
  provider: string;
};

type ComposerConfigInput = {
  settings: unknown;
  customEndpointConfigured: boolean;
  storePlanId: StorePlanKind;
  providersWithByok: ReadonlySet<string>;
  haiku55Enabled?: boolean;
  grokGemini4Enabled?: boolean;
  haikuDefaultEnabled?: boolean;
  defaultContext?: AiDefaultModelContext;
  keyOnlySavedProviders?: readonly string[] | null;
};

function canUseModelForPlan(
  option: TAiModelOption,
  storePlanId: StorePlanKind,
  providersWithByok: ReadonlySet<string>,
) {
  const definition = getAiModelDefinition(option.modelKey);
  if (!isPremiumAiModelDefinition(definition, storePlanId === "Free")) return true;
  if (storePlanId === "Free") return false;
  if (storePlanId !== "BYOK") return true;
  const provider = definition?.provider;
  return Boolean(provider && providersWithByok.has(provider));
}

function toComposerModel(option: TAiModelOption): ComposerModel {
  return {
    id: option.id,
    title: option.title,
    description: option.desc,
    model: option.model,
    provider: option.source,
  };
}

export function buildComposerConfig(input: ComposerConfigInput) {
  const enabled = isAiFeatureEnabled("aiChat", input.settings);
  const matchedOptions = enabled
    ? aiModelOptions.filter(
        (option) =>
          isAiModelOptionVisible(option, Boolean(input.haiku55Enabled), false, Boolean(input.grokGemini4Enabled)) &&
          isAiFeatureModelEnabled(
            "aiChat",
            option.id,
            input.settings,
            input.customEndpointConfigured,
          ) &&
          canUseModelForPlan(
            option,
            input.storePlanId,
            input.providersWithByok,
          ),
      )
    : [];
  const allowedOptions = input.keyOnlySavedProviders
    ? modelOptionsForKeyOnlyTeam(matchedOptions, input.keyOnlySavedProviders, (modelKey) => {
        const definition = getAiModelDefinition(modelKey as TAiModelOption["modelKey"]);
        return definition ? { provider: definition.provider } : undefined;
      })
    : matchedOptions;
  const defaultContext = { ...input.defaultContext, haikuDefaultEnabled: input.haikuDefaultEnabled, plan: input.storePlanId, hasByok: hasHaikuByokProvider(input.providersWithByok) };
  const boardDefault = resolveUserFacingModelOption(
    "aiChat",
    input.settings,
    null,
    {
      customEndpointConfigured: input.customEndpointConfigured,
      haiku55Enabled: input.haiku55Enabled,
      ...defaultContext,
      defaultModelOption:
        input.haiku55Enabled
          ? getDefaultAiModelOptionForPlan(input.storePlanId, defaultContext.hasByok, true, input.haikuDefaultEnabled, defaultContext)
          : input.storePlanId === "Free"
          ? preferredAiModelOption
          : undefined,
    },
  );
  const selected =
    allowedOptions.find((option) => option.id === boardDefault?.id) ??
    pickAutoAiModelOption(allowedOptions, input.haiku55Enabled, defaultContext) ??
    null;
  const blockedReason = !enabled
    ? "AI chat is disabled for this board."
    : allowedOptions.length === 0
      ? "No AI model is available for this board and plan."
      : null;

  return {
    enabled: enabled && allowedOptions.length > 0,
    blockedReason,
    selectedModelId: selected?.id ?? null,
    models: allowedOptions.map(toComposerModel),
    dictation: {
      enabled: isAiFeatureEnabled("dictation", input.settings),
      blockedReason: isAiFeatureEnabled("dictation", input.settings)
        ? null
        : "Dictation is disabled for this board.",
    },
  };
}

export function providersRequiringByokCheck() {
  return Array.from(
    new Set(
      aiModelOptions
        .map((option) => getAiModelDefinition(option.modelKey))
        .filter((definition) => isPremiumAiModelDefinition(definition))
        .map((definition) => definition?.provider)
        .filter(
          (provider): provider is TAiProviderKey =>
            provider !== undefined && provider !== "custom",
        ),
    ),
  ).map((provider) => ({ provider, byokKey: getAiProviderInfo(provider)?.byokKey }));
}
