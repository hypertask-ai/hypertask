import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9308_UPDATE_FAILURE_CAUSE_FLAG = "htpr-9308-update-failure-cause";

export default {
  key: HTPR_9308_UPDATE_FAILURE_CAUSE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-15",
  description:
    "A failed task update reports its real error to PostHog instead of a synthetic server error with no cause.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the crash report changes. The response status and body stay the same, and Off keeps today's report.",
  },
} as const satisfies FeatureFlagDefinition;
