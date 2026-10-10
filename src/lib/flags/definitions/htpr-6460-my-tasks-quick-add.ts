import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_QUICK_ADD_FLAG = "htpr-6460-my-tasks-quick-add";

export default {
  key: MY_TASKS_QUICK_ADD_FLAG,
  shippedOn: "2026-09-15",
  description:
    "Adds a quick-add row at the top of My Tasks that creates a task on the view's default board, assigned to you.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds a quick-add row that creates tasks on the view default board."
  },
} as const satisfies FeatureFlagDefinition;
