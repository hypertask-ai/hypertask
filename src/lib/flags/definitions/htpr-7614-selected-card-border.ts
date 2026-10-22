import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_7614_SELECTED_CARD_BORDER_FLAG = "htpr-7614-selected-card-border";

export default {
  key: HTPR_7614_SELECTED_CARD_BORDER_FLAG,
  kind: "bugfix",
  defaultMode: "EVERYONE",
  shippedOn: "2026-10-22",
  description: "Aligns the selected kanban card's blue line with its rounded outer edge on desktop and phone.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes the selected card's outline and preserves its blocked stripe without changing card dimensions. Off restores the existing inset ring.",
  },
} as const satisfies FeatureFlagDefinition;
