import {
  aiModelOptions,
  getAiModelDefinition,
  isPremiumAiModelDefinition,
  pickAutoAiModelOption,
  type TAiModelOption,
} from "@/lib/aiModelOptions";
import { getAiProviderInfo, type TAiProviderKey } from "@/lib/aiProviders";
import {
  isAiFeatureEnabled,
  isAiFeatureModelEnabled,
  resolveUserFacingModelOption,
} from "@/lib/systemModelLadder";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";

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
};

function canUseModelForPlan(
  option: TAiModelOption,
  storePlanId: StorePlanKind,
  providersWithByok: ReadonlySet<string>,
) {
  const definition = getAiModelDefinition(option.modelKey);
  // Custom endpoints are intentionally non-premium and were already gated by
  // isAiFeatureModelEnabled(customEndpointConfigured) before this plan check.
  if (!isPremiumAiModelDefinition(definition)) return true;
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
  const allowedOptions = enabled
    ? aiModelOptions.filter(
        (option) =>
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
  const boardDefault = resolveUserFacingModelOption(
    "aiChat",
    input.settings,
    null,
    { customEndpointConfigured: input.customEndpointConfigured },
  );
  const selected =
    allowedOptions.find((option) => option.id === boardDefault?.id) ??
    pickAutoAiModelOption(allowedOptions) ??
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
        .filter(isPremiumAiModelDefinition)
        .map((definition) => definition?.provider)
        .filter(
          (provider): provider is TAiProviderKey =>
            provider !== undefined && provider !== "custom",
        ),
    ),
  ).map((provider) => ({ provider, byokKey: getAiProviderInfo(provider)?.byokKey }));
}
