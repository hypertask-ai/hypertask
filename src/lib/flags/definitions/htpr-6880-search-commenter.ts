import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6880_SEARCH_COMMENTER_FLAG = "htpr-6880-search-commenter";

export default {
  key: HTPR_6880_SEARCH_COMMENTER_FLAG,
  shippedOn: "2026-10-03",
  description: "Finds tasks commented on by a person and shows their newest matching comment; combines typed text with that person’s comments. The picker requires the search layout flag.",
  related: ["htpr-6865-search-layout"],
} as const satisfies FeatureFlagDefinition;
