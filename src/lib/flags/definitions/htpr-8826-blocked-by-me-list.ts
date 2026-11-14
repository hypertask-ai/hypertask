import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8826_BLOCKED_BY_ME_LIST_FLAG = "htpr-8826-blocked-by-me-list";

export default {
  key: HTPR_8826_BLOCKED_BY_ME_LIST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-05",
  description: "Keeps Blocked by me rows and counts together regardless of the previous saved view's hidden columns or subtasks.",
  releaseRisk: {
    risk: "small",
    reason: "Changes only the Blocked by me projection; saved views, blocker markers and permissions stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
