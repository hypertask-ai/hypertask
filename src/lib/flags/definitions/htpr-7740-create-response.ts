import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7740_CREATE_RESPONSE_FLAG = "htpr-7740-create-response";

export default {
  key: HTPR_7740_CREATE_RESPONSE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description: "Task creation generates missing positions and answers invalid section requests instead of leaving the connection open. Off restores legacy positioning.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes fallback positioning and missing-section responses in the existing task creation endpoint; explicit positioning and fullscreen creation are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
