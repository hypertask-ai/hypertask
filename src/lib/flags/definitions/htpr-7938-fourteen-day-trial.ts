import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7938_FOURTEEN_DAY_TRIAL_FLAG = "htpr-7938-fourteen-day-trial";

export default {
  key: HTPR_7938_FOURTEEN_DAY_TRIAL_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-25",
  releaseRisk: {
    risk: "new",
    reason: "Restores fourteen-day trial terms for new Start plan checkouts without changing saved offers.",
    highRisk: "money",
  },
  description: "New Start plan trials last fourteen days; existing checkout offers retain their original terms.",
} as const satisfies FeatureFlagDefinition;
