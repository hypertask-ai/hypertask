import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8172_NEW_TASK_AI_NAVIGATION_FLAG = "htpr-8172-new-task-ai-navigation";

export default {
  key: HTPR_8172_NEW_TASK_AI_NAVIGATION_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-29",
  description: "Keeps Ctrl+J on the saved task with its AI sidebar instead of returning from New Task to the board.",
  releaseRisk: {
    risk: "small",
    reason: "Skips the board redirect only during the existing New Task page keyboard handoff; modal closing and ordinary saves stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
