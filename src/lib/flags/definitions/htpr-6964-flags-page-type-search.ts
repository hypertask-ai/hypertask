import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG = "htpr-6964-flags-page-type-search";

export default {
  key: HTPR_6964_FLAGS_PAGE_TYPE_SEARCH_FLAG,
  shippedOn: "2026-10-06",
  description: "Shows flag kinds and related changes, with a search field that stays visible while scrolling.",
  kind: "feature",
  releaseRisk: {
    "risk": "new",
    "reason": "The flags page adds search, ticket-type badges and links to related changes."
  },
} as const satisfies FeatureFlagDefinition;
