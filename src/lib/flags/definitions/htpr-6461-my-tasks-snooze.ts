import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_SNOOZE_FLAG = "htpr-6461-my-tasks-snooze";

export default {
  key: MY_TASKS_SNOOZE_FLAG,
  kind: "feature",
  shippedOn: "2026-09-15",
  description:
    "On My Tasks, H opens the existing Remind Me picker. The chosen date hides the row here and in Inbox until it returns to both.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds snoozing through the existing Remind Me date picker."
  },
} as const satisfies FeatureFlagDefinition;
