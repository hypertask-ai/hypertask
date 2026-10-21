import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7263_PHONE_HOLD_SELECT_FLAG = "htpr-7263-phone-hold-select";

export default {
  key: HTPR_7263_PHONE_HOLD_SELECT_FLAG,
  shippedOn: "2026-10-21",
  kind: "feature",
  defaultMode: "EVERYONE",
  releaseRisk: {
    risk: "new",
    reason: "Adds phone hold-to-select alongside card dragging; flag off preserves the existing phone gestures.",
  },
  description: "On phones, hold and release a Kanban card to select it, tap other cards to toggle selection, or hold and move to drag.",
} as const satisfies FeatureFlagDefinition;
