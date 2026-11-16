import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9393_ARCHIVED_BOARD_TASK_LIST_FLAG =
  "htpr-9393-archived-board-task-list";

export default {
  key: HTPR_9393_ARCHIVED_BOARD_TASK_LIST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "A member can list tasks on an archived board. Project show already returns that board. Off keeps the access denied reply.",
  releaseRisk: {
    risk: "small",
    reason:
      "Task list on one archived board returns that board's tasks for a member. People who are not members still get access denied. A deleted board stays hidden. Off restores the old refusal.",
  },
} as const satisfies FeatureFlagDefinition;
