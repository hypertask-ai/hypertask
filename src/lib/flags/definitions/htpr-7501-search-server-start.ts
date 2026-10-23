import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7501_SEARCH_SERVER_START_FLAG = "htpr-7501-search-server-start";

export default {
  key: HTPR_7501_SEARCH_SERVER_START_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Starts the search on the server when a search page is opened as a full page load, so its results show sooner.",
  releaseRisk: {
    risk: "small",
    reason: "Same results, tabs and order from the same search; the page falls back to its own search when the server result is missing or for another query.",
  },
} as const satisfies FeatureFlagDefinition;
