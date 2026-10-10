import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_PRIORITY_FILTER_FLAG = "htpr-6312-my-tasks-priority-filter";

export default {
  key: MY_TASKS_PRIORITY_FILTER_FLAG,
  kind: "feature",
  shippedOn: "2026-09-09",
  description:
    "Adds a priority filter to the My Tasks page. Picking one or more priority levels shows only those tasks; the choice resets when the page reloads.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds a filter for one or more priority levels."
  },
} as const satisfies FeatureFlagDefinition;
