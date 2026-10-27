import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7922_UNLIMITED_FREE_BOARDS_FLAG = "htpr-7922-unlimited-free-boards";

export default {
  key: HTPR_7922_UNLIMITED_FREE_BOARDS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-27",
  description: "Remove the Free-plan board cap when Free-plan limits are enabled. Ticket and attachment limits stay unchanged. Off restores the unreleased two-board cap.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Changes Free-plan admission rules; preserves the existing rollout pending independent and product-lead review.",
  },
} as const satisfies FeatureFlagDefinition;
