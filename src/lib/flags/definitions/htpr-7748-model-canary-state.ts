import type { FeatureFlagDefinition } from "../definitions";

export const MODEL_CANARY_STATE_FLAG = "htpr-7748-model-canary-state";

export default {
  key: MODEL_CANARY_STATE_FLAG,
  shippedOn: "2026-10-29",
  description:
    "Model status reports whether the daily canary is enabled, disabled or never run, and why, instead of an empty list.",
  releaseRisk: {
    "risk": "small",
    "reason": "Adds state and configuration fields to the internal model status route; switching off restores the previous response."
  },
  kind: "improvement",
  defaultMode: "EVERYONE",
} as const satisfies FeatureFlagDefinition;
