import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_OVERDUE_BADGES_FLAG = "htpr-6459-my-tasks-overdue-badges";

export default {
  key: MY_TASKS_OVERDUE_BADGES_FLAG,
  kind: "feature",
  shippedOn: "2026-09-15",
  description:
    "Shows a red overdue count next to each My Tasks view tab and board split tab. Hidden when the count is zero. Counts follow the filters that are on.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks view and board tabs add a red count of overdue tasks."
  },
} as const satisfies FeatureFlagDefinition;
