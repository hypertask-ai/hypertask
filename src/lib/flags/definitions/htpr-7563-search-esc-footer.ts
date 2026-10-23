import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7563_SEARCH_ESC_FOOTER_FLAG = "htpr-7563-search-esc-footer";

export default {
  key: HTPR_7563_SEARCH_ESC_FOOTER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Search suggestions say Esc to go back when Escape leaves search. Requires the search Escape leaves flag.",
  related: ["htpr-6994-search-esc-leaves"],
  releaseRisk: {
    risk: "small",
    reason: "Changes only existing search suggestion help text. Off restores Esc to close without changing keyboard behavior.",
  },
} as const satisfies FeatureFlagDefinition;
