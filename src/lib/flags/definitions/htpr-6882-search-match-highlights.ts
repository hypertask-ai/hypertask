import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG = "htpr-6882-search-match-highlights";

export default {
  key: HTPR_6882_SEARCH_MATCH_HIGHLIGHTS_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description: "Shows why search results matched with inbox-style person highlights, label and board pills, safe text highlights and comment authors. Requires the search layout flag.",
  related: ["htpr-6865-search-layout"],
} as const satisfies FeatureFlagDefinition;
