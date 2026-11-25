import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8976_MOUSE_MULTISELECT_FLAG = "htpr-8976-mouse-multiselect";

export default {
  key: HTPR_8976_MOUSE_MULTISELECT_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-10",
  description: "Board cards select with the mouse like a file manager: Ctrl or Cmd+click adds or removes one card, Shift+click selects a range across columns, a click on empty board space clears the selection, and the selection bar teaches it with a one-time hint.",
  releaseRisk: {
    risk: "small",
    reason: "Changes how clicks select board cards and adds one line of hint text to the selection bar, without touching saved data. Off restores Ctrl+click opening a new tab, same-column Shift ranges and no hint.",
  },
} as const satisfies FeatureFlagDefinition;
