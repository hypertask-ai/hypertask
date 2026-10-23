import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7387_SEARCH_OPERATOR_COLOURS_FLAG = "htpr-7387-search-operator-colours";

export default {
  key: HTPR_7387_SEARCH_OPERATOR_COLOURS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "Slack-style search operators autocomplete and reuse the existing filter colours, with four more Search tips. Requires the search operator logic flag.",
  related: ["htpr-6368-search-operator-logic"],
  releaseRisk: {
    risk: "small",
    reason: "Reuses the search chips and suggestions without changing search results. Off restores the existing input behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
