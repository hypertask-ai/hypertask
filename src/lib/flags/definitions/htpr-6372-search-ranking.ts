import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6372_SEARCH_RANKING_FLAG = "htpr-6372-search-ranking";

export default {
  key: HTPR_6372_SEARCH_RANKING_FLAG,
  shippedOn: "2026-09-14",
  description:
    "Hides search results that do not contain every word you typed, and when you open search from a board, shows that board's matches first.",
} as const satisfies FeatureFlagDefinition;
