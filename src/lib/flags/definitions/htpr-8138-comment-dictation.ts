import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8138_COMMENT_DICTATION_FLAG = "htpr-8138-comment-dictation";

export default {
  key: HTPR_8138_COMMENT_DICTATION_FLAG,
  kind: "bugfix",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-07",
  description: "Dictation records the microphone into the comment draft again. The level bar moves, and the words appear.",
  releaseRisk: {
    risk: "small",
    reason: "Routes the existing microphone through one audio graph so the level bar and the recording hear the same input, and sends the open ticket's board when no current board is set. Flag off keeps today's capture.",
  },
} as const satisfies FeatureFlagDefinition;
