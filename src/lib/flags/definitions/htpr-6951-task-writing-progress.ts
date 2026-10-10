import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6951_TASK_WRITING_PROGRESS_FLAG = "htpr-6951-task-writing-progress";

export default {
  key: HTPR_6951_TASK_WRITING_PROGRESS_FLAG,
  shippedOn: "2026-10-05",
  description: "Shows the Task Writer's current step in the New Task window instead of only a spinner. Requires the New Task window flag.",
  related: ["htpr-6937-new-task-window", "htpr-6929-compose-task-writer"],
  releaseRisk: {
    "risk": "small",
    "reason": "The New Task window shows the current writing step instead of only a spinner."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
