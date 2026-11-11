import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9072_SEARCH_DESCRIPTION_FLAG = "htpr-9072-search-description";

export default {
  key: HTPR_9072_SEARCH_DESCRIPTION_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-11",
  description:
    "Task search JSON returns the full description, including acceptance criteria, instead of the empty legacy column.",
  releaseRisk: {
    risk: "small",
    reason:
      "Callers who can already read the task get the same description text task list returns. Off keeps the legacy column, which is often empty.",
  },
} as const satisfies FeatureFlagDefinition;
