import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7952_BULK_ARCHIVE_TWO_UPDATES_FLAG = "htpr-7952-bulk-archive-two-updates";

export default {
  key: HTPR_7952_BULK_ARCHIVE_TWO_UPDATES_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-25",
  description: "Archiving or restoring many inbox items at once uses two database updates instead of two per item, so a big selection no longer fails with an unexpected error.",
  releaseRisk: {
    risk: "small",
    reason: "Same rows get the same status; Off keeps the old one-update-per-item path.",
  },
} as const satisfies FeatureFlagDefinition;
