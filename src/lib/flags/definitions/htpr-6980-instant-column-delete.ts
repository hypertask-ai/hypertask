import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6980_INSTANT_COLUMN_DELETE_FLAG = "htpr-6980-instant-column-delete";

export default {
  key: HTPR_6980_INSTANT_COLUMN_DELETE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Removes a board column immediately after confirming deletion and restores it if deletion fails.",
} as const satisfies FeatureFlagDefinition;
