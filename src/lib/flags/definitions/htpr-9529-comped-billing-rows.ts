import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9529_COMPED_BILLING_ROWS_FLAG = "htpr-9529-comped-billing-rows";

export default {
  key: HTPR_9529_COMPED_BILLING_ROWS_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-25",
  description:
    "Settings > Billing shows a comped team's comped plan, cycle, renewal and empty invoice list instead of Free Plan on every row.",
  releaseRisk: {
    risk: "small",
    reason:
      "Display only: no price, Stripe call, plan gate or charge changes. Off keeps today's rows, where a comped team reads Free Plan beside its Pro plan name.",
  },
} as const satisfies FeatureFlagDefinition;
