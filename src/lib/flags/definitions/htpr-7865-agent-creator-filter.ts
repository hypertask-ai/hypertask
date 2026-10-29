import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7865_AGENT_CREATOR_FILTER_FLAG = "htpr-7865-agent-creator-filter";

export default {
  key: HTPR_7865_AGENT_CREATOR_FILTER_FLAG,
  shippedOn: "2026-10-29",
  kind: "improvement",
  defaultMode: "EVERYONE",
  description: "Adds agents to the board Created by filter and separates their tickets from their owner's tickets.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing creator picker and saved filter payload; switching off restores owner-only matching without changing tickets.",
  },
} as const satisfies FeatureFlagDefinition;
