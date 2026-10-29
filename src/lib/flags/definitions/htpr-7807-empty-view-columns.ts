import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG = "htpr-7807-empty-view-columns";

export default {
  key: HTPR_7807_EMPTY_VIEW_COLUMNS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Shows the view’s empty columns when hiding empties would hide the whole board, without changing its saved preference.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the empty-column projection; saved view settings, explicit column visibility and task writes stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
