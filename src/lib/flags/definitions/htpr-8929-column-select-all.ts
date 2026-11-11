import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8929_COLUMN_SELECT_ALL_FLAG =
  "htpr-8929-column-select-all";

export default {
  key: HTPR_8929_COLUMN_SELECT_ALL_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description:
    "Shift+A selects every card in the focused board column, and the Commands row and shortcuts panel show the key.",
  releaseRisk: {
    risk: "small",
    reason:
      "Adds one keyboard shortcut and its key hint; Ctrl+A board selection, bulk commands and the existing column command keep their current behavior.",
  },
} as const satisfies FeatureFlagDefinition;
