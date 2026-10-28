import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7855_DIRECT_PROMPT_CACHE_FLAG = "htpr-7855-direct-prompt-cache";

export default {
  key: HTPR_7855_DIRECT_PROMPT_CACHE_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-27",
  description:
    "Caches stable chat instructions and tools on direct Anthropic requests, keeping live user, ticket and clock context outside the cache boundary.",
  releaseRisk: {
    risk: "small",
    reason: "Adds paid provider cache writes and reorders direct Claude chat context.",
    highRisk: "money",
  },
} as const satisfies FeatureFlagDefinition;
