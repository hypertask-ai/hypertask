import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6989_BULK_ARCHIVE_UNDO_FLAG = "htpr-6989-bulk-archive-undo";

export default {
  key: HTPR_6989_BULK_ARCHIVE_UNDO_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Restores every selected inbox item after undoing a bulk archive, including after reload.",
} as const satisfies FeatureFlagDefinition;
