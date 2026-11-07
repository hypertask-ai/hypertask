import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8777_ACTIVITY_BOARD_NUMBER_FLAG = "htpr-8777-activity-board-number";

export default {
  key: HTPR_8777_ACTIVITY_BOARD_NUMBER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-06",
  description: "Adding agent activity to a feedback ticket accepts the board number from its link, not only the database id.",
  related: ["htpr-8839-evidence-board-number"],
  releaseRisk: {
    risk: "small",
    reason: "Opening a runtime run can address a ticket by its board number on a named project; a bare id stays the database id, a collision is refused, and Off keeps today's id lookup.",
  },
} as const satisfies FeatureFlagDefinition;
