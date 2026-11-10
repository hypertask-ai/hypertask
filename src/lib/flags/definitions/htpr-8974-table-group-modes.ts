import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8974_TABLE_GROUP_MODES_FLAG = "htpr-8974-table-group-modes";

export default {
  key: HTPR_8974_TABLE_GROUP_MODES_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-10",
  description: "Table view can group rows by assignee, priority, size or a chosen list of tags.",
  releaseRisk: { risk: "small", reason: "Optional table grouping saved per view. Off keeps the existing column and tag grouping." },
} as const satisfies FeatureFlagDefinition;
