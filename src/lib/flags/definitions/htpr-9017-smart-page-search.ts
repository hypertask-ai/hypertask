import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9017_SMART_PAGE_SEARCH_FLAG = "htpr-9017-smart-page-search";

export default {
  key: HTPR_9017_SMART_PAGE_SEARCH_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description: "Search pages with the existing semantic and keyword index, checking current board access before returning results.",
  releaseRisk: {
    risk: "small",
    reason: "Uses the existing search and embedding route. Saved pages and board permissions stay unchanged. Revert restores plain word matching.",
  },
} as const satisfies FeatureFlagDefinition;
