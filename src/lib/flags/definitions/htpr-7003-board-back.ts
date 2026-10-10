import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7003_BOARD_BACK_FLAG = "htpr-7003-board-back";

export default {
  key: HTPR_7003_BOARD_BACK_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Keeps the previous ticket hidden on a quick Back from a board card until the board is ready to show.",
} as const satisfies FeatureFlagDefinition;
