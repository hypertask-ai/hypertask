import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6994_SEARCH_ESC_LEAVES_FLAG = "htpr-6994-search-esc-leaves";

export default {
  key: HTPR_6994_SEARCH_ESC_LEAVES_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-07",
  description: "Escape in search returns to the page you opened search from, even while the empty-box tips are showing.",
} as const satisfies FeatureFlagDefinition;
