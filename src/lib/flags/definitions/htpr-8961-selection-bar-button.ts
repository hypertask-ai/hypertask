import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8961_SELECTION_BAR_BUTTON_FLAG = "htpr-8961-selection-bar-button";

export default {
  key: HTPR_8961_SELECTION_BAR_BUTTON_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-09",
  description: "The Open actions button on the board selection bar uses the app's neutral filled button instead of the indigo one. Off restores the indigo button.",
  releaseRisk: {
    risk: "small",
    reason: "Only the colour of one button changes. Selection, actions and shortcuts stay the same.",
  },
} as const satisfies FeatureFlagDefinition;
