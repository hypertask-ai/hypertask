import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8013_SIDEBAR_WIDTH_FLAG = "htpr-8013-sidebar-width";

export default {
  key: HTPR_8013_SIDEBAR_WIDTH_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-26",
  description: "Remembers the dragged AI chat sidebar width per account on this browser, without replacing it when the window temporarily narrows.",
  releaseRisk: {
    risk: "small",
    reason: "Reuses the existing resize handle and viewport limits; Off restores the previous shared width preference.",
  },
} as const satisfies FeatureFlagDefinition;
