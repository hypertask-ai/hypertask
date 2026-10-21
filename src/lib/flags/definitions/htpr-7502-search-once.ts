import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7502_SEARCH_ONCE_FLAG = "htpr-7502-search-once";

export default {
  key: HTPR_7502_SEARCH_ONCE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-21",
  description: "A search link opened in a new tab sends its search once, or not at all when the server already started it, so results show sooner.",
  related: ["htpr-7501-search-server-start", "htpr-6879-search-esc-back"],
  releaseRisk: {
    risk: "small",
    reason: "Same results, tabs and order; only the repeated search request is dropped. Off restores today's two requests.",
  },
} as const satisfies FeatureFlagDefinition;
