import { HTPR_7854_AI_THINKING_OPT_IN_FLAG } from "@/lib/flags/definitions/htpr-7854-ai-thinking-opt-in";

export { HTPR_7854_AI_THINKING_OPT_IN_FLAG };

export const CHAT_TITLE_MAX_OUTPUT_TOKENS = 64;

export const DEEPSEEK_NONE_UNCHANGED_NOTE =
  "DeepSeek V4 Pro has no non-reasoning variant in the catalog; the model id is unchanged.";

export const DEEPSEEK_MEDIUM_NOTE =
  "DeepSeek reasoningEffort accepts low, high, or max; medium is sent as high.";

export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type ReasoningProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "deepseek"
  | "openrouter"
  | "gateway"
  | "xai"
  | "moonshot"
  | "alibaba"
  | "zhipu"
  | "baseten"
  | "custom";

export const FEATURE_REASONING_EFFORT = {
  "chat-title": "none",
  labels: "none",
  summaries: "none",
  tldr: "none",
  heartbeat: "none",
  "suggested-questions": "none",
  "slash-rewrite": "none",
  chat: "low",
  "hyper-mentioned": "low",
  "task-writer": "low",
} as const satisfies Record<string, ReasoningEffort>;

const USAGE_FEATURE_TO_REASONING: Record<string, keyof typeof FEATURE_REASONING_EFFORT> = {
  "chat-title": "chat-title",
  labels: "labels",
  "smart-label": "labels",
  summaries: "summaries",
  summary: "summaries",
  tldr: "tldr",
  heartbeat: "heartbeat",
  "suggested-questions": "suggested-questions",
  "task-questions": "suggested-questions",
  "slash-rewrite": "slash-rewrite",
  editor: "slash-rewrite",
  chat: "chat",
  "hyper-mentioned": "hyper-mentioned",
  "task-writer": "task-writer",
};

const DEEPSEEK_NONE_MODEL: Record<string, string> = {
  "deepseek/deepseek-v4.1-flash-1017": "deepseek/deepseek-v4.1-flash-1017-fast",
  "deepseek-v4.1-flash": "deepseek-v4.1-flash-fast",
  "deepseek/deepseek-v4.1-flash": "deepseek/deepseek-v4.1-flash-1017-fast",
};

const DEEPSEEK_ALREADY_NONE = new Set([
  "deepseek/deepseek-v4.1-flash-1017-fast",
  "deepseek-v4.1-flash-fast",
]);

const PROVIDERS_WITHOUT_KNOB = new Set<ReasoningProvider>([
  "gateway",
  "xai",
  "moonshot",
  "alibaba",
  "zhipu",
  "baseten",
  "custom",
]);

export type ReasoningTranslation = {
  level: ReasoningEffort;
  providerOptions?: Record<string, Record<string, unknown>>;
  modelId?: string;
  note?: string;
};

export async function aiThinkingOptInEnabled(userId: number | null | undefined): Promise<boolean> {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return false;
  try {
    const { isFeatureEnabled } = require("@/lib/flags") as typeof import("@/lib/flags");
    return await isFeatureEnabled(HTPR_7854_AI_THINKING_OPT_IN_FLAG, userId);
  } catch {
    return false;
  }
}

export function effortForFeature(feature: string | null | undefined, explicit?: ReasoningEffort | null): ReasoningEffort {
  if (explicit === "none" || explicit === "low" || explicit === "medium" || explicit === "high") return explicit;
  const key = feature ? USAGE_FEATURE_TO_REASONING[feature] : undefined;
  if (key) return FEATURE_REASONING_EFFORT[key];
  return "none";
}

export function translateReasoning(args: {
  feature?: string | null;
  provider: ReasoningProvider;
  modelId?: string;
  explicit?: ReasoningEffort | null;
  modelOptInHigh?: boolean;
}): ReasoningTranslation {
  const level = args.explicit === "none" || args.explicit === "low" || args.explicit === "medium" || args.explicit === "high"
    ? args.explicit
    : args.modelOptInHigh ? "high" : effortForFeature(args.feature, null);
  if (PROVIDERS_WITHOUT_KNOB.has(args.provider)) return { level };
  if (args.provider === "anthropic") {
    if (level === "none") {
      return { level, providerOptions: { anthropic: { thinking: { type: "disabled" } } } };
    }
    return {
      level,
      providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort: level } },
    };
  }
  if (args.provider === "openai") {
    return { level, providerOptions: { openai: { reasoningEffort: level } } };
  }
  if (args.provider === "google") {
    if (level === "none") {
      return { level, providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } } };
    }
    return { level, providerOptions: { google: { thinkingConfig: { thinkingLevel: level } } } };
  }
  if (args.provider === "openrouter") {
    return { level, providerOptions: { openrouter: { reasoning: { effort: level } } } };
  }
  return deepseekTranslation(level, args.modelId);
}

function deepseekTranslation(level: ReasoningEffort, modelId?: string): ReasoningTranslation {
  if (level === "none") {
    const swapped = modelId ? DEEPSEEK_NONE_MODEL[modelId] : undefined;
    if (swapped || (modelId && DEEPSEEK_ALREADY_NONE.has(modelId))) {
      return {
        level,
        modelId: swapped ?? modelId,
        providerOptions: { deepseek: { thinking: { type: "disabled" } } },
      };
    }
    return {
      level,
      modelId,
      note: DEEPSEEK_NONE_UNCHANGED_NOTE,
    };
  }
  if (level === "medium") {
    return {
      level,
      modelId,
      note: DEEPSEEK_MEDIUM_NOTE,
      providerOptions: { deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" } },
    };
  }
  return {
    level,
    modelId,
    providerOptions: { deepseek: { thinking: { type: "enabled" }, reasoningEffort: level } },
  };
}

const HIGH_EFFORT = new Set(["high", "xhigh", "max"]);

export function modelOptedIntoHigh(providerOptions: { [key: string]: { [key: string]: unknown } | undefined } | undefined): boolean {
  if (!providerOptions) return false;
  const anthropic = providerOptions.anthropic?.effort;
  if (typeof anthropic === "string" && HIGH_EFFORT.has(anthropic)) return true;
  const openai = providerOptions.openai?.reasoningEffort;
  if (typeof openai === "string" && HIGH_EFFORT.has(openai)) return true;
  const google = (providerOptions.google?.thinkingConfig as { thinkingLevel?: unknown } | undefined)?.thinkingLevel;
  if (google === "high") return true;
  const deepseek = providerOptions.deepseek?.reasoningEffort;
  if (typeof deepseek === "string" && HIGH_EFFORT.has(deepseek)) return true;
  const openrouter = (providerOptions.openrouter?.reasoning as { effort?: unknown } | undefined)?.effort;
  if (typeof openrouter === "string" && HIGH_EFFORT.has(openrouter)) return true;
  return false;
}

export function vendorsForModel(modelId: string, provider?: string | null): ReasoningProvider[] {
  const id = modelId.toLowerCase();
  const name = (provider ?? "").toLowerCase();
  const vendors: ReasoningProvider[] = [];
  if (name.includes("openrouter")) vendors.push("openrouter");
  if (name === "claude" || name === "anthropic" || id.includes("claude") || id.includes("anthropic")) vendors.push("anthropic");
  if (name === "openai" || id.includes("openai/") || /(^|\/)gpt-/.test(id)) vendors.push("openai");
  if (name === "google" || id.includes("gemini") || id.includes("google/")) vendors.push("google");
  if (name === "deepseek" || id.includes("deepseek")) vendors.push("deepseek");
  if (vendors.length > 0) return vendors;
  if (
    name === "gateway" || name === "xai" || name === "moonshot" || name === "alibaba" ||
    name === "zhipu" || name === "baseten" || name === "custom"
  ) return [name];
  return [];
}

type ReasoningParams = {
  providerOptions?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
};

export function applyReasoningToParams<T extends ReasoningParams>(
  params: T,
  input: {
    feature?: string | null;
    reasoningFeature?: string | null;
    reasoningEffort?: ReasoningEffort | null;
    provider?: string | null;
  },
  modelId: string,
): T {
  const feature = input.reasoningFeature ?? input.feature ?? "";
  const explicit = input.reasoningEffort ?? null;
  const optedHigh = explicit ? false : modelOptedIntoHigh(params.providerOptions);
  let next = params;
  for (const provider of vendorsForModel(modelId, input.provider)) {
    const translated = translateReasoning({
      feature,
      provider,
      modelId,
      explicit,
      modelOptInHigh: optedHigh,
    });
    if (!translated.providerOptions) continue;
    const providerOptions = { ...(next.providerOptions ?? {}) };
    for (const [key, value] of Object.entries(translated.providerOptions)) {
      const current = { ...(providerOptions[key] ?? {}) };
      const merged = { ...current, ...value };
      if (key === "anthropic" && translated.level === "none") delete merged.effort;
      providerOptions[key] = merged;
    }
    next = { ...next, providerOptions };
  }
  return next;
}
