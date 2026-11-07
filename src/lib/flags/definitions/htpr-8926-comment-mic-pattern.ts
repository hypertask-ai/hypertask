import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8926_COMMENT_MIC_PATTERN_FLAG = "htpr-8926-comment-mic-pattern";

export default {
  key: HTPR_8926_COMMENT_MIC_PATTERN_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  description:
    "Task comments and descriptions use the white mic, and comments end in a plain text Send. While dictating, the compact dictation pill replaces the mic with no purple check, X or dotted line.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only restyles the existing desktop mic and Send in the comment and description editors. Dictation, sending and saving keep working, and Off restores today's controls.",
  },
} as const satisfies FeatureFlagDefinition;
