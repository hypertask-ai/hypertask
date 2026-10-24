import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7692_BILLED_COST_FLAG = "htpr-7692-billed-cost";

export default {
  key: HTPR_7692_BILLED_COST_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description:
    "Admit platform-funded AI calls against Gateway billed snapshots and running holds, keeping estimate accounting as the rollback path.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Billed reports replace estimates for admission; report lag can permit additional spend. Missing or funding-changed snapshots retain existing estimate admission.",
  },
} as const satisfies FeatureFlagDefinition;
