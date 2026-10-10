import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6998_BOARD_SCROLL_RESTORE_FLAG = "htpr-6998-board-scroll-restore";

export default {
  key: HTPR_6998_BOARD_SCROLL_RESTORE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Keeps the board and each column at their previous scroll positions when you return from search or another page.",
} as const satisfies FeatureFlagDefinition;
