import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7796_DISABLED_PROVIDER_PICK_FLAG = "htpr-7796-disabled-provider-pick";

export default {
  key: HTPR_7796_DISABLED_PROVIDER_PICK_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-26",
  defaultMode: "EVERYONE",
  description: "Refuses an explicit chat model pick when its provider is off, instead of silently answering with another model. Default model fallback is unchanged.",
  releaseRisk: {
    risk: "small",
    reason: "Only explicit chat picks for disabled providers are refused before model execution. Enabled picks and automatic defaults keep their existing routing.",
  },
} as const satisfies FeatureFlagDefinition;
