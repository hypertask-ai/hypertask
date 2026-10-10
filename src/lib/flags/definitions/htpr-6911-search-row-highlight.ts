import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG = "htpr-6911-search-row-highlight";

export default {
  key: HTPR_6911_SEARCH_ROW_HIGHLIGHT_FLAG,
  shippedOn: "2026-10-03",
  description: "Gives selected search results and suggestions the inbox highlight: background edge to edge and the accent bar on the far left. Requires the search layout flag.",
  related: ["htpr-6865-search-layout"],
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
} as const satisfies FeatureFlagDefinition;
