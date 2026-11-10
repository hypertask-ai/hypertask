import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8928_BULK_ARCHIVE_INSTANT_HIDE_FLAG =
  "htpr-8928-bulk-archive-instant-hide";

export default {
  key: HTPR_8928_BULK_ARCHIVE_INSTANT_HIDE_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Selected board tickets leave the column immediately on bulk archive; persistence continues in the background.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes client timing for multi-select archive on the board; single-ticket archive and undo behavior stay on the existing paths.",
  },
} as const satisfies FeatureFlagDefinition;
