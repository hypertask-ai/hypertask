import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9079_OLDER_RAIL_FOLDED_FLAG = "htpr-9079-older-rail-folded";

export default {
  key: HTPR_9079_OLDER_RAIL_FOLDED_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "Full screen AI chat starts with Older folded shut. Today and Previous 7 days stay open. After a person opens or folds a group, that choice stays. Off starts every group open again, except a group they already folded.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only the starting fold of the Older group changes. Off restores the previous all-open start, and a choice already saved on the chat list stays.",
  },
} as const satisfies FeatureFlagDefinition;
