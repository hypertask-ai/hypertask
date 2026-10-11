import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7040_LAST_COLUMN_DELETE_MESSAGE_FLAG = "htpr-7040-last-column-delete-message";

export default {
  key: HTPR_7040_LAST_COLUMN_DELETE_MESSAGE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-09",
  description: "Explains why a board's last column cannot be deleted while it still has cards, from Ctrl+K or the column header.",
} as const satisfies FeatureFlagDefinition;
