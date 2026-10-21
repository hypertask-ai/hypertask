import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6865_SEARCH_LAYOUT_FLAG = "htpr-6865-search-layout";

export default {
  key: HTPR_6865_SEARCH_LAYOUT_FLAG,
  shippedOn: "2026-10-03",
  description: "Shows one aligned search suggestion list with recents, tips, people emails and grey value completion; searches only after acceptance or Enter. Requires search autocomplete.",
  related: ["htpr-6688-search-autocomplete"],
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
