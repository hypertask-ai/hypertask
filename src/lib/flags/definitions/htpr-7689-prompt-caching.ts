import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7689_PROMPT_CACHING_FLAG = "htpr-7689-prompt-caching";

export default {
  key: HTPR_7689_PROMPT_CACHING_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-23",
  description:
    "Uses automatic Claude gateway caching and scoped OpenAI chat cache keys, with stable chat rules before live context. Off preserves existing requests.",
  releaseRisk: {
    risk: "small",
    reason: "Changes paid provider cache writes and chat prompt order.",
    highRisk: "money",
  },
} as const satisfies FeatureFlagDefinition;
