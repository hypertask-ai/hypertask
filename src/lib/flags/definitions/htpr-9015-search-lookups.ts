import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9015_SEARCH_LOOKUPS_FLAG = "htpr-9015-search-lookups";

export default {
  key: HTPR_9015_SEARCH_LOOKUPS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "AI search remembers one team route for a minute, reuses the Task Writer ticket search, and skips the memory list when board memory is off.",
  releaseRisk: {
    risk: "small",
    reason: "Off repeats the old route, ticket and memory lookups. Search results stay the same tickets. Saved data, keys and permissions are unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
