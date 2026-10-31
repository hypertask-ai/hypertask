import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8218_COMMENT_PIN_STAR_FLAG = "htpr-8218-comment-pin-star";

export default {
  key: HTPR_8218_COMMENT_PIN_STAR_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description: "Agents can pin and star a comment, the same marker people already use.",
  releaseRisk: {
    risk: "small",
    reason: "Adds one agent action on the existing comment tool; it saves or removes the caller's own marker and touches no other comment data. Off removes the action and leaves add, update and delete as before.",
  },
} as const satisfies FeatureFlagDefinition;
