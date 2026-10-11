import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6557_AGENT_ROOMS_FLAG = "htpr-6557-agent-rooms";

export default {
  key: HTPR_6557_AGENT_ROOMS_FLAG,
  shippedOn: "2026-09-18",
  description:
    "Adds one shared Agent Chat room per board, with named bot handoffs, a three-turn bot limit, Stop, and a visible daily turn budget.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a shared chat room on each board where people and agents can work together."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
