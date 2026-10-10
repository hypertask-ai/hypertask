import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6427_ROW_SHORTCUTS_FLAG = "htpr-6427-row-shortcuts";

export default {
  key: HTPR_6427_ROW_SHORTCUTS_FLAG,
  shippedOn: "2026-09-14",
  description:
    "Lets the selected table or My Tasks row use the same task property shortcuts as a Kanban card without opening the task.",
  releaseRisk: {
    "risk": "small",
    "reason": "Existing table and My Tasks rows respond to task-property keyboard shortcuts."
  },
} as const satisfies FeatureFlagDefinition;
