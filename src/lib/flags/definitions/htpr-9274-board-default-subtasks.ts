import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG =
  "htpr-9274-board-default-subtasks";

export default {
  key: HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-14",
  description:
    "A board whose shared default view still hides sub-tickets shows them as cards again, with the parent line, and the view tab count matches the cards.",
  releaseRisk: {
    risk: "small",
    reason:
      "Display only: which existing cards a board shows and the count next to them. With the switch off the board payload carries no default-view setting, so every board renders exactly as it does today.",
  },
} as const satisfies FeatureFlagDefinition;
