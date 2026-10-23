import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7185_DELETE_TASK_UNDO_FLAG = "htpr-7185-delete-task-undo";

export default {
  key: HTPR_7185_DELETE_TASK_UNDO_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-13",
  description: "Deleting a task from its detail page keeps Undo available through the toast and Ctrl+Z.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing authenticated task restore and board reconciliation; detail deletion returns to its own board without unloading undo state.",
  },
} as const satisfies FeatureFlagDefinition;
