import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG = "htpr-7077-task-writer-real-error";

export default {
  key: HTPR_7077_TASK_WRITER_REAL_ERROR_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-10",
  description:
    "When the AI fails before writing anything, the task writer shows the real reason (such as the monthly AI allowance being used up) instead of an endless try again.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the error text shown when the AI returns nothing changes; successful drafts are untouched."
  },
} as const satisfies FeatureFlagDefinition;
