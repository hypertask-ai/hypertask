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
  | "gpt-6.1-terra"
  | "gpt-6.1-sol"
  | "claude-sonnet-5-5"
  | "claude-opus-5-5"
  | "deepseek-v4.1-flash"
  | "deepseek-v4.1-flash-fast"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.3-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.8-flash"
  | "gemini-4-argon"
  | "grok-4.7"
  | "claude-haiku-5-5"
  | "custom";

export type TAiEffort = "light" | "standard" | "high";

export type TAiModelOptionId =
  | "gpt-6-luna"
  | "gpt-6-luna-light"
  | "gpt-6-luna-high"
  | "gpt-6.1-terra"
  | "gpt-6.1-terra-light"
  | "gpt-6.1-terra-high"
  | "gpt-6.1-sol"
  | "gpt-6.1-sol-light"
  | "gpt-6.1-sol-high"
  | "claude-sonnet-5-5-instant"
  | "claude-sonnet-5-5-thinking"
  | "claude-opus-5-5-instant"
  | "claude-opus-5-5-thinking"
  | "deepseek-v4.1-flash"
  | "deepseek-v4.1-flash-fast"
  | "deepseek-v4-pro"
  | "kimi-k2.5"
  | "kimi-k3"
  | "qwen3.7-plus"
  | "glm-5.3-flash"
  | "gemini-3.5-flash-lite"
  | "gemini-3.8-flash"
  | "gemini-4-argon"
  | "grok-4.7"
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
  modelClass: string;
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
  {
    key: "gpt-6-luna",
    modelClass: "gpt-luna",
    label: "Luna 6",
    provider: "openai",
    priceTier: 2,
  },
  {
    key: "gpt-6.1-terra",
    modelClass: "gpt-terra",
    label: "Terra 6.1",
    provider: "openai",
    priceTier: 2,
  },
  {
    key: "gpt-6.1-sol",
    modelClass: "gpt-sol",
    label: "Sol 6.1",
    provider: "openai",
    priceTier: 3,
    premium: true,
  },
  {
    key: "claude-opus-5-5",
    modelClass: "claude-opus",
    label: "Opus 5.5",
    provider: "anthropic",
    priceTier: 3,
    premium: true,
  },
  {
    key: "claude-sonnet-5-5",
    modelClass: "claude-sonnet",
    label: "Sonnet 5.5",
    provider: "anthropic",
    priceTier: 2,
  },
  {
    key: "claude-haiku-5-5",
    modelClass: "claude-haiku",
    label: "Haiku 5.5",
    provider: "anthropic",
    priceTier: 1,
  },
  {
    key: "deepseek-v4.1-flash",
    modelClass: "deepseek-flash",
    label: "DeepSeek V4.1 Flash",
    provider: "deepseek",
    priceTier: 1,
  },
  {
    key: "deepseek-v4.1-flash-fast",
    modelClass: "deepseek-flash-fast",
    label: "DeepSeek V4.1 Flash Fast",
    provider: "deepseek",
    priceTier: 2,
  },
  {
    key: "deepseek-v4-pro",
    modelClass: "deepseek-pro",
    label: "DeepSeek V4 Pro",
    provider: "deepseek",
    priceTier: 1,
  },
  {
    key: "kimi-k2.5",
    modelClass: "kimi-k2.5-free",
    label: "Kimi K2.5",
    provider: "moonshot",
    priceTier: 1,
  },
  {
    key: "kimi-k3",
    modelClass: "kimi-k3",
    label: "Kimi K3",
    provider: "moonshot",
    priceTier: 3,
  },
  {
    key: "qwen3.7-plus",
    modelClass: "qwen-plus",
    label: "Qwen3.7 Plus",
    provider: "alibaba",
    priceTier: 1,
  },
  {
    key: "glm-5.3-flash",
    modelClass: "glm-flash",
    label: "GLM-5.3 Flash",
    provider: "zhipu",
    priceTier: 2,
  },
  {
    key: "gemini-3.5-flash-lite",
    modelClass: "gemini-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    provider: "google",
    priceTier: 1,
  },
  {
    key: "gemini-3.8-flash",
    modelClass: "gemini-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    priceTier: 2,
  },
  {
    key: "gemini-4-argon",
    modelClass: "gemini-argon",
    label: "Gemini 4 Argon",
    provider: "google",
    priceTier: 2,
  },
  {
    key: "grok-4.7",
    modelClass: "grok",
    label: "Grok 4.7",
    provider: "xai",
    priceTier: 2,
  },
  {
    key: "custom",
    modelClass: "custom",
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
    title: "GPT Luna 6",
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
    title: "GPT Luna 6 Light",
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
    title: "GPT Luna 6 High",
    model: "gpt-6-luna",
    desc: "Deep Luna reasoning",
    reasoning: "thinking",
    modelKey: "gpt-6-luna",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "gpt-6.1-terra",
    source: "openai",
    title: "GPT Terra 6.1",
    model: "gpt-6.1-terra",
    desc: "Balanced mid tier",
    reasoning: "instant",
    modelKey: "gpt-6.1-terra",
    effort: "standard",
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  {
    id: "gpt-6.1-terra-light",
    source: "openai",
    title: "GPT Terra 6.1 Light",
    model: "gpt-6.1-terra",
    desc: "Fastest Terra replies",
    reasoning: "instant",
    modelKey: "gpt-6.1-terra",
    effort: "light",
    providerOptions: { openai: { reasoningEffort: "low" } },
  },
  {
    id: "gpt-6.1-terra-high",
    source: "openai",
    title: "GPT Terra 6.1 High",
    model: "gpt-6.1-terra",
    desc: "Deep Terra reasoning",
    reasoning: "thinking",
    modelKey: "gpt-6.1-terra",
    effort: "high",
    providerOptions: { openai: { reasoningEffort: "high" } },
  },
  {
    id: "gpt-6.1-sol",
    source: "openai",
    title: "GPT Sol 6.1",
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
    title: "GPT Sol 6.1 Light",
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
    title: "GPT Sol 6.1 High",
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
    model: "deepseek/deepseek-v4.1-flash-1017",
    directModel: "deepseek-flash",
    desc: "Cheapest general model",
    reasoning: "instant",
    modelKey: "deepseek-v4.1-flash",
  },
  {
    id: "deepseek-v4.1-flash-fast",
    source: "gateway",
    title: "DeepSeek V4.1 Flash Fast",
    model: "deepseek/deepseek-v4.1-flash-1017-fast",
    desc: "Fast cheap general model",
    reasoning: "instant",
    modelKey: "deepseek-v4.1-flash-fast",
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
    id: "gemini-4-argon",
    source: "gateway",
    title: "Gemini 4 Argon",
    model: "google/gemini-4-argon",
    desc: "Newest Gemini",
    reasoning: "instant",
    modelKey: "gemini-4-argon",
  },
  {
    id: "grok-4.7",
    source: "gateway",
    title: "Grok 4.7",
    model: "spacexai/grok-4.7",
    desc: "Newest Grok from xAI",
    reasoning: "instant",
    modelKey: "grok-4.7",
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

export type AiDefaultModelContext = {
  haiku55Enabled?: boolean;
  haikuDefaultEnabled?: boolean;
  backgroundClaudeEnabled?: boolean;
  plan?: StorePlanKind | null;
  hasByok?: boolean;
  openaiOnlyDefaultEnabled?: boolean;
  hasDirectOpenAiKey?: boolean;
  hasClaudeRoute?: boolean;
};

export function isOpenAiOnlyPaidTeam({ openaiOnlyDefaultEnabled, plan, hasClaudeRoute, hasDirectOpenAiKey }: AiDefaultModelContext): boolean {
  return Boolean(openaiOnlyDefaultEnabled && (plan === "Pro" || plan === "AI") && hasClaudeRoute === false && hasDirectOpenAiKey);
}

export function chatModelRequestFields(
  { currentOption, agentSessionOption, usesPlanDefault }: { currentOption: TAiModelOption; agentSessionOption: TAiModelOption | null; usesPlanDefault: boolean },
  agentId: string | null | undefined,
) {
  if (agentId && agentSessionOption) return { modelFromDefault: true };
  return { modelOptionId: currentOption.id, model: currentOption.model, provider: currentOption.source, modelFromDefault: usesPlanDefault };
}

export function defaultModelKeyFor(context: AiDefaultModelContext, productionDefault: TAiModelKey = "gpt-6-luna"): TAiModelKey {
  const { haiku55Enabled, haikuDefaultEnabled, backgroundClaudeEnabled, plan, hasByok } = context;
  if (isOpenAiOnlyPaidTeam(context)) return "gpt-6-luna";
  return backgroundClaudeEnabled || haikuDefaultEnabled || (haiku55Enabled && ((hasByok && plan !== "Free") || plan === "Pro" || plan === "AI" || plan === "BYOK"))
    ? "claude-haiku-5-5"
    : productionDefault;
}

export function hasHaikuByokProvider(providers: ReadonlySet<string>): boolean {
  return ["claude", "anthropic", "gateway", "openrouter"].some((provider) => providers.has(provider));
}

export function getDefaultAiModelOptionForPlan(
  storePlanId: StorePlanKind | null | undefined,
  hasEligibleByokCredential = false,
  haiku55Enabled = false,
  haikuDefaultEnabled = false,
  context: AiDefaultModelContext = {},
): TAiModelOption {
  const productionDefault = storePlanId === "Pro" ||
    storePlanId === "AI" ||
    (storePlanId === "BYOK" && hasEligibleByokCredential) ||
    storePlanId === "Free"
    ? preferredAiModelOption
    : defaultAiModelOption;
  return getAiModelOptionById(defaultModelKeyFor({ ...context, haiku55Enabled, haikuDefaultEnabled, plan: storePlanId, hasByok: hasEligibleByokCredential }, productionDefault.modelKey))!;
}

export function resolveAiModelOption(
  savedOptionIds: readonly (string | null | undefined)[],
  planDefault: TAiModelOption,
  haiku55Enabled = false,
  deepseekFlashFastEnabled = true,
): TAiModelOption {
  for (const id of savedOptionIds) {
    const option = getAiModelOptionById(id, haiku55Enabled);
    if (option?.modelKey === "deepseek-v4.1-flash-fast" && !deepseekFlashFastEnabled) return planDefault;
    if (option) return option;
  }
  return planDefault;
}

export function isLunaBlockedForPlan(
  modelOption: TAiModelOption | undefined,
  storePlanId: StorePlanKind | null | undefined,
  hasEligibleByokCredential: boolean,
): boolean {
  if (modelOption?.modelKey !== LUNA_FREE_MODEL_KEY) return false;
  return storePlanId === "BYOK" && !hasEligibleByokCredential;
}

const RETIRED_OPTION_ID_ALIASES: Record<string, TAiModelOptionId> = {
  "gpt-5.6-terra": "gpt-6.1-terra",
  "gpt-5.6-terra-light": "gpt-6.1-terra-light",
  "gpt-5.6-terra-high": "gpt-6.1-terra-high",
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
  "deepseek/deepseek-v4-flash": "deepseek-v4.1-flash",
  "deepseek/deepseek-v4.1-flash": "deepseek-v4.1-flash",
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

const LEGACY_CLAUDE_OPTION_ID = /^claude-(haiku|sonnet|opus)-(?!5[.-]5(?:$|-))/;

export function upgradeLegacyClaudeOptionId(id: string): string {
  const match = LEGACY_CLAUDE_OPTION_ID.exec(id);
  if (!match) return id;
  if (match[1] === "haiku") return "claude-haiku-5-5";
  return `claude-${match[1]}-5-5-${id.includes("thinking") ? "thinking" : "instant"}`;
}

export function isClaude55Model(modelId: string): boolean {
  return /(?:^|\/)claude-(?:haiku|sonnet|opus)-5[.-]5(?:-\d{8})?$/.test(modelId);
}

export function getAiModelOptionById(
  id: string | null | undefined,
  haiku55Enabled = false,
): TAiModelOption | undefined {
  const trimmed = id?.trim();
  if (!trimmed) return undefined;
  const haiku = isHaiku45Model(trimmed) || isHaiku55Model(trimmed) ? "claude-haiku-5-5" : trimmed;
  const aliased = RETIRED_OPTION_ID_ALIASES[haiku] ?? haiku;
  const resolved = haiku55Enabled ? upgradeLegacyClaudeOptionId(aliased) : aliased;
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
  freePlan = false,
): boolean {
  if (freePlan && model?.key === LUNA_FREE_MODEL_KEY) return false;
  return Boolean(model && ((model.priceTier ?? 1) > 1 || model.premium));
}

export function isPremiumAiModelKey(modelKey: TAiModelKey): boolean {
  return isPremiumAiModelDefinition(getAiModelDefinition(modelKey));
}

export function pickAutoAiModelOption<T extends TAiModelOption>(
  candidates: readonly T[],
  haiku55Enabled = false,
  context: AiDefaultModelContext = {},
): T | undefined {
  const defaultModelKey = defaultModelKeyFor({ ...context, haiku55Enabled });
  if (defaultModelKey === "claude-haiku-5-5" || isOpenAiOnlyPaidTeam(context)) {
    const preferred = candidates.find((candidate) => candidate.modelKey === defaultModelKey);
    if (preferred) return preferred;
  }
  return (
    candidates.find(
      (candidate) => !isPremiumAiModelKey(candidate.modelKey)
    ) ?? candidates[0]
  );
}

export function pickReplacementAiModelOption<T extends TAiModelOption>(
  currentModelKey: TAiModelKey,
  candidates: readonly T[],
  haiku55Enabled = false,
  context: AiDefaultModelContext = {},
): T | undefined {
  const tierOf = (modelKey: TAiModelKey) =>
    getAiModelDefinition(modelKey)?.priceTier ?? 3;
  const currentTier = tierOf(currentModelKey);
  const noPricier = candidates.filter(
    (candidate) => tierOf(candidate.modelKey) <= currentTier
  );
  return pickAutoAiModelOption(noPricier.length > 0 ? noPricier : candidates, haiku55Enabled, context);
}

export function resolveAiModelMention(value: string | null | undefined, haiku55Enabled = false) {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return undefined;

  const definition = aiModelDefinitions.find(
    (model) =>
      model.label.toLowerCase() === normalized ||
      model.key.toLowerCase() === normalized
  );
  if (!definition) return undefined;

  const modelOption = getAiModelOptionById(getNearestAiModelOption(definition.key)?.id, haiku55Enabled);
  return modelOption ? { definition: getAiModelDefinition(modelOption.modelKey)!, modelOption } : undefined;
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

export function isGrokGemini4ModelKey(modelKey: string | null | undefined): boolean {
  return modelKey === "grok-4.7" || modelKey === "gemini-4-argon";
}

export function isAiModelOptionVisible(
  option: TAiModelOption,
  _haiku55Enabled: boolean,
  deepseekFlashFastEnabled = false,
  grokGemini4Enabled = false,
): boolean {
  if (isGrokGemini4ModelKey(option.modelKey) && !grokGemini4Enabled) return false;
  return option.modelKey !== "deepseek-v4.1-flash-fast" || deepseekFlashFastEnabled;
}

export function isHaiku45Model(modelId: string): boolean {
  return /(?:^|\/)claude-haiku-4[.-]5(?:-\d{8})?$/.test(modelId);
}

export function resolveHaikuModelId(modelId: string, _haiku55Enabled = false): string {
  return isHaiku45Model(modelId)
    ? modelId.includes("/") ? "anthropic/claude-haiku-5.5" : "claude-haiku-5-5"
    : modelId;
}
