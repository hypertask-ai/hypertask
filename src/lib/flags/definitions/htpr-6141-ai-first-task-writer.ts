import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6141_AI_FIRST_TASK_WRITER_FLAG = "htpr-6141-ai-first-task-writer";

export default {
  key: HTPR_6141_AI_FIRST_TASK_WRITER_FLAG,
  shippedOn: "2026-09-04",
  description: "Opens the AI task writer from a column plus instead of the classic new-task form.",
  releaseRisk: {
    "risk": "small",
    "reason": "The column add button opens the AI task writer instead of the classic task form."
  },
} as const satisfies FeatureFlagDefinition;
