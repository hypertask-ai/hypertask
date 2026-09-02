import type { TAiProviderKey } from "@/lib/aiProviders";
import type { StorePlanKind } from "@/lib/planFromStripePriceId";

export type TModelProvider =
  | "claude"
  | "openai"
  | "openrouter"
  | "gateway"
  | "custom";

export type TAiReasoningVariant = "instant" | "thinking" | "mini";

export type TAiModelKey =
  | "gpt-5.6-luna"
  | "gpt-5.6-terra"
  | "gpt-5.6-sol"
  | "gpt-5.5"
  | "gpt-5.4-mini"
  | "claude-sonnet-5"
  | "claude-opus-5"
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k2.6"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.2"
  | "gemini-3.5-flash-lite"
  | "gemini-3.6-flash"
  | "grok-4.1-fast"
  | "grok-4.20"
  | "grok-4.5"
  | "claude-haiku-4.5"
  | "custom";

export type TAiEffort = "light" | "standard" | "high";

export type TAiModelOptionId =
  | "gpt-5.5-instant"
  | "gpt-5.5-thinking"
  | "gpt-5.6-luna"
  | "gpt-5.6-luna-light"
  | "gpt-5.6-luna-high"
  | "gpt-5.6-terra"
  | "gpt-5.6-terra-light"
  | "gpt-5.6-terra-high"
  | "gpt-5.6-sol"
  | "gpt-5.6-sol-light"
  | "gpt-5.6-sol-high"
  | "gpt-5.4-mini"
  | "claude-sonnet-5-instant"
  | "claude-sonnet-5-thinking"
  | "claude-opus-5-instant"
  | "claude-opus-5-thinking"
  | "deepseek-v4-flash"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k2.6"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.2"
  | "gemini-3.5-flash-lite"
  | "gemini-3.6-flash"
  | "grok-4.1-fast-instant"
  | "grok-4.1-fast-thinking"
  | "grok-4.20-instant"
  | "grok-4.20-thinking"
  | "grok-4.5"
  | "claude-haiku-4.5"
  | "custom";

export type TAiProviderOptions = Record<string, Record<string, any>>;

export type TAiModelOption = {
  id: TAiModelOptionId;
  source: Exclude<TModelProvider, "openrouter">;
  title: string;
  model: string;
  directModel?: string;
  desc: string;
  reasoning: TAiReasoningVariant;
  modelKey: TAiModelKey;
  effort?: TAiEffort;
  providerOptions?: TAiProviderOptions;
};

export type TAiModelDefinition = {
  key: TAiModelKey;
  label: string;
  provider: TAiProviderKey | "custom";
  priceTier?: 1 | 2 | 3;
  premium?: boolean;
};

export type TAiImageModelKey = "nano-banana" | "gpt-image";

export type TAiImageModelDefinition = {
  key: TAiImageModelKey;
  label: string;
  gatewayModel: string;
  provider: TAiProviderKey;
  generation: "language" | "image";
  premium: true;
};

export const aiModelDefinitions: TAiModelDefinition[] = [
  { key: "gpt-5.6-luna", label: "5.6 Luna", provider: "openai", priceTier: 2 },
  {
    key: "gpt-5.6-terra",
    label: "5.6 Terra",
    provider: "openai",
    priceTier: 2,
  },
  {
    key: "gpt-5.6-sol",
    label: "5.6 Sol",
    provider: "openai",
    priceTier: 3,
    premium: true,
  },
  { key: "gpt-5.5", label: "GPT-5.5", provider: "openai", priceTier: 3 },
  {
    key: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    provider: "openai",
    priceTier: 1,
  },
  {
    key: "claude-opus-5",
    label: "Opus 5",
    provider: "anthropic",
    priceTier: 3,
    premium: true,
  },
  {
    key: "claude-sonnet-5",
    label: "Sonnet 5",
    provider: "anthropic",
    priceTier: 2,
  },
  {
    key: "claude-haiku-4.5",
    label: "Haiku 4.5",
    provider: "anthropic",
    priceTier: 1,
  },
  {
    key: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    priceTier: 1,
  },
  {
    key: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    priceTier: 1,
  },
  { key: "kimi-k2.5", label: "Kimi K2.5", provider: "moonshot", priceTier: 1 },
  { key: "kimi-k2.6", label: "Kimi K2.6", provider: "moonshot", priceTier: 2 },
  { key: "kimi-k3", label: "Kimi K3", provider: "moonshot", priceTier: 3 },
  {
    key: "qwen3.7-plus",
    label: "Qwen3.7 Plus",
    provider: "alibaba",
    priceTier: 1,
  },
  { key: "glm-5.2", label: "GLM-5.2", provider: "zhipu", priceTier: 2 },
  {
    key: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    provider: "google",
    priceTier: 1,
  },
  {
    key: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    provider: "google",
    priceTier: 2,
  },
  {
    key: "grok-4.1-fast",
    label: "Grok 4.1 Fast",
    provider: "xai",
    priceTier: 1,
  },
  {
    key: "grok-4.20",
    label: "Grok 4.20",
    provider: "xai",
    priceTier: 2,
  },
  {
    key: "grok-4.5",
    label: "Grok 4.5",
    provider: "xai",
    priceTier: 3,
    premium: true,
  },
  {
    key: "custom",
    label: "Custom endpoint",
    provider: "custom",
  },
];

export const aiImageModelDefinitions: TAiImageModelDefinition[] = [
  {
    key: "nano-banana",
    label: "Nano Banana",
    gatewayModel: "google/gemini-3-pro-image",
    provider: "google",
    generation: "language",
    premium: true,
  },
  {
    key: "gpt-image",
    label: "GPT Image",
    gatewayModel: "openai/gpt-image-1",
    provider: "openai",
    generation: "image",
    premium: true,
  },
];

export const aiEffortLabels: Record<TAiEffort, string> = {
  light: "Light",
  standard: "Standard",
  high: "High",
};

export function getAiEffortLabel(
  modelKey: TAiModelKey,
  effort: TAiEffort
): string {
  if (
    modelKey === "gpt-5.5" ||
    modelKey.startsWith("claude-") ||
    modelKey.startsWith("grok-")
  ) {
    return effort === "light" ? "Instant" : "Thinking";
  }

  return aiEffortLabels[effort];
}

export const aiModelOptions: TAiModelOption[] = [
  {
    id: "gpt-5.5-instant",
    source: "openai",
    title: "GPT 5.5 Instant",
    model: "gpt-5.5",
    desc: "Fastest replies",
    reasoning: "instant",
    modelKey: "gpt-5.5",
    effort: "light",
    providerOptions: {
      // "minimal" returns empty completions through the task-writer/editor
      // system prompts on gpt-5.5; "low" is the fastest effort that still
      // produces output. See HTPR-3970.
      openai: {
        reasoningEffort: "low",
      },
    },
  },
  {
    id: "gpt-5.5-thinking",
    source: "openai",
    title: "GPT 5.5 Thinking",
    model: "gpt-5.5",
    desc: "Full reasoning, slower",
    reasoning: "thinking",
    modelKey: "gpt-5.5",
    effort: "high",
    providerOptions: {
      openai: {
        reasoningEffort: "high",
      },
    },
  },
  {
    id: "gpt-5.6-luna",
    source: "openai",
    title: "GPT 5.6 Luna",
    model: "gpt-5.6-luna",
    desc: "Cheap and fast",
    reasoning: "instant",
    modelKey: "gpt-5.6-luna",
    effort: "standard",
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
      },
    },
  },
  {
    id: "gpt-5.6-luna-light",
    source: "openai",
    title: "GPT 5.6 Luna Light",
    model: "gpt-5.6-luna",
    desc: "Fastest Luna replies",
    reasoning: "instant",
    modelKey: "gpt-5.6-luna",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-5.6-luna-high",
    source: "openai",
    title: "GPT 5.6 Luna High",
    model: "gpt-5.6-luna",
    desc: "Deep Luna reasoning",
    reasoning: "thinking",
    modelKey: "gpt-5.6-luna",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "gpt-5.6-terra",
    source: "openai",
    title: "GPT 5.6 Terra",
    model: "gpt-5.6-terra",
    desc: "Balanced mid tier",
    reasoning: "instant",
    modelKey: "gpt-5.6-terra",
    effort: "standard",
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  {
    id: "gpt-5.6-terra-light",
    source: "openai",
    title: "GPT 5.6 Terra Light",
    model: "gpt-5.6-terra",
    desc: "Fastest Terra replies",
    reasoning: "instant",
    modelKey: "gpt-5.6-terra",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-5.6-terra-high",
    source: "openai",
    title: "GPT 5.6 Terra High",
    model: "gpt-5.6-terra",
    desc: "Deep Terra reasoning",
    reasoning: "thinking",
    modelKey: "gpt-5.6-terra",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "gpt-5.6-sol",
    source: "openai",
    title: "GPT 5.6 Sol",
    model: "gpt-5.6-sol",
    desc: "OpenAI flagship",
    reasoning: "thinking",
    modelKey: "gpt-5.6-sol",
    effort: "standard",
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  {
    id: "gpt-5.6-sol-light",
    source: "openai",
    title: "GPT 5.6 Sol Light",
    model: "gpt-5.6-sol",
    desc: "Fastest Sol replies",
    reasoning: "instant",
    modelKey: "gpt-5.6-sol",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-5.6-sol-high",
    source: "openai",
    title: "GPT 5.6 Sol High",
    model: "gpt-5.6-sol",
    desc: "Deep Sol reasoning",
    reasoning: "thinking",
    modelKey: "gpt-5.6-sol",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "gpt-5.4-mini",
    source: "openai",
    title: "GPT 5.4 Mini",
    model: "gpt-5.4-mini",
    desc: "Lightweight and quick",
    reasoning: "mini",
    modelKey: "gpt-5.4-mini",
  },
  {
    id: "claude-opus-5-instant",
    source: "claude",
    title: "Opus 5 Instant",
    model: "claude-opus-5",
    desc: "Fast premium Claude",
    reasoning: "instant",
    modelKey: "claude-opus-5",
    effort: "light",
    providerOptions: {
      anthropic: {
        thinking: { type: "disabled" },
        effort: "low",
      },
    },
  },
  {
    id: "claude-opus-5-thinking",
    source: "claude",
    title: "Opus 5 Thinking",
    model: "claude-opus-5",
    desc: "Deep reasoning",
    reasoning: "thinking",
    modelKey: "claude-opus-5",
    effort: "high",
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "high",
      },
    },
  },
  {
    id: "claude-sonnet-5-instant",
    source: "claude",
    title: "Sonnet 5 Instant",
    model: "claude-sonnet-5",
    desc: "Fast Claude replies",
    reasoning: "instant",
    modelKey: "claude-sonnet-5",
    effort: "light",
    providerOptions: {
      anthropic: {
        thinking: { type: "disabled" },
        effort: "low",
      },
    },
  },
  {
    id: "claude-sonnet-5-thinking",
    source: "claude",
    title: "Sonnet 5 Thinking",
    model: "claude-sonnet-5",
    desc: "Adaptive reasoning",
    reasoning: "thinking",
    modelKey: "claude-sonnet-5",
    effort: "high",
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "high",
      },
    },
  },
  {
    id: "claude-haiku-4.5",
    source: "claude",
    title: "Haiku 4.5",
    model: "claude-haiku-4.5",
    desc: "Fast and cheap Claude",
    reasoning: "instant",
    modelKey: "claude-haiku-4.5",
  },
  {
    id: "deepseek-v4-flash",
    source: "gateway",
    title: "DeepSeek V4 Flash",
    model: "deepseek/deepseek-v4-flash",
    desc: "Cheapest general model",
    reasoning: "instant",
    modelKey: "deepseek-v4-flash",
  },
  {
    id: "deepseek-v4-pro",
    source: "gateway",
    title: "DeepSeek V4 Pro",
    model: "deepseek/deepseek-v4-pro",
    desc: "Efficient general model",
    reasoning: "instant",
    modelKey: "deepseek-v4-pro",
  },
  {
    id: "kimi-k2.5",
    source: "gateway",
    title: "Kimi K2.5",
    model: "moonshotai/kimi-k2.5",
    desc: "Cheapest reasoning model",
    reasoning: "thinking",
    modelKey: "kimi-k2.5",
  },
  {
    id: "kimi-k2.6",
    source: "gateway",
    title: "Kimi K2.6",
    model: "moonshotai/kimi-k2.6",
    desc: "Fast general model",
    reasoning: "instant",
    modelKey: "kimi-k2.6",
  },
  {
    id: "kimi-k3",
    source: "gateway",
    title: "Kimi K3",
    model: "moonshotai/kimi-k3",
    desc: "Flagship, 1M context",
    reasoning: "instant",
    modelKey: "kimi-k3",
  },
  {
    id: "qwen3.7-plus",
    source: "gateway",
    title: "Qwen3.7 Plus",
    model: "alibaba/qwen3.7-plus",
    desc: "Strong general model",
    reasoning: "instant",
    modelKey: "qwen3.7-plus",
  },
  {
    id: "glm-5.2",
    source: "gateway",
    title: "GLM-5.2",
    model: "zai/glm-5.2",
    desc: "Fast general model",
    reasoning: "instant",
    modelKey: "glm-5.2",
  },
  {
    id: "gemini-3.5-flash-lite",
    source: "gateway",
    title: "Gemini 3.5 Flash Lite",
    model: "google/gemini-3.5-flash-lite",
    desc: "Cheap and quick",
    reasoning: "instant",
    modelKey: "gemini-3.5-flash-lite",
  },
  {
    id: "gemini-3.6-flash",
    source: "gateway",
    title: "Gemini 3.6 Flash",
    model: "google/gemini-3.6-flash",
    desc: "Newest fast Gemini",
    reasoning: "instant",
    modelKey: "gemini-3.6-flash",
  },
  {
    id: "grok-4.1-fast-instant",
    source: "gateway",
    title: "Grok 4.1 Fast Instant",
    model: "xai/grok-4.1-fast-non-reasoning",
    directModel: "grok-4-1-fast-non-reasoning",
    desc: "Fastest model we offer",
    reasoning: "instant",
    modelKey: "grok-4.1-fast",
    effort: "light",
  },
  {
    id: "grok-4.1-fast-thinking",
    source: "gateway",
    title: "Grok 4.1 Fast Thinking",
    model: "xai/grok-4.1-fast-reasoning",
    directModel: "grok-4-1-fast-reasoning",
    desc: "Fast reasoning",
    reasoning: "thinking",
    modelKey: "grok-4.1-fast",
    effort: "high",
  },
  {
    id: "grok-4.20-instant",
    source: "gateway",
    title: "Grok 4.20 Instant",
    model: "xai/grok-4.20-non-reasoning",
    desc: "Fast general model",
    reasoning: "instant",
    modelKey: "grok-4.20",
    effort: "light",
  },
  {
    id: "grok-4.20-thinking",
    source: "gateway",
    title: "Grok 4.20 Thinking",
    model: "xai/grok-4.20-reasoning",
    desc: "Deep reasoning",
    reasoning: "thinking",
    modelKey: "grok-4.20",
    effort: "high",
  },
  {
    id: "grok-4.5",
    source: "gateway",
    title: "Grok 4.5",
    model: "xai/grok-4.5",
    desc: "xAI flagship",
    reasoning: "thinking",
    modelKey: "grok-4.5",
    effort: "standard",
  },
  {
    id: "custom",
    source: "custom",
    title: "Custom endpoint",
    model: "custom",
    desc: "Your OpenAI-compatible endpoint",
    reasoning: "instant",
    modelKey: "custom",
  },
];

// Luna Standard is the preferred product default for teams entitled to use a
// tier-2 model. Keep the universal fallback included on every plan so callers
// without trusted billing context can never select a locked model implicitly.
export const preferredAiModelOption =
  aiModelOptions.find((option) => option.id === "gpt-5.6-luna") ??
  aiModelOptions[0];

export const defaultAiModelOption =
  aiModelOptions.find((option) => option.id === "gpt-5.4-mini") ??
  aiModelOptions[0];

export const MOBILE_AI_CHAT_QUICK_MODEL_IDS = [
  "gpt-5.6-luna-high",
  "gpt-5.6-luna",
  "gpt-5.6-sol-high",
  "gpt-5.6-sol-light",
] as const satisfies readonly TAiModelOptionId[];

export function getDefaultAiModelOptionForPlan(
  storePlanId: StorePlanKind | null | undefined,
  hasEligibleByokCredential = false,
): TAiModelOption {
  return storePlanId === "Pro" ||
    storePlanId === "AI" ||
    (storePlanId === "BYOK" && hasEligibleByokCredential)
    ? preferredAiModelOption
    : defaultAiModelOption;
}

// Retired option ids map to their replacement so a persisted choice upgrades in
// place instead of silently falling back to the default. HTPR-4534.
const RETIRED_OPTION_ID_ALIASES: Record<string, TAiModelOptionId> = {
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.5-flash": "gemini-3.6-flash",
  "claude-opus-4-8-instant": "claude-opus-5-instant",
  "claude-opus-4-8-thinking": "claude-opus-5-thinking",
};

export function getAiModelOptionById(
  id: string | null | undefined
): TAiModelOption | undefined {
  const normalized = id?.trim();
  if (!normalized) return undefined;
  const resolved = RETIRED_OPTION_ID_ALIASES[normalized] ?? normalized;
  return aiModelOptions.find((option) => option.id === resolved);
}

export function getAiModelDefinition(modelKey: TAiModelKey) {
  return aiModelDefinitions.find((model) => model.key === modelKey);
}

export function getMobileAiChatModelLabel(
  option: { id: string } | undefined,
): string {
  const catalogOption = getAiModelOptionById(option?.id);
  if (!catalogOption) return "Select model";
  const modelLabel = getAiModelDefinition(catalogOption.modelKey)?.label;
  let effortLabel: string | null = null;
  if (catalogOption.id === "gpt-5.6-sol-light") {
    effortLabel = "Fast";
  } else if (catalogOption.effort) {
    effortLabel = getAiEffortLabel(catalogOption.modelKey, catalogOption.effort);
  }
  return [modelLabel, effortLabel].filter(Boolean).join(" · ");
}

export function isPremiumAiModelDefinition(
  model: TAiModelDefinition | undefined,
): boolean {
  return Boolean(model && ((model.priceTier ?? 1) > 1 || model.premium));
}

export function isPremiumAiModelKey(modelKey: TAiModelKey): boolean {
  return isPremiumAiModelDefinition(getAiModelDefinition(modelKey));
}

// The arrays above are in DISPLAY order, so "first available" is whatever we
// happen to show first -- since Opus leads the Anthropic group that would
// auto-select a premium, plan-gated model for teams who never asked for it.
// Every automatic pick goes through here instead: prefer non-premium, and only
// fall back to a premium option when nothing else is available.
export function pickAutoAiModelOption<T extends TAiModelOption>(
  candidates: readonly T[]
): T | undefined {
  return (
    candidates.find(
      (candidate) => !isPremiumAiModelKey(candidate.modelKey)
    ) ?? candidates[0]
  );
}

// Replacing a model the team can no longer use (provider disabled) must not
// cost the user more than the model they picked: a tier-1 choice should not
// silently become tier-3. Prefer candidates at the same price tier or cheaper,
// and only widen the search when that leaves nothing (HTPR-4688).
export function pickReplacementAiModelOption<T extends TAiModelOption>(
  currentModelKey: TAiModelKey,
  candidates: readonly T[]
): T | undefined {
  const tierOf = (modelKey: TAiModelKey) =>
    getAiModelDefinition(modelKey)?.priceTier ?? 3;
  const currentTier = tierOf(currentModelKey);
  const noPricier = candidates.filter(
    (candidate) => tierOf(candidate.modelKey) <= currentTier
  );
  return pickAutoAiModelOption(noPricier.length > 0 ? noPricier : candidates);
}

export function resolveAiModelMention(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return undefined;

  const definition = aiModelDefinitions.find(
    (model) =>
      model.label.toLowerCase() === normalized ||
      model.key.toLowerCase() === normalized
  );
  if (!definition) return undefined;

  const modelOption = getNearestAiModelOption(definition.key);
  return modelOption ? { definition, modelOption } : undefined;
}

export function resolveAiImageModelMention(
  value: string | null | undefined
) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return undefined;

  return aiImageModelDefinitions.find(
    (model) =>
      model.label.toLowerCase() === normalized ||
      model.key.toLowerCase() === normalized
  );
}

export function getAiModelEfforts(
  modelKey: TAiModelKey,
  options: readonly TAiModelOption[] = aiModelOptions
): TAiEffort[] {
  const effortOrder: TAiEffort[] = ["light", "standard", "high"];
  return effortOrder.filter((effort) =>
    options.some((option) => option.modelKey === modelKey && option.effort === effort)
  );
}

export function getAiModelOption(
  modelKey: TAiModelKey,
  effort?: TAiEffort,
  options: readonly TAiModelOption[] = aiModelOptions
) {
  return options.find(
    (option) => option.modelKey === modelKey && option.effort === effort
  );
}

export function getNearestAiModelOption(
  modelKey: TAiModelKey,
  preferredEffort?: TAiEffort,
  options: readonly TAiModelOption[] = aiModelOptions
) {
  const noEffortOption = getAiModelOption(modelKey, undefined, options);
  if (noEffortOption) return noEffortOption;

  const efforts = getAiModelEfforts(modelKey, options);
  if (efforts.length === 0) return undefined;

  const targetIndex = ["light", "standard", "high"].indexOf(
    preferredEffort ?? "standard"
  );
  const nearestEffort = efforts.reduce((nearest, effort) => {
    const distance = Math.abs(
      ["light", "standard", "high"].indexOf(effort) - targetIndex
    );
    const nearestDistance = Math.abs(
      ["light", "standard", "high"].indexOf(nearest) - targetIndex
    );
    return distance < nearestDistance ? effort : nearest;
  });

  return getAiModelOption(modelKey, nearestEffort, options);
}
