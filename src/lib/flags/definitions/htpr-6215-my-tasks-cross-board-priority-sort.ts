import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG = "htpr-6215-my-tasks-cross-board-priority-sort";

export default {
  key: MY_TASKS_CROSS_BOARD_PRIORITY_SORT_FLAG,
  shippedOn: "2026-09-10",
  description:
    "Sorting My Tasks by priority interleaves tasks from every board by priority level, instead of only reordering the tasks within each board's group.",
  releaseRisk: {
    "risk": "small",
    "reason": "My Tasks priority sorting interleaves tasks from all boards by priority."
  },
} as const satisfies FeatureFlagDefinition;
