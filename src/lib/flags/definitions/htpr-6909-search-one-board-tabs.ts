import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG = "htpr-6909-search-one-board-tabs";

export default {
  key: HTPR_6909_SEARCH_ONE_BOARD_TABS_FLAG,
  shippedOn: "2026-10-03",
  description: "Hides the search result tab row when every result comes from one board and there is no open or archived split.",
} as const satisfies FeatureFlagDefinition;
