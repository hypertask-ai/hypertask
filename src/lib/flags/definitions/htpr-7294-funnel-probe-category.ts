import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7294_FUNNEL_PROBE_CATEGORY_FLAG = "htpr-7294-funnel-probe-category";

export default {
  key: HTPR_7294_FUNNEL_PROBE_CATEGORY_FLAG,
  kind: "feature",
  shippedOn: "2026-10-18",
  defaultMode: "OWNER_AND_QA",
  description: "Accounts on the funnel-probe.hypertask.app test domain are labelled probe in analytics so the daily test signup never counts as a customer",
  releaseRisk: {
    risk: "small",
    reason: "Only analytics labels for the reserved test domain change; probe events continue to be sent.",
  },
} as const satisfies FeatureFlagDefinition;
