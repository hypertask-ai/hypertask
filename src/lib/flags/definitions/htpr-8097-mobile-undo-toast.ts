import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8097_MOBILE_UNDO_TOAST_FLAG = "htpr-8097-mobile-undo-toast";

export default {
  key: HTPR_8097_MOBILE_UNDO_TOAST_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-27",
  description: "Restore the small mobile undo toast near the middle-left of the screen, clear of archive controls. Desktop stays unchanged.",
  releaseRisk: {
    risk: "small",
    reason: "Restores historical phone placement and compact content in the existing undo toaster. Undo actions, duration and desktop appearance stay unchanged; Off restores the current phone toast.",
  },
} as const satisfies FeatureFlagDefinition;
