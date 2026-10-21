
import type { TAiModelKey } from "@/lib/aiModelOptions";

export const GUEST_MODEL_KEYS: readonly TAiModelKey[] = [
  "gemini-3.5-flash-lite",
  "kimi-k2.5",
  "glm-5.3-flash",
  "deepseek-v4-pro",
  "qwen3.7-plus",
];

export const GUEST_DEFAULT_MODEL_KEY: TAiModelKey = "gemini-3.5-flash-lite";
export const GUEST_DEFAULT_OPTION_ID = "gemini-3.5-flash-lite";

export const GUEST_ALLOWED_GATEWAY_MODELS: ReadonlySet<string> = new Set([
  "google/gemini-3.5-flash-lite",
  "moonshotai/kimi-k2.5",
  "zai/glm-5.3-flash",
  "deepseek/deepseek-v4-pro",
  "alibaba/qwen3.7-plus",
]);
export const GUEST_DEFAULT_GATEWAY_MODEL = "google/gemini-3.5-flash-lite";

export function isGuestAllowedModelKey(
  key: string | null | undefined,
): key is TAiModelKey {
  return !!key && GUEST_MODEL_KEYS.includes(key as TAiModelKey);
}

export const GUEST_AI_BUDGET_USD =
  Number(process.env.DEMO_AI_BUDGET_USD) || 0.1;

export const DEMO_USD_PER_1K_TOKENS = 0.0004;

export function estimateDemoUsd(totalTokens: number): number {
  return (Math.max(0, totalTokens) / 1000) * DEMO_USD_PER_1K_TOKENS;
}
