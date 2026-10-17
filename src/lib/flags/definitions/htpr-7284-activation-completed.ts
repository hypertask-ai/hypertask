import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7284_ACTIVATION_COMPLETED_FLAG = "htpr-7284-activation-completed";

export default {
  key: HTPR_7284_ACTIVATION_COMPLETED_FLAG,
  kind: "feature",
  shippedOn: "2026-10-17",
  defaultMode: "OWNER_AND_QA",
  description: "Captures activation_completed once when an owned non-sample board reaches three live tasks within seven days of signup.",
  releaseRisk: {
    risk: "new",
    reason: "Adds owner-scoped activation analytics based on live task counts and signup timing.",
  },
} as const satisfies FeatureFlagDefinition;
