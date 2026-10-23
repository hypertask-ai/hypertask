
export type DictationProvider = "deepgram";

export const DEFAULT_DICTATION_PROVIDER: DictationProvider = "deepgram";

export const DICTATION_PROVIDER_OPTIONS: {
  value: DictationProvider;
  label: string;
}[] = [
  { value: "deepgram", label: "Deepgram" },
];

const DICTATION_PROVIDER_LABELS: Record<DictationProvider, string> = {
  deepgram: "Deepgram",
};

export function isDictationProvider(value: unknown): value is DictationProvider {
  return value === "deepgram";
}

export function dictationProviderLabel(provider: DictationProvider): string {
  return DICTATION_PROVIDER_LABELS[provider];
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && !Array.isArray(value) && typeof value === "object";

export function resolveDictationProvider(
  aiProviderSettings: unknown,
): DictationProvider {
  if (!isObjectRecord(aiProviderSettings)) return DEFAULT_DICTATION_PROVIDER;
  const value = aiProviderSettings.dictationProvider;
  return isDictationProvider(value) ? value : DEFAULT_DICTATION_PROVIDER;
}

export function updateDictationProviderSettings(
  aiProviderSettings: unknown,
  provider: DictationProvider,
): Record<string, unknown> {
  const nextSettings = isObjectRecord(aiProviderSettings)
    ? { ...aiProviderSettings }
    : {};

  if (provider === DEFAULT_DICTATION_PROVIDER) {
    delete nextSettings.dictationProvider;
  } else {
    nextSettings.dictationProvider = provider;
  }

  return nextSettings;
}

export const DEFAULT_DICTATION_LANGUAGE = "en";

export const DICTATION_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "hi", label: "Hindi" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "multi", label: "Multilingual (auto-detect)" },
];

const DICTATION_LANGUAGE_VALUES = new Set(
  DICTATION_LANGUAGE_OPTIONS.map((option) => option.value),
);

export function isDictationLanguage(value: unknown): value is string {
  return typeof value === "string" && DICTATION_LANGUAGE_VALUES.has(value);
}

export function resolveDictationLanguage(value: unknown): string {
  return isDictationLanguage(value) ? value : DEFAULT_DICTATION_LANGUAGE;
}
