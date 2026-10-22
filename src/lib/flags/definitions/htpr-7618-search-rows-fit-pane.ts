import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7618_SEARCH_ROWS_FIT_PANE_FLAG = "htpr-7618-search-rows-fit-pane";

export default {
  key: HTPR_7618_SEARCH_ROWS_FIT_PANE_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Lay out search result rows by the width of the search pane, so they stay readable in half-screen view with the AI sidebar open.",
  releaseRisk: {
    risk: "small",
    reason: "Only switches the row grid from a window-width rule to the search pane's width; full-width rows and phone rows are unchanged. Off restores the window-width rule.",
  },
} as const satisfies FeatureFlagDefinition;
