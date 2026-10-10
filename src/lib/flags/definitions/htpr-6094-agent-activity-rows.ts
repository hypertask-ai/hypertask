import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6094_AGENT_ACTIVITY_ROWS_FLAG = "htpr-6094-agent-activity-rows";

export default {
  key: HTPR_6094_AGENT_ACTIVITY_ROWS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-05",
  description: "Shows passive ticket progress between normal messages in Agent Chat.",
  releaseRisk: {
    "risk": "new",
    "reason": "Agent Chat adds progress rows between normal conversation messages."
  },
} as const satisfies FeatureFlagDefinition;
