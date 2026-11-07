import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7294_DAILY_FUNNEL_PROBE_FLAG =
  "htpr-7294-daily-funnel-probe";

export default {
  key: HTPR_7294_DAILY_FUNNEL_PROBE_FLAG,
  kind: "internal",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description:
    "Daily isolated signup probe: capture verification links for funnel-probe mail, expose the ops inbox reader, and enable the scheduled funnel walk.",
  releaseRisk: {
    risk: "medium",
    highRisk: "customer-email",
    reason:
      "Creates real probe accounts and sends verification mail on a schedule; probe addresses stay out of customer analytics.",
  },
} as const satisfies FeatureFlagDefinition;
