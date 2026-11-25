import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9277_BOAT_DEV_MODEL_FLAG = "htpr-9277-boat-dev-model";

export default {
  key: HTPR_9277_BOAT_DEV_MODEL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-25",
  description: "Separate people and agent sign-in in the boat.dev-inspired login layout.",
  related: ["htpr-7552-agent-code-signin"],
  releaseRisk: {
    risk: "small",
    reason: "Visible login layout under design review. Off preserves the existing login; authentication and agent approval are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
