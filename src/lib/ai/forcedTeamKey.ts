import { getAiModelDefinition, type TAiModelKey } from "@/lib/aiModelOptions";
import {
  AI_GATEWAY_BYOK_PROVIDER,
  BASETEN_BYOK_PROVIDER,
  BASETEN_MODEL_SLUGS,
  getAiProviderByByokKey,
  getAiProviderInfo,
  isByokProviderKey,
  type TByokProviderKey,
} from "@/lib/aiProviders";

export function forcedByokProvider(
  keys: { provider: string; enabled: boolean; alwaysUse?: boolean }[] | null | undefined,
): TByokProviderKey | null {
  const match = keys?.find((key) => key.enabled && key.alwaysUse === true);
  return match && isByokProviderKey(match.provider) ? match.provider : null;
}

export function forcedKeyLabel(provider: TByokProviderKey) {
  if (provider === "baseten") return BASETEN_BYOK_PROVIDER.label;
  if (provider === "gateway") return AI_GATEWAY_BYOK_PROVIDER.label;
  if (provider === "custom") return "custom";
  return getAiProviderByByokKey(provider)?.label ?? provider;
}

export function forcedTeamKeyPauseMessage(provider: TByokProviderKey) {
  return `Always use this key is on for ${forcedKeyLabel(provider)}. AI is paused because this request cannot use that key. Allowance is not used.`;
}

export function isOwnKeyOnlySettings(settings: unknown) {
  return Boolean(
    settings &&
      typeof settings === "object" &&
      !Array.isArray(settings) &&
      (settings as { ownKeyOnly?: unknown }).ownKeyOnly === true,
  );
}

export function modelOptionMatchesForcedKey(
  option: { modelKey: string; source?: string },
  provider: TByokProviderKey,
) {
  if (provider === "custom") return option.source === "custom" || option.modelKey === "custom";
  if (provider === "baseten") return Object.hasOwn(BASETEN_MODEL_SLUGS, option.modelKey);
  if (provider === "gateway") return option.source !== "custom" && option.modelKey !== "custom";
  const definition = getAiModelDefinition(option.modelKey as TAiModelKey);
  if (!definition || definition.provider === "custom") return false;
  return getAiProviderInfo(definition.provider)?.byokKey === provider;
}
