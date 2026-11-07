import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8881_BOARD_VIEW_FILTERS_FLAG = "htpr-8881-board-view-filters";

export default {
  key: HTPR_8881_BOARD_VIEW_FILTERS_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "Keeps board filters on the open view and gives unnamed saved views a readable title.",
  releaseRisk: {
    risk: "small",
    reason: "Scopes personal board-setting writes to the selected view without changing saved shared filters or access.",
  },
} as const satisfies FeatureFlagDefinition;
