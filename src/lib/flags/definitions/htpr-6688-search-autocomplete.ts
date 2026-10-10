import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG = "htpr-6688-search-autocomplete";

export default {
  key: HTPR_6688_SEARCH_AUTOCOMPLETE_FLAG,
  shippedOn: "2026-10-01",
  description: "Completes search operators and values with keyboard suggestions, coloured filters, an active filter frame, search tips and highlighted result titles.",
  related: ["htpr-6369-search-operators", "htpr-6370-search-chips"],
} as const satisfies FeatureFlagDefinition;
