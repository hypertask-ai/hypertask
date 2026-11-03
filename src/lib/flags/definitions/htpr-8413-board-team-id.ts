import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8413_BOARD_TEAM_FLAG = "htpr-8413-board-team-id";

export default {
  key: HTPR_8413_BOARD_TEAM_FLAG,
  kind: "improvement",
  shippedOn: "2026-11-03",
  defaultMode: "EVERYONE",
  description: "A board read says which team the board belongs to, so agents can group boards before adding one.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one team id to the board read the caller already sees; no member, token or billing data. Off removes the field.",
  },
} as const satisfies FeatureFlagDefinition;
