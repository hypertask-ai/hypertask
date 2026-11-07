import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG = "htpr-7037-shared-email-layout";

export default {
  key: HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-09",
  description: "Uses the shared onboarding email design for agent connection and first completed task emails.",
  releaseRisk: {
    "risk": "small",
    "reason": "Agent connection and first-task emails use the existing onboarding email design."
  },
} as const satisfies FeatureFlagDefinition;
