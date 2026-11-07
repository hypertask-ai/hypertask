import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7686_FREE_PLAN_COPY_FLAG = "htpr-7686-free-plan-copy";

export default {
  key: HTPR_7686_FREE_PLAN_COPY_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "Settings → Plans Free card and the trial comparison use the corrected plan copy. Off keeps the current production wording.",
  releaseRisk: {
    risk: "small",
    highRisk: "money",
    reason: "Changes plan wording on Settings and the trial comparison; billing charges stay the same and Off restores today's copy.",
  },
  related: [
    "htpr-7686-free-plan-limits",
    "htpr-7922-unlimited-free-boards",
    "htpr-7923-unlimited-free-tickets",
    "htpr-7924-free-file-25mb",
    "htpr-7924-free-storage-2gb",
    "htpr-7919-allowance-percent",
  ],
} as const satisfies FeatureFlagDefinition;
