import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8973_TABLE_SORT_COLUMNS_FLAG = "htpr-8973-table-sort-columns";

export default {
  key: HTPR_8973_TABLE_SORT_COLUMNS_FLAG,
  kind: "feature",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Table view uses one sort for the header and the Sort button, saves every sort level, and keeps every view's sort and columns on the view.",
  releaseRisk: {
    risk: "small",
    reason: "Table sort and column layout save on the view. Everywhere is already on in production. Off keeps the shared browser columns and the separate board sort button.",
  },
} as const satisfies FeatureFlagDefinition;
