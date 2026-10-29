import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { OpenRouterProviderOptions } from "@openrouter/ai-sdk-provider";

const efforts = ["low", "medium", "high"] as const;
const allEfforts = ["none", ...efforts] as const;

export const anthropicOptions = [
  { thinking: { type: "disabled" } },
  ...efforts.map((effort) => ({ thinking: { type: "adaptive" as const }, effort })),
] satisfies AnthropicProviderOptions[];

export const openaiOptions = allEfforts.map((reasoningEffort) => ({
  reasoningEffort,
})) satisfies OpenAIResponsesProviderOptions[];

export const openrouterOptions = allEfforts.map((effort) => ({
  reasoning: { effort },
})) satisfies OpenRouterProviderOptions[];
