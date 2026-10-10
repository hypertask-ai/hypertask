import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6370_SEARCH_CHIPS_FLAG = "htpr-6370-search-chips";

export default {
  key: HTPR_6370_SEARCH_CHIPS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-28",
  description: "Shows search operators as removable chips with people, board and label suggestions.",
  related: ["htpr-6369-search-operators"],
} as const satisfies FeatureFlagDefinition;
