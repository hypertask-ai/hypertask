import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9017_SMART_PAGE_SEARCH_FLAG = "htpr-9017-smart-page-search";

export default {
  key: HTPR_9017_SMART_PAGE_SEARCH_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Page search finds a page from different words by reading the page index that already stores its text and meaning. Board access is still checked on the current page before anything is returned.",
  releaseRisk: {
    risk: "small",
    reason:
      "Returns the same kind of page results from the existing search route and embedding spend. Pages are still filtered by today's board access, archive state and Normal boards. Off restores plain word matching.",
  },
} as const satisfies FeatureFlagDefinition;
