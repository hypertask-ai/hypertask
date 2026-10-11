import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7095_REACTION_WEBHOOK_FLAG = "htpr-7095-reaction-webhook";

export default {
  key: HTPR_7095_REACTION_WEBHOOK_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description:
    "An agent subscribed to comment.reaction hears when a person adds an emoji reaction to one of its comments, so a thumbs up reaches it as a yes.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only agents that subscribe to the new comment.reaction event receive anything; reactions, notifications and comments look the same to people."
  },
} as const satisfies FeatureFlagDefinition;
