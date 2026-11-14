import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG = "htpr-8095-task-create-ai-step-timing";

export default {
  key: HTPR_8095_TASK_CREATE_AI_STEP_TIMING_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-14",
  description:
    "A Ctrl+J New Task save also records how long the task writer step and the title step took, next to the save and screen update times it already records.",
  releaseRisk: {
    risk: "none",
    reason:
      "Timing only. Off stops the two AI step measurements and leaves the saved task, its copy, the save order and the screen unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
