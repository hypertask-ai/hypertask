import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7097_DELETED_VIEW_LEAVES_TABS_FLAG = "htpr-7097-deleted-view-leaves-tabs";

export default {
  key: HTPR_7097_DELETED_VIEW_LEAVES_TABS_FLAG,
  kind: "bugfix",
  shippedOn: "2026-10-11",
  description:
    "A saved view you delete leaves the view tabs and the Manage Views list right away, without a page reload.",
  releaseRisk: {
    "risk": "small",
    "reason": "Only the board's cached task and view copy is refreshed after a view is deleted; no saved data changes."
  },
} as const satisfies FeatureFlagDefinition;
