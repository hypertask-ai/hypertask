import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG = "htpr-7649-sidebar-view-saved";

export default {
  key: HTPR_7649_SIDEBAR_VIEW_SAVED_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-23",
  description: "Keeps the sidebar Teams or Recent choice with the account across browsers and sign-ins.",
  releaseRisk: {
    risk: "small",
    reason: "Saves only the sidebar grouping preference. Off keeps the existing browser-local choice without account synchronization.",
  },
} as const satisfies FeatureFlagDefinition;
