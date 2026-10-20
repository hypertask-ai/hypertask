import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7393_COMMENT_INLINE_AI_FLAG = "htpr-7393-comment-inline-ai";

export default {
  key: HTPR_7393_COMMENT_INLINE_AI_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-20",
  description: "Restores the inline AI writer for new and existing comments while descriptions keep the sidebar chat.",
  releaseRisk: {
    risk: "small",
    reason: "Restores existing comment editor routing only; switching off preserves the current sidebar behavior.",
  },
} as const satisfies FeatureFlagDefinition;
