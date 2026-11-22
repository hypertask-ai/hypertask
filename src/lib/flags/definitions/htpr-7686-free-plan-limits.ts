import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7686_FREE_PLAN_LIMITS_FLAG = "htpr-7686-free-plan-limits";

export default {
  key: HTPR_7686_FREE_PLAN_LIMITS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description: "Limit Free scopes to two Normal boards, 250 Normal tickets on Normal boards and 25 MB task attachments, without restricting existing work.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Introduces upgrade refusals at Free-plan write boundaries; owner and QA validate additive admission before wider rollout.",
  },
} as const satisfies FeatureFlagDefinition;
