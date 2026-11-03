import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8437_PEOPLE_COMMENT_NEEDS_KIND_FLAG = "htpr-8437-people-comment-needs-kind";

export default {
  key: HTPR_8437_PEOPLE_COMMENT_NEEDS_KIND_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-03",
  description: "A comment posted through the agent API with no kind is refused with the three allowed kinds instead of appearing for people as robot status. Off accepts the untyped comment again.",
  releaseRisk: {
    risk: "small",
    reason: "Only comment writes through /api/mcp/comments change. The app comment box, agents writing to the hidden agent log and stored comments are untouched.",
  },
} as const satisfies FeatureFlagDefinition;
