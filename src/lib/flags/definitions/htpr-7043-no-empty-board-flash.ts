import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7043_NO_EMPTY_BOARD_FLASH_FLAG = "htpr-7043-no-empty-board-flash";

export default {
  key: HTPR_7043_NO_EMPTY_BOARD_FLASH_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Keeps board columns and cards on screen when deleting the last populated column is refused, from every column-delete entry point.",
} as const satisfies FeatureFlagDefinition;
