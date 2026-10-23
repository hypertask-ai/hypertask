import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7611_COMMENT_PARTS_ONE_PASS_FLAG = "htpr-7611-comment-parts-one-pass";

export default {
  key: HTPR_7611_COMMENT_PARTS_ONE_PASS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Loads comment reactions and emoji options with the comment, so each comment shows at full height in one pass and the ticket thread does not jump after it opens.",
  related: ["htpr-6899-stable-layout"],
  releaseRisk: {
    risk: "small",
    reason: "Only changes when two small comment parts load; final layout is unchanged. Off restores loading them separately.",
  },
} as const satisfies FeatureFlagDefinition;
