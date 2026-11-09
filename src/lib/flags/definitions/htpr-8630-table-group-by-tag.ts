import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8630_TABLE_GROUP_BY_TAG_FLAG = "htpr-8630-table-group-by-tag";

export default {
  key: HTPR_8630_TABLE_GROUP_BY_TAG_FLAG,
  kind: "feature",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-08",
  description: "Table view can group rows by board column or by tag.",
  releaseRisk: {
    risk: "small",
    reason: "Adds an optional table grouping mode saved per view. Off keeps column grouping only.",
  },
} as const satisfies FeatureFlagDefinition;
