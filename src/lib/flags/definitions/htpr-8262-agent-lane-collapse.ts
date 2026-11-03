import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8262_AGENT_LANE_COLLAPSE_FLAG = "htpr-8262-agent-lane-collapse";

export default {
  key: HTPR_8262_AGENT_LANE_COLLAPSE_FLAG,
  kind: "improvement",
  shippedOn: "2026-11-03",
  defaultMode: "EVERYONE",
  description: "Shift+O collapses agent lane entries with the comments, a collapsed lane row uses the comment one-line row, and lane rows take the live comment card spacing.",
  releaseRisk: {
    risk: "small",
    reason: "Changes how agent lane rows fold and how much padding they use inside the ticket thread. Off keeps lane rows always expanded at today's inset.",
  },
} as const satisfies FeatureFlagDefinition;
