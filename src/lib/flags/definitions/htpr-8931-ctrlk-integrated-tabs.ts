import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8931_CTRLK_INTEGRATED_TABS_FLAG = "htpr-8931-ctrlk-integrated-tabs";

export default {
  key: HTPR_8931_CTRLK_INTEGRATED_TABS_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-08",
  description:
    "Ctrl+J and Ctrl+K put the Search and New Task tabs inside the window, top left, with a thin divider under them. The New Task text box uses 4px corners.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only moves the existing tab switch from above the window to inside it on desktop. Both tabs, every shortcut and the content stay the same, and Off restores today's layout.",
  },
} as const satisfies FeatureFlagDefinition;
