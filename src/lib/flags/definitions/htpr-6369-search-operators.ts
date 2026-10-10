import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6369_SEARCH_OPERATORS_FLAG = "htpr-6369-search-operators";

export default {
  key: HTPR_6369_SEARCH_OPERATORS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-28",
  description:
    "Searches tasks by author, assignee, board, label, status, date and attachments using query operators, with suggestions for values.",
} as const satisfies FeatureFlagDefinition;
