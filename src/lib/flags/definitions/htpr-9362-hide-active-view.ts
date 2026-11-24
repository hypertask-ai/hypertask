import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_9362_HIDE_ACTIVE_VIEW_FLAG = "htpr-9362-hide-active-view";

export default {
  key: HTPR_9362_HIDE_ACTIVE_VIEW_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-22",
  description:
    "Hiding the view you are looking at, such as Blocked, removes it from the board tabs at once and keeps it hidden after a reload.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes hiding the open board view. Off keeps the open view in the tab list until you leave it.",
  },
} as const satisfies FeatureFlagDefinition;
