import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7893_BOARD_ALIAS_FLAG = "htpr-7893-board-alias";

export default {
  key: HTPR_7893_BOARD_ALIAS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Accepts board_id as an alias for project_id in hypertask_tasks and hypertask_comments.",
  releaseRisk: {
    risk: "small",
    reason: "The alias only lets an agent call hypertask_tasks or hypertask_comments with board_id instead of project_id. Off keeps today's 400.",
  },
} as const satisfies FeatureFlagDefinition;
