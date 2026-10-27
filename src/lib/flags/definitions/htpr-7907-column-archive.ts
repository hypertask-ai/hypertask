import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7907_COLUMN_ARCHIVE_FLAG = "htpr-7907-column-archive";

export default {
  key: HTPR_7907_COLUMN_ARCHIVE_FLAG,
  kind: "feature",
  shippedOn: "2026-10-27",
  defaultMode: "EVERYONE",
  description: "Archive every ticket in one column from Ctrl+K, with an exact count, confirmation and one undo.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses per-ticket archive permissions and grouped undo. Nothing is permanently deleted; other columns stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
