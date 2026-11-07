import type { FeatureFlagDefinition } from "../definitions";

export const YPER4_651_SELF_FOLLOW_QUIET_FLAG = "yper4-651-self-follow-quiet";

export default {
  key: YPER4_651_SELF_FOLLOW_QUIET_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-10-24",
  description:
    "Stops follower-added notifications when a person follows a ticket or adds their own agent as a follower, while keeping agent mentions and other people's follower additions.",
  releaseRisk: {
    risk: "small",
    highRisk: "customer-email",
    reason: "Suppresses self-added follower notifications used by customer email digests and pushes; follower creation and agent mentions stay unchanged. Off restores the existing notifications."
  },
} as const satisfies FeatureFlagDefinition;
