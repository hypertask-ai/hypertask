import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7980_STRIPE_PORTAL_BILLING_FLAG = "htpr-7980-stripe-portal-billing";

export default {
  key: HTPR_7980_STRIPE_PORTAL_BILLING_FLAG,
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-26",
  description: "A single Billing card with checkout for unsubscribed Free teams and an explicitly configured, price-only Stripe billing portal for existing subscriptions.",
  releaseRisk: {
    risk: "new",
    highRisk: "money",
    reason: "Exposes Stripe plan changes and period-end cancellation; requires an approved dedicated portal configuration before production exposure.",
  },
} as const satisfies FeatureFlagDefinition;
