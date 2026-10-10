import type { FeatureFlagDefinition } from "../definitions";

export const POSTHOG_ERROR_ALERT_FLAG = "htpr-6238-posthog-error-alert";

export default {
  key: POSTHOG_ERROR_ALERT_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description:
    "Lets signed PostHog server errors alert the Manager and request a guarded rollback after a fresh release.",
  releaseRisk: {
    "risk": "none",
    "reason": "Routes server error alerts to the Manager and guards rollbacks without changing app screens."
  },
} as const satisfies FeatureFlagDefinition;
