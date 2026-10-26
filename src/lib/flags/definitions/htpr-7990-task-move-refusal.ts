import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7990_TASK_MOVE_REFUSAL_FLAG = "htpr-7990-task-move-refusal";

export default {
  key: HTPR_7990_TASK_MOVE_REFUSAL_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  releaseRisk: {
    risk: "small",
    reason: "Preserves existing task move refusals without changing permissions or successful moves.",
  },
  description: "Task move refusals keep their original response instead of becoming server errors.",
} as const satisfies FeatureFlagDefinition;
