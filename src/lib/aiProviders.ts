export type TAiProviderKey =
  | "openai"
  | "anthropic"
  | "google"
  | "xai"
  | "deepseek"
  | "moonshot"
  | "alibaba"
  | "zhipu"
  | "openrouter";

export type TByokProviderKey =
  | "gateway"
  | "custom"
  | "openai"
  | "claude"
  | "google"
  | "xai"
  | "deepseek"
  | "moonshot"
  | "zhipu"
  | "alibaba"
  | "openrouter";

type TByokProviderInfo = {
  byokKey: TByokProviderKey;
  keyUrl: string;
  keyUrlLabel: string;
  keyPlaceholder: string;
  openAiCompatibleBaseUrl?: string;
};

export type TAiProviderInfo = TByokProviderInfo & {
  key: TAiProviderKey;
  label: string;
  badge?: string;
  defaultEnabled: boolean;
  chinaHosted: boolean;
  requestDestination: string;
  gdprNote?: string;
};

const CHINA_HOSTED_GDPR_NOTE =
  "Models are served by a China-based provider. Prompts and task content sent to these models may be processed outside the EU.";

export const AI_PROVIDERS: TAiProviderInfo[] = [
  {
    key: "openai",
    label: "OpenAI",
    defaultEnabled: true,
    chinaHosted: false,
    requestDestination: "OpenAI",
    byokKey: "openai",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "platform.openai.com/api-keys",
    keyPlaceholder: "Enter your OpenAI API key",
  },
  {
    key: "anthropic",
    label: "Anthropic",
    defaultEnabled: true,
    chinaHosted: false,
    requestDestination: "Anthropic",
    byokKey: "claude",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "console.anthropic.com/settings/keys",
    keyPlaceholder: "Enter your Anthropic API key",
  },
  {
    key: "google",
    label: "Google",
    defaultEnabled: true,
    chinaHosted: false,
    requestDestination: "Google",
    byokKey: "google",
    keyUrl: "https://aistudio.google.com/apikey",
    keyUrlLabel: "aistudio.google.com/apikey",
    keyPlaceholder: "Enter your Google AI Studio key",
    openAiCompatibleBaseUrl:
      "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    key: "xai",
    label: "xAI",
    defaultEnabled: true,
    chinaHosted: false,
    requestDestination: "xAI",
    byokKey: "xai",
    keyUrl: "https://console.x.ai",
    keyUrlLabel: "console.x.ai",
    keyPlaceholder: "Enter your xAI API key",
    openAiCompatibleBaseUrl: "https://api.x.ai/v1",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    defaultEnabled: false,
    chinaHosted: true,
    requestDestination: "DeepSeek (China-hosted)",
    gdprNote: CHINA_HOSTED_GDPR_NOTE,
    byokKey: "deepseek",
    keyUrl: "https://platform.deepseek.com",
    keyUrlLabel: "platform.deepseek.com",
    keyPlaceholder: "Enter your DeepSeek API key",
    openAiCompatibleBaseUrl: "https://api.deepseek.com",
  },
  {
    key: "moonshot",
    label: "Moonshot (Kimi)",
    defaultEnabled: false,
    chinaHosted: true,
    requestDestination: "Moonshot (China-hosted)",
    gdprNote: CHINA_HOSTED_GDPR_NOTE,
    byokKey: "moonshot",
    keyUrl: "https://platform.moonshot.ai",
    keyUrlLabel: "platform.moonshot.ai",
    keyPlaceholder: "Enter your Moonshot API key",
    openAiCompatibleBaseUrl: "https://api.moonshot.ai/v1",
  },
  {
    key: "zhipu",
    label: "Z.ai (GLM)",
    defaultEnabled: false,
    chinaHosted: true,
    requestDestination: "Z.ai (China-hosted)",
    gdprNote: CHINA_HOSTED_GDPR_NOTE,
    byokKey: "zhipu",
    keyUrl: "https://z.ai/model-api",
    keyUrlLabel: "z.ai/model-api",
    keyPlaceholder: "Enter your Z.ai API key",
    openAiCompatibleBaseUrl: "https://api.z.ai/api/paas/v4",
  },
  {
    key: "alibaba",
    label: "Alibaba (Qwen)",
    defaultEnabled: false,
    chinaHosted: true,
    requestDestination: "Alibaba (China-hosted)",
    gdprNote: CHINA_HOSTED_GDPR_NOTE,
    byokKey: "alibaba",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
    keyUrlLabel: "dashscope.console.aliyun.com",
    keyPlaceholder: "Enter your DashScope API key",
    openAiCompatibleBaseUrl:
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    badge: "Aggregator",
    defaultEnabled: false,
    chinaHosted: false,
    requestDestination: "OpenRouter",
    byokKey: "openrouter",
    keyUrl: "https://openrouter.ai/keys",
    keyUrlLabel: "openrouter.ai/keys",
    keyPlaceholder: "Enter your OpenRouter API key",
  },
];

export const AI_GATEWAY_BYOK_PROVIDER: TByokProviderInfo & {
  byokKey: "gateway";
  label: string;
} = {
  byokKey: "gateway",
  label: "Vercel AI Gateway",
  keyUrl: "https://vercel.com/ai-gateway",
  keyUrlLabel: "vercel.com/ai-gateway",
  keyPlaceholder: "Enter your Vercel AI Gateway key (vck_)",
};

export const BYOK_PROVIDER_KEYS: TByokProviderKey[] = [
  AI_GATEWAY_BYOK_PROVIDER.byokKey,
  ...AI_PROVIDERS.map((provider) => provider.byokKey),
  "custom",
];

const BYOK_PROVIDER_KEY_SET = new Set<TByokProviderKey>(BYOK_PROVIDER_KEYS);

const PROVIDER_BY_KEY = new Map(
  AI_PROVIDERS.map((provider) => [provider.key, provider]),
);

export function isAiProviderKey(value: unknown): value is TAiProviderKey {
  return (
    typeof value === "string" && PROVIDER_BY_KEY.has(value as TAiProviderKey)
  );
}

export function getAiProviderInfo(provider: TAiProviderKey) {
  return PROVIDER_BY_KEY.get(provider);
}

export function isByokProviderKey(value: unknown): value is TByokProviderKey {
  return (
    typeof value === "string" &&
    BYOK_PROVIDER_KEY_SET.has(value as TByokProviderKey)
  );
}

export function getAiProviderByByokKey(provider: TByokProviderKey) {
  return AI_PROVIDERS.find((candidate) => candidate.byokKey === provider);
}

export function isByokProviderRestrictedInGdprSafeMode(
  provider: TByokProviderKey,
): boolean {
  return Boolean(getAiProviderByByokKey(provider)?.chinaHosted);
}

export function isGdprSafeModeEnabled(settings: unknown): boolean {
  return Boolean(
    settings &&
    !Array.isArray(settings) &&
    typeof settings === "object" &&
    (settings as { gdprSafeMode?: unknown }).gdprSafeMode === true,
  );
}

type GdprProviderTestLease = { id: string; expiresAt: number };

export function getActiveGdprProviderTestLease(
  settings: unknown,
  now = Date.now(),
): GdprProviderTestLease | null {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return null;
  }
  const lease = (settings as { gdprProviderTestLease?: unknown })
    .gdprProviderTestLease;
  if (!lease || Array.isArray(lease) || typeof lease !== "object") return null;
  const { id, expiresAt } = lease as { id?: unknown; expiresAt?: unknown };
  return typeof id === "string" &&
    typeof expiresAt === "number" &&
    expiresAt > now
    ? { id, expiresAt }
    : null;
}

export function setGdprProviderTestLease(
  settings: unknown,
  lease: GdprProviderTestLease,
): Record<string, unknown> {
  const current =
    settings && !Array.isArray(settings) && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  return { ...current, gdprProviderTestLease: lease };
}

export function clearGdprProviderTestLease(
  settings: unknown,
  leaseId: string,
): Record<string, unknown> {
  const current =
    settings && !Array.isArray(settings) && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  const lease = current.gdprProviderTestLease;
  if (
    !lease ||
    Array.isArray(lease) ||
    typeof lease !== "object" ||
    (lease as { id?: unknown }).id !== leaseId
  ) {
    return current;
  }
  const next = { ...current };
  delete next.gdprProviderTestLease;
  return next;
}

function explicitProviderValue(
  settings: unknown,
  provider: TAiProviderKey,
): boolean | undefined {
  if (!settings || Array.isArray(settings) || typeof settings !== "object") {
    return undefined;
  }

  const providers = (settings as { providers?: unknown }).providers;
  const source =
    providers && !Array.isArray(providers) && typeof providers === "object"
      ? (providers as Record<string, unknown>)
      : (settings as Record<string, unknown>);
  const value = source[provider];
  return typeof value === "boolean" ? value : undefined;
}

export function resolveTeamProviderEnabled(
  settings: unknown,
  provider: TAiProviderKey,
): boolean {
  if (
    isGdprSafeModeEnabled(settings) &&
    PROVIDER_BY_KEY.get(provider)?.chinaHosted
  ) {
    return false;
  }
  const explicit = explicitProviderValue(settings, provider);
  if (explicit !== undefined) return explicit;
  return PROVIDER_BY_KEY.get(provider)?.defaultEnabled ?? false;
}

export function enabledProvidersForTeam(settings: unknown): TAiProviderKey[] {
  return AI_PROVIDERS.filter((provider) =>
    resolveTeamProviderEnabled(settings, provider.key),
  ).map((provider) => provider.key);
}
