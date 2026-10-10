import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6985_DELETE_VIEW_ONCE_FLAG = "htpr-6985-delete-view-once";

export default {
  key: HTPR_6985_DELETE_VIEW_ONCE_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Prevents repeated saved-view deletion while confirmation is pending and avoids errors for already-deleted views.",
} as const satisfies FeatureFlagDefinition;
