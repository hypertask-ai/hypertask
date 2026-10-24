import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7716_ALLOWANCE_FALLBACKS_FLAG = "htpr-7716-allowance-fallbacks";

export default {
  key: HTPR_7716_ALLOWANCE_FALLBACKS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  description: "Task questions and comment summaries treat a used-up AI allowance as an expected fallback instead of a server failure.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only allowance-refusal logging and incident reporting; existing fallbacks, allowance enforcement and successful generation stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
