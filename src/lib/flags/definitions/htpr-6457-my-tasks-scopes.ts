import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_SCOPES_FLAG = "htpr-6457-my-tasks-scopes";

export default {
  key: MY_TASKS_SCOPES_FLAG,
  shippedOn: "2026-09-15",
  description:
    "Lets My Tasks show tasks you created, were mentioned in, or watch, not only tasks assigned to you. Multi-select, saved per view.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds choices for tasks created, mentioned or watched as well as assigned."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
