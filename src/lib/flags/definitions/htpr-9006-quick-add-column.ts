import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9006_QUICK_ADD_COLUMN_FLAG = "htpr-9006-quick-add-column";

export default {
  key: HTPR_9006_QUICK_ADD_COLUMN_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "A task created with N stays in the column and label view that were open.",
  releaseRisk: {
    risk: "small",
    reason: "Puts the new task on the board task list in the column that was open. Off keeps the previous cache update.",
  },
} as const satisfies FeatureFlagDefinition;
