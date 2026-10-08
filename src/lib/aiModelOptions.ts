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
  | "gpt-6-luna"
  | "gpt-5.6-terra"
  | "gpt-6.1-sol"
  | "claude-sonnet-5-5"
  | "claude-opus-5-5"
  | "deepseek-v4.1-flash"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.3-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.8-flash"
  | "claude-haiku-4.5"
  | "claude-haiku-5-5"
  | "custom";

export type TAiEffort = "light" | "standard" | "high";

export type TAiModelOptionId =
  | "gpt-6-luna"
  | "gpt-6-luna-light"
  | "gpt-6-luna-high"
  | "gpt-5.6-terra"
  | "gpt-5.6-terra-light"
  | "gpt-5.6-terra-high"
  | "gpt-6.1-sol"
  | "gpt-6.1-sol-light"
  | "gpt-6.1-sol-high"
  | "claude-sonnet-5-5-instant"
  | "claude-sonnet-5-5-thinking"
  | "claude-opus-5-5-instant"
  | "claude-opus-5-5-thinking"
  | "deepseek-v4.1-flash"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.3-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.8-flash"
  | "claude-haiku-4.5"
  | "claude-haiku-5-5"
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
  { key: "gpt-6-luna", label: "6 Luna", provider: "openai", priceTier: 2 },
  {
    key: "gpt-5.6-terra",
    label: "5.6 Terra",
    provider: "openai",
    priceTier: 2,
  },
  {
    key: "gpt-6.1-sol",
    label: "6.1 Sol",
    provider: "openai",
    priceTier: 3,
    premium: true,
  },
  {
    key: "claude-opus-5-5",
    label: "Opus 5.5",
    provider: "anthropic",
    priceTier: 3,
    premium: true,
  },
  {
    key: "claude-sonnet-5-5",
    label: "Sonnet 5.5",
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
    key: "claude-haiku-5-5",
    label: "Haiku 5.5",
    provider: "anthropic",
    priceTier: 1,
  },
  {
    key: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
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
  { key: "kimi-k3", label: "Kimi K3", provider: "moonshot", priceTier: 3 },
  {
    key: "qwen3.7-plus",
    label: "Qwen3.7 Plus",
    provider: "alibaba",
    priceTier: 1,
  },
  { key: "glm-5.3-flash", label: "GLM-5.3 Flash", provider: "zhipu", priceTier: 2 },
  {
    key: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    provider: "google",
    priceTier: 1,
  },
  {
    key: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    priceTier: 2,
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
  if (modelKey.startsWith("claude-")) {
    return effort === "light" ? "Instant" : "Thinking";
  }

  return aiEffortLabels[effort];
}

export const aiModelOptions: TAiModelOption[] = [
  {
    id: "gpt-6-luna",
    source: "openai",
    title: "GPT 6 Luna",
    model: "gpt-6-luna",
    desc: "Cheap and fast",
    reasoning: "instant",
    modelKey: "gpt-6-luna",
    effort: "standard",
    providerOptions: {
      openai: {
        reasoningEffort: "medium",
      },
    },
  },
  {
    id: "gpt-6-luna-light",
    source: "openai",
    title: "GPT 6 Luna Light",
    model: "gpt-6-luna",
    desc: "Fastest Luna replies",
    reasoning: "instant",
    modelKey: "gpt-6-luna",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-6-luna-high",
    source: "openai",
    title: "GPT 6 Luna High",
    model: "gpt-6-luna",
    desc: "Deep Luna reasoning",
    reasoning: "thinking",
    modelKey: "gpt-6-luna",
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
    id: "gpt-6.1-sol",
    source: "openai",
    title: "GPT 6.1 Sol",
    model: "gpt-6.1-sol",
    desc: "OpenAI flagship",
    reasoning: "thinking",
    modelKey: "gpt-6.1-sol",
    effort: "standard",
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  {
    id: "gpt-6.1-sol-light",
    source: "openai",
    title: "GPT 6.1 Sol Light",
    model: "gpt-6.1-sol",
    desc: "Fastest Sol replies",
    reasoning: "instant",
    modelKey: "gpt-6.1-sol",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-6.1-sol-high",
    source: "openai",
    title: "GPT 6.1 Sol High",
    model: "gpt-6.1-sol",
    desc: "Deep Sol reasoning",
    reasoning: "thinking",
    modelKey: "gpt-6.1-sol",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "claude-opus-5-5-instant",
    source: "claude",
    title: "Opus 5.5 Instant",
    model: "claude-opus-5.5",
    directModel: "claude-opus-5-5",
    desc: "Fast premium Claude",
    reasoning: "instant",
    modelKey: "claude-opus-5-5",
    effort: "light",
    providerOptions: {
      anthropic: {
        thinking: { type: "disabled" },
        effort: "low",
      },
    },
  },
  {
    id: "claude-opus-5-5-thinking",
    source: "claude",
    title: "Opus 5.5 Thinking",
    model: "claude-opus-5.5",
    directModel: "claude-opus-5-5",
    desc: "Deep reasoning",
    reasoning: "thinking",
    modelKey: "claude-opus-5-5",
    effort: "high",
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort: "high",
      },
    },
  },
  {
    id: "claude-sonnet-5-5-instant",
    source: "claude",
    title: "Sonnet 5.5 Instant",
    model: "claude-sonnet-5.5",
    directModel: "claude-sonnet-5-5",
    desc: "Fast Claude replies",
    reasoning: "instant",
    modelKey: "claude-sonnet-5-5",
    effort: "light",
    providerOptions: {
      anthropic: {
        thinking: { type: "disabled" },
        effort: "low",
      },
    },
  },
  {
    id: "claude-sonnet-5-5-thinking",
    source: "claude",
    title: "Sonnet 5.5 Thinking",
    model: "claude-sonnet-5.5",
    directModel: "claude-sonnet-5-5",
    desc: "Adaptive reasoning",
    reasoning: "thinking",
    modelKey: "claude-sonnet-5-5",
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
    id: "claude-haiku-5-5",
    source: "claude",
    title: "Haiku 5.5",
    model: "claude-haiku-5.5",
    directModel: "claude-haiku-5-5",
    desc: "Fast and cheap Claude with adaptive thinking",
    reasoning: "thinking",
    modelKey: "claude-haiku-5-5",
    providerOptions: {
      anthropic: { thinking: { type: "adaptive" }, effort: "medium" },
    },
  },
  {
    id: "deepseek-v4.1-flash",
    source: "gateway",
    title: "DeepSeek V4.1 Flash",
    model: "deepseek/deepseek-v4.1-flash",
    desc: "Cheapest general model",
    reasoning: "instant",
    modelKey: "deepseek-v4.1-flash",
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
    id: "glm-5.3-flash",
    source: "gateway",
    title: "GLM-5.3 Flash",
    model: "zai/glm-5.3-flash",
    desc: "Fast general model",
    reasoning: "instant",
    modelKey: "glm-5.3-flash",
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
    id: "gemini-3.8-flash",
    source: "gateway",
    title: "Gemini 3.8 Flash",
    model: "google/gemini-3.8-flash",
    desc: "Newest fast Gemini",
    reasoning: "instant",
    modelKey: "gemini-3.8-flash",
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

// Luna Standard is the product default for paid plans, and for Free plans once
// the htpr-6722-latest-models flag is on for the user (LUNA_FREE_PLAN_FLAG).
// The universal fallback must be included on every plan, so it is the cheapest
// tier-1 model: callers without trusted billing context can never select a
// locked model implicitly.
export const preferredAiModelOption =
  aiModelOptions.find((option) => option.id === "gpt-6-luna") ??
  aiModelOptions[0];

export const defaultAiModelOption =
  aiModelOptions.find((option) => option.id === "gemini-3.5-flash-lite") ??
  aiModelOptions[0];

export const MOBILE_AI_CHAT_QUICK_MODEL_IDS = [
  "gpt-6-luna-high",
  "gpt-6-luna",
  "gpt-6.1-sol-high",
  "gpt-6.1-sol-light",
] as const satisfies readonly TAiModelOptionId[];

export const LUNA_FREE_MODEL_KEY: TAiModelKey = "gpt-6-luna";

// `lunaFree` is the per-user htpr-6722-latest-models flag: with it on, Luna
// counts as an included (tier 1) model on Free plans and is their default.
export function getDefaultAiModelOptionForPlan(
  storePlanId: StorePlanKind | null | undefined,
  hasEligibleByokCredential = false,
  lunaFree = false,
): TAiModelOption {
  return storePlanId === "Pro" ||
    storePlanId === "AI" ||
    (storePlanId === "BYOK" && hasEligibleByokCredential) ||
    (storePlanId === "Free" && lunaFree)
    ? preferredAiModelOption
    : defaultAiModelOption;
}

// Model picker resolution: an explicit saved choice (or team/board default)
// always wins; only when none exists does the plan default apply.
export function resolveAiModelOption(
  savedOptionIds: readonly (string | null | undefined)[],
  planDefault: TAiModelOption,
): TAiModelOption {
  for (const id of savedOptionIds) {
    const option = getAiModelOptionById(id);
    if (option) return option;
  }
  return planDefault;
}

// A saved choice of Luna (for example a saved GPT 5.4 Mini, which aliases to
// Luna) is not usable on Free plans while the flag is off, or on BYOK plans
// without an eligible customer key. Those requests drop to the plan default.
export function isLunaBlockedForPlan(
  modelOption: TAiModelOption | undefined,
  storePlanId: StorePlanKind | null | undefined,
  lunaFree: boolean,
  hasEligibleByokCredential: boolean,
): boolean {
  if (modelOption?.modelKey !== LUNA_FREE_MODEL_KEY) return false;
  if (storePlanId === "Free") return !lunaFree;
  return storePlanId === "BYOK" && !hasEligibleByokCredential;
}

// Retired option ids map to their replacement so a persisted choice upgrades in
// place instead of silently falling back to the default. HTPR-4534.
const RETIRED_OPTION_ID_ALIASES: Record<string, TAiModelOptionId> = {
  "gpt-5.6-luna": "gpt-6-luna",
  "gpt-5.6-luna-light": "gpt-6-luna-light",
  "gpt-5.6-luna-high": "gpt-6-luna-high",
  "gpt-5.6-sol": "gpt-6.1-sol",
  "gpt-5.6-sol-light": "gpt-6.1-sol-light",
  "gpt-5.6-sol-high": "gpt-6.1-sol-high",
  "gpt-6-sol": "gpt-6.1-sol",
  "gpt-6-sol-light": "gpt-6.1-sol-light",
  "gpt-6-sol-high": "gpt-6.1-sol-high",
  "gpt-5.5": "gpt-6.1-sol",
  "gpt-5.5-instant": "gpt-6.1-sol-light",
  "gpt-5.5-thinking": "gpt-6.1-sol-high",
  "gpt-5.4-mini": "gpt-6-luna",
  "claude-opus-5-instant": "claude-opus-5-5-instant",
  "claude-opus-5-thinking": "claude-opus-5-5-thinking",
  "claude-sonnet-5-instant": "claude-sonnet-5-5-instant",
  "claude-sonnet-5-thinking": "claude-sonnet-5-5-thinking",
  "deepseek-v4-flash": "deepseek-v4.1-flash",
  "kimi-k2.6": "kimi-k3",
  "glm-5.2": "glm-5.3-flash",
  "gemini-3.1-flash-lite": "gemini-3.5-flash-lite",
  "gemini-3.5-flash": "gemini-3.8-flash",
  "gemini-3.6-flash": "gemini-3.8-flash",
  "claude-opus-4-8-instant": "claude-opus-5-5-instant",
  "claude-opus-4-8-thinking": "claude-opus-5-5-thinking",
  "grok-4.1-fast-instant": "gpt-6-luna",
  "grok-4.1-fast-thinking": "gpt-6-luna",
  "grok-4.20-instant": "gpt-6-luna",
  "grok-4.20-thinking": "gpt-6-luna",
  "grok-4.5": "gpt-6-luna",
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
  if (catalogOption.id === "gpt-6.1-sol-light") {
    effortLabel = "Fast";
  } else if (catalogOption.effort) {
    effortLabel = getAiEffortLabel(catalogOption.modelKey, catalogOption.effort);
  }
  return [modelLabel, effortLabel].filter(Boolean).join(" · ");
}

export function isPremiumAiModelDefinition(
  model: TAiModelDefinition | undefined,
  lunaFree = false,
): boolean {
  if (lunaFree && model?.key === LUNA_FREE_MODEL_KEY) return false;
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

export function isHaiku55Model(modelId: string): boolean {
  return /(?:^|\/)claude-haiku-5[.-]5$/.test(modelId);
}

export function isAiModelOptionVisible(
  option: TAiModelOption,
  haiku55Enabled: boolean,
): boolean {
  return option.modelKey !== "claude-haiku-5-5" || haiku55Enabled;
}
