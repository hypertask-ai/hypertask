import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG = "htpr-7923-unlimited-free-tickets";

export default {
  key: HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Remove the Free-plan ticket cap across creation, restoration and board moves. Board and attachment limits stay unchanged. Off restores the unreleased ticket cap when Free-plan limits are enabled.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Changes Free-plan admission rules; keeps the existing plan rollout unchanged pending independent and product-lead review.",
  },
} as const satisfies FeatureFlagDefinition;
