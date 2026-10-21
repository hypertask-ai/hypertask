import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7547_SEARCH_LAZY_CLOSED_FLAG = "htpr-7547-search-lazy-closed";

export default {
  key: HTPR_7547_SEARCH_LAZY_CLOSED_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Search loads the closed command palette and its tools only when opened, leaving results unchanged.",
  related: ["htpr-7502-search-once"],
  releaseRisk: {
    risk: "small",
    reason: "Same closed search markup and command callbacks; a focus proxy retains typing during cold opens, and Off warms the module during search startup.",
  },
} as const satisfies FeatureFlagDefinition;
