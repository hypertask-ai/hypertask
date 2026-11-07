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
    "highRisk": "customer-email",
    "reason": "Agent connection and first completed task emails use the shared design. A sent customer email cannot be recalled."
  },
} as const satisfies FeatureFlagDefinition;
