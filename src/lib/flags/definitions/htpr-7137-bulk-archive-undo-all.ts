import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7137_BULK_ARCHIVE_UNDO_ALL_FLAG = "htpr-7137-bulk-archive-undo-all";

export default {
  key: HTPR_7137_BULK_ARCHIVE_UNDO_ALL_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description: "One Undo restores every successfully archived ticket after a board bulk archive, including after reload.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the authenticated single-ticket restore API; only flag-enabled board bulk archives share one Undo action.",
  },
} as const satisfies FeatureFlagDefinition;
