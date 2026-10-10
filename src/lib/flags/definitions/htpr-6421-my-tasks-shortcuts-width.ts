import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_SHORTCUTS_WIDTH_FLAG = "htpr-6421-my-tasks-shortcuts-width";

export default {
  key: MY_TASKS_SHORTCUTS_WIDTH_FLAG,
  shippedOn: "2026-09-14",
  description:
    "Enables global shortcuts on My Tasks, remembers the selected board in the URL, and uses the full available page width.",
  releaseRisk: {
    "risk": "small",
    "reason": "My Tasks supports global shortcuts, remembers the board tab and uses the available width."
  },
  kind: "improvement",
} as const satisfies FeatureFlagDefinition;
