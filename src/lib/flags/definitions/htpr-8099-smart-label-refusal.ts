import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8099_SMART_LABEL_REFUSAL_FLAG = "htpr-8099-smart-label-refusal";

export default {
  key: HTPR_8099_SMART_LABEL_REFUSAL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Smart labels quietly skip expected AI allowance refusals, preserving existing labels. Genuine failures still report normally.",
  releaseRisk: {
    risk: "small",
    reason: "Only suppresses expected allowance-refusal logging. Funding limits, existing labels and successful classification stay unchanged. Off restores reporting.",
  },
} as const satisfies FeatureFlagDefinition;
