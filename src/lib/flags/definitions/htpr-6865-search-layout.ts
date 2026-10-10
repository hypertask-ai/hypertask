import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6865_SEARCH_LAYOUT_FLAG = "htpr-6865-search-layout";

export default {
  key: HTPR_6865_SEARCH_LAYOUT_FLAG,
  shippedOn: "2026-10-03",
  description: "Shows one aligned search suggestion list with recents, tips, people emails and grey value completion; searches only after acceptance or Enter. Requires search autocomplete, chips and operators.",
  related: ["htpr-6369-search-operators", "htpr-6370-search-chips", "htpr-6688-search-autocomplete"],
} as const satisfies FeatureFlagDefinition;
