import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9362_HIDE_ACTIVE_VIEW_FLAG = "htpr-9362-hide-active-view";

export default {
  key: HTPR_9362_HIDE_ACTIVE_VIEW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-16",
  description:
    "Hiding the view you are looking at, such as Blocked, moves the board back to its default view so the view leaves the tab list and stays hidden after a reload.",
  releaseRisk: {
    risk: "small",
    reason:
      "Changes only what happens when someone hides the view they currently have open. With the switch off, hiding a view behaves exactly as it does today.",
  },
} as const satisfies FeatureFlagDefinition;
