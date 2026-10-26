import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8039_ARCHIVE_COLUMN_BOUNDARY_FLAG = "htpr-8039-archive-column-boundary";

export default {
  key: HTPR_8039_ARCHIVE_COLUMN_BOUNDARY_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Keeps archive focus inside its original board column, so repeated Ctrl+E cannot archive neighboring columns.",
  releaseRisk: {
    risk: "small",
    reason: "Stops automatic focus at an empty column; existing archive requests, undo and manual column navigation stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
