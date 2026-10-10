import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_FILTER_PARITY_FLAG = "htpr-6447-my-tasks-filter-parity";

export default {
  key: MY_TASKS_FILTER_PARITY_FLAG,
  kind: "feature",
  shippedOn: "2026-09-14",
  description:
    "Opens the same Kanban filter menu on My Tasks, including match all/any, clear all, and the filters that were still missing.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds the board filter menu and its full set of filter choices."
  },
} as const satisfies FeatureFlagDefinition;
