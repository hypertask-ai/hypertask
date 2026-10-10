import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6555_IDLE_COMMENT_MIC_FLAG = "htpr-6555-idle-comment-mic";

export default {
  key: HTPR_6555_IDLE_COMMENT_MIC_FLAG,
  shippedOn: "2026-09-17",
  description:
    "Shows the microphone on the closed task-detail comment bar so you can start dictating with one tap instead of tapping the text first.",
  releaseRisk: {
    "risk": "new",
    "reason": "Adds a microphone to the closed comment bar so dictation can start with one tap."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
