import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG =
  "htpr-8199-follow-shortcut-feedback";

export default {
  key: HTPR_8199_FOLLOW_SHORTCUT_FEEDBACK_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-30",
  description:
    "Pressing f to follow a ticket now says what happened when the ticket is your own, you are already an assignee or you already follow it, instead of doing nothing.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only adds a message on the follow paths that already existed; follower rows, unfollowing and notifications stay unchanged. Off restores the silent behaviour.",
  },
} as const satisfies FeatureFlagDefinition;
