import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6371_MOBILE_SEARCH_FLAG = "htpr-6371-mobile-search";

export default {
  key: HTPR_6371_MOBILE_SEARCH_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-11",
  description: "Keeps phone search suggestions above the keyboard with wrapping, thumb-removable filters.",
  related: ["htpr-6370-search-chips"],
  releaseRisk: {
    risk: "small",
    reason: "Only phone search input and picker layout change; operators, results and shared URLs stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
