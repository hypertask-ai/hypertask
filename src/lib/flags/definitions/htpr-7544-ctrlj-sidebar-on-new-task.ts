import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG = "htpr-7544-ctrlj-sidebar-on-new-task";

export default {
  key: HTPR_7544_CTRLJ_SIDEBAR_ON_NEW_TASK_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "On an empty task detail, Ctrl+J opens the existing AI sidebar to write that task's description instead of opening New Task.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the task-bound sidebar editing flow only for empty task details; board shortcuts and flag-off behavior stay unchanged.",
  },
} as const satisfies FeatureFlagDefinition;
