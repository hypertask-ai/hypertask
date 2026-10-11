import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG = "htpr-6368-search-operator-logic";

export default {
  key: HTPR_6368_SEARCH_OPERATOR_LOGIC_FLAG,
  shippedOn: "2026-10-11",
  description:
    "Search understands type:ticket and type:comment, priority:high style filters, exact phrases in double quotes and -word or -\"phrase\" exclusions. Needs the search operators flag. No new screens or controls.",
  related: ["htpr-6369-search-operators"],
  kind: "feature",
  releaseRisk: {
    risk: "none",
    reason: "Search understands more typed operators and phrases; no new screens, chips or controls appear."
  },
} as const satisfies FeatureFlagDefinition;
