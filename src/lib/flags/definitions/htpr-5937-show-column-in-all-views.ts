import type { FeatureFlagDefinition } from "../definitions";

export const COLUMN_ALL_VIEWS_FLAG = "htpr-5937-show-column-in-all-views";

export default {
  key: COLUMN_ALL_VIEWS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-07",
  description:
    "Adds Show in all views and Hide in all views to the column editor, so one column's visibility changes across every saved view at once.",
} as const satisfies FeatureFlagDefinition;
