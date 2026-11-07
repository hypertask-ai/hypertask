import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7294_DAILY_FUNNEL_PROBE_FLAG =
  "htpr-7294-daily-funnel-probe";

export default {
  key: HTPR_7294_DAILY_FUNNEL_PROBE_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description:
    "Daily isolated signup probe: capture verification links for funnel-probe mail, expose the ops inbox reader, and enable the scheduled funnel walk.",
  releaseRisk: {
    risk: "small",
    highRisk: "customer-email",
    reason:
      "Creates probe accounts and sends scheduled verification mail; probe addresses stay excluded from customer analytics.",
  },
} as const satisfies FeatureFlagDefinition;
