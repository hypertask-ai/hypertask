import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7902_TEAM_ID_FLAG = "htpr-7902-team-id";

export default {
  key: HTPR_7902_TEAM_ID_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Accepts numeric team ids for MCP agent presence without changing string team ids.",
  releaseRisk: {
    risk: "small",
    reason: "Only presence team_id accepts a positive integer number and converts it to a string. Off keeps today's 400 for numeric team ids; existing strings and other inputs are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
