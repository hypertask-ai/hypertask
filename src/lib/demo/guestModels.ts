// HTPR-4303: which AI models an anonymous demo guest may use.
//
// Guests run on the dedicated, fail-closed DEMO_AI_GATEWAY_API_KEY. We only ever
// let them touch the cheap Chinese models below — never our premium OpenAI /
// Anthropic tiers. The picker greys the rest out (UX), but the REAL boundary is
// the demo chat route, which must resolve the model through this allowlist and
// never trust an arbitrary model string from the request body.

import type { TAiModelKey } from "@/lib/aiModelOptions";

// modelKey === option id for each of these gateway models (see aiModelOptions).
// Order = picker order. Same price band throughout; Gemini and Kimi lead
// because a cold visitor recognizes those labels (Valentin, 2026-08-02).
export const GUEST_MODEL_KEYS: readonly TAiModelKey[] = [
  "gemini-3.5-flash-lite", // fast default, recognizable label
  "kimi-k2.5",
  "glm-5.2",
  "deepseek-v4-pro",
  "qwen3.7-plus",
];

export const GUEST_DEFAULT_MODEL_KEY: TAiModelKey = "gemini-3.5-flash-lite";
// The aiModelOptions id a fresh guest starts on (id === key for these).
export const GUEST_DEFAULT_OPTION_ID = "gemini-3.5-flash-lite";

// Gateway model strings (provider/model) the demo route is allowed to send.
export const GUEST_ALLOWED_GATEWAY_MODELS: ReadonlySet<string> = new Set([
  "google/gemini-3.5-flash-lite",
  "moonshotai/kimi-k2.5",
  "zai/glm-5.2",
  "deepseek/deepseek-v4-pro",
  "alibaba/qwen3.7-plus",
]);
export const GUEST_DEFAULT_GATEWAY_MODEL = "google/gemini-3.5-flash-lite";

export function isGuestAllowedModelKey(
  key: string | null | undefined,
): key is TAiModelKey {
  return !!key && GUEST_MODEL_KEYS.includes(key as TAiModelKey);
}

// Free-AI allowance for a guest, in USD. Deliberately low: a taste, then a
// signup wall. Tunable via env without a redeploy of the constant.
export const GUEST_AI_BUDGET_USD =
  Number(process.env.DEMO_AI_BUDGET_USD) || 0.1;

// ponytail: flat blended rate for the four cheap Chinese models (~$0.40 / 1M
// tokens). Good enough to drive a progress bar and a soft cap; the hard cost
// bound per call is maxOutputTokens on the route, not this estimate.
export const DEMO_USD_PER_1K_TOKENS = 0.0004;

export function estimateDemoUsd(totalTokens: number): number {
  return (Math.max(0, totalTokens) / 1000) * DEMO_USD_PER_1K_TOKENS;
}
