import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG = "htpr-7776-default-view-filters";

export default {
  key: HTPR_7776_DEFAULT_VIEW_FILTERS_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-24",
  description:
    "Applies board default filters for members without a personal view row. Off restores unfiltered tickets for those members.",
  releaseRisk: {
    risk: "small",
    reason: "Restores intended board filtering without changing board access, tickets or saved views.",
  },
} as const satisfies FeatureFlagDefinition;
