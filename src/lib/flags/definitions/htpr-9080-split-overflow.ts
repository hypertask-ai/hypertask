import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9080_SPLIT_OVERFLOW_FLAG = "htpr-9080-split-overflow";

export default {
  key: HTPR_9080_SPLIT_OVERFLOW_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-11",
  description:
    "Adds Overflow hidden to Manage inbox splits. When enabled, desktop splits stay on one horizontally scrollable line with arrows and the selected split stays visible. Saved per person; off by default.",
  releaseRisk: {
    risk: "new",
    reason: "Visible inbox navigation change awaiting independent design QA. Off preserves wrapping and hides the new setting.",
  },
} as const satisfies FeatureFlagDefinition;
