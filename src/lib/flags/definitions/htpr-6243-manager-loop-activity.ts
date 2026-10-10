import type { FeatureFlagDefinition } from "../definitions";

export const MANAGER_LOOP_ACTIVITY_FLAG = "htpr-6243-manager-loop-activity";

export default {
  key: MANAGER_LOOP_ACTIVITY_FLAG,
  kind: "feature",
  shippedOn: "2026-09-08",
  description:
    "Shows each scheduled Manager loop cycle in Agent Chat as a timestamped activity entry, including quiet and failed cycles.",
  releaseRisk: {
    "risk": "small",
    "reason": "The existing Agent Chat activity feed records each scheduled Manager cycle."
  },
} as const satisfies FeatureFlagDefinition;
