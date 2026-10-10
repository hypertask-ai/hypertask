import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG = "htpr-6556-mobile-description-first";

export default {
  key: HTPR_6556_MOBILE_DESCRIPTION_FIRST_FLAG,
  kind: "feature",
  shippedOn: "2026-09-18",
  description:
    "Focuses mobile task creation on one description box, with collapsed title and properties plus raw and Task Writer save actions.",
  releaseRisk: {
    "risk": "new",
    "reason": "Mobile task creation adds a description-first flow with Task Writer and direct save choices."
  },
} as const satisfies FeatureFlagDefinition;
