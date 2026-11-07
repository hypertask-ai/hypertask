import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8846_AGENT_LANE_ON_READABLE_BOARD_FLAG = "htpr-8846-agent-lane-on-readable-board";

export default {
  key: HTPR_8846_AGENT_LANE_ON_READABLE_BOARD_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "An agent log note on a board the agent can already read is stored under that agent's name. Off still requires a board membership before the note can be saved.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Lets an agent save a hidden log note on boards it can already read, without opening boards it cannot read. A human login still cannot save that note.",
  },
} as const satisfies FeatureFlagDefinition;
