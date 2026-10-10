import type { FeatureFlagDefinition } from "../definitions";

export const MY_TASKS_BULK_SELECTION_FLAG = "htpr-6444-my-tasks-bulk-selection";

export default {
  key: MY_TASKS_BULK_SELECTION_FLAG,
  shippedOn: "2026-09-16",
  description:
    "Adds Inbox-style multi-select on My Tasks with bulk archive, assign, label, and move to column.",
  releaseRisk: {
    "risk": "new",
    "reason": "My Tasks adds multi-selection and bulk archive, assignment, label and move actions."
  },
  kind: "feature",
} as const satisfies FeatureFlagDefinition;
