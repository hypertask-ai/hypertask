import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7069_FLAGS_DROPDOWN_FILTERS_FLAG = "htpr-7069-flags-dropdown-filters";

export default {
  key: HTPR_7069_FLAGS_DROPDOWN_FILTERS_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-10",
  description:
    "Shows the owner flags-page filters as a wrapping dropdown row with option counts and a count of shown flags beside search.",
  releaseRisk: {
    "risk": "small",
    "reason": "The owner-only flags page replaces existing filter bars with dropdowns and shows how many flags match."
  },
} as const satisfies FeatureFlagDefinition;
