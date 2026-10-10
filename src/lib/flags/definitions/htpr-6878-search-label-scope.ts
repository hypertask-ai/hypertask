import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6878_SEARCH_LABEL_SCOPE_FLAG = "htpr-6878-search-label-scope";

export default {
  key: HTPR_6878_SEARCH_LABEL_SCOPE_FLAG,
  shippedOn: "2026-10-03",
  description: "Scopes search label suggestions to picked boards, shows ticket counts and combines same-name labels across boards. Requires the search layout flag.",
  related: ["htpr-6865-search-layout"],
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
