import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6879_SEARCH_ESC_BACK_FLAG = "htpr-6879-search-esc-back";

export default {
  key: HTPR_6879_SEARCH_ESC_BACK_FLAG,
  kind: "feature",
  shippedOn: "2026-10-03",
  description: "Escape restores the previous search in this tab or recents and tips; empty searches never hide that list, and board chips omit the extra hash. Requires search layout.",
  related: ["htpr-6865-search-layout"],
} as const satisfies FeatureFlagDefinition;
