/**
 * Dictation provider selection (shared, dependency-free).
 *
 * Voice dictation is transcribed by Deepgram. The provider value remains in
 * team settings for API compatibility, but legacy `openai` values now resolve
 * to Deepgram because Hypertask no longer keeps a direct OpenAI API key.
 */

export type DictationProvider = "deepgram";

/**
 * Default provider when a team has made no explicit choice.
 * Switched from OpenAI to Deepgram on 2026-07-20 (voice-dictation provider swap).
 */
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

/**
 * Read the dictation provider from a team's `aiProviderSettings` blob,
 * falling back to the product default.
 */
export function resolveDictationProvider(
  aiProviderSettings: unknown,
): DictationProvider {
  if (!isObjectRecord(aiProviderSettings)) return DEFAULT_DICTATION_PROVIDER;
  const value = aiProviderSettings.dictationProvider;
  return isDictationProvider(value) ? value : DEFAULT_DICTATION_PROVIDER;
}

/**
 * Return a new settings blob with the dictation provider set. Passing the
 * default provider clears the key so settings stay minimal.
 */
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

/**
 * Dictation languages offered in Settings. These are Deepgram Nova-3 language
 * codes; "multi" turns on automatic code-switching across the whole set (English
 * plus the nine below) within a single recording, so a user who mixes two
 * languages gets both transcribed. Stored per-user on `UserSetting.dictationLanguage`.
 */
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

/** Coerce any stored/incoming value to a valid language, defaulting to English. */
export function resolveDictationLanguage(value: unknown): string {
  return isDictationLanguage(value) ? value : DEFAULT_DICTATION_LANGUAGE;
}
