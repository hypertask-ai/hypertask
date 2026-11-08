import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8943_CTRLK_TABS_ON_TOP_FLAG = "htpr-8943-ctrlk-tabs-on-top";

export default {
  key: HTPR_8943_CTRLK_TABS_ON_TOP_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-08",
  description:
    "Ctrl+K shows the Search and New Task tabs at the top of the window, with the search box under them, so the tabs stay in the same place when you switch to New Task.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only moves the tab row above the search box on desktop. Both tabs, every shortcut and the results stay the same, and Off restores the previous order.",
  },
} as const satisfies FeatureFlagDefinition;
