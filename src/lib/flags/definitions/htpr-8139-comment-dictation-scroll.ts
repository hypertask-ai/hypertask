import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8139_COMMENT_DICTATION_SCROLL_FLAG = "htpr-8139-comment-dictation-scroll";

export default {
  key: HTPR_8139_COMMENT_DICTATION_SCROLL_FLAG,
  shippedOn: "2026-10-28",
  kind: "bugfix",
  defaultMode: "EVERYONE",
  description: "Reveals the comment box before starting dictation with Ctrl+Shift+D or Ctrl+Shift+F on a long ticket.",
  releaseRisk: {
    risk: "small",
    reason: "Only scrolls the existing comment composer for its desktop dictation shortcuts; recording and draft handling stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
