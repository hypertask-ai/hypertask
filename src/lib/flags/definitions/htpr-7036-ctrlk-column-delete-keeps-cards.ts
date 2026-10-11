import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7036_CTRLK_COLUMN_DELETE_KEEPS_CARDS_FLAG = "htpr-7036-ctrlk-column-delete-keeps-cards";

export default {
  key: HTPR_7036_CTRLK_COLUMN_DELETE_KEEPS_CARDS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Moves cards to the first remaining board column before deleting a column from Ctrl+K or the column header, and refuses to delete a populated last column.",
} as const satisfies FeatureFlagDefinition;
