import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_LIVE_UPDATES_FLAG = "htpr-6458-my-tasks-live-updates";

export default {
  key: MY_TASKS_LIVE_UPDATES_FLAG,
  kind: "feature",
  shippedOn: "2026-09-15",
  description:
    "Updates My Tasks rows live when another tab, the CLI, or an agent changes a task, without reloading the page.",
  releaseRisk: {
    "risk": "small",
    "reason": "Existing My Tasks rows update when a task changes elsewhere without a reload."
  },
} as const satisfies FeatureFlagDefinition;
