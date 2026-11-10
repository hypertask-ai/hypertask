import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8976_MOUSE_MULTISELECT_FLAG = "htpr-8976-mouse-multiselect";

export default {
  key: HTPR_8976_MOUSE_MULTISELECT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Board cards select with the mouse like a file manager: Ctrl or Cmd+click adds or removes one card, Shift+click selects a range across columns, and a click on empty board space clears the selection.",
  releaseRisk: {
    risk: "small",
    reason: "Changes how clicks select board cards without touching saved data. Off restores Ctrl+click opening a new tab and same-column Shift ranges.",
  },
} as const satisfies FeatureFlagDefinition;
