import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG =
  "htpr-9274-board-default-subtasks";

export default {
  key: HTPR_9274_BOARD_DEFAULT_SUBTASKS_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-14",
  description:
    "A board whose shared default view still hides sub-tickets shows them as cards again, with the parent line, and the view tab count matches the cards. Personal views that hide sub-tickets on such a board show them too, so one board shows one truth.",
  releaseRisk: {
    risk: "small",
    reason:
      "Display only: which existing cards a board shows and the count next to them. With the switch off the board payload keeps the stored sub-ticket setting, so every board renders exactly as it does today.",
  },
} as const satisfies FeatureFlagDefinition;
