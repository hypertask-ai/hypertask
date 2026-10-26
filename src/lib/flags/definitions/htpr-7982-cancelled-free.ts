import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7982_CANCELLED_FREE_FLAG = "htpr-7982-cancelled-free";

export default {
  key: HTPR_7982_CANCELLED_FREE_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Applies Free board admission after Stripe stops collecting payment; paid, retrying and comped teams retain access.",
  },
  description: "Unpaid subscriptions follow Free board admission while active, trialing, retrying and comped teams retain paid admission.",
} as const satisfies FeatureFlagDefinition;
