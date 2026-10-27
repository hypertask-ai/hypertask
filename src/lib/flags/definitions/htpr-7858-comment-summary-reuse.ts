import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7858_COMMENT_SUMMARY_REUSE_FLAG = "htpr-7858-comment-summary-reuse";

export default {
  key: HTPR_7858_COMMENT_SUMMARY_REUSE_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Reuse the existing comment TL;DR when its source text has not changed, avoiding repeated AI calls.",
  releaseRisk: {
    risk: "small",
    reason: "Only reuses successful summaries with a matching source hash. Edited comments still regenerate; Off restores regeneration for every job.",
  },
} as const satisfies FeatureFlagDefinition;
