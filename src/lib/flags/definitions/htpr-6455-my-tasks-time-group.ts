import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_TIME_GROUP_FLAG = "htpr-6455-my-tasks-time-group";

export default {
  key: MY_TASKS_TIME_GROUP_FLAG,
  shippedOn: "2026-09-14",
  description:
    "Groups My Tasks by due time (Overdue, Today, This week, Later, No due date) by default, with board grouping still available per saved view.",
  releaseRisk: {
    "risk": "small",
    "reason": "My Tasks groups tasks by due time by default instead of by board."
  },
} as const satisfies FeatureFlagDefinition;
