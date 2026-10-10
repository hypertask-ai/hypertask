import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_TABLE_COLUMNS_FLAG = "htpr-6456-my-tasks-table-columns";

export default {
  key: MY_TASKS_TABLE_COLUMNS_FLAG,
  shippedOn: "2026-09-15",
  description:
    "Lets you choose which My Tasks table columns show, and saves that choice in the active My Tasks view.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds a column picker whose choices are saved with the view."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
