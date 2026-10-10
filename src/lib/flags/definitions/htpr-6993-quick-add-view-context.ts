import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG = "htpr-6993-quick-add-view-context";

export default {
  key: HTPR_6993_QUICK_ADD_VIEW_CONTEXT_FLAG,
  shippedOn: "2026-10-07",
  description: "Quick add inherits the open board view labels, assignees, priority and size so the new card stays visible immediately.",
  kind: "bugfix",
} as const satisfies FeatureFlagDefinition;
