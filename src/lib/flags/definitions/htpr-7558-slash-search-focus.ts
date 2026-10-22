import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7558_SLASH_SEARCH_FOCUS_FLAG = "htpr-7558-slash-search-focus";

export default {
  key: HTPR_7558_SLASH_SEARCH_FOCUS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Keep the search box focused when / opens an empty search, ready for typing without a click.",
  releaseRisk: {
    risk: "small",
    reason: "Skips server-result navigation for queries too short to search; Enter submission, result navigation and Escape are unchanged. Off retains the previous focus behavior.",
  },
} as const satisfies FeatureFlagDefinition;
