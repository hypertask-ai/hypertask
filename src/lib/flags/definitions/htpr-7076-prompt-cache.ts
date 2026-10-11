import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7076_PROMPT_CACHE_FLAG = "htpr-7076-prompt-cache";

// HTPR-7076 (https://app.hypertask.ai/detail/project-15/7076): cheaper AI calls with identical answers.
export default {
  key: HTPR_7076_PROMPT_CACHE_FLAG,
  kind: "feature",
  shippedOn: "2026-10-11",
  description:
    "Asks Claude to cache the fixed instructions of the task writer and suggestions so repeat calls cost less, and records cached tokens in AI usage. Off sends the instructions as before.",
  releaseRisk: {
    "risk": "small",
    "reason": "AI answers stay the same; only the price of repeat calls drops, and the allowance now counts cached tokens at the lower rate."
  },
} as const satisfies FeatureFlagDefinition;
