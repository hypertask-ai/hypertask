import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8972_TABLE_GROUP_FOLD_FLAG = "htpr-8972-table-group-fold";

export default {
  key: HTPR_8972_TABLE_GROUP_FOLD_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description:
    "Table view keeps groups when sorting, folds group headers, and persists folded section ids on the saved view.",
  releaseRisk: {
    risk: "small",
    reason:
      "Fixes grouped table sort, fold headers and view persistence for folded sections. Off keeps the previous flat sort and non-persisted headers.",
  },
} as const satisfies FeatureFlagDefinition;
