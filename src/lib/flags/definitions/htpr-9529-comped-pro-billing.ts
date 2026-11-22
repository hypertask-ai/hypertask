import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9529_COMPED_PRO_BILLING_FLAG = "htpr-9529-comped-pro-billing";

export default {
  key: HTPR_9529_COMPED_PRO_BILLING_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "A comped Pro team's billing cycle, renewal and invoice match the complimentary plan instead of saying Free Plan.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the empty billing labels change for a complimentary team. Paid invoices, checkout and cancellation stay the same. Off restores Free Plan on those empty rows.",
  },
} as const satisfies FeatureFlagDefinition;
