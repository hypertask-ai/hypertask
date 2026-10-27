import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7034_ACTIVATION_ANALYTICS_FLAG = "htpr-7034-activation-analytics";

export default {
  key: HTPR_7034_ACTIVATION_ANALYTICS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-09",
  defaultMode: "OWNER_AND_QA",
  description: "Records server-side board, agent and invitation activation milestones in PostHog.",
  releaseRisk: {
    "risk": "none",
    "reason": "Records activation milestones for reporting without changing what users see."
  },
} as const satisfies FeatureFlagDefinition;
