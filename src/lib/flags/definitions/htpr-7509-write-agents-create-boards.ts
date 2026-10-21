import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7509_WRITE_AGENTS_CREATE_BOARDS_FLAG = "htpr-7509-write-agents-create-boards";

export default {
  key: HTPR_7509_WRITE_AGENTS_CREATE_BOARDS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-21",
  defaultMode: "OWNER_AND_QA",
  description: "On lets agents with the write role create boards in a team they work in. Off keeps board creation for admin agents only.",
  releaseRisk: {
    risk: "small",
    highRisk: "access",
    reason: "Widens board creation from admin agents to write agents that are already on a board in the same team; delegated access stays admin only.",
  },
} as const satisfies FeatureFlagDefinition;
