import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_VIEWS_FLAG = "htpr-6422-my-tasks-views";

export default {
  key: MY_TASKS_VIEWS_FLAG,
  kind: "feature",
  shippedOn: "2026-09-14",
  description:
    "Adds personal saved views to My Tasks with board, column, task filters, done visibility, and sorting.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds personal saved views with filters and sorting."
  },
} as const satisfies FeatureFlagDefinition;
