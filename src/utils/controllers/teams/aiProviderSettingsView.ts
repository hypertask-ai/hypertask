import {
  AI_PROVIDERS,
  isAiProviderKey,
  isGdprSafeModeEnabled,
  resolveTeamProviderEnabled,
  type TAiProviderKey,
} from "@/lib/aiProviders";

export function providerRows(settings: unknown) {
  return AI_PROVIDERS.filter(
    (provider) => !isGdprSafeModeEnabled(settings) || !provider.chinaHosted,
  ).map((provider) => ({
    key: provider.key,
    label: provider.label,
    chinaHosted: provider.chinaHosted,
    gdprNote: provider.gdprNote,
    enabled: resolveTeamProviderEnabled(settings, provider.key),
  }));
}

export function currentProviderOverrides(settings: unknown) {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return {} as Partial<Record<TAiProviderKey, boolean>>;
  }

  const providers = (settings as { providers?: unknown }).providers;
  const source =
    providers && !Array.isArray(providers) && typeof providers === "object"
      ? (providers as Record<string, unknown>)
      : (settings as Record<string, unknown>);

  return Object.fromEntries(
    Object.entries(source).filter(
      ([key, value]) => isAiProviderKey(key) && typeof value === "boolean",
    ),
  ) as Partial<Record<TAiProviderKey, boolean>>;
}

export function currentSettings(settings: unknown): Record<string, unknown> {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return {};
  }

  return settings as Record<string, unknown>;
}
