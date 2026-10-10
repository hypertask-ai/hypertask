import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6881_SEARCH_FUZZY_PERSON_FLAG = "htpr-6881-search-fuzzy-person";

export default {
  key: HTPR_6881_SEARCH_FUZZY_PERSON_FLAG,
  shippedOn: "2026-10-03",
  description: "Typed author and assignee filters match all similar names or emails in accessible requested boards, ignoring case and accents; selected person IDs stay exact.",
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
