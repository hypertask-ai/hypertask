import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7070_PARKED_FLAGS_FLAG = "htpr-7070-parked-flags";

export default {
  key: HTPR_7070_PARKED_FLAGS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description: "Shows parked flags and their reasons in the existing flags page, with a separate Parked filter.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing flags page labels parked work and offers a Parked filter without changing rollout modes."
  },
} as const satisfies FeatureFlagDefinition;
