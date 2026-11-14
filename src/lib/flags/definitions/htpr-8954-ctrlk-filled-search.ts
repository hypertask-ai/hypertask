import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8954_CTRLK_FILLED_SEARCH_FLAG = "htpr-8954-ctrlk-filled-search";

export default {
  key: HTPR_8954_CTRLK_FILLED_SEARCH_FLAG,
  kind: "improvement",
  defaultMode: "EVERYONE",
  shippedOn: "2026-11-09",
  description:
    "Ctrl+K Search shows the search box as a filled box with the same fill as the New Task text box, with no thin lines above or below it.",
  releaseRisk: {
    risk: "small",
    reason:
      "Only changes the look of the search box row on desktop. Search, results, shortcuts and the tabs stay the same, and Off restores the previous lines.",
  },
} as const satisfies FeatureFlagDefinition;
