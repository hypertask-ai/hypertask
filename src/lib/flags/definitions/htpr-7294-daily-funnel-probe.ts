import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7294_DAILY_FUNNEL_PROBE_FLAG =
  "htpr-7294-daily-funnel-probe";

export default {
  key: HTPR_7294_DAILY_FUNNEL_PROBE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "Daily funnel-probe signup and verification capture.",
  releaseRisk: {
    risk: "small",
    highRisk: "customer-email",
    reason: "Scheduled probe signups only; probe mail excluded from customer analytics.",
  },
} as const satisfies FeatureFlagDefinition;
